import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { basename } from "node:path/posix";
import { DatabaseSync } from "node:sqlite";
import { serve, upgradeWebSocket } from "@hono/node-server";
import {
  ALERT_FILES,
  type AlertFile,
  api,
  CHANNEL_CONTEXT,
  type ChannelMessage,
  type Choices,
  type ChosenPresence,
  CONTRACT_VERSION,
  type ConflictPair,
  type ContractError,
  ContractFailure,
  decode,
  EXECUTOR_NAMES,
  type ExecutorId,
  encode,
  encodeVersionMismatch,
  HISTORY_PAGE,
  LIVE_SOCKET,
  MAX_FRAME_BYTES,
  type MemberView,
  type ObservedFile,
  type Post,
  PRESENCE_DURATIONS,
  type Presence,
  type PresenceDuration,
  type Qa,
  RUNNER_SOCKET,
  runnerToServer,
  type ShareLevel,
  type StatusLine,
  serverToRunner,
  serverToWeb,
  type Visibility,
  type Work,
  type WorkRef,
  type WorkView,
  webToServer,
} from "@omagari/contract";
import { checkoutVersion } from "@omagari/contract/version";
import type { WSContext } from "hono/ws";
import { type WebSocket, WebSocketServer } from "ws";
import type { GitHub } from "./github.ts";
import { createApp, mount } from "./http.ts";

export { type GitHub, type Pull, realGitHub } from "./github.ts";

/** push 권한을 다시 확인하는 주기. Room의 10분에서 시작한다(ADR-0011). */
const RECHECK_MS = 10 * 60_000;
/** 러너 연결의 생사를 묻는 주기. 답이 없으면 다음 주기에 끊는다. */
const HEARTBEAT_MS = 30_000;
/** 끝나지 않은 기기 인증을 들고 있는 수의 상한. 로그인 없이 부르는 경로라 GitHub에 무한히 묻지 않는다. */
const MAX_PENDING_LOGINS = 100;
/** 작업마다의 초안 PR 제목과 머지 여부를 GitHub에서 다시 읽는 주기. 오래된 오프라인 멤버도 이 주기에 지운다. */
const FOLLOW_MS = 60_000;
/** 오프라인인 멤버의 관측과 상태 한 줄을 남겨 두는 시간. Room의 7일이다(1단계 질문 A10). */
const FORGET_MS = 7 * 24 * 60 * 60_000;
/** 지표의 하루를 자르는 시간대. 만드는 팀의 하루다(ADR-0018). 서울은 일광 절약 시간이 없어 하루가 늘 24시간이다. */
const TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60_000;
/** `TIME_ZONE`에서 그 시각의 날짜(YYYY-MM-DD). sv-SE가 ISO 꼴로 적는다. */
const dayOf = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(ms);

/** 에이전트가 쓴 줄이 없을 때 보이는 고치는 파일의 줄. 바뀐 것이 없으면 없다. */
function filesLine(files: ObservedFile[]) {
  const [first] = files;
  if (!first) return null;
  const others = files.length > 1 ? ` 외 ${files.length - 1}개` : "";
  return `${basename(first.path)}${others} 수정 중`;
}

const hash = (session: string) => createHash("sha256").update(session).digest("hex");
const bearer = (authorization?: string) => authorization?.match(/^Bearer (\S+)$/)?.[1];

/** 문답을 읽는다. 뒤에 WHERE와 ORDER BY를 붙여 쓴다. */
const QAS = "SELECT id, channel, login, executor, question, at, answer, visibility FROM qas";
type QaRow = {
  id: number;
  channel: string;
  login: string;
  executor: ExecutorId;
  question: string;
  at: number;
  answer: string | null;
  visibility: Visibility;
};
const qaView = (row: QaRow): Qa => ({
  id: row.id,
  channel: row.channel,
  executor: row.executor,
  question: row.question,
  at: new Date(row.at).toISOString(),
  visibility: row.visibility,
  answer: row.answer === null ? { state: "pending" } : JSON.parse(row.answer),
});

/** 처음 알림을 올릴 때 알림 채널이 없으면 쓰거나 만드는 채널. */
const ALERT_CHANNEL = "부딪힘";

/** 포스트(채널 줄)의 글 수. `c`가 포스트의 채널이다. */
const POST_COUNT = "(SELECT COUNT(*) FROM messages WHERE channel = c.id)";

/**
 * 메시지를 쓴 사람의 이름과, 공개된 문답이면 그 문답, 알림이면 그 알림과 달린 포스트와 함께 읽는다. 뒤에 WHERE와 ORDER BY를 붙여 쓴다.
 */
const MESSAGES = `SELECT m.id, m.channel, m.login, m.text, m.note, m.at, p.name,
  q.id AS qa, q.executor, q.question, q.at AS asked, q.answer, q.visibility,
  m.alert, a.works, a.files, a.resolved,
  c.id AS post, CASE WHEN c.id IS NULL THEN 0 ELSE ${POST_COUNT} END AS count FROM messages m
  LEFT JOIN people p ON p.login = m.login
  LEFT JOIN qas q ON q.id = m.qa
  LEFT JOIN alerts a ON a.id = m.alert
  LEFT JOIN channels c ON c.alert = m.id AND m.alert IS NOT NULL`;
type MessageRow = {
  id: number;
  channel: string;
  login: string;
  text: string | null;
  note: string | null;
  at: number;
  name: string | null;
  qa: number | null;
  asked: number;
  alert: number | null;
  works: string | null;
  files: string | null;
  resolved: number | null;
  post: string | null;
  count: number;
} & Pick<QaRow, "executor" | "question" | "answer" | "visibility">;

const messageView = (row: MessageRow): ChannelMessage => {
  if (row.alert !== null) {
    const files: AlertFile[] = JSON.parse(row.files ?? "[]");
    return {
      kind: "alert",
      id: row.id,
      channel: row.channel,
      at: new Date(row.at).toISOString(),
      alert: {
        kind: "direct",
        works: JSON.parse(row.works ?? "[]"),
        files: files.slice(0, ALERT_FILES),
        more: Math.max(files.length - ALERT_FILES, 0),
        resolved: row.resolved === null ? null : new Date(row.resolved).toISOString(),
      },
      post: row.post === null ? null : { channel: row.post, count: row.count },
    };
  }
  const common = {
    id: row.id,
    channel: row.channel,
    login: row.login,
    name: row.name ?? row.login,
    at: new Date(row.at).toISOString(),
  };
  if (row.qa === null) return { kind: "text", ...common, text: row.text ?? "" };
  return {
    kind: "qa",
    ...common,
    ...(row.note !== null && { text: row.note }),
    qa: qaView({ ...row, id: row.qa, at: row.asked }),
  };
};

