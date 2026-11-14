import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { basename } from "node:path/posix";
import { DatabaseSync } from "node:sqlite";
import { serve, upgradeWebSocket } from "@hono/node-server";
import {
  ALERT_FILES,
  ALERT_LABELS,
  type Alert,
  type AlertFile,
  type AlertRun,
  type AlertSymbol,
  ANSWERED_DAYS,
  api,
  CHANNEL_CONTEXT,
  type ChannelKind,
  type ChannelMessage,
  type Choices,
  type ChosenPresence,
  type Claim,
  CONTRACT_VERSION,
  type ConflictPair,
  type ContractError,
  ContractFailure,
  type Decision,
  type DecisionWindow,
  type Draft,
  decode,
  EXECUTOR_NAMES,
  type ExecutorId,
  encode,
  encodeVersionMismatch,
  FEED_PAGE,
  HISTORY_PAGE,
  INBOX_MS,
  type InboxItem,
  LIVE_SOCKET,
  MAX_FRAME_BYTES,
  type MemberView,
  type MergeCheckState,
  type Message,
  type ObservedFile,
  type Post,
  PRESENCE_DURATIONS,
  type Presence,
  type PresenceDuration,
  type Qa,
  type Question,
  type ReplyOf,
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

/** 처음 알림을 올릴 때 알림을 올릴 포럼이 없으면 쓰거나 만드는 포럼. 사람은 이 이름으로 채팅 채널을 만들지 못한다. */
const ALERT_CHANNEL = "부딪힘";

/** 포스트(채널 줄)의 글 수. `c`가 포스트의 채널이다. 결정 PR의 줄은 세지 않는다. */
const POST_COUNT = "(SELECT COUNT(*) FROM messages WHERE channel = c.id AND decision IS NULL)";

/** 결정 파일을 두는 레포의 폴더(구현 8장). */
const DECISIONS = "docs/decisions";
/** 레포의 AGENTS.md가 결정 폴더를 가리키지 않으면 첫 결정 PR이 더하는 한 줄. */
const AGENTS_LINE = `결정 기록은 \`${DECISIONS}/\`에 있다. 일을 시작하기 전에 관련 결정을 읽는다.`;
/** 이의 창의 길이를 시간 수로(ADR-0030). */
const windowHours = (window: DecisionWindow) =>
  typeof window === "object"
    ? window.amount * (window.unit === "day" ? 24 : 1)
    : { now: 0, hour: 1, day: 24, three_days: 72 }[window];
const windowName = (window: DecisionWindow) =>
  typeof window === "object"
    ? `${window.amount}${window.unit === "day" ? "일" : "시간"}`
    : { now: "바로", hour: "1시간", day: "하루", three_days: "3일" }[window];
/** 이름 붙은 창은 그대로, 직접 넣은 창은 JSON으로 `span` 열에 둔다. */
const spanOf = (span: string): DecisionWindow =>
  span.startsWith("{") ? JSON.parse(span) : (span as DecisionWindow);

/** 로그인의 프로필 이름. 모르면 로그인이다. `l`은 로그인을 내는 SQL이다. */
const nameSql = (l: string) => `COALESCE((SELECT name FROM people WHERE login = ${l}), ${l})`;

/**
 * 결정 하나를 계약의 꼴로 읽는 JSON. `d`가 decisions, `dp`가 정리한 사람의 people이다. `decisionView`가 상태를 짓고 시각을 고친다.
 * 결정자(`d.deciders`, 로그인의 JSON 배열) 가운데 정리한 사람은 늘 동의한 것이다(ADR-0029).
 */
const DECISION = `json_object('id', d.id, 'post', d.post, 'login', d.login, 'name', COALESCE(dp.name, d.login),
  'title', d.title, 'path', d.path, 'pull', json_object('number', d.pull, 'url', d.url),
  'window', CASE WHEN d.span LIKE '{%' THEN json(d.span) ELSE d.span END, 'state', d.state,
  'closes', d.closes, 'reopened', d.reopened, 'early', d.early, 'stuck', json(d.stuck),
  'deciders', (SELECT json_group_array(json_object('login', j.value, 'name', ${nameSql("j.value")},
    'agreed', j.value = d.login OR EXISTS (SELECT 1 FROM agreements g WHERE g.decision = d.id AND g.login = j.value)))
    FROM json_each(d.deciders) j),
  'objections', (SELECT json_group_array(json_object('login', o.login, 'name', ${nameSql("o.login")}, 'via', o.via, 'at', o.at))
    FROM (SELECT * FROM objections WHERE decision = d.id ORDER BY at, rowid) o),
  'at', d.at)`;
const iso = (ms: number) => new Date(ms).toISOString();
const decisionView = (json: string): Decision => {
  const { closes, reopened, early, stuck, deciders, objections, at, ...decision } =
    JSON.parse(json);
  const open = decision.state === "proposed";
  const status: Decision["status"] = !open
    ? decision.state
    : objections.length > 0
      ? "objected"
      : (stuck?.kind ?? (reopened ? "reopened" : "proposed"));
  return {
    ...decision,
    status,
    ...((status === "blocked" || status === "stalled") && { reason: stuck.reason }),
    closes: open && objections.length === 0 ? iso(closes) : null,
    deciders: deciders.map((d: { agreed: number }) => ({ ...d, agreed: d.agreed === 1 })),
    objections: objections.map((o: { at: number }) => ({ ...o, at: iso(o.at) })),
    early: early === 1,
    at: iso(at),
  };
};

/**
 * 메시지를 쓴 사람의 이름과, 공개된 문답이면 그 문답, 알림이면 그 알림과 달린 포스트와 함께 읽는다. 뒤에 WHERE와 ORDER BY를 붙여 쓴다.
 */
const POST_LAST = `(SELECT json_object('login', x.login, 'name', COALESCE(pp.name, x.login),
  'line', COALESCE(x.note, x.text, qq.question, ''), 'at', x.at) FROM messages x
  LEFT JOIN people pp ON pp.login = x.login LEFT JOIN qas qq ON qq.id = x.qa
  WHERE x.channel = c.id AND x.decision IS NULL ORDER BY x.id DESC LIMIT 1)`;

const MESSAGES = `SELECT m.id, m.channel, m.login, m.text, m.note, m.at, m.github, p.name,
  c.issue, c.issue_url, c.issue_title, c.issue_labels, c.issue_open,
  q.id AS qa, q.executor, q.question, q.at AS asked, q.answer, q.visibility,
  m.alert, a.kind, a.works, a.files, a.resolved, a.run, a.confirmed,
  c.id AS post, CASE WHEN c.id IS NULL THEN 0 ELSE ${POST_COUNT} END AS count, ${POST_LAST} AS last,
  CASE WHEN d.id IS NULL THEN NULL ELSE ${DECISION} END AS decision FROM messages m
  LEFT JOIN people p ON p.login = m.login
  LEFT JOIN qas q ON q.id = m.qa
  LEFT JOIN alerts a ON a.id = m.alert
  LEFT JOIN channels c ON c.alert = m.id AND m.alert IS NOT NULL
  LEFT JOIN decisions d ON d.id = m.decision
  LEFT JOIN people dp ON dp.login = d.login`;
type MessageRow = {
  id: number;
  channel: string;
  login: string;
  text: string | null;
  note: string | null;
  at: number;
  github: number;
  name: string | null;
  issue: number | null;
  issue_url: string | null;
  issue_title: string | null;
  issue_labels: string | null;
  issue_open: number | null;
  qa: number | null;
  asked: number;
  alert: number | null;
  kind: string | null;
  works: string | null;
  files: string | null;
  resolved: number | null;
  run: string | null;
  confirmed: number | null;
  post: string | null;
  count: number;
  decision: string | null;
  last: string | null;
} & Pick<QaRow, "executor" | "question" | "answer" | "visibility">;

/**
 * 알림 표의 한 줄을 계약의 알림으로. `files` 열은 직접 충돌이면 파일들, 나머지 종류면 심볼들이다.
 * `ALERT_FILES`개까지 이름을 적고 나머지는 센다.
 */
const alertView = (row: {
  kind: string | null;
  works: string | null;
  files: string | null;
  resolved: number | null;
  run: string | null;
  confirmed: number | null;
}): Alert => {
  const items: unknown[] = JSON.parse(row.files ?? "[]");
  const common = {
    works: JSON.parse(row.works ?? "[]"),
    more: Math.max(items.length - ALERT_FILES, 0),
    resolved: row.resolved === null ? null : new Date(row.resolved).toISOString(),
  };
  const kind = row.kind ?? "direct";
  if (kind === "direct")
    return { kind, ...common, files: items.slice(0, ALERT_FILES) as AlertFile[] };
  return {
    kind: kind as "indirect" | "duplicate" | "declared",
    ...common,
    symbols: items.slice(0, ALERT_FILES) as AlertSymbol[],
    ...(row.run !== null && { run: JSON.parse(row.run), confirmed: row.confirmed === 1 }),
  };
};

/** 간접 충돌과 선언된 계약 변경의 심볼에서 쓰는 쪽(`works`의 자리). 그 쪽 러너가 계산한 것이다. */
const usingSide = (symbol: AlertSymbol) =>
  symbol.places[0].some((place) => place.role === "uses") ? 0 : 1;

/** 쓰는 쪽 러너만 계산하는 종류(방향이 있다). */
const oneWay = (kind: Alert["kind"]) => kind === "indirect" || kind === "declared";

/** 알림에 묶인 것 하나의 열쇠: 직접 충돌은 경로, 중복 구현은 이름, 간접 충돌과 선언된 계약 변경은 이름과 쓰는 쪽(방향마다 따로다). */
const itemId = (kind: Alert["kind"], item: AlertFile | AlertSymbol) =>
  "path" in item ? item.path : oneWay(kind) ? `${item.name}\0${usingSide(item)}` : item.name;

/** 알림에 묶인 것 하나를 계산할 수 있는 러너의 멤버들(ADR-0023). 간접 충돌과 선언된 계약 변경은 쓰는 쪽 사본의 색인이 있어야 한다. */
const computedBy = (kind: Alert["kind"], item: AlertFile | AlertSymbol, works: WorkRef[]) =>
  oneWay(kind) && "places" in item
    ? [works[usingSide(item)]?.login]
    : works.map((work) => work.login);

/** 포스트 요약(`Post`에서 `alert`만 뺀 것). `row`는 알림 줄이다. 한 줄은 줄바꿈을 접고 `POST_LINE`자까지만 준다. */
const POST_LINE = 200;
const postSummary = (row: MessageRow): Omit<Post, "alert"> => {
  const last = row.last === null ? null : JSON.parse(row.last);
  return {
    channel: row.post as string,
    count: row.count,
    last: last && {
      login: last.login,
      name: last.name,
      line: last.line.replace(/\s+/g, " ").trim().slice(0, POST_LINE),
    },
    activity: new Date(last ? last.at : row.at).toISOString(),
    issue:
      row.issue === null
        ? null
        : {
            number: row.issue,
            url: row.issue_url as string,
            title: row.issue_title as string,
            labels: JSON.parse(row.issue_labels ?? "[]"),
            open: row.issue_open === 1,
          },
  };
};

const messageView = (row: MessageRow): ChannelMessage => {
  if (row.alert !== null) {
    return {
      kind: "alert",
      id: row.id,
      channel: row.channel,
      at: new Date(row.at).toISOString(),
      alert: alertView(row),
      post: postSummary(row),
    };
  }
  if (row.decision !== null) {
    return {
      kind: "decision",
      id: row.id,
      channel: row.channel,
      at: new Date(row.at).toISOString(),
      event: row.text as Extract<ChannelMessage, { kind: "decision" }>["event"],
      ...(row.note !== null && { reason: row.note }),
      ...(row.login !== "" && { by: { login: row.login, name: row.name ?? row.login } }),
      decision: decisionView(row.decision),
    };
  }
  const common = {
    id: row.id,
    channel: row.channel,
    login: row.login,
    name: row.name ?? row.login,
    at: new Date(row.at).toISOString(),
  };
  if (row.qa === null)
    return {
      kind: "text",
      ...common,
      text: row.text ?? "",
      ...(row.github === 1 && { github: true }),
    };
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
  /** 편지함의 소식을 남겨 두는 시간. 기본 14일(`INBOX_MS`). 테스트가 줄여 쓴다. 만료는 `followMs`마다 치운다. */
  inboxMs?: number;
  /** 고른 접속 상태가 온라인으로 돌아오기까지의 시간. 테스트가 줄여 쓴다. 주지 않은 것은 계약의 시간이다. */
  presenceDurations?: Partial<Record<PresenceDuration, number>>;
  /** 사람이 웹을 여는 주소. 결정 파일의 출처(포스트 링크)에 쓴다. 주지 않으면 서버가 듣는 주소다. */
  publicUrl?: string;
  /** 결정 PR의 이의 창에서 한 시간의 길이. 기본은 정말 한 시간이다. 테스트가 줄여 쓴다. 창이 닫혔는지는 `followMs`마다 본다. */
  hourMs?: number;
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
  // 포스트에서 정리한 결정과 그 결정 PR(ADR-0025). `login`은 정리한 멤버, `pull`과 `url`은 PR의 번호와 주소, `span`은 이의 창,
  // `state`는 PR에서 읽은 상태(proposed, accepted, closed), `at`은 정리한 시각(ms)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    post TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    title TEXT NOT NULL,
    path TEXT NOT NULL,
    pull INTEGER NOT NULL,
    url TEXT NOT NULL,
    span TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'proposed',
    at INTEGER NOT NULL
  ) STRICT`);
  // 결정 PR의 줄은 `decision`(결정 번호)이 있고, `text`가 일어난 일, `note`가 막힌 까닭, `login`이 그 일을 한 사람(없으면 빈 이름)이다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'decision'").get())
    db.exec("ALTER TABLE messages ADD COLUMN decision INTEGER REFERENCES decisions (id)");
  // 이의 창과 동의(#86). `branch`는 결정 PR의 브랜치, `deciders`는 결정자 로그인의 JSON 배열, `closes`는 창이 닫히는 시각(ms),
  // `reopened`는 이의가 모두 거둬져 다시 열렸는지, `early`는 모두 동의해 일찍 머지했는지, `stuck`은 머지가 막히거나 멈춘 것({kind, reason})이다.
  // #83의 결정은 결정자를 몰라 일찍 머지하지 않고, 창은 정리한 때부터 잰다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('decisions') WHERE name = 'closes'").get()) {
    db.exec(`ALTER TABLE decisions ADD COLUMN branch TEXT;
      ALTER TABLE decisions ADD COLUMN deciders TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE decisions ADD COLUMN closes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE decisions ADD COLUMN reopened INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE decisions ADD COLUMN early INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE decisions ADD COLUMN stuck TEXT;`);
    db.prepare("UPDATE decisions SET closes = at + ? WHERE span = 'day'").run(
      24 * (options.hourMs ?? 3_600_000),
    );
    db.exec("UPDATE decisions SET closes = at WHERE span = 'now'");
  }
  // 결정자의 동의. 정리한 사람의 것은 두지 않는다(늘 동의한 것이다).
  db.exec(`CREATE TABLE IF NOT EXISTS agreements (
    decision INTEGER NOT NULL REFERENCES decisions (id),
    login TEXT NOT NULL,
    PRIMARY KEY (decision, login)
  ) STRICT`);
  // 걸린 이의. 포스트에서 낸 것(`post`)과 GitHub의 변경 요청 리뷰(`github`). 거두면 지운다. `at`은 낸 시각(ms)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS objections (
    decision INTEGER NOT NULL REFERENCES decisions (id),
    login TEXT NOT NULL,
    via TEXT NOT NULL CHECK (via IN ('post', 'github')),
    at INTEGER NOT NULL,
    PRIMARY KEY (decision, login, via)
  ) STRICT`);
  // 채널의 종류(ADR-0027). 포스트의 줄은 'chat'으로 두고 `alert`로 가린다. 2단계 앞의 표에는 `kind`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'kind'").get())
    db.exec(
      "ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'forum'))",
    );
  // 포스트의 GitHub 이슈(ADR-0032). `issue`는 번호(아직 열지 못했으면 NULL), 제목·라벨(JSON)·열림은 GitHub에서 마지막으로 읽은 것이다.
  // `issue_closed`는 알림이 풀려 Omagari가 이슈를 닫은 시각(ms)이다. 사람이 다시 열면 다시 닫지 않는다.
  // 메시지의 `comment`는 그 글과 맞춘 이슈 댓글의 번호다. 포스트의 글을 댓글로 올렸거나 댓글이 글로 들어왔다. `github`이 1이면 들어온 것이다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'issue'").get())
    db.exec(`ALTER TABLE channels ADD COLUMN issue INTEGER;
      ALTER TABLE channels ADD COLUMN issue_url TEXT;
      ALTER TABLE channels ADD COLUMN issue_title TEXT;
      ALTER TABLE channels ADD COLUMN issue_labels TEXT;
      ALTER TABLE channels ADD COLUMN issue_open INTEGER;
      ALTER TABLE channels ADD COLUMN issue_closed INTEGER;
      ALTER TABLE messages ADD COLUMN comment INTEGER;
      ALTER TABLE messages ADD COLUMN github INTEGER NOT NULL DEFAULT 0;`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS messages_by_comment ON messages (comment)");
  // 알림(ADR-0023): 두 작업 한 쌍과 종류(`kind`)마다 하나. 채널에는 messages의 한 줄(`alert`)로 선다. 그 줄의 `text`는 빈 글, `login`은 빈 이름이다
  // (`text`의 CHECK를 바꾸려면 표를 다시 만들어야 한다). `pair`는 두 작업을 정한 순서로 적은 열쇠, `works`는 계약의 WorkRef 둘(JSON),
  // `files`는 묶은 것 전부(직접 충돌이면 계약의 AlertFile 배열로 확인된 것부터 경로 순, 나머지 종류면 AlertSymbol 배열로 이름 순)다. `resolved`는 풀린 시각(ms)이고, 풀리지 않은 알림은 쌍마다 하나다.
  // `updated`는 마지막으로 고친 시각(ms)이다. 실시간 연결이 다시 붙을 때 끊긴 사이에 고친 알림을 다시 보낸다.
  db.exec(`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'direct',
    works TEXT NOT NULL,
    files TEXT NOT NULL,
    resolved INTEGER,
    updated INTEGER NOT NULL
  ) STRICT`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS alerts_open ON alerts (pair) WHERE resolved IS NULL");
  // 직접 충돌만 있던 표에는 `kind`가 없다. 직접 충돌의 `pair`는 그대로 두고, 다른 종류는 `pair` 앞에 종류를 붙인다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'kind'").get())
    db.exec("ALTER TABLE alerts ADD COLUMN kind TEXT NOT NULL DEFAULT 'direct'");
  // 합쳐 돌려 보기(ADR-0036): `run`은 간접 충돌 알림에 붙은 마지막 판정(계약의 AlertRun, JSON), `confirmed`는 깨져 확인됐는지(0, 1)다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'run'").get())
    db.exec(`ALTER TABLE alerts ADD COLUMN run TEXT;
      ALTER TABLE alerts ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;`);
  // v0.1.0의 표에는 `alert`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'alert'").get())
    db.exec("ALTER TABLE messages ADD COLUMN alert INTEGER REFERENCES alerts (id)");
  // 편지함(2단계 질문 A5~A7): 작업(`login` + `branch`)마다 넘겨줄 소식. 알림(`alert`)이거나, 그 밖의 소식(`news`, 계약의 InboxItem에서
  // id, branch, at을 뺀 것의 JSON) 가운데 하나다. `at`은 들어온 시각(ms)이다.
  // 작업과 알림마다 넘겨주지 않은 것은 하나다. 넘겨준 확인이 오면 지우고, `inboxMs`가 지나면 만료로 지운다.
  const INBOX = `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    alert INTEGER REFERENCES alerts (id),
    news TEXT,
    at INTEGER NOT NULL,
    UNIQUE (login, branch, alert),
    CHECK ((alert IS NULL) != (news IS NULL))
  ) STRICT`;
  db.exec(`CREATE TABLE IF NOT EXISTS inbox ${INBOX}`);
  // #82의 표에는 `news`가 없고 `alert`가 NOT NULL이다. 표를 다시 만들어 옮긴다(번호는 그대로 이어 간다).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('inbox') WHERE name = 'news'").get()) {
    db.exec("BEGIN");
    db.exec(`CREATE TABLE inbox_next ${INBOX}`);
    db.exec(
      "INSERT INTO inbox_next (id, login, branch, alert, at) SELECT id, login, branch, alert, at FROM inbox",
    );
    db.exec("DROP TABLE inbox");
    db.exec("ALTER TABLE inbox_next RENAME TO inbox");
    db.exec("COMMIT");
  }
  // 선점(ADR-0008). `lines`는 LineRange(JSON)이고 심볼과 줄 범위에만 있다. `at`은 건 시각(ms)이다.
  // `stale`은 주인이 오프라인으로 `forgetMs`를 넘겨 "오래됨"이 된 시각(ms)이고, 그 뒤 `forgetMs`가 더 지나면 지운다. 러너가 다시 붙으면 지운다.
  db.exec(`CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    path TEXT NOT NULL,
    unit TEXT NOT NULL,
    symbol TEXT,
    lines TEXT,
    at INTEGER NOT NULL,
    stale INTEGER,
    plan TEXT
  ) STRICT`);
  // #85의 표에는 계획(`plan`, 계약의 Plan JSON)이 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('claims') WHERE name = 'plan'").get())
    db.exec("ALTER TABLE claims ADD COLUMN plan TEXT");
  // 피드에만 남는 소식: 걸거나 푼 선점(`kind`가 claim이나 released, `claim`은 계약의 Claim JSON). `inboxMs`가 지나면 지운다.
  db.exec(`CREATE TABLE IF NOT EXISTS feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`);
  // 워크스페이스의 설정 하나씩: 알림 채널(`alert_channel`)과, 러너가 마지막으로 알려 온 설정 파일(`check`, 계약의 CheckReading JSON).
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
  // 묻기(ADR-0024). 묻는 작업(`login` + `branch`)이 받는 멤버(`target`)에게 보낸 질문. `executor`는 받는 쪽 실행기이고 고르지 않았으면 보낼 때 정한다.
  // `answer`는 편지함에 넣은 답이나 실패(JSON)이고, 답을 기다리는 동안 NULL이다. `at`은 물은 시각(ms)이고 `inboxMs`가 지나면 지운다.
  db.exec(`CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    target TEXT NOT NULL,
    executor TEXT,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    answer TEXT
  ) STRICT`);
  // 남의 질문에 답하지 않게 스위치를 끈 멤버(ADR-0024). 기본은 켜짐이라 없으면 켜짐이다.
  db.exec("CREATE TABLE IF NOT EXISTS ask_off (login TEXT PRIMARY KEY) STRICT");
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
      mergeCheck: MergeCheckState;
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
  /** 받는 쪽 러너에 보내고 답을 기다리는 질문(묻기). 키는 보낸 `question`의 id다. 연결이 끊기거나 서버가 다시 뜨면 잃고, 러너가 붙을 때 다시 보낸다. */
  const questionsSent = new Map<string, { socket: WSContext; executor: ExecutorId; id: number }>();
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
    const { message } = shareQa(ask.qa);
    if (message) syncSoon(message.channel); // `@호출`의 답을 이슈 댓글로
    shareMembers();
  };
  /** 러너에 보내고 기다리는 결정 초안(ADR-0028). 키는 보낸 `draft`의 id이고 `Draft.id`다. 저장하지 않는다. */
  const drafting = new Map<
    string,
    { socket: WSContext; login: string; executor: ExecutorId; draft: Draft }
  >();
  /** 기다리던 초안을 끝내고 요청한 사람에게 보낸다. 이미 끝났으면 없다. */
  const settleDraft = (id: string, state: Exclude<Draft["state"], { state: "pending" }>) => {
    const found = drafting.get(id);
    if (!found || stopped) return;
    drafting.delete(id);
    const draft = { ...found.draft, state };
    sendTo(found.login, encode(serverToWeb, "draft", draft));
    shareMembers();
    return draft;
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

  type ClaimRow = {
    id: number;
    login: string;
    branch: string;
    path: string;
    unit: Claim["unit"];
    symbol: string | null;
    lines: string | null;
    at: number;
    stale: number | null;
    plan: string | null;
  };
  const claimView = (row: ClaimRow): Claim => ({
    id: row.id,
    login: row.login,
    branch: row.branch,
    path: row.path,
    unit: row.unit,
    ...(row.symbol !== null && { symbol: row.symbol }),
    ...(row.lines !== null && { lines: JSON.parse(row.lines) }),
    at: new Date(row.at).toISOString(),
    stale: row.stale !== null,
    ...(row.plan !== null && { plan: JSON.parse(row.plan) }),
  });
  /** 선점 전부. 작업처럼 워크스페이스에서 빠진 사람의 것은 보이지 않는다. */
  const claimsView = (): Claim[] =>
    (
      db
        .prepare("SELECT * FROM claims WHERE login IN (SELECT login FROM sessions) ORDER BY id")
        .all() as ClaimRow[]
    ).map(claimView);

  /** 선점을 푼다. 피드에 남기고 푼 것을 돌려준다. 상황은 부른 쪽이 보낸다. */
  const releaseClaims = (where: string, ...params: (string | number)[]) => {
    const rows = db.prepare(`SELECT * FROM claims WHERE ${where}`).all(...params) as ClaimRow[];
    const now = Date.now();
    for (const row of rows) {
      db.prepare("DELETE FROM claims WHERE id = ?").run(row.id);
      db.prepare("INSERT INTO feed (kind, claim, at) VALUES ('released', ?, ?)").run(
        JSON.stringify(claimView(row)),
        now,
      );
    }
    return rows.map(claimView);
  };

  /** 계획대로라면 선점한 작업의 정의 줄에 생길 변경. 이름 바꾸기는 옛 이름이 없어진다. */
  const PLAN_CHANGE = { rename: "removed", signature: "changed", delete: "removed", add: "added" };
  /**
   * 푼 선점의 계획 가운데 이루지 못한 것(그 작업의 관측에서 정의 줄이 계획대로 바뀌지 않았다)을 취소로 알린다.
   * 그 계획의 열린 선언된 계약 변경 알림을 받은 다른 작업의 편지함에 넣는다. 머지되어 풀린 것은 부르지 않는다.
   */
  // ponytail: 이루었는지는 서버가 받은 관측의 정의 줄로만 본다. intent 작업은 정의 줄을 올리지 않아 늘 취소로 본다.
  const cancelPlans = (claims: Claim[]) => {
    const works = worksView();
    const open = db
      .prepare("SELECT works, files FROM alerts WHERE kind = 'declared' AND resolved IS NULL")
      .all() as { works: string; files: string }[];
    const put = db.prepare("INSERT INTO inbox (login, branch, news, at) VALUES (?, ?, ?, ?)");
    const now = Date.now();
    for (const claim of claims) {
      const { plan } = claim;
      if (!plan) continue;
      const work = works.find((w) => w.login === claim.login && w.branch === claim.branch);
      const done = work?.files.some((file) =>
        ("definitions" in file ? (file.definitions ?? []) : []).some(
          (d) =>
            (d.name === plan.symbol || d.name.endsWith(`.${plan.symbol}`)) &&
            d.change === PLAN_CHANGE[plan.kind],
        ),
      );
      if (done) continue;
      for (const row of open) {
        const pair = JSON.parse(row.works) as [WorkRef, WorkRef];
        const side = pair.findIndex((w) => w.login === claim.login && w.branch === claim.branch);
        if (side === -1) continue;
        const symbols = JSON.parse(row.files) as AlertSymbol[];
        if (!symbols.some((s) => s.name === plan.symbol && usingSide(s) !== side)) continue;
        const to = pair[1 - side] as WorkRef;
        put.run(to.login, to.branch, JSON.stringify({ kind: "cancelled", claim }), now);
      }
    }
    shareInbox();
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
      const busy = [...asks.values(), ...drafting.values(), ...questionsSent.values()].some(
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
    const open = db
      .prepare("SELECT works, files FROM alerts WHERE resolved IS NULL AND kind = 'direct'")
      .all() as {
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

  /** 알림을 올릴 포럼. 정한 것이 없거나 포럼이 아니면 "부딪힘" 포럼을 쓰고, 그것도 없으면 만든다. */
  const alertChannel = () => {
    const chosen = db.prepare("SELECT value FROM settings WHERE key = 'alert_channel'").get() as
      | { value: string }
      | undefined;
    if (
      chosen &&
      db.prepare("SELECT 1 FROM channels WHERE id = ? AND kind = 'forum'").get(chosen.value)
    )
      return chosen.value;
    // ponytail: 2단계 앞의 개발용 DB에 채팅 "부딪힘"이 있으면 이름이 겹쳐 만들지 못한다. 릴리즈된 적이 없어 옮기지 않는다(이슈 #101).
    let found = db
      .prepare("SELECT id FROM channels WHERE name = ? AND kind = 'forum'")
      .get(ALERT_CHANNEL) as { id: string } | undefined;
    if (!found) {
      found = { id: randomBytes(8).toString("hex") };
      db.prepare("INSERT INTO channels (id, name, kind) VALUES (?, ?, 'forum')").run(
        found.id,
        ALERT_CHANNEL,
      );
      broadcast(
        encode(serverToWeb, "channel", { id: found.id, name: ALERT_CHANNEL, kind: "forum" }),
      );
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
   * 러너들의 계산을 두 작업 한 쌍과 종류마다 하나로 묶어 알림을 올리고, 고치고, 풀린 것을 닫는다(ADR-0023).
   * 알림에 묶인 것(직접 충돌의 파일, 나머지의 심볼)마다 그것을 계산할 수 있는 러너가 있다(`computedBy`).
   * 그 러너가 붙어 있는데 올리지 않았으면 풀린 것이고, 그 러너가 꺼져 있으면 알 수 없으니 지난 것을 그대로 둔다.
   * 직접 충돌과 중복 구현은 두 쪽 러너 모두, 간접 충돌은 쓰는 쪽 러너만 계산한다. 한 파일을 양쪽 러너가 올렸으면 줄이 확인된 쪽을 쓴다.
   */
  const reconcile = () => {
    const name = (login: string) =>
      (
        db.prepare("SELECT name FROM people WHERE login = ?").get(login) as
          | { name: string }
          | undefined
      )?.name ?? login;
    type Item = AlertFile | AlertSymbol;
    const found = new Map<
      string,
      { kind: Alert["kind"]; works: [WorkRef, WorkRef]; items: Map<string, Item> }
    >();
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
        const ends = JSON.stringify([a.login, a.branch, b.login, b.branch]);
        // 직접 충돌의 열쇠는 종류가 하나뿐이던 때의 것 그대로다.
        const key = pair.kind === "direct" ? ends : `${pair.kind} ${ends}`;
        const entry = found.get(key) ?? {
          kind: pair.kind,
          works: [
            { ...a, name: name(a.login) },
            { ...b, name: name(b.login) },
          ] as [WorkRef, WorkRef],
          items: new Map(),
        };
        found.set(key, entry);
        const views: Item[] =
          pair.kind === "direct"
            ? pair.files.map((file) =>
                "unknown" in file
                  ? file
                  : {
                      path: file.path,
                      lines: flip ? [file.theirs, file.mine] : [file.mine, file.theirs],
                    },
              )
            : pair.symbols.map(({ name, mine, theirs, plan }) => ({
                name,
                places: flip ? [theirs, mine] : [mine, theirs],
                ...(plan && { plan }),
              }));
        for (const view of views) {
          const id = itemId(entry.kind, view);
          const known = entry.items.get(id);
          if (!known || ("unknown" in known && "lines" in view)) entry.items.set(id, view);
        }
      }
    }
    const open = db
      .prepare("SELECT id, pair, kind, works, files FROM alerts WHERE resolved IS NULL")
      .all() as { id: number; pair: string; kind: Alert["kind"]; works: string; files: string }[];
    let changed = false;
    const now = Date.now();
    for (const key of new Set([...open.map((row) => row.pair), ...found.keys()])) {
      const known = open.find((row) => row.pair === key);
      const entry = found.get(key);
      const kind = (entry?.kind ?? known?.kind) as Alert["kind"];
      const works = entry?.works ?? (JSON.parse(known?.works ?? "[]") as [WorkRef, WorkRef]);
      const items = new Map(entry?.items);
      // 계산할 러너가 꺼져 있는 것은 지난 것을 그대로 둔다.
      for (const view of known ? (JSON.parse(known.files) as Item[]) : []) {
        const id = itemId(kind, view);
        if (items.has(id)) continue;
        if (!computedBy(kind, view, works).some((login) => reporting.has(login)))
          items.set(id, view);
      }
      if (items.size === 0) {
        if (!known) continue;
        db.prepare("UPDATE alerts SET resolved = ?, updated = ? WHERE id = ?").run(
          now,
          now,
          known.id,
        );
        shareAlert(known.id);
        deliver(known.id, works, now);
        changed = true;
        continue;
      }
      // 직접 충돌은 줄이 확인된 파일부터, 그 안에서는 경로 순이다. 심볼은 이름 순이다.
      const json = JSON.stringify(
        [...items.entries()]
          .sort(([x, a], [y, b]) =>
            "path" in a && "path" in b
              ? Number("unknown" in a) - Number("unknown" in b) || (a.path < b.path ? -1 : 1)
              : x < y
                ? -1
                : 1,
          )
          .map(([, view]) => view),
      );
      if (known?.files === json) continue;
      changed = true;
      if (known) {
        db.prepare("UPDATE alerts SET files = ?, works = ?, updated = ? WHERE id = ?").run(
          json,
          JSON.stringify(works),
          now,
          known.id,
        );
        shareAlert(known.id);
        deliver(known.id, works, now);
        continue;
      }
      const channel = alertChannel();
      db.exec("BEGIN");
      const { lastInsertRowid } = db
        .prepare("INSERT INTO alerts (pair, kind, works, files, updated) VALUES (?, ?, ?, ?, ?)")
        .run(key, kind, JSON.stringify(works), json, now);
      const message = db
        .prepare("INSERT INTO messages (channel, login, text, alert, at) VALUES (?, '', '', ?, ?)")
        .run(channel, lastInsertRowid, now).lastInsertRowid;
      // 알림 하나가 포스트 하나다(ADR-0027). 포스트의 이름은 사람이 지을 수 없는 이름(줄바꿈으로 시작)이다.
      const post = randomBytes(8).toString("hex");
      db.prepare("INSERT INTO channels (id, name, alert) VALUES (?, ?, ?)").run(
        post,
        `\n${post}`,
        message,
      );
      db.exec("COMMIT");
      shareAlert(Number(lastInsertRowid));
      deliver(Number(lastInsertRowid), works, now);
      syncSoon(post); // 포스트의 이슈를 연다(ADR-0032)
    }
    if (changed) {
      shareMembers(); // 멤버 목록의 직접 충돌 표시
      shareInbox();
    }
  };

  /**
   * 러너가 올린 합쳐 돌려 보기의 판정을 그 쌍의 열린 간접 충돌 알림에 붙인다(ADR-0036). 열린 알림이 없으면 버린다.
   * 새 판정(돌려 보는 중도 지난 결과도 아닌 것)이 나면 두 작업의 편지함에 다시 넣는다. 이 이슈에서는 깨지면 곧 확인됨이고,
   * 확인됨은 다음 판정이 날 때까지 남는다(돌려 보는 중이나 지난 결과로는 바뀌지 않는다).
   */
  const attachRun = (
    login: string,
    { branch, theirs, run }: Extract<Message<typeof runnerToServer>, { kind: "merged" }>["payload"],
  ) => {
    const mine = { login, branch };
    const flip = JSON.stringify([login, branch]) > JSON.stringify([theirs.login, theirs.branch]);
    const [a, b] = flip ? [theirs, mine] : [mine, theirs];
    const key = `indirect ${JSON.stringify([a.login, a.branch, b.login, b.branch])}`;
    const row = db
      .prepare("SELECT id, works, run, confirmed FROM alerts WHERE pair = ? AND resolved IS NULL")
      .get(key) as { id: number; works: string; run: string | null; confirmed: number } | undefined;
    if (!row) return;
    const next = { ...run, login };
    const { at: _, ...known } = row.run ? (JSON.parse(row.run) as AlertRun) : {};
    if (JSON.stringify(known) === JSON.stringify(next)) return; // 같은 것을 다시 올렸다
    const finished = run.verdict !== "running" && !run.stale;
    const confirmed = finished ? Number(run.verdict === "broken") : row.confirmed;
    const now = Date.now();
    db.prepare("UPDATE alerts SET run = ?, confirmed = ?, updated = ? WHERE id = ?").run(
      JSON.stringify({ ...next, at: new Date(now).toISOString() }),
      confirmed,
      now,
      row.id,
    );
    shareAlert(row.id);
    if (!finished) return;
    deliver(row.id, JSON.parse(row.works), now);
    shareInbox();
  };

  /** 알림이 생기거나 바뀌거나 풀렸다. 두 작업의 편지함에 넣는다. 아직 넘겨주지 않은 같은 알림의 소식은 새 것으로 바꾼다. */
  const deliver = (alert: number, works: WorkRef[], now: number) => {
    for (const { login, branch } of works) {
      db.prepare("DELETE FROM inbox WHERE login = ? AND branch = ? AND alert = ?").run(
        login,
        branch,
        alert,
      );
      db.prepare("INSERT INTO inbox (login, branch, alert, at) VALUES (?, ?, ?, ?)").run(
        login,
        branch,
        alert,
        now,
      );
    }
  };

  const inboxMs = options.inboxMs ?? INBOX_MS;
  /** 멤버의 편지함 전부: 만료되지 않은 것을 들어온 순서로. */
  const inboxOf = (login: string): InboxItem[] =>
    (
      db
        .prepare(
          `SELECT i.id, i.branch, i.at, i.news, a.kind, a.works, a.files, a.resolved, a.run, a.confirmed FROM inbox i
           LEFT JOIN alerts a ON a.id = i.alert WHERE i.login = ? AND i.at > ? ORDER BY i.id`,
        )
        .all(login, Date.now() - inboxMs) as {
        id: number;
        branch: string;
        at: number;
        news: string | null;
        kind: string | null;
        works: string | null;
        files: string | null;
        resolved: number | null;
        run: string | null;
        confirmed: number | null;
      }[]
    ).map((row) => {
      const head = { id: row.id, branch: row.branch, at: new Date(row.at).toISOString() };
      return row.news === null
        ? { ...head, kind: "alert", alert: alertView(row) }
        : { ...head, ...JSON.parse(row.news) };
    });
  /** 러너마다 마지막으로 보낸 편지함. 같은 것을 다시 보내지 않는다. */
  const sentInbox = new Map<WSContext, string>();
  /** 편지함이 달라진 러너에 그 멤버의 편지함을 보낸다. `to`(막 붙은 러너)에는 같아도 보낸다. */
  const shareInbox = (to?: WSContext) => {
    for (const [socket, { login }] of runners) {
      if (socket.readyState !== 1) continue; // OPEN
      const items = inboxOf(login);
      const json = JSON.stringify(items);
      if (socket !== to && sentInbox.get(socket) === json) continue;
      sentInbox.set(socket, json);
      socket.send(encode(serverToRunner, "inbox", { items }));
    }
  };

  type QuestionRow = {
    id: number;
    login: string;
    branch: string;
    target: string;
    executor: ExecutorId | null;
    text: string;
    at: number;
  };
  const questionView = (row: QuestionRow): Question => ({
    id: row.id,
    to: row.target,
    executor: row.executor,
    text: row.text,
    at: new Date(row.at).toISOString(),
  });
  /** 질문에 답이나 실패를 적고 묻는 작업의 편지함에 넣는다. 이미 적은 것(만료로 지운 것 포함)이면 그대로 둔다. */
  const settleQuestion = (
    id: number,
    answer: Extract<InboxItem, { kind: "answer" }>["answer"],
    executor?: ExecutorId,
  ) => {
    if (stopped) return;
    const row = db.prepare("SELECT * FROM questions WHERE id = ? AND answer IS NULL").get(id) as
      | QuestionRow
      | undefined;
    if (!row) return;
    const now = Date.now();
    const question = questionView({ ...row, executor: executor ?? row.executor });
    db.prepare("UPDATE questions SET answer = ?, executor = ? WHERE id = ?").run(
      JSON.stringify(answer),
      question.executor,
      id,
    );
    db.prepare("INSERT INTO inbox (login, branch, news, at) VALUES (?, ?, ?, ?)").run(
      row.login,
      row.branch,
      JSON.stringify({ kind: "answer", question, answer }),
      now,
    );
    shareInbox();
  };
  /** 멤버의 이 연결이 그 실행기(고르지 않았으면 첫째 실행기)로 답할 수 있으면 그 실행기. */
  const answererOf = (target: string, executor: ExecutorId | null) => {
    const found = [...runners].findLast(
      ([, runner]) =>
        runner.login === target && (executor === null || runner.executors.includes(executor)),
    );
    if (!found) return undefined;
    const [socket, runner] = found;
    return { socket, executor: executor ?? (runner.executors[0] as ExecutorId) };
  };
  /**
   * 멤버(`target`)에게 남은 질문(답이 없고 만료되지 않았고 아직 보내지 않은 것)을 그 멤버의 러너에 보낸다. 묻는 순서대로다.
   * 스위치가 꺼져 있으면 보내지 않고 실패로 묻는 쪽 편지함에 넣는다. 받을 러너가 없으면 남겨 둔다.
   */
  const dispatchQuestions = (target: string) => {
    const rows = db
      .prepare("SELECT * FROM questions WHERE target = ? AND answer IS NULL AND at > ? ORDER BY id")
      .all(target, Date.now() - inboxMs) as QuestionRow[];
    const sent = new Set([...questionsSent.values()].map((q) => q.id));
    for (const row of rows) {
      if (sent.has(row.id)) continue;
      if (db.prepare("SELECT 1 FROM ask_off WHERE login = ?").get(target)) {
        settleQuestion(row.id, {
          state: "failed",
          error: { code: "refused", message: `${target}이 남의 질문에 답하지 않게 해 두었다` },
        });
        continue;
      }
      const answerer = answererOf(target, row.executor);
      if (!answerer) continue;
      const frame = encode(serverToRunner, "question", {
        id: row.id,
        from: { login: row.login, name: nameOf(row.login), branch: row.branch },
        executor: answerer.executor,
        text: row.text,
      });
      questionsSent.set((JSON.parse(frame) as { id: string }).id, { ...answerer, id: row.id });
      answerer.socket.send(frame);
    }
    shareMembers(); // 답하는 중
  };
  /** 멤버의 GitHub 프로필 이름. 모르면 `login`이다. */
  const nameOf = (login: string) =>
    (
      db.prepare("SELECT name FROM people WHERE login = ?").get(login) as
        | { name: string }
        | undefined
    )?.name ?? login;

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
    const claims = claimsView();
    shareMembers(undefined, works); // 멤버 목록은 상황에서 나온다
    const json = JSON.stringify([works, claims]);
    const targets = (json !== sent ? [...runners.keys()] : to ? [to] : []).filter(
      (socket) => socket.readyState === 1, // OPEN
    );
    sent = json;
    if (targets.length === 0) return;
    const frame = encode(serverToRunner, "situation", { works, claims });
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

  /** 서버가 듣는 주소. 뜬 뒤에 정해진다. */
  let url = "";

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

  mount(app, api.setAskSwitch, ({ on }, c) => {
    const login = c.get("login") as string;
    if (on) db.prepare("DELETE FROM ask_off WHERE login = ?").run(login);
    else db.prepare("INSERT OR IGNORE INTO ask_off (login) VALUES (?)").run(login);
    return { on };
  });

  mount(app, api.settings, (_, c) => {
    const login = c.get("login") as string;
    // 답한 것만 센다. 남겨 두고 아직 답하지 않았거나 답하지 못한 질문은 세지 않는다.
    const answered = db
      .prepare(
        `SELECT login, text, at FROM questions
         WHERE target = ? AND at > ? AND json_extract(answer, '$.state') = 'answered' ORDER BY id DESC`,
      )
      .all(login, Date.now() - ANSWERED_DAYS * 24 * 60 * 60_000) as {
      login: string;
      text: string;
      at: number;
    }[];
    const last = answered[0];
    return {
      askSwitch: !db.prepare("SELECT 1 FROM ask_off WHERE login = ?").get(login),
      answered: {
        count: answered.length,
        last: last
          ? {
              login: last.login,
              name: nameOf(last.login),
              text: last.text,
              at: new Date(last.at).toISOString(),
            }
          : null,
      },
      alertChannel: alertChannel(),
      mergeCheck: {
        // ponytail: 멤버 하나에 러너 하나로 본다(hello와 같다). 마지막에 붙은 러너의 것이다.
        runner:
          [...runners.values()].findLast((r) => r.login === login)?.mergeCheck ??
          ("offline" as const),
        check: JSON.parse(
          (
            db.prepare("SELECT value FROM settings WHERE key = 'check'").get() as
              | { value: string }
              | undefined
          )?.value ?? "null",
        ),
      },
    };
  });

  /** 에이전트는 주인만 부른다. */
  const mustOwn = (agent: string, login: string) => {
    if (agent !== login) {
      throw new ContractFailure({
        code: "forbidden",
        message: `${agent}의 에이전트는 ${agent}만 부를 수 있다`,
      });
    }
  };

  /**
   * `agent`의 `executor`를 돌리는 러너의 연결. 같은 멤버의 러너가 여럿이면 마지막에 붙은 것이 답한다.
   * 꺼져 있으면 쌓아 두지 않고 `runner_offline`이다.
   */
  const runnerOf = (agent: string, executor: ExecutorId) => {
    const found = [...runners].findLast(
      ([, runner]) => runner.login === agent && runner.executors.includes(executor),
    );
    if (!found) {
      throw new ContractFailure({
        code: "runner_offline",
        message: `${agent}의 ${EXECUTOR_NAMES[executor]} 러너가 꺼져 있다. 요청은 쌓아 두지 않는다`,
      });
    }
    return found[0];
  };

  /**
   * 러너에 넘길 채널의 최근 대화, 오래된 것부터 `CHANNEL_CONTEXT`개까지. 포스트면 맨 앞에 그 알림을 둔다.
   * 알림의 번호가 포스트의 글보다 앞이라 러너는 채널 세션의 첫 턴에만 넘긴다.
   */
  const recentOf = (channel: string) => {
    const alert = postAlert(channel);
    return [
      ...(alert ? [alert] : []),
      ...(
        db
          .prepare(`${MESSAGES} WHERE m.channel = ? ORDER BY m.id DESC LIMIT ?`)
          .all(channel, CHANNEL_CONTEXT - (alert ? 1 : 0)) as MessageRow[]
      ).reverse(),
    ].map(messageView);
  };

  mount(app, api.ask, ({ agent, executor, channel, message, visibility, model, effort }, c) => {
    mustOwn(agent, c.get("login") as string);
    mustWrite(channel);
    visit(agent);
    const socket = runnerOf(agent, executor);
    // 채널 대화는 이 문답이 채널에 서기 전에 읽는다. `@호출`의 질문이 데이터로 한 번 더 들어가지 않는다.
    // ponytail: 첫 턴 뒤에 알림이 고쳐져도 그 채널 세션에는 다시 넘기지 않는다. 고친 알림이 필요해지면 러너가 알림만 따로 다시 넘긴다.
    const recent = recentOf(channel);
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

  mount(app, api.draftDecision, ({ agent, executor, post, model, effort }, c) => {
    mustOwn(agent, c.get("login") as string);
    if (!postAlert(post))
      throw new ContractFailure({ code: "not_found", message: `없는 포스트다: ${post}` });
    visit(agent);
    const socket = runnerOf(agent, executor);
    const messages = recentOf(post);
    const frame = encode(serverToRunner, "draft", {
      executor,
      post: { id: post, name: channelName(post) },
      messages,
      model,
      effort,
    });
    const draft: Draft = {
      id: (JSON.parse(frame) as { id: string }).id,
      post,
      executor,
      read: {
        texts: messages.filter((m) => m.kind === "text").length,
        qas: messages.filter((m) => m.kind === "qa").length,
      },
      state: { state: "pending" },
    };
    drafting.set(draft.id, { socket, login: agent, executor, draft });
    socket.send(frame);
    shareMembers(); // 답하는 중
    return { draft };
  });

  mount(app, api.stopDraft, ({ draft: id }, c) => {
    const found = drafting.get(id);
    if (!found || found.login !== c.get("login")) {
      throw new ContractFailure({
        code: "not_found",
        message: `쓰는 중인 내 초안이 아니다: ${id}`,
      });
    }
    found.socket.send(encode(serverToRunner, "stopDraft", { id }));
    return { draft: settleDraft(id, { state: "stopped" }) as Draft };
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
    syncSoon(row.channel);
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
      db.prepare("SELECT id, name, kind FROM channels WHERE alert IS NULL ORDER BY name").all() as {
        id: string;
        name: string;
        kind: ChannelKind;
      }[]
    ).map(({ id, name, kind }) => ({ id, name, kind })),
  }));

  mount(app, api.createChannel, ({ name }, c) => {
    visit(c.get("login") as string);
    if (db.prepare("SELECT 1 FROM channels WHERE name = ?").get(name) || name === ALERT_CHANNEL) {
      throw new ContractFailure({ code: "conflict", message: `#${name} 채널이 이미 있다` });
    }
    const channel = { id: randomBytes(8).toString("hex"), name, kind: "chat" as const };
    db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(channel.id, channel.name);
    broadcast(encode(serverToWeb, "channel", channel));
    return { channel };
  });

  mount(app, api.feed, (_, c) => {
    const login = c.get("login");
    const since = Date.now() - inboxMs;
    const rows = db
      .prepare(
        "SELECT kind, works, files, resolved, run, confirmed, updated FROM alerts WHERE updated > ?",
      )
      .all(since) as {
      kind: string;
      works: string;
      files: string;
      resolved: number | null;
      run: string | null;
      confirmed: number;
      updated: number;
    }[];
    const alerts = rows
      .map((row) => ({ ms: row.updated, alert: alertView(row) }))
      .filter(({ alert }) => !alert.works.some((work) => work.login === login));
    const claims = (
      db.prepare("SELECT kind, claim, at FROM feed WHERE at > ?").all(since) as {
        kind: "claim" | "released";
        claim: string;
        at: number;
      }[]
    )
      .map((row) => ({ ms: row.at, kind: row.kind, claim: JSON.parse(row.claim) as Claim }))
      .filter((news) => news.claim.login !== login)
      .map(({ ms, kind, claim }) => ({ ms, [kind]: claim }));
    const news = [...alerts, ...claims]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, FEED_PAGE)
      .map(({ ms, ...news }) => ({ at: new Date(ms).toISOString(), ...news }));
    return { news } as ReplyOf<typeof api.feed>;
  });
  mount(app, api.setAlertChannel, ({ channel }) => {
    const found = db
      .prepare("SELECT name, kind FROM channels WHERE id = ? AND alert IS NULL")
      .get(channel) as { name: string; kind: ChannelKind } | undefined;
    if (!found) {
      throw new ContractFailure({ code: "not_found", message: `없는 채널이다: ${channel}` });
    }
    if (found.kind !== "forum") {
      throw new ContractFailure({
        code: "invalid_request",
        message: `알림은 포럼에만 올린다. #${found.name}은 채팅 채널이다`,
      });
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('alert_channel', ?)").run(
      channel,
    );
    return { channel: { id: channel, name: found.name, kind: found.kind } };
  });

  /** 알림 줄(`WHERE` 뒤에 붙인다)로 포스트와 그 알림 메시지를 읽는다. */
  const postsWhere = (where: string, ...args: number[]) =>
    (
      db
        .prepare(`${MESSAGES} WHERE m.alert IS NOT NULL${where} ORDER BY m.id`)
        .all(...args) as MessageRow[]
    ).map((row) => {
      const message = messageView(row);
      return {
        message,
        post: { ...(message.kind === "alert" && message.post), alert: row.id } as Post,
      };
    });

  mount(app, api.openPost, ({ alert }, c) => {
    visit(c.get("login") as string);
    const [found] = postsWhere(" AND m.id = ?", alert);
    if (!found)
      throw new ContractFailure({ code: "not_found", message: `없는 알림이다: ${alert}` });
    return found;
  });

  /** 결정 하나를 읽는다. */
  const decisionOf = (id: number | bigint) =>
    decisionView(
      (
        db
          .prepare(
            `SELECT ${DECISION} AS decision FROM decisions d LEFT JOIN people dp ON dp.login = d.login WHERE d.id = ?`,
          )
          .get(id) as { decision: string }
      ).decision,
    );

  /** 결정 PR에 일어난 일을 결정의 포스트에 한 줄 올린다. 부딪힘 포럼에는 올리지 않는다(ADR-0027). `by`는 그 일을 한 사람이다. */
  const announce = (
    decision: number | bigint,
    event: Extract<ChannelMessage, { kind: "decision" }>["event"],
    { reason, by }: { reason?: string; by?: string } = {},
  ) => {
    const { post } = db.prepare("SELECT post FROM decisions WHERE id = ?").get(decision) as {
      post: string;
    };
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO messages (channel, login, text, note, decision, at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(post, by ?? "", event, reason ?? null, decision, Date.now());
    broadcast(
      encode(
        serverToWeb,
        "message",
        messageView(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow),
      ),
    );
  };

  /** 열린 결정 PR이 머지되거나 닫혔다. 이미 알았으면 아무것도 하지 않는다. */
  const settleDecision = (decision: number | bigint, state: "accepted" | "closed", by?: string) => {
    const { changes } = db
      .prepare("UPDATE decisions SET state = ? WHERE id = ? AND state = 'proposed'")
      .run(state, decision);
    if (changes > 0) announce(decision, state === "accepted" ? "merged" : "closed", { by });
  };

  const hourMs = options.hourMs ?? 3_600_000;
  /** 결정의 창을 지금부터 같은 길이로 다시 연다. 막히거나 멈춘 것도 지운다. */
  const restartWindow = (id: number) => {
    const { span } = db.prepare("SELECT span FROM decisions WHERE id = ?").get(id) as {
      span: string;
    };
    db.prepare("UPDATE decisions SET closes = ?, stuck = NULL WHERE id = ?").run(
      Date.now() + windowHours(spanOf(span)) * hourMs,
      id,
    );
  };
  /** 이의가 모두 거둬졌으면 창을 처음부터 다시 연다(ADR-0025). */
  const reopenIfClear = (id: number) => {
    if (db.prepare("SELECT 1 FROM objections WHERE decision = ?").get(id)) return;
    restartWindow(id);
    db.prepare("UPDATE decisions SET reopened = 1 WHERE id = ?").run(id);
  };

  /**
   * 머지할 때가 됐으면 정리한 사람의 토큰으로 머지한다: 걸린 이의가 없고, 창이 닫혔거나 결정자가 모두 동의했을 때(ADR-0029).
   * GitHub이 막으면 `blocked`, 토큰이 듣지 않거나(401, 403) 정리한 사람의 세션이 없으면 `stalled`다. 까닭이 바뀔 때만 한 줄 올리고,
   * 다음 부름(주기마다)에 다시 해 본다. 같은 결정을 두 번 함께 머지하지 않는다.
   */
  const merging = new Set<number>();
  const tryMerge = async (id: number) => {
    if (merging.has(id)) return;
    const decision = decisionOf(id);
    if (decision.state !== "proposed" || decision.closes === null) return;
    const all = decision.deciders.length > 0 && decision.deciders.every((d) => d.agreed);
    const closes = Date.parse(decision.closes);
    const now = Date.now();
    if (now < closes && !all) return;
    merging.add(id);
    try {
      const session = db
        .prepare("SELECT github_token FROM sessions WHERE login = ? ORDER BY rowid DESC")
        .get(decision.login) as { github_token: string } | undefined;
      const merged = session
        ? await github
            .merge(session.github_token, repo, decision.pull.number)
            .catch((error: Error) => ({ reason: error.message }))
        : { reason: `${decision.login}가 로그인해 있지 않다` };
      if (stopped) return;
      if ("merged" in merged) {
        db.prepare("UPDATE decisions SET early = ?, stuck = NULL WHERE id = ?").run(
          now < closes ? 1 : 0,
          id,
        );
        settleDecision(id, "accepted");
        return;
      }
      const kind = !session || /^HTTP 40[13]\b/.test(merged.reason) ? "stalled" : "blocked";
      const stuck = JSON.stringify({ kind, reason: merged.reason });
      const { changes } = db
        .prepare(
          "UPDATE decisions SET stuck = ? WHERE id = ? AND state = 'proposed' AND stuck IS NOT ?",
        )
        .run(stuck, id, stuck);
      if (changes > 0) announce(id, kind, { reason: merged.reason });
    } finally {
      merging.delete(id);
    }
  };

  /** 결정 파일의 내용. 결정자는 로그인들이고 이름은 지금의 프로필 이름이다. */
  const decisionFile = (
    number: string,
    post: string,
    deciders: string[],
    fields: { title: string; context: string; decision: string; consequences: string },
  ) => {
    const named = deciders.map((login) => `${nameOf(login)} (@${login})`);
    return [
      `# ${number}. ${fields.title}`,
      "",
      `- 결정자: ${named.join(", ")}`,
      `- 출처: ${options.publicUrl ?? url}/#${post}`,
      "",
      "## 맥락",
      "",
      fields.context,
      "",
      "## 결정",
      "",
      fields.decision,
      "",
      "## 결과",
      "",
      fields.consequences,
      "",
    ].join("\n");
  };

  /** 부른 세션의 GitHub 토큰. */
  const callerToken = (c: { req: { header(name: string): string | undefined } }) =>
    (
      db
        .prepare("SELECT github_token FROM sessions WHERE hash = ?")
        .get(hash(bearer(c.req.header("authorization")) as string)) as { github_token: string }
    ).github_token;

  /**
   * 정리한 멤버의 토큰으로 결정 PR을 연다(ADR-0025): 기본 브랜치에서 새 브랜치를 따 결정 파일(과 필요하면 AGENTS.md 한 줄)을
   * 커밋 하나로 올리고, 기본 브랜치로 PR을 연다. 번호는 기본 브랜치의 결정 파일과 아직 열린 결정 PR의 것 다음이다.
   */
  mount(app, api.proposeDecision, async ({ post, window, ...fields }, c) => {
    const login = c.get("login") as string;
    visit(login);
    if (!postAlert(post))
      throw new ContractFailure({ code: "not_found", message: `없는 포스트다: ${post}` });
    const token = callerToken(c);
    // 결정자: 그 포스트에서 말한 멤버(글과 공개된 문답)와, 정리해 결정 줄을 세우는 멤버.
    const deciders = (
      db
        .prepare(
          `SELECT login FROM messages WHERE channel = ? AND login != '' AND decision IS NULL
           GROUP BY login ORDER BY MIN(id)`,
        )
        .all(post) as { login: string }[]
    ).map((row) => row.login);
    if (!deciders.includes(login)) deciders.push(login);
    const name = nameOf(login);
    let opened: { number: number; url: string };
    let path: string;
    let branch: string;
    try {
      const base = await github.defaultBranch(token, repo);
      const numbers = [
        ...(await github.list(token, repo, base.sha, DECISIONS)),
        ...(
          db.prepare("SELECT path FROM decisions WHERE state = 'proposed'").all() as {
            path: string;
          }[]
        ).map((row) => basename(row.path)),
      ].map((file) => Number(/^(\d+)-/.exec(file)?.[1] ?? 0));
      const number = String(Math.max(0, ...numbers) + 1).padStart(4, "0");
      const slug =
        fields.title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "decision";
      path = `${DECISIONS}/${number}-${slug}.md`;
      const files = [{ path, content: decisionFile(number, post, deciders, fields) }];
      const agents = await github.read(token, repo, base.sha, "AGENTS.md");
      if (!agents?.includes(DECISIONS)) {
        const before = agents ? `${agents.replace(/\n*$/, "")}\n\n` : "";
        files.push({ path: "AGENTS.md", content: `${before}${AGENTS_LINE}\n` });
      }
      branch = `omagari/decision-${number}-${randomBytes(3).toString("hex")}`;
      const subject = `docs(decisions): ${fields.title}`;
      await github.commit(token, repo, { branch, base: base.sha, message: subject, files });
      opened = await github.openPull(token, repo, {
        head: branch,
        base: base.name,
        title: subject,
        body: [
          `Omagari 포스트에서 정리한 결정이다. 이 PR이 머지되면 결정이 수락된다.`,
          "",
          `- 결정 파일: \`${path}\``,
          `- 정리한 사람: ${name} (@${login})`,
          `- 출처: ${options.publicUrl ?? url}/#${post}`,
          `- 이의 창: ${windowName(window)}`,
        ].join("\n"),
      });
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `${login}의 GitHub 토큰으로 결정 PR을 열지 못했다: ${(error as Error).message}`,
      });
    }
    const at = Date.now();
    const id = Number(
      db
        .prepare(
          `INSERT INTO decisions (post, login, title, path, pull, url, span, at, branch, deciders, closes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          post,
          login,
          fields.title,
          path,
          opened.number,
          opened.url,
          typeof window === "string" ? window : JSON.stringify(window),
          at,
          branch,
          JSON.stringify(deciders),
          at + windowHours(window) * hourMs,
        ).lastInsertRowid,
    );
    announce(id, "opened");
    await tryMerge(id); // "바로"면 곧이어 머지한다
    return { decision: decisionOf(id) };
  });

  /** 열린 결정 하나의 날 줄. 없으면 `not_found`, 머지되거나 닫혔으면 `conflict`다. */
  const openDecision = (id: number) => {
    const row = db
      .prepare("SELECT login, post, path, branch, deciders, state FROM decisions WHERE id = ?")
      .get(id) as
      | {
          login: string;
          post: string;
          path: string;
          branch: string | null;
          deciders: string;
          state: string;
        }
      | undefined;
    if (!row) throw new ContractFailure({ code: "not_found", message: `없는 결정이다: ${id}` });
    if (row.state !== "proposed")
      throw new ContractFailure({ code: "conflict", message: `이미 끝난 결정이다: ${id}` });
    return row;
  };

  mount(app, api.respondToDecision, async ({ id, response }, c) => {
    const login = c.get("login") as string;
    visit(login);
    const row = openDecision(id);
    if (response === "agree") {
      if (!(JSON.parse(row.deciders) as string[]).includes(login))
        throw new ContractFailure({
          code: "forbidden",
          message: `${login}는 이 결정의 결정자가 아니라 동의할 수 없다. 이의만 낸다`,
        });
      if (login !== row.login) {
        const { changes } = db
          .prepare("INSERT OR IGNORE INTO agreements (decision, login) VALUES (?, ?)")
          .run(id, login);
        if (changes > 0) announce(id, "agreed", { by: login });
      }
    } else if (response === "object") {
      const { changes } = db
        .prepare(
          "INSERT OR IGNORE INTO objections (decision, login, via, at) VALUES (?, ?, 'post', ?)",
        )
        .run(id, login, Date.now());
      if (changes > 0) announce(id, "objected", { by: login });
    } else {
      const { changes } = db
        .prepare("DELETE FROM objections WHERE decision = ? AND login = ? AND via = 'post'")
        .run(id, login);
      if (changes === 0)
        throw new ContractFailure({ code: "not_found", message: `${login}가 낸 이의가 없다` });
      reopenIfClear(id);
      announce(id, "withdrawn", { by: login });
    }
    await tryMerge(id);
    return { decision: decisionOf(id) };
  });

  /** 정리한 사람만 고치고 버린다. */
  const organizerOnly = (row: { login: string }, login: string, what: string) => {
    if (row.login !== login)
      throw new ContractFailure({
        code: "forbidden",
        message: `결정은 정리한 사람(${row.login})만 ${what}`,
      });
  };

  mount(app, api.reviseDecision, async ({ id, ...fields }, c) => {
    const login = c.get("login") as string;
    visit(login);
    const row = openDecision(id);
    organizerOnly(row, login, "고친다");
    const number = basename(row.path).slice(0, 4);
    try {
      if (!row.branch) throw new Error("결정 PR의 브랜치를 모른다");
      await github.addCommit(callerToken(c), repo, {
        branch: row.branch,
        message: `docs(decisions): ${fields.title}`,
        files: [
          {
            path: row.path,
            content: decisionFile(number, row.post, JSON.parse(row.deciders), fields),
          },
        ],
      });
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `${login}의 GitHub 토큰으로 결정을 고쳐 올리지 못했다: ${(error as Error).message}`,
      });
    }
    // 고친 결정에는 다시 동의를 받고, 창도 처음부터 다시 연다(ADR-0031).
    db.prepare("UPDATE decisions SET title = ? WHERE id = ?").run(fields.title, id);
    db.prepare("DELETE FROM agreements WHERE decision = ?").run(id);
    restartWindow(id);
    announce(id, "revised", { by: login });
    await tryMerge(id);
    return { decision: decisionOf(id) };
  });

  mount(app, api.discardDecision, async ({ id }, c) => {
    const login = c.get("login") as string;
    visit(login);
    const row = openDecision(id);
    organizerOnly(row, login, "버린다");
    const { pull } = db.prepare("SELECT pull FROM decisions WHERE id = ?").get(id) as {
      pull: number;
    };
    try {
      await github.closePull(callerToken(c), repo, pull);
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `${login}의 GitHub 토큰으로 결정 PR을 닫지 못했다: ${(error as Error).message}`,
      });
    }
    settleDecision(id, "closed", login);
    return { decision: decisionOf(id) };
  });

  mount(app, api.decisions, () => ({
    decisions: (
      db
        .prepare(
          `SELECT ${DECISION} AS decision FROM decisions d LEFT JOIN people dp ON dp.login = d.login ORDER BY d.id`,
        )
        .all() as { decision: string }[]
    ).map((row) => decisionView(row.decision)),
  }));

  mount(app, api.posts, () => ({
    posts: postsWhere("").map(({ post, message }) => ({ ...post, message })),
  }));

  const mustExist = (channel: string) => {
    const found = db.prepare("SELECT kind FROM channels WHERE id = ?").get(channel) as
      | { kind: ChannelKind }
      | undefined;
    if (!found) {
      throw new ContractFailure({ code: "not_found", message: `없는 채널이다: ${channel}` });
    }
    return found.kind;
  };
  /** 글, DM, `@호출`은 포럼에 쓰지 못하고 포스트 안에서만 쓴다(ADR-0027). */
  const mustWrite = (channel: string) => {
    if (mustExist(channel) === "forum") {
      throw new ContractFailure({
        code: "invalid_request",
        message: "포럼에는 쓸 수 없다. 포스트 안에서 쓴다",
      });
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
    mustWrite(channel);
    visit(c.get("login") as string);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO messages (channel, login, text, at) VALUES (?, ?, ?, ?)")
      .run(channel, c.get("login") as string, text, Date.now());
    const message = messageView(
      db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow,
    );
    broadcast(encode(serverToWeb, "message", message));
    posted(channel);
    syncSoon(channel);
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
          // 끊긴 사이에 고친 알림과, 끊긴 사이에 포스트의 글 수가 바뀐 알림도 다시 보낸다.
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
          const { session, repos, executors, choices, mergeCheck } = message.payload;
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
          runners.set(socket, { login, hash: hash(session), executors, choices, mergeCheck });
          db.prepare("DELETE FROM offline WHERE login = ?").run(login);
          db.prepare("UPDATE claims SET stale = NULL WHERE login = ?").run(login);
          // ponytail: 멤버 하나에 러너 하나로 본다. 기기 둘에서 실행기가 다른 러너를 켜면 나중에 붙은 쪽의 것만 남는다.
          db.prepare("DELETE FROM agents WHERE login = ?").run(login);
          const known = db.prepare("INSERT OR IGNORE INTO agents (login, executor) VALUES (?, ?)");
          for (const executor of executors) known.run(login, executor);
          socket.send(encode(serverToRunner, "welcome", { login, repo }, message.id));
          shareSituation(socket);
          shareInbox(socket);
          dispatchQuestions(login); // 오프라인 사이에 남겨 둔 질문
          return;
        }
        const runner = runners.get(socket);
        if (!runner) {
          // hello를 마치지 않은 연결의 메시지는 받지 않는다.
          refuse(socket, { code: "unauthorized", message: "hello를 먼저 보내라" }, message.id);
        } else if (message.kind === "checkCommand") {
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('check', ?)").run(
            JSON.stringify(message.payload),
          );
        } else if (message.kind === "observation") {
          replaceWorks(runner.login, message.payload.works);
          shareSituation();
        } else if (message.kind === "conflicts") {
          reports.set(socket, message.payload.pairs);
          reconcile();
        } else if (message.kind === "merged") {
          attachRun(runner.login, message.payload);
        } else if (message.kind === "delivered") {
          const drop = db.prepare("DELETE FROM inbox WHERE id = ? AND login = ?");
          for (const id of message.payload.ids) drop.run(id, runner.login);
          shareInbox();
        } else if (message.kind === "claim") {
          const { branch, path, unit, symbol, lines, overlaps, plan } = message.payload;
          const login = runner.login;
          const now = Date.now();
          const linesJson = lines ? JSON.stringify(lines) : null;
          db.exec("BEGIN");
          // 같은 작업의 같은 곳은 하나다. 다시 걸면 새로 건 것으로 바꾼다.
          db.prepare(
            `DELETE FROM claims WHERE login = ? AND branch = ? AND path = ? AND unit = ?
             AND symbol IS ? AND lines IS ?`,
          ).run(login, branch, path, unit, symbol ?? null, linesJson);
          // 같은 작업의 같은 심볼에 걸린 옛 계획은 새 계획이 대체한다. 그 계획의 알림은 쓰는 쪽 러너가 다시 계산해 고쳐진다.
          if (plan)
            db.prepare(
              "UPDATE claims SET plan = NULL WHERE login = ? AND branch = ? AND plan ->> '$.symbol' = ?",
            ).run(login, branch, plan.symbol);
          const { lastInsertRowid } = db
            .prepare(
              "INSERT INTO claims (login, branch, path, unit, symbol, lines, at, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              login,
              branch,
              path,
              unit,
              symbol ?? null,
              linesJson,
              now,
              plan ? JSON.stringify(plan) : null,
            );
          const claim = claimView(
            db.prepare("SELECT * FROM claims WHERE id = ?").get(lastInsertRowid) as ClaimRow,
          );
          db.prepare("INSERT INTO feed (kind, claim, at) VALUES ('claim', ?, ?)").run(
            JSON.stringify(claim),
            now,
          );
          // 겹침은 양쪽 작업의 편지함에 넣는다. 각자 자기 선점이 `mine`이다.
          const put = db.prepare("INSERT INTO inbox (login, branch, news, at) VALUES (?, ?, ?, ?)");
          for (const id of overlaps) {
            const row = db
              .prepare("SELECT * FROM claims WHERE id = ? AND login != ?")
              .get(id, login) as ClaimRow | undefined;
            if (!row) continue;
            const theirs = claimView(row);
            put.run(login, branch, JSON.stringify({ kind: "overlap", mine: claim, theirs }), now);
            put.run(
              theirs.login,
              theirs.branch,
              JSON.stringify({ kind: "overlap", mine: theirs, theirs: claim }),
              now,
            );
          }
          db.exec("COMMIT");
          socket.send(encode(serverToRunner, "claimed", { claim }, message.id));
          shareSituation();
          shareInbox();
        } else if (message.kind === "question") {
          const { branch, to, executor, text } = message.payload;
          const reply = (
            payload: Parameters<typeof encode<typeof serverToRunner, "questioned">>[2],
          ) => socket.send(encode(serverToRunner, "questioned", payload, message.id));
          const fail = (code: ContractError["code"], text: string) =>
            socket.send(encode(serverToRunner, "error", { code, message: text }, message.id));
          if (to === runner.login)
            return fail("invalid_request", "자기 에이전트에게는 묻지 않는다");
          if (!db.prepare("SELECT 1 FROM sessions WHERE login = ?").get(to))
            return fail("not_found", `워크스페이스의 멤버가 아니다: ${to}`);
          if (
            executor &&
            !db.prepare("SELECT 1 FROM agents WHERE login = ? AND executor = ?").get(to, executor)
          ) {
            return fail("not_found", `${to}에게 ${EXECUTOR_NAMES[executor]} 에이전트가 없다`);
          }
          if (db.prepare("SELECT 1 FROM ask_off WHERE login = ?").get(to))
            return reply({ state: "refused" });
          const { lastInsertRowid } = db
            .prepare(
              "INSERT INTO questions (login, branch, target, executor, text, at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(runner.login, branch, to, executor ?? null, text, Date.now());
          const id = Number(lastInsertRowid);
          dispatchQuestions(to);
          const sending = [...questionsSent.values()].find((q) => q.id === id);
          const row = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as QuestionRow;
          reply({
            state: sending ? "sent" : "offline",
            question: questionView({ ...row, executor: sending?.executor ?? row.executor }),
          });
        } else if (message.kind === "release") {
          const { branch, path, symbol, lines } = message.payload;
          const where = ["login = ?", "branch = ?"];
          const params: string[] = [runner.login, branch];
          for (const [column, value] of [
            ["path", path],
            ["symbol", symbol],
            ["lines", lines && JSON.stringify(lines)],
          ] as const) {
            if (value === undefined) continue;
            where.push(`${column} = ?`);
            params.push(value);
          }
          const claims = releaseClaims(where.join(" AND "), ...params);
          socket.send(encode(serverToRunner, "released", { claims }, message.id));
          if (claims.length > 0) {
            cancelPlans(claims);
            shareSituation();
          }
        } else {
          // 문답이나 초안의 답, 실패. 그것을 보낸 연결에서 온 것만 받는다.
          const re = message.re ?? "";
          const question = questionsSent.get(re);
          if (question?.socket === socket) {
            questionsSent.delete(re);
            settleQuestion(
              question.id,
              message.kind === "answer"
                ? { state: "answered", ...message.payload }
                : message.kind === "error"
                  ? { state: "failed", error: message.payload }
                  : {
                      state: "failed",
                      error: { code: "invalid_message", message: "질문에 답 대신 초안이 왔다" },
                    },
              question.executor,
            );
            shareMembers();
          } else if (drafting.get(re)?.socket === socket) {
            if (message.kind === "drafted")
              settleDraft(re, { state: "drafted", ...message.payload });
            else if (message.kind === "error")
              settleDraft(re, { state: "failed", error: message.payload });
          } else if (asks.get(re)?.socket !== socket) {
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
        sentInbox.delete(socket);
        if (reports.delete(socket) && !stopped) reconcile();
        // 그 멤버의 러너가 다 떨어졌으면 오프라인이다. 마지막 관측과 상태 한 줄은 이 시각 기준으로 남는다.
        if (runner && !stopped && ![...runners.values()].some((r) => r.login === runner.login)) {
          db.prepare("INSERT OR REPLACE INTO offline (login, since) VALUES (?, ?)").run(
            runner.login,
            Date.now(),
          );
          shareSituation();
        }
        // 떨어진 러너에 보낸 질문은 남겨 두고, 그 멤버의 러너가 다시 붙으면 다시 보낸다.
        for (const [id, question] of questionsSent)
          if (question.socket === socket) questionsSent.delete(id);
        // 떨어진 러너의 답은 오지 않는다. 기다리던 초안과 문답을 실패로 둔다.
        for (const [id, { socket: to, login }] of drafting) {
          if (to !== socket) continue;
          settleDraft(id, {
            state: "failed",
            error: {
              code: "runner_offline",
              message: `${login}의 러너가 초안을 쓰기 전에 떨어졌다`,
            },
          });
        }
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

  /** 멤버의 GitHub 토큰(마지막에 들어온 세션의 것). 세션이 없으면 없다. */
  const tokenOf = (login: string) =>
    (
      db
        .prepare("SELECT github_token FROM sessions WHERE login = ? ORDER BY rowid DESC")
        .get(login) as { github_token: string } | undefined
    )?.github_token;

  /** 포스트의 이슈 제목: 부딪힌 파일(또는 심볼)과 종류. 사람은 넣지 않는다(DESIGN.md "부딪힘 포럼"). */
  const issueTitle = (alert: Alert) => {
    const first =
      alert.kind === "direct"
        ? alert.files[0] && basename(alert.files[0].path)
        : alert.symbols[0]?.name;
    return `${first ?? alert.works[0].branch} ${ALERT_LABELS[alert.kind]}`;
  };
  /** 포스트의 이슈 본문: 알림의 두 작업과 곳, 그리고 포스트 링크. */
  const issueBody = (alert: Alert, link: string) => {
    const places =
      alert.kind === "direct"
        ? alert.files.map((file) => `\`${file.path}\``)
        : alert.symbols.map((symbol) => `\`${symbol.name}\``);
    const [a, b] = alert.works;
    return [
      "Omagari가 부딪힘 포럼에 올린 포스트예요. 포스트의 글은 이 이슈의 댓글로, 이 이슈의 댓글은 포스트의 글로 맞춰져요.",
      "",
      `- 종류: ${ALERT_LABELS[alert.kind]}`,
      `- 작업: ${a.name} (\`${a.branch}\`) ↔ ${b.name} (\`${b.branch}\`)`,
      `- 곳: ${places.join(", ")}${alert.more > 0 ? ` 외 ${alert.more}곳` : ""}`,
      "",
      `포스트: ${link}`,
    ].join("\n");
  };
  /**
   * 포스트의 글 하나를 이슈 댓글로. 사람의 글은 그대로, 공개된 문답은 올린 사람의 글 뒤에 AI가 쓴 답이라는 표시(DESIGN.md "AI가 쓴 글")와
   * 질문, 답을 붙인다. 아직 답이 오지 않은 문답이면 없다(답이 오면 올린다). 답하지 못한 문답은 올리지 않는다.
   */
  const commentBody = (message: ChannelMessage) => {
    if (message.kind === "text") return message.text;
    if (message.kind !== "qa" || message.qa.answer.state !== "answered") return undefined;
    const { answer, executor, question } = message.qa;
    const model = [answer.model, answer.effort && `effort ${answer.effort}`]
      .filter(Boolean)
      .join(" · ");
    return [
      ...(message.text ? [message.text, ""] : []),
      "> [!NOTE]",
      `> 🤖 **AI가 쓴 답** · ${message.name}의 ${EXECUTOR_NAMES[executor]}${model ? ` (${model})` : ""}`,
      ...question.split("\n").map((line, i) => `> ${i === 0 ? "물음: " : ""}${line}`),
      "",
      answer.text,
    ].join("\n");
  };

  /**
   * 포스트와 GitHub 이슈를 맞춘다(ADR-0032). 포스트마다:
   * 1. 이슈가 없고 알림이 풀리지 않았으면 연다. 알림의 두 사람 가운데 세션이 있는 사람의 토큰으로, 없으면 아무 멤버의 것으로 연다.
   * 2. 아직 올리지 않은 글을 쓴 사람의 토큰으로 댓글로 올린다. 그 사람의 세션이 없으면 들어올 때까지 둔다.
   * 3. 이슈의 제목, 라벨, 열림을 읽고, 모르는 댓글을 포스트의 글로 들인다.
   * 4. 알림이 풀렸고 이슈가 열려 있으면 한 번 닫는다. 사람이 다시 열면 두고, 알림이 풀렸고 이슈도 닫힌 포스트는 더 따라가지 않는다.
   * GitHub이 받지 않으면 그 포스트는 다음 주기에 다시 한다.
   */
  // ponytail: 주기마다 따라가는 이슈 하나에 GitHub 요청 둘이다. 포스트가 많아져 요청 한도가 걱정되면 GitHub 앱의 웹훅으로 바꾼다.
  const syncIssues = async (only?: Set<string>) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.issue, c.issue_open, c.issue_closed, m.id AS message, m.alert, m.channel AS forum
         FROM channels c JOIN messages m ON m.id = c.alert ORDER BY m.id`,
      )
      .all() as {
      id: string;
      issue: number | null;
      issue_open: number | null;
      issue_closed: number | null;
      message: number;
      alert: number;
      forum: string;
    }[];
    for (const row of rows) {
      if (only && !only.has(row.id)) continue;
      const view = messageView(
        db.prepare(`${MESSAGES} WHERE m.id = ?`).get(row.message) as MessageRow,
      );
      if (view.kind !== "alert") continue;
      const { alert } = view;
      const logins = alert.works.map((work) => work.login);
      // 알림의 두 사람의 토큰부터, 그다음 다른 멤버들의 것. GitHub이 받지 않으면(토큰 무효) 다음 것으로 한다.
      const tokens = [
        ...new Set([
          ...logins.map(tokenOf),
          ...(
            db.prepare("SELECT github_token FROM sessions ORDER BY rowid DESC").all() as {
              github_token: string;
            }[]
          ).map((session) => session.github_token),
        ]),
      ].filter((token): token is string => token !== undefined);
      /** 토큰을 차례로 넣어 GitHub이 처음 답한 것. 모두 받지 않으면 없다. 마지막 까닭을 남긴다. */
      const answered = async <T>(ask: (token: string) => Promise<T | undefined>) => {
        for (const token of tokens) {
          const result = await ask(token).catch((error: Error) => {
            console.error("포스트의 이슈를 GitHub에서 다루지 못했다:", error.message);
            return undefined;
          });
          if (stopped) return undefined;
          if (result !== undefined) return { token, result };
        }
        return undefined;
      };
      if (tokens.length === 0) return;
      const resolved = alert.resolved !== null;
      let number = row.issue;
      if (number === null) {
        if (resolved) continue; // 풀린 뒤에는 열지 않는다
        const link = `${options.publicUrl ?? url}/#${row.forum}/${row.message}`;
        const title = issueTitle(alert);
        const labels = [ALERT_LABELS[alert.kind]];
        const opened = (
          await answered((token) =>
            github.openIssue(token, repo, { title, body: issueBody(alert, link), labels }),
          )
        )?.result;
        if (stopped) return;
        if (!opened) continue;
        number = opened.number;
        db.prepare(
          "UPDATE channels SET issue = ?, issue_url = ?, issue_title = ?, issue_labels = ?, issue_open = 1 WHERE id = ?",
        ).run(number, opened.url, title, JSON.stringify(labels), row.id);
        shareAlert(row.alert);
      } else if (resolved && row.issue_open === 0) continue;

      // 2. 포스트의 글을 댓글로. 결정 PR 줄과 들어온 댓글은 올리지 않는다.
      const unsent = db
        .prepare(
          `${MESSAGES} WHERE m.channel = ? AND m.comment IS NULL AND m.decision IS NULL ORDER BY m.id`,
        )
        .all(row.id) as MessageRow[];
      for (const message of unsent.map(messageView)) {
        const body = commentBody(message);
        const writer = "login" in message ? tokenOf(message.login) : undefined;
        if (body === undefined || !writer) continue;
        const made = await github.comment(writer, repo, number, body).catch((e: Error) => e);
        if (stopped) return;
        if (made instanceof Error) {
          console.error("포스트의 글을 이슈 댓글로 올리지 못했다:", made.message);
          continue;
        }
        db.prepare("UPDATE messages SET comment = ? WHERE id = ?").run(made.id, message.id);
      }

      // 3. 이슈를 읽고 모르는 댓글을 들인다.
      let changed = false;
      const read = await answered((token) => github.issue(token, repo, number));
      if (stopped) return;
      const issue = read?.result;
      if (issue) {
        const labels = JSON.stringify(issue.labels);
        const open = issue.open ? 1 : 0;
        const known = db
          .prepare("SELECT issue_title, issue_labels, issue_open FROM channels WHERE id = ?")
          .get(row.id) as { issue_title: string; issue_labels: string; issue_open: number };
        if (
          known.issue_title !== issue.title ||
          known.issue_labels !== labels ||
          known.issue_open !== open
        ) {
          db.prepare(
            "UPDATE channels SET issue_title = ?, issue_labels = ?, issue_open = ? WHERE id = ?",
          ).run(issue.title, labels, open, row.id);
          changed = true;
        }
      }
      const comments = read && (await github.comments(read.token, repo, number));
      if (stopped) return;
      for (const comment of comments ?? []) {
        if (db.prepare("SELECT 1 FROM messages WHERE comment = ?").get(comment.id)) continue;
        const { lastInsertRowid } = db
          .prepare(
            "INSERT INTO messages (channel, login, text, at, comment, github) VALUES (?, ?, ?, ?, ?, 1)",
          )
          .run(row.id, comment.login, comment.body, Date.now(), comment.id);
        broadcast(
          encode(
            serverToWeb,
            "message",
            messageView(
              db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow,
            ),
          ),
        );
        changed = true;
      }

      // 4. 알림이 풀렸으면 이슈를 한 번 닫는다.
      if (read && issue?.open && resolved && row.issue_closed === null) {
        const closed = await github.closeIssue(read.token, repo, number).catch((e: Error) => e);
        if (stopped) return;
        if (closed instanceof Error) console.error("포스트의 이슈를 닫지 못했다:", closed.message);
        else {
          db.prepare("UPDATE channels SET issue_open = 0, issue_closed = ? WHERE id = ?").run(
            Date.now(),
            row.id,
          );
          changed = true;
        }
      }
      if (changed) shareAlert(row.alert);
    }
  };
  /**
   * 이슈 맞추기를 돌린다. `post`를 주면 그 포스트만, 주지 않으면(주기마다) 모두다. 도는 중이면 끝난 뒤 모아 둔 것을 한 번 더 돈다.
   * 포스트에 글이 서거나 답이 오거나 알림이 생기면 그 포스트로 부른다.
   */
  let syncing = false;
  let waiting: Set<string> | "all" | undefined;
  const syncSoon = (post?: string) => {
    if (post && !db.prepare("SELECT 1 FROM channels WHERE id = ? AND alert IS NOT NULL").get(post))
      return;
    waiting = !post || waiting === "all" ? "all" : new Set([...(waiting ?? []), post]);
    if (syncing) return;
    syncing = true;
    void (async () => {
      while (waiting && !stopped) {
        const only = waiting;
        waiting = undefined;
        await syncIssues(only === "all" ? undefined : only).catch((error) =>
          console.error("이슈를 맞추지 못했다:", error),
        );
      }
      syncing = false;
    })();
  };

  // 오프라인 7일이 지난 멤버의 관측과 상태 한 줄을 지우고, 작업마다의 초안 PR 제목과 머지 여부를 GitHub에서 읽는다.
  // 머지되면 그 브랜치에서 머지 전에 쓴 줄을 지운다. 머지 뒤에 같은 브랜치에 새로 쓴 줄은 남는다.
  // ponytail: 주기마다 브랜치 하나에 GitHub 요청 하나다. 작업이 많아져 요청 한도가 걱정되면 GitHub 앱의 웹훅으로 바꾼다.
  let following = false;
  const follow = setInterval(async () => {
    if (following) return;
    following = true;
    syncSoon(); // 포스트의 이슈를 맞춘다(ADR-0032). 따로 돈다.
    try {
      const forgotten = "SELECT login FROM offline WHERE since < ?";
      const cutoff = Date.now() - (options.forgetMs ?? FORGET_MS);
      const now = Date.now();
      db.exec("BEGIN");
      db.prepare(`DELETE FROM works WHERE login IN (${forgotten})`).run(cutoff);
      db.prepare(`DELETE FROM lines WHERE login IN (${forgotten})`).run(cutoff);
      // 선점은 지우지 않고 "오래됨"으로 둔다. 오래됨이 된 지 `forgetMs`가 더 지나면 지운다(Room의 오래됨 표시와 7일 만료).
      db.prepare(`UPDATE claims SET stale = ? WHERE stale IS NULL AND login IN (${forgotten})`).run(
        now,
        cutoff,
      );
      db.prepare("DELETE FROM offline WHERE since < ?").run(cutoff);
      db.prepare("DELETE FROM claims WHERE stale < ?").run(now - (options.forgetMs ?? FORGET_MS));
      db.prepare("DELETE FROM inbox WHERE at <= ?").run(now - inboxMs);
      db.prepare("DELETE FROM feed WHERE at <= ?").run(now - inboxMs);
      db.prepare("DELETE FROM questions WHERE at <= ?").run(now - inboxMs); // 답이 없으면 만료
      db.exec("COMMIT");
      shareInbox(); // 만료된 소식이 빠진다

      const branches = db
        .prepare(
          `SELECT w.branch, MAX(s.github_token) AS token
           FROM (SELECT login, branch FROM works UNION SELECT login, branch FROM claims) w
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
        if (merged > 0) {
          db.prepare("DELETE FROM lines WHERE branch = ? AND at < ?").run(branch, merged);
          // 머지된 브랜치의 선점은 저절로 풀린다. 머지 뒤에 같은 브랜치에 새로 건 것은 남는다.
          releaseClaims("branch = ? AND at < ?", branch, merged);
        }
      }
      drafts = next;
      shareSituation();

      // 열린 결정 PR이 머지되거나 닫혔는지 읽는다. 정리한 멤버의 토큰으로, 그 멤버의 세션이 없으면 다른 멤버의 것으로 읽는다.
      const open = db
        .prepare(
          `SELECT d.id, d.pull, COALESCE(
             (SELECT github_token FROM sessions WHERE login = d.login),
             (SELECT github_token FROM sessions)) AS token
           FROM decisions d WHERE d.state = 'proposed'`,
        )
        .all() as { id: number; pull: number; token: string | null }[];
      // 열린 것은 GitHub의 변경 요청 리뷰를 이의로 맞추고(ADR-0025), 창이 닫혔으면 머지한다.
      for (const { id, pull: number, token } of open) {
        if (!token) continue;
        const pull = await github.pull(token, repo, number);
        if (stopped) return;
        if (pull && !pull.open) {
          settleDecision(id, pull.mergedAt ? "accepted" : "closed");
          continue;
        }
        const requested = await github.changesRequested(token, repo, number);
        if (stopped) return;
        if (requested) {
          const known = (
            db
              .prepare("SELECT login FROM objections WHERE decision = ? AND via = 'github'")
              .all(id) as { login: string }[]
          ).map((row) => row.login);
          for (const login of requested.filter((l) => !known.includes(l))) {
            db.prepare(
              "INSERT INTO objections (decision, login, via, at) VALUES (?, ?, 'github', ?)",
            ).run(id, login, Date.now());
            announce(id, "objected", { by: login });
          }
          const withdrawn = known.filter((l) => !requested.includes(l));
          for (const login of withdrawn)
            db.prepare(
              "DELETE FROM objections WHERE decision = ? AND login = ? AND via = 'github'",
            ).run(id, login);
          if (withdrawn.length > 0) reopenIfClear(id);
          for (const login of withdrawn) announce(id, "withdrawn", { by: login });
        }
        await tryMerge(id);
      }
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
  url = `http://${hostname}:${(server.address() as AddressInfo).port}`;

  return {
    url,
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