export async function startServer(options: {
  /** 워크스페이스의 레포 `owner/name`. 서버 하나에 워크스페이스 하나, 레포 하나다(ADR-0012). */
  repo: string;
  github: GitHub;
  /** SQLite 파일. 주지 않으면 메모리에 두고 서버가 꺼지면 잃는다. */
  database?: string;
  port?: number;
  /** 듣는 주소. 기본은 이 기기 안에서만 듣는다. 바깥에 열 때만 "0.0.0.0"처럼 준다. */
  hostname?: string;
  recheckMs?: number;
  heartbeatMs?: number;
  followMs?: number;
  forgetMs?: number;
  /** 고른 접속 상태가 온라인으로 돌아오기까지의 시간. 테스트가 줄여 쓴다. 주지 않은 것은 계약의 시간이다. */
  presenceDurations?: Partial<Record<PresenceDuration, number>>;
}) {
  const { repo, github } = options;
  const version = checkoutVersion();
  const hostname = options.hostname ?? "127.0.0.1";
  const db = new DatabaseSync(options.database ?? ":memory:");
  // 세션은 해시로만 둔다. GitHub 토큰은 서버 밖으로 나가지 않는다.
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    github_token TEXT NOT NULL
  ) STRICT`);
  // 멤버마다 GitHub 프로필의 이름. 로그인할 때마다 다시 적는다.
  db.exec(`CREATE TABLE IF NOT EXISTS people (
    login TEXT PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT`);
  // 작업(멤버 + 브랜치)마다의 마지막 관측. `files`는 계약의 ObservedFile 배열(JSON)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS works (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    base TEXT NOT NULL,
    share TEXT NOT NULL,
    files TEXT NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT`);
  // 작업마다 에이전트가 쓴 상태 한 줄. `at`은 쓴 시각(ms)이다. 관측이 없는 브랜치에도 쓸 수 있고, 관측되면 보인다.
  db.exec(`CREATE TABLE IF NOT EXISTS lines (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT`);
  // 멤버마다 러너가 붙을 때 알린 실행기. 실행기마다 에이전트가 하나다(ADR-0015). 러너가 떨어져도 남아 오프라인으로 보인다.
  db.exec(`CREATE TABLE IF NOT EXISTS agents (
    login TEXT NOT NULL,
    executor TEXT NOT NULL,
    PRIMARY KEY (login, executor)
  ) STRICT`);
  // 러너가 떨어진 멤버와 떨어진 시각(ms). 러너가 붙으면 지운다.
  db.exec(`CREATE TABLE IF NOT EXISTS offline (
    login TEXT PRIMARY KEY,
    since INTEGER NOT NULL
  ) STRICT`);
  // 사람마다 스스로 고른 접속 상태와 상태 메시지. `presence`는 계약의 ChosenPresence, `until`은 고른 것이 끝나는 시각(ms)이고
  // NULL이면 직접 바꿀 때까지다. `message`와 `emoji`(글 앞의 이모지 한 칸)가 빈 글이면 없다. 들어와 있는지(웹 창)는 여기 두지 않는다.
  db.exec(`CREATE TABLE IF NOT EXISTS profiles (
    login TEXT PRIMARY KEY,
    presence TEXT NOT NULL,
    until INTEGER,
    message TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT ''
  ) STRICT`);
  // v0.1.0의 표에는 `emoji`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('profiles') WHERE name = 'emoji'").get())
    db.exec("ALTER TABLE profiles ADD COLUMN emoji TEXT NOT NULL DEFAULT ''");
  // 채팅 채널. 이름은 대소문자를 가리지 않고 하나뿐이다.
  db.exec(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  ) STRICT`);
  // 채널의 메시지. `id`는 워크스페이스 전체에서 늘어나기만 한다(AUTOINCREMENT라 지워도 다시 쓰지 않는다).
  // 웹이 다시 붙을 때 이 번호 뒤의 것을 이어 받는다. `at`은 쓴 시각(ms)이다.
  // 사람이 쓴 글이면 `text`, 공개된 문답이면 `qa`(문답 번호) 가운데 하나만 있다. 문답의 `login`은 그 에이전트의 주인이다.
  // `note`는 문답을 올린 사람이 함께 쓴 글이다(없으면 NULL). `text`의 CHECK를 바꾸려면 표를 다시 만들어야 해서 따로 둔다.
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    text TEXT,
    qa INTEGER UNIQUE REFERENCES qas (id),
    at INTEGER NOT NULL,
    note TEXT,
    CHECK ((text IS NULL) != (qa IS NULL))
  ) STRICT`);
  // v0.1.0의 표에는 `note`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'note'").get())
    db.exec("ALTER TABLE messages ADD COLUMN note TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel, id)");
  // 알림에 달린 포스트(문답 Q3)는 채널의 한 줄이다. 그래서 글, 지난 대화, DM, `@호출`, 채널에 올리기가 채널과 같은 길로 돈다.
  // `alert`는 알림이 선 메시지의 번호이고, 채팅 채널이면 NULL이다. 포스트의 `name`은 사람이 지을 수 없는 이름(줄바꿈으로 시작)이라
  // 채팅 채널의 이름과 겹치지 않는다. 사람이 읽는 이름은 `postName`이 짓는다. v0.1.0의 표에는 `alert`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'alert'").get())
    db.exec("ALTER TABLE channels ADD COLUMN alert INTEGER REFERENCES messages (id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS channels_by_alert ON channels (alert)");
  // 알림(ADR-0023): 두 작업 한 쌍의 직접 충돌. 채널에는 messages의 한 줄(`alert`)로 선다. 그 줄의 `text`는 빈 글, `login`은 빈 이름이다
  // (`text`의 CHECK를 바꾸려면 표를 다시 만들어야 한다). `pair`는 두 작업을 정한 순서로 적은 열쇠, `works`는 계약의 WorkRef 둘(JSON),
  // `files`는 묶은 파일 전부(계약의 AlertFile 배열, 확인된 것부터 경로 순)다. `resolved`는 풀린 시각(ms)이고, 풀리지 않은 알림은 쌍마다 하나다.
  // `updated`는 마지막으로 고친 시각(ms)이다. 실시간 연결이 다시 붙을 때 끊긴 사이에 고친 알림을 다시 보낸다.
  db.exec(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    works TEXT NOT NULL,
    files TEXT NOT NULL,
    resolved INTEGER,
    updated INTEGER NOT NULL
  ) STRICT`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS alerts_open ON alerts (pair) WHERE resolved IS NULL");
  // v0.1.0의 표에는 `alert`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'alert'").get())
    db.exec("ALTER TABLE messages ADD COLUMN alert INTEGER REFERENCES alerts (id)");
  // 워크스페이스의 설정 하나씩. 지금은 알림 채널(`alert_channel`)뿐이다.
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`);
  // 문답. 묻는 사람(`login`)이 그 에이전트의 주인이다. 비공개면 그 사람만 보고, 공개면 messages에 한 줄이 서서 모두가 본다.
  // `answer`는 계약의 Qa.answer(JSON)이고, 답을 기다리는 동안 NULL이다. `settled`는 답이나 실패를 적은 시각(ms)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS qas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    executor TEXT NOT NULL,
    question TEXT NOT NULL,
    at INTEGER NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'public')),
    answer TEXT,
    settled INTEGER
  ) STRICT`);
  db.exec("CREATE INDEX IF NOT EXISTS qas_by_asker ON qas (login, channel, id)");
  // 날마다 들어온 멤버(ADR-0018). 날은 `TIME_ZONE`의 날짜다. 지표가 남기는 것은 이것뿐이고, 문답 수는 `qas`에서 센다.
  db.exec(`CREATE TABLE IF NOT EXISTS visits (
    day TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (day, login)
  ) STRICT`);
  // 서버가 막 떴으니 러너에 보낸 문답의 답은 오지 않는다. 기다리는 채로 남지 않게 실패로 둔다.
  db.prepare("UPDATE qas SET answer = ?, settled = ? WHERE answer IS NULL").run(
    JSON.stringify({
      state: "failed",
      error: { code: "runner_offline", message: "서버가 다시 떠서 답을 받지 못했다" },
    }),
    Date.now(),
  );
  // 서버가 막 떴으니 아무 러너도 붙어 있지 않다. 이미 떨어져 있던 멤버는 떨어진 시각을 그대로 둔다.
  db.prepare(
    `INSERT OR IGNORE INTO offline (login, since)
     SELECT login, ? FROM works UNION SELECT login, ? FROM lines`,
  ).run(Date.now(), Date.now());

  /**
   * 멤버의 작업을 러너가 지금 보는 것으로 바꾼다.
   * 관측된 변경이 있다가 0이 된 작업은 에이전트가 쓴 줄을 지운다. 처음부터 0이던 작업의 줄은 남긴다(ADR-0010).
   */
  // ponytail: 멤버 하나에 러너 하나로 본다. 한 멤버가 기기 둘에서 러너를 켜면 나중에 보낸 쪽이 덮는다. 그때는 러너마다 나눈다.
  const replaceWorks = (login: string, works: Work[]) => {
    db.exec("BEGIN");
    const changed = new Set(
      (
        db
          .prepare("SELECT branch FROM works WHERE login = ? AND json_array_length(files) > 0")
          .all(login) as { branch: string }[]
      ).map((row) => row.branch),
    );
    db.prepare("DELETE FROM works WHERE login = ?").run(login);
    const insert = db.prepare(
      "INSERT OR REPLACE INTO works (login, branch, base, share, files) VALUES (?, ?, ?, ?, ?)",
    );
    const clear = db.prepare("DELETE FROM lines WHERE login = ? AND branch = ?");
    for (const work of works) {
      insert.run(login, work.branch, work.base, work.share, JSON.stringify(work.files));
      // intent의 빈 files는 바뀐 것이 0이 된 것이 아니라 보내지 않은 것이다. 수준을 낮춰도 쓴 줄은 남는다.
      if (work.share !== "intent" && work.files.length === 0 && changed.has(work.branch)) {
        clear.run(login, work.branch);
      }
    }
    db.exec("COMMIT");
  };
  /** 브랜치마다 열린 초안 PR의 제목. GitHub에서 `followMs`마다 다시 읽는다. 서버가 꺼지면 잃고 다음 주기에 다시 읽는다. */
  let drafts = new Map<string, string>();
  const sessionLogin = (session: string) =>
    (
      db.prepare("SELECT login FROM sessions WHERE hash = ?").get(hash(session)) as
        | { login: string }
        | undefined
    )?.login;

  /** 멤버가 오늘 들어왔다고 적는다. 웹만 부르는 곳(실시간 연결, 채널에서 읽고 쓰기)에서만 부른다. 러너와 CLI는 세지 않는다. */
  const visit = (login: string) =>
    db
      .prepare("INSERT OR IGNORE INTO visits (day, login) VALUES (?, ?)")
      .run(dayOf(Date.now()), login);

  /** 끝나지 않은 기기 인증. 서버가 꺼지면 잃는다. 다시 로그인하면 된다. */
  const logins = new Map<
    string,
    { deviceCode: string; expiresAt: number; intervalMs: number; nextPollAt: number }
  >();
  /** hello를 마친 러너의 연결과 그 러너가 돌리는 실행기, 실행기마다의 고를 거리. */
  const runners = new Map<
    WSContext,
    {
      login: string;
      hash: string;
      executors: ExecutorId[];
      choices: Partial<Record<ExecutorId, Choices>>;
    }
  >();
  /** hello를 마친 웹의 실시간 연결과 그 세션의 해시, 멤버. 세션이 끝나면 닫는다. */
  const watchers = new Map<WSContext, { hash: string; login: string }>();
  /** 붙어 있는 웹 모두에 보낸다. 멤버가 아니게 된 세션의 연결은 이미 닫혔다. */
  const broadcast = (frame: string) => {
    for (const socket of watchers.keys()) if (socket.readyState === 1) socket.send(frame); // OPEN
  };
  /** `login`의 웹 연결에만 보낸다. 비공개인 DM은 이것으로만 나간다. */
  const sendTo = (login: string, frame: string) => {
    for (const [socket, watcher] of watchers) {
      if (watcher.login === login && socket.readyState === 1) socket.send(frame); // OPEN
    }
  };
  /** 러너에 보내고 답을 기다리는 문답. 키는 보낸 `ask`의 id다. 서버가 꺼지면 잃고, 다시 뜰 때 실패로 둔다. */
  const asks = new Map<
    string,
    { socket: WSContext; login: string; executor: ExecutorId; qa: number }
  >();
  /**
   * 문답이 생기거나 바뀌었다. 묻는 사람의 연결에 보내고, 공개된 문답이면 채널에 선 줄을 모두에게 다시 보낸다.
   * 채널에 선 줄이 있으면 돌려준다.
   */
  const shareQa = (id: number) => {
    const asked = db.prepare(`${QAS} WHERE id = ?`).get(id) as QaRow;
    const qa = qaView(asked);
    const row = db.prepare(`${MESSAGES} WHERE m.qa = ?`).get(id) as MessageRow | undefined;
    sendTo(asked.login, encode(serverToWeb, "qa", qa));
    if (!row) return { qa };
    const message = messageView(row);
    broadcast(encode(serverToWeb, "message", message));
    return { qa, message };
  };
  /** 기다리던 문답에 답이나 실패를 적고, 보이는 사람에게 보내고, 답하는 중을 거둔다. */
  const settle = (id: string, answer: Exclude<Qa["answer"], { state: "pending" }>) => {
    const ask = asks.get(id);
    // 서버가 꺼지는 중이면 DB가 먼저 닫힐 수 있다. 남은 문답은 다시 뜰 때 실패로 둔다.
    if (!ask || stopped) return;
    asks.delete(id);
    db.prepare("UPDATE qas SET answer = ?, settled = ? WHERE id = ?").run(
      JSON.stringify(answer),
      Date.now(),
      ask.qa,
    );
    shareQa(ask.qa);
    shareMembers();
  };

  /** 멤버들이 보는 작업 전부. 웹과 러너가 같은 것을 본다. */
  const worksView = (): WorkView[] => {
    // 워크스페이스에서 빠진 사람(세션이 없는 사람)의 작업은 보이지 않는다.
    const rows = db
      .prepare(
        `SELECT w.login, w.branch, w.base, w.share, w.files, l.text, l.at, o.since FROM works w
         LEFT JOIN lines l ON l.login = w.login AND l.branch = w.branch
         LEFT JOIN offline o ON o.login = w.login
         WHERE w.login IN (SELECT login FROM sessions) ORDER BY w.login, w.branch`,
      )
      .all() as {
      login: string;
      branch: string;
      base: string;
      share: ShareLevel;
      files: string;
      text: string | null;
      at: number | null;
      since: number | null;
    }[];
    return rows.map(({ login, branch, base, share, text, at, since, ...row }) => {
      const files: ObservedFile[] = JSON.parse(row.files);
      const draft = drafts.get(branch);
      const changes = filesLine(files);
      // 고르는 순서: 에이전트가 쓴 줄 → 초안 PR 제목 → 고치는 파일 → 없음. 오프라인은 offlineSince로 따로 간다.
      const line: StatusLine | null =
        text !== null && at !== null
          ? { source: "agent", text, at: new Date(at).toISOString() }
          : draft !== undefined
            ? { source: "pull", text: draft }
            : changes !== null
              ? { source: "files", text: changes }
              : null;
      const offlineSince = since === null ? null : new Date(since).toISOString();
      return { login, branch, base, share, files, line, offlineSince };
    });
  };

  /**
   * 멤버 목록: 사람마다 이름, 접속 상태와 상태 메시지, 실행기마다의 에이전트, 작업마다의 상태 한 줄. 이름 순이다.
   * 접속 상태는 웹 창(실시간 연결)이 하나라도 붙어 있으면 고른 것, 없거나 "오프라인으로 보이기"면 offline이다.
   * 오프라인으로 보이는 사람과 정말 나간 사람은 같은 모양이다. 상태 메시지는 둘 다 그대로 보인다.
   */
  const membersView = (works: WorkView[]): MemberView[] => {
    const people = db
      .prepare(
        `SELECT s.login, COALESCE(p.name, s.login) AS name, o.since, f.presence, f.until, f.message, f.emoji
         FROM (SELECT DISTINCT login FROM sessions) s
         LEFT JOIN people p ON p.login = s.login
         LEFT JOIN offline o ON o.login = s.login
         LEFT JOIN profiles f ON f.login = s.login
         ORDER BY name, s.login`,
      )
      .all() as {
      login: string;
      name: string;
      since: number | null;
      presence: ChosenPresence | null;
      until: number | null;
      message: string | null;
      emoji: string | null;
    }[];
    const open = new Set([...watchers.values()].map((watcher) => watcher.login));
    const now = Date.now();
    const presenceOf = (login: string, chosen: ChosenPresence | null, until: number | null) => {
      // 끝난 것은 타이머가 지우기 전이라도 온라인이다.
      const live = chosen !== null && (until === null || until > now) ? chosen : "online";
      return !open.has(login) || live === "invisible" ? "offline" : (live satisfies Presence);
    };
    const known = db.prepare("SELECT login, executor FROM agents ORDER BY executor").all() as {
      login: string;
      executor: ExecutorId;
    }[];
    const agent = (login: string, executor: ExecutorId) => {
      const live = [...runners].filter(
        ([, runner]) => runner.login === login && runner.executors.includes(executor),
      );
      const sockets = live.map(([socket]) => socket);
      const busy = [...asks.values()].some(
        (ask) => ask.executor === executor && sockets.includes(ask.socket),
      );
      // 고를 거리는 묻는 문답이 갈 러너(마지막에 붙은 것)의 것이다.
      const choices = live.at(-1)?.[1].choices[executor] ?? { models: [], efforts: [] };
      const state = busy ? "answering" : sockets.length > 0 ? "online" : "offline";
      return { executor, state, choices } as const;
    };
    const byLogin = Map.groupBy(works, (work) => work.login);
    const conflicted = conflictedWorks();
    return people.map(({ login, name, since, ...profile }) => {
      const agents = known
        .filter((agent) => agent.login === login)
        .map(({ executor }) => agent(login, executor));
      // ponytail: 실행기가 하나뿐이면 작업은 그 에이전트의 것이다. 둘 이상(#16)이면 그 브랜치에서 마지막으로
      // 훅이나 status set을 보낸 실행기로 정한다(ADR-0015). 그 길이 생기기 전까지 둘 이상이면 모른다(null).
      const executor = agents.length === 1 ? (agents[0]?.executor ?? null) : null;
      return {
        login,
        name,
        presence: presenceOf(login, profile.presence, profile.until),
        message: profile.message || null,
        emoji: profile.emoji || null,
        agents,
        offlineSince: since === null ? null : new Date(since).toISOString(),
        works: (byLogin.get(login) ?? []).map(({ branch, line }) => ({
          branch,
          executor,
          line,
          conflict: conflicted.has(JSON.stringify([login, branch])),
        })),
      };
    });
  };

  /** 풀리지 않은 알림 가운데 줄이 부딪히는 것이 확인된 것의 작업들. 열쇠는 `[login, branch]`의 JSON이다. */
  const conflictedWorks = () => {
    const found = new Set<string>();
    const open = db.prepare("SELECT works, files FROM alerts WHERE resolved IS NULL").all() as {
      works: string;
      files: string;
    }[];
    for (const row of open) {
      if (!(JSON.parse(row.files) as AlertFile[]).some((file) => "lines" in file)) continue;
      for (const work of JSON.parse(row.works) as WorkRef[])
        found.add(JSON.stringify([work.login, work.branch]));
    }
    return found;
  };

  /** 붙어 있는 러너마다 마지막으로 올린 직접 충돌의 계산. 끊기면 지운다. 아직 올리지 않은 러너는 없다. */
  const reports = new Map<WSContext, ConflictPair[]>();

  /** 알림 채널. 정한 것이 없거나 지워졌으면 "부딪힘" 채널을 쓰고, 그것도 없으면 만든다. */
  const alertChannel = () => {
    const chosen = db.prepare("SELECT value FROM settings WHERE key = 'alert_channel'").get() as
      | { value: string }
      | undefined;
    if (chosen && db.prepare("SELECT 1 FROM channels WHERE id = ?").get(chosen.value))
      return chosen.value;
    let found = db.prepare("SELECT id FROM channels WHERE name = ?").get(ALERT_CHANNEL) as
      | { id: string }
      | undefined;
    if (!found) {
      found = { id: randomBytes(8).toString("hex") };
      db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(found.id, ALERT_CHANNEL);
      broadcast(encode(serverToWeb, "channel", { id: found.id, name: ALERT_CHANNEL }));
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('alert_channel', ?)").run(
      found.id,
    );
    return found.id;
  };

  /** 알림 하나의 채널 줄을 붙어 있는 웹 모두에 보낸다. */
  const shareAlert = (alert: number) =>
    broadcast(
      encode(
        serverToWeb,
        "message",
        messageView(db.prepare(`${MESSAGES} WHERE m.alert = ?`).get(alert) as MessageRow),
      ),
    );

  /** 채널에 메시지가 섰다. 포스트면 그 알림의 글 수가 바뀌었으니 알림 줄을 모두에게 다시 보낸다. */
  const posted = (channel: string) => {
    const row = db
      .prepare("SELECT a.alert FROM channels c JOIN messages a ON a.id = c.alert WHERE c.id = ?")
      .get(channel) as { alert: number } | undefined;
    if (row) shareAlert(row.alert);
  };

  /** 포스트의 알림 메시지. 채팅 채널이면 없다. */
  const postAlert = (channel: string) =>
    db.prepare(`${MESSAGES} WHERE m.id = (SELECT alert FROM channels WHERE id = ?)`).get(channel) as
      | MessageRow
      | undefined;

  /** 러너에 넘기는 채널의 이름. 포스트면 알림이 선 채널의 이름으로 짓는다. */
  const channelName = (channel: string) => {
    const alert = postAlert(channel);
    const name = (id: string) =>
      (db.prepare("SELECT name FROM channels WHERE id = ?").get(id) as { name: string }).name;
    return alert ? `${name(alert.channel)}의 알림 ${alert.id}번 포스트` : name(channel);
  };

  /**
   * 러너들의 계산을 두 작업 한 쌍마다 하나로 묶어 알림을 올리고, 고치고, 풀린 것을 닫는다(ADR-0023).
   * 한 쌍을 양쪽 러너가 올렸으면 파일마다 줄이 확인된 쪽을 쓴다. 쌍의 어느 쪽이든 계산을 올린 러너가 붙어 있는데
   * 그 쌍이 없으면 풀린 것이다. 양쪽 러너가 다 꺼져 있으면 알 수 없으니 그대로 둔다.
   */
  const reconcile = () => {
    const name = (login: string) =>
      (
        db.prepare("SELECT name FROM people WHERE login = ?").get(login) as
          | { name: string }
          | undefined
      )?.name ?? login;
    const found = new Map<string, { works: [WorkRef, WorkRef]; files: Map<string, AlertFile> }>();
    const reporting = new Set<string>();
    for (const [socket, pairs] of reports) {
      const login = runners.get(socket)?.login;
      if (!login) continue;
      reporting.add(login);
      for (const pair of pairs) {
        const mine = { login, branch: pair.branch };
        const flip =
          JSON.stringify([mine.login, mine.branch]) >
          JSON.stringify([pair.theirs.login, pair.theirs.branch]);
        const [a, b] = flip ? [pair.theirs, mine] : [mine, pair.theirs];
        const key = JSON.stringify([a.login, a.branch, b.login, b.branch]);
        const entry = found.get(key) ?? {
          works: [
            { ...a, name: name(a.login) },
            { ...b, name: name(b.login) },
          ],
          files: new Map(),
        };
        found.set(key, entry);
        for (const file of pair.files) {
          const view: AlertFile =
            "unknown" in file
              ? file
              : {
                  path: file.path,
                  lines: flip ? [file.theirs, file.mine] : [file.mine, file.theirs],
                };
          const known = entry.files.get(file.path);
          if (!known || ("unknown" in known && "lines" in view)) entry.files.set(file.path, view);
        }
      }
    }
    const open = db
      .prepare("SELECT id, pair, works, files FROM alerts WHERE resolved IS NULL")
      .all() as { id: number; pair: string; works: string; files: string }[];
    let changed = false;
    const now = Date.now();
    for (const row of open) {
      if (found.has(row.pair)) continue;
      const works = JSON.parse(row.works) as WorkRef[];
      if (!works.some((work) => reporting.has(work.login))) continue;
      db.prepare("UPDATE alerts SET resolved = ?, updated = ? WHERE id = ?").run(now, now, row.id);
      shareAlert(row.id);
      changed = true;
    }
    for (const [key, entry] of found) {
      // 줄이 확인된 파일부터, 그 안에서는 경로 순이다.
      const files = [...entry.files.values()].sort(
        (x, y) => Number("unknown" in x) - Number("unknown" in y) || (x.path < y.path ? -1 : 1),
      );
      const json = JSON.stringify(files);
      const known = open.find((row) => row.pair === key);
      if (known?.files === json) continue;
      changed = true;
      if (known) {
        db.prepare("UPDATE alerts SET files = ?, works = ?, updated = ? WHERE id = ?").run(
          json,
          JSON.stringify(entry.works),
          now,
          known.id,
        );
        shareAlert(known.id);
        continue;
      }
      const channel = alertChannel();
      db.exec("BEGIN");
      const { lastInsertRowid } = db
        .prepare("INSERT INTO alerts (pair, works, files, updated) VALUES (?, ?, ?, ?)")
        .run(key, JSON.stringify(entry.works), json, now);
      db.prepare(
        "INSERT INTO messages (channel, login, text, alert, at) VALUES (?, '', '', ?, ?)",
      ).run(channel, lastInsertRowid, now);
      db.exec("COMMIT");
      shareAlert(Number(lastInsertRowid));
    }
    if (changed) shareMembers(); // 멤버 목록의 직접 충돌 표시
  };

  /** 웹에 마지막으로 보낸 멤버 목록. 같은 것을 다시 보내지 않는다. */
  let sentMembers: string | undefined;
  /**
   * 멤버 목록이 달라졌으면 붙어 있는 웹 모두에게 보낸다. 그대로면 `to`(막 붙은 웹)에게만 보낸다.
   * 상황이 바뀌는 곳은 `shareSituation`이 부르고, 에이전트만 바뀌는 곳(문답의 시작과 끝)은 따로 부른다.
   */
  // ponytail: 달라질 때마다 목록 전부를 보낸다. 멤버와 작업이 많아지면 사람마다의 차이만 보낸다.
  const shareMembers = (to?: WSContext, works = worksView()) => {
    const members = membersView(works);
    const json = JSON.stringify(members);
    const changed = json !== sentMembers;
    sentMembers = json;
    const frame = encode(serverToWeb, "members", { members });
    if (changed) broadcast(frame);
    else if (to?.readyState === 1) to.send(frame); // OPEN
  };

  const durations = { ...PRESENCE_DURATIONS, ...options.presenceDurations };
  /** 고른 접속 상태가 끝날 때 온라인으로 돌릴 타이머. 사람마다 하나이고, 다시 고르면 바꾼다. */
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  const expireAt = (login: string, until: number | null) => {
    clearTimeout(expiries.get(login));
    expiries.delete(login);
    if (until === null) return;
    const timer = setTimeout(
      () => {
        expiries.delete(login);
        if (stopped) return;
        db.prepare("UPDATE profiles SET presence = 'online', until = NULL WHERE login = ?").run(
          login,
        );
        shareMembers();
      },
      Math.max(0, until - Date.now()),
    );
    expiries.set(login, timer);
  };
  // 서버가 다시 떴으면 남은 것을 다시 건다. 그사이 끝난 것은 바로 온라인으로 돌아온다.
  for (const { login, until } of db
    .prepare("SELECT login, until FROM profiles WHERE until IS NOT NULL")
    .all() as { login: string; until: number }[]) {
    expireAt(login, until);
  }

  /** 러너에 마지막으로 보낸 상황. 같은 것을 다시 보내지 않는다. */
  let sent: string | undefined;
  /**
   * 상황(작업 전부)이 달라졌으면 붙어 있는 러너 모두에게 보낸다. 그대로면 `to`(막 붙은 러너)에게만 보낸다.
   * 상황을 바꾸는 곳(관측, 상태 한 줄, 오프라인, 멤버 자격, GitHub 따라가기)마다 부른다.
   * 닫히는 중인 연결(내보낸 멤버의 러너)에는 보내지 않는다.
   */
  // ponytail: 달라질 때마다 작업 전부(내용 포함)를 러너마다 보낸다. 멤버와 큰 작업이 많아지면 작업마다의 차이만 보낸다.
  const shareSituation = (to?: WSContext) => {
    const works = worksView();
    shareMembers(undefined, works); // 멤버 목록은 상황에서 나온다
    const json = JSON.stringify(works);
    const targets = (json !== sent ? [...runners.keys()] : to ? [to] : []).filter(
      (socket) => socket.readyState === 1, // OPEN
    );
    sent = json;
    if (targets.length === 0) return;
    const frame = encode(serverToRunner, "situation", { works });
    for (const socket of targets) socket.send(frame);
  };

  /** `error`를 보내고 1008로 닫는다. 러너와 웹의 `error`는 같은 형식이다. */
  const refuse = (socket: WSContext, error: ContractError, re?: string) => {
    socket.send(encode(serverToRunner, "error", error, re));
    socket.close(1008, error.code);
  };

  /** 세션 하나를 끝낸다. 그 세션으로 붙은 러너와 웹의 실시간 연결은 `error`를 받고 끊긴다. */
  const endSession = (sessionHash: string, error: ContractError) => {
    db.prepare("DELETE FROM sessions WHERE hash = ?").run(sessionHash);
    for (const [socket, runner] of runners) if (runner.hash === sessionHash) refuse(socket, error);
    for (const [socket, watcher] of watchers)
      if (watcher.hash === sessionHash) refuse(socket, error);
    shareSituation(); // 세션이 하나도 남지 않은 멤버의 작업은 보이지 않는다
  };

  const app = createApp((authorization) => {
    const session = bearer(authorization);
    return session && sessionLogin(session);
  });

  mount(app, api.health, () => ({ contract: CONTRACT_VERSION }));

  mount(app, api.login, async () => {
    const now = Date.now();
    for (const [device, pending] of logins) if (pending.expiresAt < now) logins.delete(device);
    if (logins.size >= MAX_PENDING_LOGINS) {
      throw new ContractFailure({
        code: "internal",
        message: "로그인이 밀려 있다. 잠시 뒤 다시 하라",
      });
    }
    const started = await github.startDevice();
    const device = randomBytes(16).toString("hex");
    logins.set(device, {
      deviceCode: started.deviceCode,
      expiresAt: now + started.expiresInMs,
      intervalMs: started.intervalMs,
      nextPollAt: now + started.intervalMs,
    });
    return {
      device,
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      intervalMs: started.intervalMs,
    };
  });

  mount(app, api.loginPoll, async ({ device }) => {
    const pending = logins.get(device);
    if (!pending || pending.expiresAt < Date.now()) {
      logins.delete(device);
      throw new ContractFailure({
        code: "unauthorized",
        message: "기기 인증이 끝났다. 로그인을 다시 하라",
      });
    }
    // 너무 자주 물으면 GitHub에 넘기지 않는다(GitHub의 slow_down을 부르지 않는다).
    if (Date.now() < pending.nextPollAt) return { pending: true as const };
    const polled = await github.pollDevice(pending.deviceCode);
    if ("pending" in polled) {
      pending.intervalMs = polled.intervalMs ?? pending.intervalMs;
      pending.nextPollAt = Date.now() + pending.intervalMs;
      return { pending: true as const };
    }
    logins.delete(device);
    if ("error" in polled)
      throw new ContractFailure({ code: "unauthorized", message: polled.error });

    const { login, name } = await github.user(polled.token);
    const push = await github.canPush(polled.token, repo);
    if (push === undefined) {
      throw new ContractFailure({
        code: "internal",
        message: `GitHub에서 ${repo}의 push 권한을 확인하지 못했다. 잠시 뒤 다시 하라`,
      });
    }
    if (!push) {
      throw new ContractFailure({
        code: "forbidden",
        message: `${login}는 ${repo}에 push 권한이 없어 이 워크스페이스에 들어올 수 없다`,
      });
    }
    const session = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (hash, login, github_token) VALUES (?, ?, ?)").run(
      hash(session),
      login,
      polled.token,
    );
    db.prepare("INSERT OR REPLACE INTO people (login, name) VALUES (?, ?)").run(
      login,
      name ?? login,
    );
    shareSituation(); // 빠졌다 돌아온 멤버의 작업이 다시 보인다
    return { session, login };
  });

  mount(app, api.me, (_, c) => {
    const login = c.get("login") as string;
    const person = db.prepare("SELECT name FROM people WHERE login = ?").get(login) as
      | { name: string }
      | undefined;
    return { login, name: person?.name ?? login, repo };
  });

  mount(app, api.logout, (_, c) => {
    endSession(hash(bearer(c.req.header("authorization")) as string), {
      code: "unauthorized",
      message: "로그아웃해 세션이 끝났다",
    });
    return {};
  });

  mount(app, api.members, () => ({ members: membersView(worksView()) }));

  mount(app, api.works, () => ({ works: worksView() }));

  mount(app, api.setStatus, ({ branch, text }, c) => {
    const at = Date.now();
    db.prepare("INSERT OR REPLACE INTO lines (login, branch, text, at) VALUES (?, ?, ?, ?)").run(
      c.get("login") as string,
      branch,
      text,
      at,
    );
    shareSituation();
    return { text, at: new Date(at).toISOString() };
  });

  mount(app, api.setPresence, ({ presence, duration }, c) => {
    const login = c.get("login") as string;
    const until = presence === "online" || !duration ? null : Date.now() + durations[duration];
    db.prepare(
      `INSERT INTO profiles (login, presence, until, message) VALUES (?, ?, ?, '')
       ON CONFLICT (login) DO UPDATE SET presence = excluded.presence, until = excluded.until`,
    ).run(login, presence, until);
    expireAt(login, until);
    shareMembers();
    return { until: until === null ? null : new Date(until).toISOString() };
  });

  mount(app, api.setStatusMessage, ({ message, emoji }, c) => {
    db.prepare(
      `INSERT INTO profiles (login, presence, until, message, emoji) VALUES (?, 'online', NULL, ?, ?)
       ON CONFLICT (login) DO UPDATE SET message = excluded.message, emoji = excluded.emoji`,
    ).run(c.get("login") as string, message, emoji ?? "");
    shareMembers();
    return { message: message || null, emoji };
  });

  mount(app, api.ask, ({ agent, executor, channel, message, visibility, model, effort }, c) => {
    if (agent !== c.get("login")) {
      throw new ContractFailure({
        code: "forbidden",
        message: `${agent}의 에이전트는 ${agent}만 부를 수 있다`,
      });
    }
    mustExist(channel);
    visit(agent);
    // 같은 멤버의 러너가 여럿이면 그 실행기를 돌리는 것 가운데 마지막에 붙은 것이 답한다.
    const found = [...runners].findLast(
      ([, runner]) => runner.login === agent && runner.executors.includes(executor),
    );
    if (!found) {
      throw new ContractFailure({
        code: "runner_offline",
        message: `${agent}의 ${EXECUTOR_NAMES[executor]} 러너가 꺼져 있다. 문답은 쌓아 두지 않는다`,
      });
    }
    const [socket] = found;
    // 채널 대화는 이 문답이 채널에 서기 전에 읽는다. `@호출`의 질문이 데이터로 한 번 더 들어가지 않는다.
    // 포스트면 맨 앞에 그 알림을 둔다. 알림의 번호가 포스트의 글보다 앞이라 러너는 첫 턴에만 넘긴다.
    // ponytail: 첫 턴 뒤에 알림이 고쳐져도 그 채널 세션에는 다시 넘기지 않는다. 고친 알림이 필요해지면 러너가 알림만 따로 다시 넘긴다.
    const alert = postAlert(channel);
    const recent = [
      ...(alert ? [alert] : []),
      ...(
        db
          .prepare(`${MESSAGES} WHERE m.channel = ? ORDER BY m.id DESC LIMIT ?`)
          .all(channel, CHANNEL_CONTEXT - (alert ? 1 : 0)) as MessageRow[]
      ).reverse(),
    ].map(messageView);
    const name = channelName(channel);
    const at = Date.now();
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO qas (channel, login, executor, question, at, visibility) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(channel, agent, executor, message, at, visibility);
    const id = Number(lastInsertRowid);
    if (visibility === "public") {
      db.prepare("INSERT INTO messages (channel, login, qa, at) VALUES (?, ?, ?, ?)").run(
        channel,
        agent,
        id,
        at,
      );
    }
    const frame = encode(serverToRunner, "ask", {
      executor,
      channel: { id: channel, name },
      message,
      recent,
      model,
      effort,
    });
    asks.set((JSON.parse(frame) as { id: string }).id, { socket, login: agent, executor, qa: id });
    socket.send(frame);
    const shared = shareQa(id); // 같은 멤버의 다른 화면에도, `@호출`이면 채널의 모두에게
    if (visibility === "public") posted(channel);
    shareMembers(); // 답하는 중
    return shared;
  });

  mount(app, api.postQa, ({ qa, text }, c) => {
    const login = c.get("login") as string;
    // 남의 문답은 있어도 없는 것으로 답한다. 비공개 DM이 있다는 것도 새지 않는다.
    const row = db.prepare(`${QAS} WHERE id = ? AND login = ?`).get(qa, login) as QaRow | undefined;
    if (!row) throw new ContractFailure({ code: "not_found", message: `없는 문답이다: ${qa}` });
    if (row.visibility === "public") {
      throw new ContractFailure({ code: "conflict", message: "이미 채널에 올린 문답이다" });
    }
    if (qaView(row).answer.state !== "answered") {
      throw new ContractFailure({
        code: "invalid_request",
        message: "답이 온 문답만 채널에 올린다. 질문과 답이 함께 올라간다",
      });
    }
    db.exec("BEGIN");
    db.prepare("UPDATE qas SET visibility = 'public' WHERE id = ?").run(qa);
    db.prepare("INSERT INTO messages (channel, login, qa, note, at) VALUES (?, ?, ?, ?, ?)").run(
      row.channel,
      login,
      qa,
      text ?? null,
      Date.now(),
    );
    db.exec("COMMIT");
    const { message } = shareQa(qa);
    posted(row.channel);
    return { message: message as ChannelMessage };
  });

  mount(app, api.dms, ({ channel }, c) => {
    mustExist(channel);
    visit(c.get("login") as string);
    const rows = db
      .prepare(`${QAS} WHERE login = ? AND channel = ? ORDER BY id DESC LIMIT ?`)
      .all(c.get("login") as string, channel, HISTORY_PAGE) as QaRow[];
    // ponytail: 최근 50개만 준다. 더 오래된 DM을 다시 볼 일이 생기면 history처럼 `before`로 넘겨 읽는다.
    return { qas: rows.reverse().map(qaView) };
  });

  mount(app, api.channels, () => ({
    channels: (
      db.prepare("SELECT id, name FROM channels WHERE alert IS NULL ORDER BY name").all() as {
        id: string;
        name: string;
      }[]
    ).map(({ id, name }) => ({ id, name })),
  }));

  mount(app, api.createChannel, ({ name }, c) => {
    visit(c.get("login") as string);
    if (db.prepare("SELECT 1 FROM channels WHERE name = ?").get(name)) {
      throw new ContractFailure({ code: "conflict", message: `#${name} 채널이 이미 있다` });
    }
    const channel = { id: randomBytes(8).toString("hex"), name };
    db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(channel.id, channel.name);
    broadcast(encode(serverToWeb, "channel", channel));
    return { channel };
  });

  mount(app, api.setAlertChannel, ({ channel }) => {
    if (!db.prepare("SELECT 1 FROM channels WHERE id = ? AND alert IS NULL").get(channel)) {
      throw new ContractFailure({ code: "not_found", message: `없는 채널이다: ${channel}` });
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('alert_channel', ?)").run(
      channel,
    );
    const { name } = db.prepare("SELECT name FROM channels WHERE id = ?").get(channel) as {
      name: string;
    };
    return { channel: { id: channel, name } };
  });

  /** 포스트 하나. 글 수와 함께 읽는다. */
  const postView = (channel: string) =>
    db
      .prepare(
        `SELECT c.id AS channel, c.alert, ${POST_COUNT} AS count FROM channels c WHERE c.id = ?`,
      )
      .get(channel) as Post;

  mount(app, api.openPost, ({ alert }, c) => {
    visit(c.get("login") as string);
    const row = db.prepare(`${MESSAGES} WHERE m.id = ? AND m.alert IS NOT NULL`).get(alert) as
      | MessageRow
      | undefined;
    if (!row) throw new ContractFailure({ code: "not_found", message: `없는 알림이다: ${alert}` });
    if (row.post !== null) return { post: postView(row.post), message: messageView(row) };
    const channel = randomBytes(8).toString("hex");
    db.prepare("INSERT INTO channels (id, name, alert) VALUES (?, ?, ?)").run(
      channel,
      `\n${channel}`,
      alert,
    );
    shareAlert(row.alert as number); // 알림 줄에 포스트가 붙었다
    return {
      post: postView(channel),
      message: messageView(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(alert) as MessageRow),
    };
  });

  mount(app, api.posts, () => ({
    posts: db
      .prepare(
        `SELECT c.id AS channel, c.alert, ${POST_COUNT} AS count FROM channels c
         WHERE c.alert IS NOT NULL ORDER BY c.alert`,
      )
      .all() as Post[],
  }));

  const mustExist = (channel: string) => {
    if (!db.prepare("SELECT 1 FROM channels WHERE id = ?").get(channel)) {
      throw new ContractFailure({ code: "not_found", message: `없는 채널이다: ${channel}` });
    }
  };

  mount(app, api.history, ({ channel, before }, c) => {
    mustExist(channel);
    visit(c.get("login") as string);
    const rows = db
      .prepare(`${MESSAGES} WHERE m.channel = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
      .all(channel, before ?? Number.MAX_SAFE_INTEGER, HISTORY_PAGE) as MessageRow[];
    return { messages: rows.reverse().map(messageView) };
  });

  mount(app, api.send, ({ channel, text }, c) => {
    mustExist(channel);
    visit(c.get("login") as string);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO messages (channel, login, text, at) VALUES (?, ?, ?, ?)")
      .run(channel, c.get("login") as string, text, Date.now());
    const message = messageView(
      db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow,
    );
    broadcast(encode(serverToWeb, "message", message));
    posted(channel);
    return { message };
  });

  mount(app, api.metrics, ({ days }) => {
    const now = Date.now();
    const range = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY_MS));
    const members = new Map(
      (
        db
          .prepare("SELECT day, COUNT(*) AS n FROM visits WHERE day >= ? GROUP BY day")
          .all(range[0] ?? "") as { day: string; n: number }[]
      ).map(({ day, n }) => [day, n]),
    );
    // 문답은 물은 시각으로 센다. 답하지 못한 문답도 물은 것이라 센다. 내용은 읽지 않는다.
    const asked = db.prepare("SELECT at FROM qas WHERE at > ?").all(now - (days + 1) * DAY_MS) as {
      at: number;
    }[];
    const qas = Map.groupBy(asked, ({ at }) => dayOf(at));
    return {
      timeZone: TIME_ZONE,
      days: range.map((day) => ({
        day,
        members: members.get(day) ?? 0,
        qas: qas.get(day)?.length ?? 0,
      })),
    };
  });

  // 웹의 실시간 연결. hello 하나를 받으면 welcome과 끊긴 사이의 메시지, 지금의 멤버 목록을 보내고,
  // 그 뒤로는 메시지는 쌓이는 대로, 멤버 목록은 달라질 때마다 보낸다.
  // 이 처리기는 끝까지 동기라 welcome의 seq, 다시 보낸 것, 이어 보낼 것 사이에 빠지는 메시지가 없다.
  // ponytail: 끊긴 사이의 것을 개수 상한 없이 다 보낸다. 오래 끊겼던 웹이 많아 무거워지면 상한을 두고 넘으면 다시 읽으라고 알린다.
  app.get(
    LIVE_SOCKET,
    upgradeWebSocket(() => ({
      onMessage({ data }, socket) {
        // 웹은 hello만 보낸다. 그 밖의 것은 고장 난 웹이라 닫는다.
        const decoded = decode(webToServer, data);
        if ("error" in decoded) return refuse(socket, decoded.error, decoded.re);
        const { id, payload } = decoded.message;
        const login = sessionLogin(payload.session);
        if (!login) {
          return refuse(
            socket,
            { code: "unauthorized", message: "세션이 없거나 끝났다. 다시 로그인하라" },
            id,
          );
        }
        const { seq } = db.prepare("SELECT COALESCE(MAX(id), 0) AS seq FROM messages").get() as {
          seq: number;
        };
        socket.send(encode(serverToWeb, "welcome", { seq }, id));
        if (payload.after !== undefined) {
          // 끊긴 사이에 답이 온 공개 문답도 다시 보낸다. `after`를 받은 뒤에 끊겼으니 그 메시지가 선 뒤에 답이 온 것이면 넉넉히 덮는다.
          // 끊긴 사이에 고친 알림과, 끊긴 사이에 포스트가 열리거나 글 수가 바뀐 알림도 다시 보낸다.
          // ponytail: 끊긴 사이에 열기만 하고 글이 없는 포스트는 다시 보내지 않는다. 웹은 다시 붙으면 `api.posts`를 읽는다.
          const missed = db
            .prepare(
              `${MESSAGES} WHERE m.id > ? OR q.settled >= (SELECT at FROM messages WHERE id = ?)
               OR a.updated >= (SELECT at FROM messages WHERE id = ?)
               OR (c.id IS NOT NULL AND EXISTS (SELECT 1 FROM messages WHERE channel = c.id AND id > ?))
               ORDER BY m.id`,
            )
            .all(payload.after, payload.after, payload.after, payload.after) as MessageRow[];
          for (const row of missed) socket.send(encode(serverToWeb, "message", messageView(row)));
        }
        watchers.set(socket, { hash: hash(payload.session), login });
        visit(login);
        shareMembers(socket);
      },
      onClose(_, socket) {
        // 그 사람의 마지막 창이었으면 오프라인이 된다.
        if (watchers.delete(socket) && !stopped) shareMembers();
      },
    })),
  );

  app.get(
    RUNNER_SOCKET,
    upgradeWebSocket(() => ({
      onMessage({ data }, socket) {
        const decoded = decode(runnerToServer, data);
        if ("error" in decoded) {
          // 계약 버전이 다른 러너에는 그 러너도 읽는 꼴로 이 서버의 버전을 실어 거절한다. 러너가 할 일을 알린다.
          if (decoded.error.code === "version_mismatch") {
            socket.send(encodeVersionMismatch(decoded.error.message, version, decoded.re));
            socket.close(1008, "version_mismatch");
          } else socket.send(encode(serverToRunner, "error", decoded.error, decoded.re));
          return;
        }
        const { message } = decoded;
        if (message.kind === "hello") {
          const { session, repos, executors, choices } = message.payload;
          const login = sessionLogin(session);
          if (!login) {
            return refuse(
              socket,
              { code: "unauthorized", message: "세션이 없거나 끝났다. 다시 로그인하라" },
              message.id,
            );
          }
          if (!repos.some((r) => r.toLowerCase() === repo.toLowerCase())) {
            return refuse(
              socket,
              {
                code: "forbidden",
                message: `이 폴더는 ${repo}의 폴더가 아니다(GitHub 원격: ${repos.join(", ")})`,
              },
              message.id,
            );
          }
          runners.set(socket, { login, hash: hash(session), executors, choices });
          db.prepare("DELETE FROM offline WHERE login = ?").run(login);
          // ponytail: 멤버 하나에 러너 하나로 본다. 기기 둘에서 실행기가 다른 러너를 켜면 나중에 붙은 쪽의 것만 남는다.
          db.prepare("DELETE FROM agents WHERE login = ?").run(login);
          const known = db.prepare("INSERT OR IGNORE INTO agents (login, executor) VALUES (?, ?)");
          for (const executor of executors) known.run(login, executor);
          socket.send(encode(serverToRunner, "welcome", { login, repo }, message.id));
          shareSituation(socket);
          return;
        }
        const runner = runners.get(socket);
        if (!runner) {
          // hello를 마치지 않은 연결의 메시지는 받지 않는다.
          refuse(socket, { code: "unauthorized", message: "hello를 먼저 보내라" }, message.id);
        } else if (message.kind === "observation") {
          replaceWorks(runner.login, message.payload.works);
          shareSituation();
        } else if (message.kind === "conflicts") {
          reports.set(socket, message.payload.pairs);
          reconcile();
        } else {
          // 문답의 답이나 실패. 그 문답을 보낸 연결에서 온 것만 받는다.
          const re = message.re ?? "";
          if (asks.get(re)?.socket !== socket) {
            if (message.kind === "error")
              console.warn("러너가 서버의 메시지를 거절했다:", message.payload);
          } else if (message.kind === "answer") {
            settle(re, { state: "answered", ...message.payload });
          } else if (message.kind === "error") {
            settle(re, { state: "failed", error: message.payload });
          }
        }
      },
      onClose(_, socket) {
        const runner = runners.get(socket);
        runners.delete(socket);
        if (reports.delete(socket) && !stopped) reconcile();
        // 그 멤버의 러너가 다 떨어졌으면 오프라인이다. 마지막 관측과 상태 한 줄은 이 시각 기준으로 남는다.
        if (runner && !stopped && ![...runners.values()].some((r) => r.login === runner.login)) {
          db.prepare("INSERT OR REPLACE INTO offline (login, since) VALUES (?, ?)").run(
            runner.login,
            Date.now(),
          );
          shareSituation();
        }
        // 떨어진 러너의 답은 오지 않는다. 기다리던 문답을 실패로 둔다.
        for (const [id, ask] of asks) {
          if (ask.socket !== socket) continue;
          settle(id, {
            state: "failed",
            error: {
              code: "runner_offline",
              message: `${ask.login}의 러너가 답하기 전에 떨어졌다`,
            },
          });
        }
      },
    })),
  );

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  // 연결의 생사: 주기마다 ping을 보내고, 다음 주기까지 pong이 없으면 끊는다.
  // 잠든 기기처럼 close 없이 사라진 러너도 이렇게 오프라인이 된다. 러너(내장 WebSocket)는 pong을 알아서 보낸다.
  const alive = new WeakSet<WebSocket>();
  sockets.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);

  // push 권한을 잃은 세션을 지우고 그 러너를 내보낸다. GitHub이 답하지 못하면 다음 주기에 다시 본다.
  let stopped = false;
  let checking = false;
  const recheck = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const rows = db.prepare("SELECT hash, login, github_token FROM sessions").all() as {
        hash: string;
        login: string;
        github_token: string;
      }[];
      for (const row of rows) {
        if ((await github.canPush(row.github_token, repo)) !== false || stopped) continue;
        endSession(row.hash, {
          code: "forbidden",
          message: `${row.login}는 이제 ${repo}에 push 권한이 없어 워크스페이스에서 빠졌다`,
        });
      }
    } catch (error) {
      console.error("push 권한을 다시 확인하지 못했다:", error);
    } finally {
      checking = false;
    }
  }, options.recheckMs ?? RECHECK_MS);

  // 오프라인 7일이 지난 멤버의 관측과 상태 한 줄을 지우고, 작업마다의 초안 PR 제목과 머지 여부를 GitHub에서 읽는다.
  // 머지되면 그 브랜치에서 머지 전에 쓴 줄을 지운다. 머지 뒤에 같은 브랜치에 새로 쓴 줄은 남는다.
  // ponytail: 주기마다 브랜치 하나에 GitHub 요청 하나다. 작업이 많아져 요청 한도가 걱정되면 GitHub 앱의 웹훅으로 바꾼다.
  let following = false;
  const follow = setInterval(async () => {
    if (following) return;
    following = true;
    try {
      const forgotten = "SELECT login FROM offline WHERE since < ?";
      const cutoff = Date.now() - (options.forgetMs ?? FORGET_MS);
      db.exec("BEGIN");
      db.prepare(`DELETE FROM works WHERE login IN (${forgotten})`).run(cutoff);
      db.prepare(`DELETE FROM lines WHERE login IN (${forgotten})`).run(cutoff);
      db.prepare("DELETE FROM offline WHERE since < ?").run(cutoff);
      db.exec("COMMIT");

      const branches = db
        .prepare(
          `SELECT w.branch, MAX(s.github_token) AS token FROM works w
           JOIN sessions s ON s.login = w.login GROUP BY w.branch`,
        )
        .all() as { branch: string; token: string }[];
      const next = new Map<string, string>();
      for (const { branch, token } of branches) {
        const pulls = await github.pulls(token, repo, branch);
        if (stopped) return;
        if (!pulls) {
          // GitHub이 답하지 못하면 지난번 것을 둔다.
          const known = drafts.get(branch);
          if (known !== undefined) next.set(branch, known);
          continue;
        }
        const draft = pulls.find((pull) => pull.open && pull.draft);
        if (draft) next.set(branch, draft.title);
        const merged = Math.max(
          ...pulls.map((pull) => Date.parse(pull.mergedAt ?? "")).filter(Number.isFinite),
        );
        if (merged > 0)
          db.prepare("DELETE FROM lines WHERE branch = ? AND at < ?").run(branch, merged);
      }
      drafts = next;
      shareSituation();
    } catch (error) {
      console.error("상태 한 줄을 따라가지 못했다:", error);
    } finally {
      following = false;
    }
  }, options.followMs ?? FOLLOW_MS);

  const server = serve({
    fetch: app.fetch,
    port: options.port ?? 0,
    hostname,
    websocket: { server: sockets },
  });
  await once(server, "listening");

  return {
    url: `http://${hostname}:${(server.address() as AddressInfo).port}`,
    /** 이 서버의 버전(`git describe --tags`). 계약 버전이 다른 러너를 거절할 때 싣는다. */
    version,
    async stop() {
      stopped = true;
      clearInterval(heartbeat);
      clearInterval(recheck);
      clearInterval(follow);
      for (const timer of expiries.values()) clearTimeout(timer);
      for (const socket of sockets.clients) socket.terminate();
      server.close();
      await once(server, "close");
      db.close();
    },
  };
}
