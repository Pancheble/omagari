import { createHash, randomBytes, randomInt } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { relative } from "node:path";
import { basename } from "node:path/posix";
import { DatabaseSync } from "node:sqlite";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
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
  type Channel,
  type ChannelKind,
  type ChannelMessage,
  type Choices,
  type ChosenPresence,
  type Claim,
  CONFIRMED_LABEL,
  CONTRACT_VERSION,
  type ConflictPair,
  type ContractError,
  ContractFailure,
  DEBATE_ROUNDS,
  DEFAULT_LABEL_COLORS,
  type Debate,
  type DebateConclusion,
  type DebateRequest,
  type DebateSeat,
  type Decision,
  type DecisionWindow,
  DISCUSS_LABELS,
  type Draft,
  decode,
  EVIDENCE_LABELS,
  EVIDENCE_MARKS,
  EXECUTOR_NAMES,
  type ExecutorId,
  encode,
  encodeVersionMismatch,
  FEED_PAGE,
  type ForumFilter,
  HISTORY_PAGE,
  IMPORTANCE_LABELS,
  Importance,
  INBOX_MS,
  type InboxItem,
  type Label,
  LIVE_SOCKET,
  MAX_FRAME_BYTES,
  MERGE_RUN_LABELS,
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
  REPO_HEADER,
  type ReplyOf,
  RUNNER_SOCKET,
  RunVerdict,
  runnerToServer,
  type ShareLevel,
  type Stance,
  type StatusLine,
  serverToRunner,
  serverToWeb,
  shows,
  type Visibility,
  WORKSPACE_HEADER,
  type Work,
  type WorkRef,
  type WorkView,
  webToServer,
} from "@omagari/contract";
import { checkoutVersion } from "@omagari/contract/version";
import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import { type WebSocket, WebSocketServer } from "ws";
import type { Giphy } from "./giphy.ts";
import type { GitHub, RepoLabel } from "./github.ts";
import { createApp, type Env, mount } from "./http.ts";
import { labelsFor } from "./labeler.ts";

export { type Giphy, realGiphy } from "./giphy.ts";
export { type Account, type GitHub, type Pull, type RepoLabel, realGitHub } from "./github.ts";

/** push 권한을 다시 확인하는 주기. Room의 10분에서 시작한다(ADR-0011). */
const RECHECK_MS = 10 * 60_000;
/** 러너 연결의 생사를 묻는 주기. 답이 없으면 다음 주기에 끊는다. */
const HEARTBEAT_MS = 30_000;
/** 끝나지 않은 기기 인증을 들고 있는 수의 상한. 로그인 없이 부르는 경로라 GitHub에 무한히 묻지 않는다. */
const MAX_PENDING_LOGINS = 100;
/** 한 주소가 들고 있을 수 있는 끝나지 않은 기기 인증의 수. 한 주소가 상한을 다 채워 남의 로그인을 막지 못하게 한다. */
const MAX_PENDING_PER_CLIENT = 5;
/** 이만큼 묻지 않은 기기 인증은 버려진 것으로 보고 지운다. CLI와 웹은 몇 초마다 묻는다. */
const ABANDONED_LOGIN_MS = 60_000;
/** hello를 마치기까지의 시간. 넘으면 연결을 끊는다. */
const HELLO_MS = 10_000;
/** hello를 마치기 전에 받는 프레임 하나의 상한. hello는 작다. */
const MAX_HELLO_BYTES = 64 * 1024;
/** hello를 마치지 않은 연결 수의 상한. */
const MAX_UNGREETED = 200;
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

/** 레포 `owner/name`의 워크스페이스: 계정 이름의 소문자(ADR-0043). */
const ownerOf = (repo: string) => (repo.split("/")[0] ?? "").toLowerCase();
/** `ownerOf`를 SQL로. `r`은 레포를 내는 SQL이다. */
const ownerSql = (r: string) => `lower(substr(${r}, 1, instr(${r}, '/') - 1))`;

/** 알림 줄이 서는 채널(ADR-0039). 포럼은 거른 보기라 알림 줄을 담지 않는다. 채널 목록에 없고 아무도 쓰지 못한다. */
const ALERTS = "alerts";

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
 * 서브쿼리가 돌려준 JSON은 `json()`으로 감싼다. 안 그러면 SQLite 판에 따라 `json_object` 안에서 배열이 문자열로 들어간다(Node 24.22.3, #258).
 * 결정자(`d.deciders`, 로그인의 JSON 배열) 가운데 정리한 사람은 늘 동의한 것이다(ADR-0029).
 */
const DECISION = `json_object('id', d.id, 'post', d.post, 'login', d.login, 'name', COALESCE(dp.name, d.login),
  'title', d.title, 'path', d.path, 'pull', json_object('number', d.pull, 'url', d.url),
  'window', CASE WHEN d.span LIKE '{%' THEN json(d.span) ELSE d.span END, 'state', d.state,
  'closes', d.closes, 'reopened', d.reopened, 'early', d.early, 'stuck', json(d.stuck),
  'deciders', json((SELECT json_group_array(json_object('login', j.value, 'name', ${nameSql("j.value")},
    'agreed', j.value = d.login OR EXISTS (SELECT 1 FROM agreements g WHERE g.decision = d.id AND g.login = j.value)))
    FROM json_each(d.deciders) j)),
  'absent', json(d.absent),
  'objections', json((SELECT json_group_array(json_object('login', o.login, 'name', ${nameSql("o.login")}, 'via', o.via, 'at', o.at))
    FROM (SELECT * FROM objections WHERE decision = d.id ORDER BY at, rowid) o)),
  'at', d.at)`;
const iso = (ms: number) => new Date(ms).toISOString();
const decisionView = (json: string): Decision => {
  const { closes, reopened, early, stuck, deciders, absent, objections, at, ...decision } =
    JSON.parse(json);
  const awaiting = (deciders as { login: string; name: string; agreed: number }[])
    .filter((d) => absent.includes(d.login) && d.agreed !== 1)
    .map(({ login, name }) => ({ login, name }));
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
    ...(absent.length > 0 && { awaiting }),
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

/** 포럼 전부의 id와 거르기(JSON 배열), 이름 순. */
const FORUMS = `(SELECT json_group_array(json_object('id', f.id, 'filter', json(f.filter)) ORDER BY f.name)
  FROM channels f WHERE f.filter IS NOT NULL AND f.workspace = c.workspace)`;
/** 포스트(`c`)의 중요도: 라벨 가운데 하나라도 논의면 논의다(ADR-0039). 모르는 라벨은 참고다. */
const POST_IMPORTANCE = `CASE WHEN EXISTS (SELECT 1 FROM json_each(c.labels) j
  JOIN labels l ON l.repo = c.repo AND l.name = j.value AND l.importance = 'discuss') THEN 'discuss' ELSE 'reference' END`;

const MESSAGES = `SELECT m.id, m.channel, m.login, m.text, m.note, m.at, m.github, p.name,
  c.issue, c.issue_url, c.issue_title, c.issue_labels, c.issue_open, c.labels, ${POST_IMPORTANCE} AS importance,
  q.id AS qa, q.executor, q.question, q.at AS asked, q.answer, q.visibility,
  m.alert, a.kind, a.works, a.files, a.resolved, a.run, a.confirmed,
  c.id AS post, CASE WHEN c.id IS NULL THEN 0 ELSE ${POST_COUNT} END AS count, ${POST_LAST} AS last,
  CASE WHEN c.id IS NULL THEN NULL ELSE ${FORUMS} END AS forums,
  CASE WHEN d.id IS NULL THEN NULL ELSE ${DECISION} END AS decision,
  COALESCE(a.repo, (SELECT ch.repo FROM channels ch WHERE ch.id = m.channel)) AS repo,
  COALESCE(${ownerSql("a.repo")}, (SELECT ch.workspace FROM channels ch WHERE ch.id = m.channel)) AS workspace FROM messages m
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
  labels: string | null;
  importance: Importance;
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
  forums: string | null;
  /** 레포의 것(알림 줄과 포스트의 글)이면 그 레포. 채팅 채널의 것이면 NULL이다. */
  repo: string | null;
  /** 이 줄이 선 워크스페이스. 알림 줄의 자리(`ALERTS`)의 것도 그 알림의 레포가 정한다. */
  workspace: string | null;
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
  const labels: string[] = JSON.parse(row.labels ?? "[]");
  return {
    channel: row.post as string,
    repo: row.repo as string,
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
    labels,
    importance: row.importance,
    forums: (JSON.parse(row.forums ?? "[]") as { id: string; filter: ForumFilter }[])
      .filter((forum) =>
        shows(forum.filter, { labels, importance: row.importance, repo: row.repo as string }),
      )
      .map((forum) => forum.id),
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
  /**
   * 받을 GitHub 계정 목록(ADR-0043). 이 계정의 레포만 워크스페이스에 넣는다. `owner/name`으로 적은 것은 그 계정을 받고
   * 그 레포를 켤 때마다 넣는다. 첫 `owner/name`은 레포가 하나이던 판의 레포라, 이미 있는 DB의 것을 그 레포로 옮긴다.
   */
  accept: string[];
  github: GitHub;
  /** GIF 찾기(ADR-0044). 서버 설정에 GIPHY 키가 있을 때만 준다. 없으면 웹에 GIF 버튼이 없다. */
  giphy?: Giphy;
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
  /** 토론의 라운드 수. 기본은 `DEBATE_ROUNDS`(가린 첫 라운드와 반박 두 라운드)이고 줄일 수 있다. */
  debateRounds?: number;
  /** 토론이 끝나지 않으면 만료하기까지의 시간. 기본 14일(`INBOX_MS`). 테스트가 줄여 쓴다. 만료는 `followMs`마다 본다. */
  debateMs?: number;
  /** Fly 위에서 돈다(`FLY_APP_NAME`이 있다). 그때만 앞단이 넣는 Fly-Client-IP를 클라이언트 주소로 믿는다. */
  behindFly?: boolean;
  /** hello를 마치기까지의 시간. 기본 10초. 테스트가 줄여 쓴다. */
  helloMs?: number;
  /** 빌드한 웹 화면(`vite build`의 dist) 폴더. 주면 API와 같은 주소에서 낸다. 개발할 때는 주지 않고 Vite를 쓴다. */
  webDir?: string;
}) {
  const { github } = options;
  /** 받을 계정들(소문자). */
  const accounts = new Set(options.accept.map((entry) => entry.split("/")[0]?.toLowerCase()));
  /** 서버 설정이 정한 레포들. */
  const seeds = options.accept.filter((entry) => entry.includes("/"));
  /** 레포가 하나이던 판의 레포. 이미 있는 DB의 레포 없는 것은 이 레포의 것이다. */
  const legacy = seeds[0];
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
  // 작업마다 그 작업의 에이전트: 그 브랜치에서 마지막으로 훅이나 status set을 보낸 실행기(ADR-0015). 관측만 있는 작업은 없다.
  db.exec(`CREATE TABLE IF NOT EXISTS work_agents (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    executor TEXT NOT NULL,
    PRIMARY KEY (login, branch)
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
  // 이슈에 올린 판정(#134): `verdict`는 마지막으로 이슈에 맞춘 것(confirmed, cleared, passed)이고, 올린 댓글의 번호는
  // `verdict_comments`에 적어 댓글 읽기가 포스트의 글로 다시 들이지 않게 한다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'verdict'").get())
    db.exec("ALTER TABLE channels ADD COLUMN verdict TEXT");
  db.exec("CREATE TABLE IF NOT EXISTS verdict_comments (id INTEGER PRIMARY KEY) STRICT");
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
  // 대행이 낀 토론의 부재자(#198). 로그인의 JSON 배열이고, 모두 동의해야 머지한다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('decisions') WHERE name = 'absent'").get())
    db.exec("ALTER TABLE decisions ADD COLUMN absent TEXT NOT NULL DEFAULT '[]'");
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
  // 통과로 닫힌 간접 충돌(ADR-0035): `held`가 1이면 그 쌍은 다시 돌린 판정이 나올 때까지 알림을 다시 세우지 않는다. 쌍마다 하나까지다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'held'").get())
    db.exec("ALTER TABLE alerts ADD COLUMN held INTEGER NOT NULL DEFAULT 0");
  // v0.1.0의 표에는 `alert`가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'alert'").get())
    db.exec("ALTER TABLE messages ADD COLUMN alert INTEGER REFERENCES alerts (id)");
  // 포스트의 라벨(ADR-0039, JSON 배열). 이슈의 라벨(`issue_labels`)과 따로 Omagari에 둔다. 이 열이 없던 DB의 포스트에는
  // 알림의 종류 라벨과, 확인됐으면 확인됨을 붙인다. 이미 연 이슈는 그대로 둔다(문답 A10).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'labels'").get()) {
    db.exec("ALTER TABLE channels ADD COLUMN labels TEXT");
    const posts = db
      .prepare(
        `SELECT c.id, a.kind, a.confirmed FROM channels c JOIN messages m ON m.id = c.alert
         JOIN alerts a ON a.id = m.alert`,
      )
      .all() as { id: string; kind: Alert["kind"]; confirmed: number }[];
    for (const post of posts)
      db.prepare("UPDATE channels SET labels = ? WHERE id = ?").run(
        JSON.stringify([ALERT_LABELS[post.kind], ...(post.confirmed ? [CONFIRMED_LABEL] : [])]),
        post.id,
      );
  }
  // 라벨(ADR-0039): 레포의 GitHub 라벨과 팀이 단 중요도. 이름, 색, 설명은 주기마다 GitHub에서 읽는다. `github`은 GitHub 라벨의 id이고,
  // 아직 GitHub에 없는 기본 라벨(종류 넷과 확인됨)은 NULL이라 다음 주기에 만든다. GitHub처럼 이름은 대소문자를 가리지 않는다.
  db.exec(`CREATE TABLE IF NOT EXISTS labels (
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    github INTEGER UNIQUE,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    importance TEXT NOT NULL DEFAULT 'reference' CHECK (importance IN ('reference', 'discuss'))
  ) STRICT`);
  /** 레포의 기본 라벨이 목록에 없으면 넣는다. GitHub에 없으면 다음 주기에 만든다. */
  const seedLabels = (repo: string) => {
    for (const [name, color] of Object.entries(DEFAULT_LABEL_COLORS))
      db.prepare(
        "INSERT OR IGNORE INTO labels (repo, name, color, importance) VALUES (?, ?, ?, ?)",
      ).run(repo, name, color, DISCUSS_LABELS.includes(name) ? "discuss" : "reference");
  };
  // 포럼의 거르기(ADR-0039, 계약의 ForumFilter JSON). 포럼에만 있고, 채팅과 포스트와 알림 줄의 자리(`ALERTS`)는 NULL이다.
  // 이 열이 없던 DB: 알림 줄을 모두 `ALERTS`로 옮기고, 있던 포럼은 논의로 거르며 "부딪힘"은 "논의"가 된다(이름이 겹치면 그대로 둔다).
  // 처음 띄운 서버에도 "논의"와 "참고" 포럼이 생긴다. 그 뒤로 지운 포럼은 다시 만들지 않는다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'filter'").get()) {
    db.exec("BEGIN");
    db.exec("ALTER TABLE channels ADD COLUMN filter TEXT");
    db.prepare("INSERT INTO channels (id, name, kind) VALUES (?, ?, 'forum')").run(
      ALERTS,
      `\n${ALERTS}`,
    );
    db.prepare("UPDATE messages SET channel = ? WHERE alert IS NOT NULL").run(ALERTS);
    db.prepare("UPDATE channels SET filter = ? WHERE kind = 'forum' AND id != ?").run(
      JSON.stringify({ importance: "discuss" }),
      ALERTS,
    );
    db.exec("UPDATE OR IGNORE channels SET name = '논의' WHERE kind = 'forum' AND name = '부딪힘'");
    for (const importance of Importance.options) {
      const filter = JSON.stringify({ importance });
      if (!db.prepare("SELECT 1 FROM channels WHERE filter = ?").get(filter))
        db.prepare(
          "INSERT OR IGNORE INTO channels (id, name, kind, filter) VALUES (?, ?, 'forum', ?)",
        ).run(randomBytes(8).toString("hex"), IMPORTANCE_LABELS[importance], filter);
    }
    db.exec("COMMIT");
  }
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
  // 워크스페이스의 설정 하나씩: 러너가 마지막으로 알려 온 설정 파일(`check`, 계약의 CheckReading JSON).
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
  // 포스트의 토론(ADR-0040). 한 포스트에 토론은 하나다. `round`는 지금 라운드, `state`는 `Debate.state`다.
  // `flip`이 1이면 안의 순서를 자리의 거꾸로 둔다(주인을 가린다). `winner`는 결론이 된 자리, `by`는 정한 길, `chooser`와 `decided`는 고른 멤버와 시각(ms)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS debates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post TEXT NOT NULL UNIQUE,
    round INTEGER NOT NULL DEFAULT 1,
    at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'choosing', 'concluded', 'ended')),
    flip INTEGER NOT NULL DEFAULT 0,
    winner INTEGER,
    by TEXT,
    chooser TEXT,
    decided INTEGER,
    expired INTEGER NOT NULL DEFAULT 0
  ) STRICT`);
  // 증거 라벨 없이 멤버나 에이전트가 낸 토론 요청(ADR-0040). 포스트마다 가장 나중 것 하나다. 안건이나 근거가 비면 열리지 않고 이것만 남는다.
  db.exec(`CREATE TABLE IF NOT EXISTS debate_requests (
    post TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    agenda TEXT NOT NULL,
    grounds TEXT NOT NULL,
    opened INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`);
  // #195의 표에는 끝내기가 없다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('debates') WHERE name = 'state'").get()) {
    db.exec(`ALTER TABLE debates ADD COLUMN state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'choosing', 'concluded', 'ended'));
      ALTER TABLE debates ADD COLUMN flip INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE debates ADD COLUMN winner INTEGER;
      ALTER TABLE debates ADD COLUMN by TEXT;
      ALTER TABLE debates ADD COLUMN chooser TEXT;
      ALTER TABLE debates ADD COLUMN decided INTEGER`);
  }
  // #196의 표에는 만료가 없다. 만료는 `state`가 ended이고 `expired`가 1이다(CHECK를 바꾸지 않는다).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('debates') WHERE name = 'expired'").get())
    db.exec("ALTER TABLE debates ADD COLUMN expired INTEGER NOT NULL DEFAULT 0");
  // 토론의 자리. `seat`은 알림의 `works` 자리(0, 1)다. `stance`는 라운드마다 낸 입장의 JSON 배열(#195의 행은 입장 하나), `error`는 내지 못한 까닭(JSON)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS seats (
    debate INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('waiting', 'submitted', 'off', 'failed')),
    stance TEXT,
    error TEXT,
    proxy TEXT,
    PRIMARY KEY (debate, seat)
  ) STRICT`);
  // 토론의 입장과 결론을 올린 이슈 댓글(ADR-0040). `seat`은 자리(0, 1)이고 결론은 -1, `round`는 입장의 라운드(0부터)다. 이 댓글은 포스트의 글로 다시 들이지 않는다.
  db.exec(`CREATE TABLE IF NOT EXISTS debate_comments (
    debate INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    round INTEGER NOT NULL,
    id INTEGER NOT NULL,
    PRIMARY KEY (debate, seat, round)
  ) STRICT`);
  // 대행(#198). `proxy`는 이 자리에 대행을 부른 멤버다.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('seats') WHERE name = 'proxy'").get())
    db.exec("ALTER TABLE seats ADD COLUMN proxy TEXT");
  // 날마다 들어온 멤버(ADR-0018). 날은 `TIME_ZONE`의 날짜다. 지표가 남기는 것은 이것뿐이고, 문답 수는 `qas`에서 센다.
  // 지표는 워크스페이스마다다(ADR-0043). 한 사람이 두 워크스페이스에 들어오면 둘에서 하루에 한 번씩 센다.
  db.exec(`CREATE TABLE IF NOT EXISTS visits (
    day TEXT NOT NULL,
    workspace TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (day, workspace, login)
  ) STRICT`);
  // 합쳐 돌려 보기의 판정 수(ADR-0018, ADR-0036). 지문마다 한 번만 센다. 이름은 남기지 않고 지문, 판정, 시각만 둔다.
  db.exec(`CREATE TABLE IF NOT EXISTS merge_runs (
    fingerprint TEXT PRIMARY KEY,
    verdict TEXT NOT NULL,
    at INTEGER NOT NULL,
    workspace TEXT NOT NULL DEFAULT ''
  ) STRICT`);
  // 워크스페이스의 레포(ADR-0043). 이름은 GitHub처럼 대소문자를 가리지 않고, 다른 표에는 여기 적힌 꼴 그대로 둔다. `at`은 넣은 시각(ms)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS repos (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    at INTEGER NOT NULL
  ) STRICT`);
  // 멤버마다 push 권한이 있는 레포(ADR-0043). 로그인할 때와 `recheckMs`마다 다시 읽는다. 하나라도 있으면 멤버다.
  const hadAccess = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'access'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS access (
    login TEXT NOT NULL,
    repo TEXT NOT NULL,
    PRIMARY KEY (login, repo)
  ) STRICT`);
  // 레포마다인 표(ADR-0043). 레포가 하나이던 판의 DB는 `repo` 열이 없다. 그 줄은 옛 레포(`legacy`)의 것으로 옮긴다.
  // 열쇠가 바뀌는 표는 다시 만들고, 다른 표가 가리키는 표(alerts)와 열쇠가 그대로인 표는 열만 더한다.
  const hasRepo = (table: string) =>
    db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'repo'`).get();
  const rebuilt: Record<string, string> = {
    works: `(repo TEXT NOT NULL, login TEXT NOT NULL, branch TEXT NOT NULL, base TEXT NOT NULL,
      share TEXT NOT NULL, files TEXT NOT NULL, PRIMARY KEY (repo, login, branch)) STRICT`,
    lines: `(repo TEXT NOT NULL, login TEXT NOT NULL, branch TEXT NOT NULL, text TEXT NOT NULL,
      at INTEGER NOT NULL, PRIMARY KEY (repo, login, branch)) STRICT`,
    work_agents: `(repo TEXT NOT NULL, login TEXT NOT NULL, branch TEXT NOT NULL, executor TEXT NOT NULL,
      PRIMARY KEY (repo, login, branch)) STRICT`,
    offline: `(repo TEXT NOT NULL, login TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (repo, login)) STRICT`,
    labels: `(repo TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, github INTEGER, color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      importance TEXT NOT NULL DEFAULT 'reference' CHECK (importance IN ('reference', 'discuss')),
      UNIQUE (repo, name), UNIQUE (repo, github)) STRICT`,
  };
  const moved = [
    ...Object.keys(rebuilt),
    "claims",
    "feed",
    "inbox",
    "alerts",
    "questions",
    "channels",
  ].filter((table) => !hasRepo(table));
  if (moved.length > 0) {
    if (legacy === undefined && db.prepare("SELECT 1 FROM works UNION SELECT 1 FROM alerts").get())
      console.warn(
        "레포가 하나이던 판의 DB인데 OMAGARI_REPO에 owner/name이 없어 있던 것이 어느 레포에도 보이지 않는다",
      );
    db.exec("BEGIN");
    for (const table of moved) {
      const columns = (
        db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]
      )
        .map((column) => column.name)
        .join(", ");
      if (rebuilt[table]) {
        db.exec(`CREATE TABLE ${table}_next ${rebuilt[table]}`);
        db.prepare(
          `INSERT INTO ${table}_next (repo, ${columns}) SELECT ?, ${columns} FROM ${table}`,
        ).run(legacy ?? "");
        db.exec(`DROP TABLE ${table}; ALTER TABLE ${table}_next RENAME TO ${table}`);
      } else if (table === "channels") {
        // 레포의 것은 포스트뿐이다. 채팅 채널과 포럼은 워크스페이스의 것이라 NULL이다(채널의 두 층은 #237).
        db.exec("ALTER TABLE channels ADD COLUMN repo TEXT");
        db.prepare("UPDATE channels SET repo = ? WHERE alert IS NOT NULL").run(legacy ?? "");
      } else {
        db.exec(`ALTER TABLE ${table} ADD COLUMN repo TEXT NOT NULL DEFAULT ''`);
        db.prepare(`UPDATE ${table} SET repo = ?`).run(legacy ?? "");
      }
    }
    // 풀리지 않은 알림은 레포의 쌍마다 하나다.
    db.exec("DROP INDEX IF EXISTS alerts_open");
    db.exec("CREATE UNIQUE INDEX alerts_open ON alerts (repo, pair) WHERE resolved IS NULL");
    // 검사 명령은 레포마다다.
    if (legacy !== undefined)
      db.prepare("UPDATE settings SET key = ? WHERE key = 'check'").run(`check ${legacy}`);
    db.exec("COMMIT");
  }
  // 옮겨지거나 이름이 바뀐 레포(ADR-0043). 옛 이름으로 오는 설정, 원격, 머리말은 새 이름으로 읽는다.
  db.exec(`CREATE TABLE IF NOT EXISTS repo_moves (
    old TEXT PRIMARY KEY COLLATE NOCASE,
    new TEXT NOT NULL
  ) STRICT`);
  // 레포의 GitHub 숫자 id(#315). 넣을 때나 처음 권한을 읽을 때 적고, 레포를 빼도 남긴다.
  // 같은 이름이라도 id가 다르면 다른 레포다: 지워진 뒤 같은 이름으로 새로 만든 레포는 옛 레포의 것을 보지 못한다.
  db.exec(`CREATE TABLE IF NOT EXISTS repo_ids (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    id INTEGER NOT NULL
  ) STRICT`);
  /** GitHub이 `repo`라 부르는 레포(`id`)가 이 서버가 아는 그 레포인가. 처음 보는 이름이면 그 id를 적는다. */
  const sameRepo = (repo: string, id: number) => {
    db.prepare("INSERT OR IGNORE INTO repo_ids (name, id) VALUES (?, ?)").run(repo, id);
    return (
      (db.prepare("SELECT id FROM repo_ids WHERE name = ?").get(repo) as { id: number }).id === id
    );
  };
  /** 옮겨진 레포면 지금 이름, 아니면 그대로다. */
  const current = (repo: string) =>
    (
      db.prepare("SELECT new FROM repo_moves WHERE old = ?").get(repo) as
        | { new: string }
        | undefined
    )?.new ?? repo;
  for (const repo of seeds)
    db.prepare("INSERT OR IGNORE INTO repos (name, at) VALUES (?, ?)").run(
      current(repo),
      Date.now(),
    );
  // 레포가 하나이던 판의 세션은 그 레포에 push 권한이 있는 것으로 들어왔다. 다시 확인할 때까지 그대로 본다.
  if (!hadAccess && legacy !== undefined)
    db.prepare("INSERT OR IGNORE INTO access (login, repo) SELECT login, ? FROM sessions").run(
      (db.prepare("SELECT name FROM repos WHERE name = ?").get(legacy) as { name: string }).name,
    );
  /** 워크스페이스의 레포들, 넣은 순서. */
  const allRepos = () =>
    (db.prepare("SELECT name FROM repos ORDER BY at, rowid").all() as { name: string }[]).map(
      (row) => row.name,
    );
  for (const repo of allRepos()) seedLabels(repo);

  // 워크스페이스(ADR-0043): 레포의 계정(`ownerOf`)마다 하나다. 채팅 채널, 포럼, 날마다의 방문, 합쳐 돌려 보기의 판정 수는 워크스페이스마다 나뉜다.
  // 워크스페이스는 그 계정의 레포가 처음 들어올 때 생긴다.
  db.exec(
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL) STRICT",
  );
  const hasColumn = (table: string, column: string) =>
    db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = '${column}'`).get();
  // 사람의 GitHub 프로필 사진(#288). 이름과 함께 로그인할 때와 10분마다 다시 읽는다.
  if (!hasColumn("people", "avatar")) db.exec("ALTER TABLE people ADD COLUMN avatar TEXT");
  // 사람의 GitHub 숫자 id(#315). 로그인할 때 적는다. 이 이름을 다른 id가 쓰던 것이면 들어오지 못한다.
  if (!hasColumn("people", "github_id")) db.exec("ALTER TABLE people ADD COLUMN github_id INTEGER");
  // 계정의 종류와 아바타(시안 101의 이름 줄). 멤버의 push 권한을 읽을 때 GitHub에서 함께 읽어 고친다.
  if (!hasColumn("workspaces", "kind")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'organization'");
    db.exec("ALTER TABLE workspaces ADD COLUMN avatar TEXT");
  }
  if (!hasColumn("channels", "workspace")) {
    // 채널의 이름은 워크스페이스마다 하나다. 표 전체에 하나이던 UNIQUE를 빼려고 표를 다시 만든다. messages가 가리키는 표라 외래 키를 잠시 끈다.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    db.exec("ALTER TABLE channels ADD COLUMN workspace TEXT");
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'channels'").get() as {
      sql: string;
    };
    const next = sql
      .replace(/^CREATE TABLE\s+"?channels"?/, "CREATE TABLE channels_next")
      .replace("name TEXT NOT NULL UNIQUE COLLATE NOCASE", "name TEXT NOT NULL COLLATE NOCASE");
    if (next === sql || next.includes("UNIQUE COLLATE NOCASE"))
      throw new Error(`channels 표를 다시 만들지 못했다: ${sql}`);
    db.exec(next);
    db.exec("INSERT INTO channels_next SELECT * FROM channels");
    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_next RENAME TO channels");
    db.exec(`UPDATE channels SET workspace = ${ownerSql("repo")} WHERE repo IS NOT NULL`);
    db.exec("CREATE UNIQUE INDEX channels_by_alert ON channels (alert)");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");
  }
  // 채널의 이름은 워크스페이스 안에서 층마다 하나다: 워크스페이스 채널(포럼 포함)끼리, 레포 채널은 그 레포 안에서. 권한 없는 레포의 채널 이름과 겹쳐 그 이름이 드러나지 않게 한다.
  db.exec("DROP INDEX IF EXISTS channels_by_name");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS channels_by_layer_name ON channels (workspace, COALESCE(repo, ''), name)",
  );
  /** 새 워크스페이스에 "논의"와 "참고" 포럼을 둔다. */
  const seedForums = (workspace: string) => {
    for (const importance of Importance.options)
      db.prepare(
        "INSERT INTO channels (id, name, kind, filter, workspace) VALUES (?, ?, 'forum', ?, ?)",
      ).run(
        randomBytes(8).toString("hex"),
        IMPORTANCE_LABELS[importance],
        JSON.stringify({ importance }),
        workspace,
      );
  };
  /**
   * `repo`의 워크스페이스가 없으면 만든다. 워크스페이스가 하나이던 판의 DB에 있던 채팅 채널과 포럼(워크스페이스 없는 것)은
   * 처음 생기는 워크스페이스가 이어받고, 이어받을 것이 없으면 기본 포럼을 둔다.
   */
  const ensureWorkspace = (repo: string) => {
    const id = ownerOf(repo);
    const made = db
      .prepare("INSERT OR IGNORE INTO workspaces (id, name, at) VALUES (?, ?, ?)")
      .run(id, repo.split("/")[0] as string, Date.now()).changes;
    if (!made) return;
    const adopted = db
      .prepare(
        "UPDATE channels SET workspace = ? WHERE workspace IS NULL AND repo IS NULL AND id != ?",
      )
      .run(id, ALERTS).changes;
    if (!adopted) seedForums(id);
  };
  for (const repo of allRepos()) ensureWorkspace(repo);
  /**
   * GitHub에서 옮겨지거나 이름이 바뀐 레포 `from`의 것을 모두 새 이름 `to` 아래로 옮긴다(ADR-0043). `repo` 열이 있는 표 모두,
   * 레포의 채널(다른 계정으로 갔으면 그 워크스페이스로), 같은 워크스페이스 포럼의 거르기, 검사 명령, 이어진 러너와 웹이다.
   * 받을 계정 밖으로 갔거나 새 이름이 이미 워크스페이스에 있으면 옮기지 않고 옛 이름으로 둔다(GitHub이 옛 이름을 넘겨 주어 그대로 돈다).
   */
  const moveRepo = (from: string, to: string) => {
    if (!accounts.has(ownerOf(to))) {
      console.warn(`${from}이 ${to}로 옮겨졌지만 받을 계정(OMAGARI_REPO) 밖이라 옛 이름으로 둔다`);
      return false;
    }
    if (
      to.toLowerCase() !== from.toLowerCase() &&
      allRepos().some((r) => r.toLowerCase() === to.toLowerCase())
    ) {
      console.warn(
        `${from}이 ${to}로 옮겨졌지만 ${to}가 이미 워크스페이스에 있어 옛 이름으로 둔다`,
      );
      return false;
    }
    const tables = (
      db
        .prepare(
          "SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND p.name = 'repo'",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE repos SET name = ? WHERE name = ?").run(to, from);
      db.prepare("UPDATE OR REPLACE repo_ids SET name = ? WHERE name = ?").run(to, from);
      for (const table of tables)
        db.prepare(`UPDATE ${table} SET repo = ? WHERE repo = ?`).run(to, from);
      db.prepare("UPDATE channels SET workspace = ? WHERE repo = ?").run(ownerOf(to), to);
      for (const forum of db
        .prepare("SELECT id, filter FROM channels WHERE kind = 'forum' AND workspace = ?")
        .all(ownerOf(to)) as { id: string; filter: string | null }[]) {
        const filter = JSON.parse(forum.filter ?? "{}") as { repos?: string[] };
        if (!filter.repos?.includes(from)) continue;
        filter.repos = filter.repos.map((r) => (r === from ? to : r));
        db.prepare("UPDATE channels SET filter = ? WHERE id = ?").run(
          JSON.stringify(filter),
          forum.id,
        );
      }
      db.prepare("UPDATE settings SET key = ? WHERE key = ?").run(`check ${to}`, `check ${from}`);
      db.prepare("UPDATE repo_moves SET new = ? WHERE new = ?").run(to, from);
      db.prepare("INSERT OR REPLACE INTO repo_moves (old, new) VALUES (?, ?)").run(from, to);
      db.prepare("DELETE FROM repo_moves WHERE old = new").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      console.error(`${from}을 ${to}로 옮기지 못했다:`, error);
      return false;
    }
    ensureWorkspace(to);
    for (const runner of runners.values()) if (runner.repo === from) runner.repo = to;
    for (const watcher of watchers.values())
      if (watcher.repo === from) Object.assign(watcher, { repo: to, workspace: ownerOf(to) });
    console.log(`${from}이 GitHub에서 ${to}로 옮겨져 따라갔다`);
    return true;
  };
  // 채팅 채널은 레포나 워크스페이스에 속한다(ADR-0043). 그 전부터 있던 채팅 채널은 그 워크스페이스의 첫 레포의 채널이 된다.
  // 한 번만 한다: 그 뒤에 만든 워크스페이스 채널(레포 없음)을 다시 옮기지 않으려고 표시를 남긴다.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'channels by repo'").get()) {
    for (const { id } of db.prepare("SELECT id FROM workspaces").all() as { id: string }[]) {
      const first = allRepos().find((repo) => ownerOf(repo) === id);
      if (first)
        db.prepare(
          "UPDATE channels SET repo = ? WHERE kind = 'chat' AND alert IS NULL AND repo IS NULL AND workspace = ?",
        ).run(first, id);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('channels by repo', '1')").run();
  }
  /** 워크스페이스가 하나이던 판의 방문과 판정 수는 처음 생긴 워크스페이스의 것이다. */
  const firstWorkspace =
    (
      db.prepare("SELECT id FROM workspaces ORDER BY at, rowid LIMIT 1").get() as
        | { id: string }
        | undefined
    )?.id ?? "";
  if (!hasColumn("visits", "workspace")) {
    db.exec("BEGIN");
    db.exec(`CREATE TABLE visits_next (day TEXT NOT NULL, workspace TEXT NOT NULL, login TEXT NOT NULL,
      PRIMARY KEY (day, workspace, login)) STRICT`);
    db.prepare(
      "INSERT INTO visits_next (day, workspace, login) SELECT day, ?, login FROM visits",
    ).run(firstWorkspace);
    db.exec("DROP TABLE visits");
    db.exec("ALTER TABLE visits_next RENAME TO visits");
    db.exec("COMMIT");
  }
  if (!hasColumn("merge_runs", "workspace")) {
    db.exec("ALTER TABLE merge_runs ADD COLUMN workspace TEXT NOT NULL DEFAULT ''");
    db.prepare("UPDATE merge_runs SET workspace = ?").run(firstWorkspace);
  }

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
    `INSERT OR IGNORE INTO offline (repo, login, since)
     SELECT repo, login, ? FROM works UNION SELECT repo, login, ? FROM lines`,
  ).run(Date.now(), Date.now());

  /**
   * 멤버의 작업을 러너가 지금 보는 것으로 바꾼다.
   * 관측된 변경이 있다가 0이 된 작업은 에이전트가 쓴 줄을 지운다. 처음부터 0이던 작업의 줄은 남긴다(ADR-0010).
   */
  // ponytail: 레포마다 멤버 하나에 러너 하나로 본다. 한 멤버가 기기 둘에서 같은 레포의 러너를 켜면 나중에 보낸 쪽이 덮는다. 그때는 러너마다 나눈다.
  const replaceWorks = (repo: string, login: string, works: Work[]) => {
    db.exec("BEGIN");
    const changed = new Set(
      (
        db
          .prepare(
            "SELECT branch FROM works WHERE repo = ? AND login = ? AND json_array_length(files) > 0",
          )
          .all(repo, login) as { branch: string }[]
      ).map((row) => row.branch),
    );
    db.prepare("DELETE FROM works WHERE repo = ? AND login = ?").run(repo, login);
    const insert = db.prepare(
      "INSERT OR REPLACE INTO works (repo, login, branch, base, share, files) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const clear = db.prepare("DELETE FROM lines WHERE repo = ? AND login = ? AND branch = ?");
    for (const work of works) {
      insert.run(repo, login, work.branch, work.base, work.share, JSON.stringify(work.files));
      // intent의 빈 files는 바뀐 것이 0이 된 것이 아니라 보내지 않은 것이다. 수준을 낮춰도 쓴 줄은 남는다.
      if (work.share !== "intent" && work.files.length === 0 && changed.has(work.branch)) {
        clear.run(repo, login, work.branch);
      }
    }
    db.exec("COMMIT");
  };
  /** 레포와 브랜치마다 열린 초안 PR의 제목. 열쇠는 `[repo, branch]`의 JSON이다. GitHub에서 `followMs`마다 다시 읽는다. 서버가 꺼지면 잃고 다음 주기에 다시 읽는다. */
  let drafts = new Map<string, string>();
  /** 레포의 멤버(세션이 있고 그 레포에 push 권한이 있다)를 내는 SQL. 레포를 하나 받는다. */
  const MEMBERS =
    "(SELECT login FROM access WHERE repo = ? AND login IN (SELECT login FROM sessions))";
  /** 멤버에게 보이는 레포들(push 권한이 있는 것), 넣은 순서. */
  const reposOf = (login: string) =>
    (
      db
        .prepare(
          "SELECT r.name FROM repos r JOIN access a ON a.repo = r.name WHERE a.login = ? ORDER BY r.at, r.rowid",
        )
        .all(login) as { name: string }[]
    ).map((row) => row.name);
  const sees = (login: string, repo: string | null | undefined) =>
    repo != null &&
    !!db.prepare("SELECT 1 FROM access WHERE login = ? AND repo = ?").get(login, repo);
  /** 포스트(채널 id)의 레포. 포스트가 아니면 없다. */
  const postRepo = (post: string) =>
    (
      db.prepare("SELECT repo FROM channels WHERE id = ? AND alert IS NOT NULL").get(post) as
        | { repo: string }
        | undefined
    )?.repo;
  /** 채널의 워크스페이스. 알림 줄의 자리(`ALERTS`)와 없는 채널은 없다. */
  const channelWorkspace = (channel: string) =>
    (
      db.prepare("SELECT workspace FROM channels WHERE id = ?").get(channel) as
        | { workspace: string | null }
        | undefined
    )?.workspace ?? undefined;
  /** 채널의 레포: 포스트와 레포 채널. 워크스페이스 채널과 없는 채널은 없다. */
  const channelRepo = (channel: string) =>
    (
      db.prepare("SELECT repo FROM channels WHERE id = ?").get(channel) as
        | { repo: string | null }
        | undefined
    )?.repo ?? undefined;
  /** 멤버가 들어간 워크스페이스들(`id`), 넣은 순서. */
  const workspacesOf = (login: string) => [...new Set(reposOf(login).map(ownerOf))];
  /** 멤버에게 보이는 포스트의 레포. 없거나 보이지 않으면 `not_found`다. */
  const seenPost = (login: string, post: string) => {
    const repo = postRepo(post);
    if (!sees(login, repo))
      throw new ContractFailure({ code: "not_found", message: `없는 포스트다: ${post}` });
    return repo as string;
  };
  const sessionLogin = (session: string) =>
    (
      db.prepare("SELECT login FROM sessions WHERE hash = ?").get(hash(session)) as
        | { login: string }
        | undefined
    )?.login;

  /** 멤버가 오늘 들어왔다고 적는다. 웹만 부르는 곳(실시간 연결, 채널에서 읽고 쓰기)에서만 부른다. 러너와 CLI는 세지 않는다. */
  const visit = (login: string, workspace: string) =>
    db
      .prepare("INSERT OR IGNORE INTO visits (day, workspace, login) VALUES (?, ?, ?)")
      .run(dayOf(Date.now()), workspace, login);

  /** 끝나지 않은 기기 인증. 서버가 꺼지면 잃는다. 다시 로그인하면 된다. */
  const logins = new Map<
    string,
    {
      deviceCode: string;
      expiresAt: number;
      intervalMs: number;
      nextPollAt: number;
      /** 시작한 쪽의 주소와 마지막으로 물은 시각. 버려진 것을 지우고 주소마다 센다. */
      client: string;
      polledAt: number;
    }
  >();
  /** 지금 GitHub에 기기 인증을 여는 중인 수. 기다리는 사이에도 상한을 지키려고 미리 센다. */
  let startingLogins = 0;
  /** 주소마다 지금 GitHub에 기기 인증을 여는 중인 수. 한 주소가 한꺼번에 보내도 주소마다의 상한을 지킨다. */
  const startingFrom = new Map<string, number>();
  /** hello를 마친 러너의 연결과 그 러너가 돌리는 실행기, 실행기마다의 고를 거리. */
  const runners = new Map<
    WSContext,
    {
      login: string;
      hash: string;
      /** 이 러너가 이어진 레포(ADR-0043). */
      repo: string;
      executors: ExecutorId[];
      choices: Partial<Record<ExecutorId, Choices>>;
      mergeCheck: MergeCheckState;
    }
  >();
  /** hello를 마친 웹의 실시간 연결과 그 세션의 해시, 멤버, 고른 레포. 세션이 끝나면 닫는다. */
  const watchers = new Map<
    WSContext,
    { hash: string; login: string; repo: string; workspace: string }
  >();
  /** 워크스페이스의 것을 그 워크스페이스를 고른 웹 모두에 보낸다. 다른 워크스페이스를 고른 연결에는 같은 사람의 것도 가지 않는다. */
  const broadcast = (workspace: string, frame: string) => {
    for (const [socket, watcher] of watchers)
      if (socket.readyState === 1 && watcher.workspace === workspace) socket.send(frame); // OPEN
  };
  /** 레포의 것을 그 레포가 보이는 웹에만, 그 레포의 워크스페이스를 고른 연결로만 보낸다. */
  const broadcastTo = (repo: string, frame: string) => {
    for (const [socket, watcher] of watchers)
      if (
        socket.readyState === 1 &&
        watcher.workspace === ownerOf(repo) &&
        sees(watcher.login, repo)
      )
        socket.send(frame); // OPEN
  };
  /** 채널의 한 줄을 그것이 보이는 웹에 보내고 계약의 꼴로 돌려준다. */
  const shareRow = (row: MessageRow) => {
    const message = messageView(row);
    const frame = encode(serverToWeb, "message", message);
    if (row.repo !== null) broadcastTo(row.repo, frame);
    else if (row.workspace !== null) broadcast(row.workspace, frame);
    return message;
  };
  /** `login`의 웹 연결에만 보낸다. 비공개인 DM은 이것으로만 나간다. `workspace`를 주면 그 워크스페이스를 고른 연결에만 간다. */
  const sendTo = (login: string, frame: string, workspace?: string) => {
    for (const [socket, watcher] of watchers) {
      if (
        watcher.login === login &&
        (workspace === undefined || watcher.workspace === workspace) &&
        socket.readyState === 1
      )
        socket.send(frame); // OPEN
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
    sendTo(asked.login, encode(serverToWeb, "qa", qa), channelWorkspace(asked.channel));
    if (!row) return { qa };
    return { qa, message: shareRow(row) };
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
    sendTo(
      found.login,
      encode(serverToWeb, "draft", draft),
      ownerOf(postRepo(found.draft.post) ?? ""),
    );
    shareMembers();
    return draft;
  };

  /** 레포의 멤버들이 보는 그 레포의 작업 전부. 웹과 러너가 같은 것을 본다. */
  const worksView = (repo: string): WorkView[] => {
    // 레포에서 빠진 사람(세션이나 push 권한이 없는 사람)의 작업은 보이지 않는다.
    const rows = db
      .prepare(
        `SELECT w.login, w.branch, w.base, w.share, w.files, l.text, l.at, o.since FROM works w
         LEFT JOIN lines l ON l.repo = w.repo AND l.login = w.login AND l.branch = w.branch
         LEFT JOIN offline o ON o.repo = w.repo AND o.login = w.login
         WHERE w.repo = ? AND w.login IN ${MEMBERS} ORDER BY w.login, w.branch`,
      )
      .all(repo, repo) as {
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
      const draft = drafts.get(JSON.stringify([repo, branch]));
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
   * 멤버 목록(과 그것으로 거르는 `omagari status`)에 보일 작업(ADR-0006). 바뀐 것이 없어 상태 한 줄(에이전트가 쓴 줄, 초안 PR, 바뀐 파일)도
   * 선점도 없는 작업은 숨긴다. `api.works`와 러너의 situation, 부딪힘 계산은 걸러지지 않은 worksView를 그대로 쓴다.
   */
  const shownWorks = (repo: string, works: WorkView[]): WorkView[] => {
    const claimed = new Set(
      (
        db.prepare("SELECT login, branch FROM claims WHERE repo = ?").all(repo) as {
          login: string;
          branch: string;
        }[]
      ).map((c) => JSON.stringify([c.login, c.branch])),
    );
    return works.filter(
      (w) =>
        w.line !== null || w.files.length > 0 || claimed.has(JSON.stringify([w.login, w.branch])),
    );
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
    repo: string;
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
  /** 레포의 선점 전부. 작업처럼 레포에서 빠진 사람의 것은 보이지 않는다. */
  const claimsView = (repo: string): Claim[] =>
    (
      db
        .prepare(`SELECT * FROM claims WHERE repo = ? AND login IN ${MEMBERS} ORDER BY id`)
        .all(repo, repo) as ClaimRow[]
    ).map(claimView);

  /** 선점을 푼다. 피드에 남기고 푼 것을 돌려준다. 상황은 부른 쪽이 보낸다. */
  const releaseClaims = (where: string, ...params: (string | number)[]) => {
    const rows = db.prepare(`SELECT * FROM claims WHERE ${where}`).all(...params) as ClaimRow[];
    const now = Date.now();
    for (const row of rows) {
      db.prepare("DELETE FROM claims WHERE id = ?").run(row.id);
      db.prepare("INSERT INTO feed (repo, kind, claim, at) VALUES (?, 'released', ?, ?)").run(
        row.repo,
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
  const cancelPlans = (repo: string, claims: Claim[]) => {
    const works = worksView(repo);
    const open = db
      .prepare(
        "SELECT works, files FROM alerts WHERE repo = ? AND kind = 'declared' AND resolved IS NULL",
      )
      .all(repo) as { works: string; files: string }[];
    const put = db.prepare(
      "INSERT INTO inbox (repo, login, branch, news, at) VALUES (?, ?, ?, ?, ?)",
    );
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
        put.run(repo, to.login, to.branch, JSON.stringify({ kind: "cancelled", claim }), now);
      }
    }
    shareInbox();
  };

  /**
   * 멤버 목록: 사람마다 이름, 접속 상태와 상태 메시지, 실행기마다의 에이전트, 작업마다의 상태 한 줄. 이름 순이다.
   * 접속 상태는 웹 창(실시간 연결)이 하나라도 붙어 있으면 고른 것, 없거나 "오프라인으로 보이기"면 offline이다.
   * 오프라인으로 보이는 사람과 정말 나간 사람은 같은 모양이다. 상태 메시지는 둘 다 그대로 보인다.
   */
  const membersView = (repo: string, works: WorkView[]): MemberView[] => {
    const people = db
      .prepare(
        `SELECT s.login, COALESCE(p.name, s.login) AS name, p.avatar, o.since, f.presence, f.until, f.message, f.emoji
         FROM ${MEMBERS} s
         LEFT JOIN people p ON p.login = s.login
         LEFT JOIN offline o ON o.repo = ? AND o.login = s.login
         LEFT JOIN profiles f ON f.login = s.login
         ORDER BY name, s.login`,
      )
      .all(repo, repo) as {
      login: string;
      name: string;
      avatar: string | null;
      since: number | null;
      presence: ChosenPresence | null;
      until: number | null;
      message: string | null;
      emoji: string | null;
    }[];
    // 접속 상태와 에이전트는 이 레포의 워크스페이스에서 본 것만이다. 다른 워크스페이스의 창과 러너는 이 목록에 드러나지 않는다.
    const workspace = ownerOf(repo);
    const open = new Set(
      [...watchers.values()]
        .filter((watcher) => watcher.workspace === workspace)
        .map((watcher) => watcher.login),
    );
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
        ([, runner]) =>
          runner.login === login &&
          ownerOf(runner.repo) === workspace &&
          runner.executors.includes(executor),
      );
      const sockets = live.map(([socket]) => socket);
      const busy = [
        ...asks.values(),
        ...drafting.values(),
        ...questionsSent.values(),
        ...debatesSent.values(),
      ].some((ask) => ask.executor === executor && sockets.includes(ask.socket));
      // 고를 거리는 묻는 문답이 갈 러너(마지막에 붙은 것)의 것이다.
      const choices = live.at(-1)?.[1].choices[executor] ?? { models: [], efforts: [] };
      const state = busy ? "answering" : sockets.length > 0 ? "online" : "offline";
      return { executor, state, choices } as const;
    };
    const byLogin = Map.groupBy(shownWorks(repo, works), (work) => work.login);
    const workAgents = new Map(
      (
        db.prepare("SELECT login, branch, executor FROM work_agents WHERE repo = ?").all(repo) as {
          login: string;
          branch: string;
          executor: ExecutorId;
        }[]
      ).map((row) => [JSON.stringify([row.login, row.branch]), row.executor]),
    );
    const conflicted = conflictedWorks(repo);
    const broken = brokenWorks(repo);
    return people.map(({ login, name, avatar, since, ...profile }) => {
      const agents = known
        .filter((agent) => agent.login === login)
        .map(({ executor }) => agent(login, executor));
      return {
        login,
        name,
        avatar,
        presence: presenceOf(login, profile.presence, profile.until),
        message: profile.message || null,
        emoji: profile.emoji || null,
        agents,
        offlineSince: since === null ? null : new Date(since).toISOString(),
        works: (byLogin.get(login) ?? []).map(({ branch, line }) => ({
          branch,
          executor: workAgents.get(JSON.stringify([login, branch])) ?? null,
          line,
          conflict: conflicted.has(JSON.stringify([login, branch])),
          broken: broken.has(JSON.stringify([login, branch])),
        })),
      };
    });
  };

  /** 풀리지 않은 알림 가운데 줄이 부딪히는 것이 확인된 것의 작업들. 열쇠는 `[login, branch]`의 JSON이다. */
  const conflictedWorks = (repo: string) => {
    const found = new Set<string>();
    const open = db
      .prepare(
        "SELECT works, files FROM alerts WHERE repo = ? AND resolved IS NULL AND kind = 'direct'",
      )
      .all(repo) as {
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

  /** 풀리지 않은 간접 충돌 가운데 합쳐 돌려 보니 깨져 확인된 것의 작업들("합치면 깨짐"). 열쇠는 `[login, branch]`의 JSON이다. */
  const brokenWorks = (repo: string) =>
    new Set(
      (
        db
          .prepare("SELECT works FROM alerts WHERE repo = ? AND resolved IS NULL AND confirmed = 1")
          .all(repo) as {
          works: string;
        }[]
      ).flatMap((row) =>
        (JSON.parse(row.works) as WorkRef[]).map((work) =>
          JSON.stringify([work.login, work.branch]),
        ),
      ),
    );

  /** 붙어 있는 러너마다 마지막으로 올린 직접 충돌의 계산. 끊기면 지운다. 아직 올리지 않은 러너는 없다. */
  const reports = new Map<WSContext, ConflictPair[]>();

  /** 알림 하나의 채널 줄을 붙어 있는 웹 모두에 보낸다. */
  const shareAlert = (alert: number) =>
    shareRow(db.prepare(`${MESSAGES} WHERE m.alert = ?`).get(alert) as MessageRow);

  /** 포스트(채널 id)의 알림 줄을 붙어 있는 웹 모두에 다시 보낸다. 라벨이나 중요도가 바뀌었을 때 부른다. */
  const sharePost = (post: string) =>
    shareAlert(
      (
        db
          .prepare(
            "SELECT m.alert FROM channels c JOIN messages m ON m.id = c.alert WHERE c.id = ?",
          )
          .get(post) as { alert: number }
      ).alert,
    );
  /** 레포의 라벨 전부, 이름 순서. */
  const labelsView = (repo: string) =>
    db
      .prepare(
        "SELECT name, color, description, importance FROM labels WHERE repo = ? ORDER BY name",
      )
      .all(repo) as Label[];
  /** 레포의 라벨을 그 레포를 고른 웹에 보낸다. */
  const shareLabels = (repo: string) => {
    const frame = encode(serverToWeb, "labels", labelsView(repo));
    for (const [socket, watcher] of watchers)
      if (watcher.repo === repo && socket.readyState === 1) socket.send(frame); // OPEN
  };
  /** 레포의 라벨 하나(이름은 대소문자를 가리지 않는다). */
  const labelRow = (repo: string, name: string) =>
    db
      .prepare(
        "SELECT rowid AS id, name, github, color, description FROM labels WHERE repo = ? AND name = ?",
      )
      .get(repo, name) as
      | { id: number; name: string; github: number | null; color: string; description: string }
      | undefined;
  /**
   * 포스트마다 라벨을 고친다. `edit`이 포스트의 라벨과, 이슈가 있으면 마지막으로 읽은 이슈 라벨(`issue_labels`)에 똑같이 적용되고,
   * 이슈가 있는 포스트에서만 고칠지는 `withIssue`로 가린다(주지 않으면 모두). 바뀐 포스트의 id를 돌려준다.
   */
  const editPostLabels = (
    repo: string,
    edit: (labels: string[]) => string[],
    withIssue?: boolean,
  ) => {
    const rows = db
      .prepare(
        "SELECT id, labels, issue_labels, issue FROM channels WHERE alert IS NOT NULL AND repo = ?",
      )
      .all(repo) as {
      id: string;
      labels: string | null;
      issue_labels: string | null;
      issue: number | null;
    }[];
    const changed: string[] = [];
    for (const row of rows) {
      if (withIssue !== undefined && withIssue !== (row.issue !== null)) continue;
      const before = row.labels ?? "[]";
      const after = JSON.stringify(edit(JSON.parse(before)));
      const issue = row.issue_labels && JSON.stringify(edit(JSON.parse(row.issue_labels)));
      if (after === before && issue === row.issue_labels) continue;
      db.prepare("UPDATE channels SET labels = ?, issue_labels = ? WHERE id = ?").run(
        after,
        issue,
        row.id,
      );
      changed.push(row.id);
      openDebate(row.id); // 이슈에서 증거 라벨을 붙였으면 토론이 열린다(ADR-0040)
    }
    return changed;
  };
  /** 레포의 라벨 이름이 바뀌었다. 포스트와 이슈 라벨에서 이름을 바꾸고 웹에 알린다. */
  const renameLabel = (repo: string, from: string, to: string) => {
    for (const post of editPostLabels(repo, (labels) => labels.map((l) => (l === from ? to : l))))
      sharePost(post);
    // 그 라벨로 거르는 포럼도 새 이름을 따른다. 그 레포만 거르는 포럼은 이름을 바꾸고,
    // 다른 레포도 거르는 포럼은 다른 레포의 옛 이름 포스트를 잃지 않게 새 이름을 더한다.
    for (const row of db
      .prepare(
        "SELECT id, name, kind, filter FROM channels WHERE workspace = ? AND EXISTS (SELECT 1 FROM json_each(filter, '$.labels') j WHERE j.value = ?)",
      )
      .all(ownerOf(repo), from) as Parameters<typeof channelView>[0][]) {
      const old = JSON.parse(row.filter as string) as { labels: string[]; repos?: string[] };
      if (old.repos?.length && !old.repos.includes(repo)) continue;
      const only = (
        old.repos?.length ? old.repos : allRepos().filter((r) => ownerOf(r) === ownerOf(repo))
      ).every((r) => r === repo);
      const labels = only
        ? old.labels.map((l) => (l === from ? to : l))
        : [...old.labels, ...(old.labels.includes(to) ? [] : [to])];
      const filter = { ...old, labels: [...new Set(labels)] };
      db.prepare("UPDATE channels SET filter = ? WHERE id = ?").run(JSON.stringify(filter), row.id);
      broadcastChannel(ownerOf(repo), { ...row, filter: JSON.stringify(filter) });
    }
  };

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

  /** 러너에 넘기는 채널의 이름. 포스트면 알림의 번호로 짓는다. */
  const channelName = (channel: string) => {
    const alert = postAlert(channel);
    const name = (id: string) =>
      (db.prepare("SELECT name FROM channels WHERE id = ?").get(id) as { name: string }).name;
    return alert ? `알림 ${alert.id}번 포스트` : name(channel);
  };

  /**
   * 러너들의 계산을 두 작업 한 쌍과 종류마다 하나로 묶어 알림을 올리고, 고치고, 풀린 것을 닫는다(ADR-0023).
   * 알림에 묶인 것(직접 충돌의 파일, 나머지의 심볼)마다 그것을 계산할 수 있는 러너가 있다(`computedBy`).
   * 그 러너가 붙어 있는데 올리지 않았으면 풀린 것이고, 그 러너가 꺼져 있으면 알 수 없으니 지난 것을 그대로 둔다.
   * 직접 충돌과 중복 구현은 두 쪽 러너 모두, 간접 충돌은 쓰는 쪽 러너만 계산한다. 한 파일을 양쪽 러너가 올렸으면 줄이 확인된 쪽을 쓴다.
   */
  const reconcile = (repo: string) => {
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
    // 쌍의 두 끝은 서버가 아는 작업(관측이나 선점)이어야 한다. 모르는 작업을 이름 댄 쌍은 버린다.
    const knownWork = db.prepare(
      `SELECT 1 FROM (SELECT repo, login, branch FROM works UNION SELECT repo, login, branch FROM claims)
       WHERE repo = ? AND login = ? AND branch = ?`,
    );
    for (const [socket, pairs] of reports) {
      const runner = runners.get(socket);
      if (runner?.repo !== repo) continue;
      const { login } = runner;
      reporting.add(login);
      for (const pair of pairs) {
        if (!knownWork.get(repo, login, pair.branch)) continue;
        if (!knownWork.get(repo, pair.theirs.login, pair.theirs.branch)) continue;
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
      .prepare(
        "SELECT id, pair, kind, works, files FROM alerts WHERE repo = ? AND resolved IS NULL",
      )
      .all(repo) as {
      id: number;
      pair: string;
      kind: Alert["kind"];
      works: string;
      files: string;
    }[];
    let changed = false;
    const now = Date.now();
    // 통과로 닫힌 쌍(ADR-0035)은 다시 돌린 판정이 나올 때까지 세우지 않는다. 쓰는 쪽 러너가 붙어 있는데 그 쌍을 올리지 않으면 부딪힘이 풀린 것이라 놓아준다.
    const held = new Set<string>();
    for (const row of db
      .prepare("SELECT id, pair, run FROM alerts WHERE repo = ? AND held = 1")
      .all(repo) as {
      id: number;
      pair: string;
      run: string;
    }[]) {
      if (found.has(row.pair)) held.add(row.pair);
      else if (reporting.has((JSON.parse(row.run) as AlertRun).login))
        db.prepare("UPDATE alerts SET held = 0 WHERE id = ?").run(row.id);
    }
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
        deliver(repo, known.id, works, now);
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
      if (!known && held.has(key)) continue;
      changed = true;
      if (known) {
        db.prepare("UPDATE alerts SET files = ?, works = ?, updated = ? WHERE id = ?").run(
          json,
          JSON.stringify(works),
          now,
          known.id,
        );
        shareAlert(known.id);
        deliver(repo, known.id, works, now);
        continue;
      }
      db.exec("BEGIN");
      const { lastInsertRowid } = db
        .prepare(
          "INSERT INTO alerts (repo, pair, kind, works, files, updated) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(repo, key, kind, JSON.stringify(works), json, now);
      const message = db
        .prepare("INSERT INTO messages (channel, login, text, alert, at) VALUES (?, '', '', ?, ?)")
        .run(ALERTS, lastInsertRowid, now).lastInsertRowid;
      // 알림 하나가 포스트 하나다(ADR-0027). 포스트의 이름은 사람이 지을 수 없는 이름(줄바꿈으로 시작)이다.
      const post = randomBytes(8).toString("hex");
      db.prepare(
        "INSERT INTO channels (id, name, alert, labels, repo, workspace) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(post, `\n${post}`, message, JSON.stringify([ALERT_LABELS[kind]]), repo, ownerOf(repo));
      db.exec("COMMIT");
      shareAlert(Number(lastInsertRowid));
      deliver(repo, Number(lastInsertRowid), works, now);
      void attachTeamLabels(post).finally(() => syncSoon(post)); // 팀 라벨을 단 뒤 포스트의 이슈를 연다(ADR-0032)
      openDebate(post); // 계약 변경이면 토론이 열린다(ADR-0040)
    }
    if (changed) {
      shareMembers(); // 멤버 목록의 직접 충돌 표시
      shareInbox();
    }
  };

  /**
   * 러너가 올린 합쳐 돌려 보기의 판정을 그 쌍의 열린 간접 충돌 알림에 붙인다(ADR-0035, ADR-0036). 판정이 나면(돌려 보는 중도 지난 결과도 아닌 것) 두 작업의 편지함에 다시 넣는다.
   * - 빠진 파일 없이 깨짐이면 확인됨, 빠진 파일 없이 통과면 알림을 풀림으로 닫고 그 쌍을 붙든다(`held`). 그 밖의 판정은 추정으로 둔다.
   * - 붙든 쌍은 열린 알림이 없다. 다른 지문의 판정이 나면 놓아주고, 통과가 아니면 새 알림을 세워 그 판정을 붙인다.
   * - 열린 알림도 붙든 쌍도 없으면 버린다. 확인됨은 다음 판정이 날 때까지 남는다(돌려 보는 중이나 지난 결과로는 바뀌지 않는다).
   */
  const attachRun = (
    repo: string,
    login: string,
    { branch, theirs, run }: Extract<Message<typeof runnerToServer>, { kind: "merged" }>["payload"],
  ) => {
    const mine = { login, branch };
    const flip = JSON.stringify([login, branch]) > JSON.stringify([theirs.login, theirs.branch]);
    const [a, b] = flip ? [theirs, mine] : [mine, theirs];
    const key = `indirect ${JSON.stringify([a.login, a.branch, b.login, b.branch])}`;
    // 판정 수(지표). 열린 알림이 없어도 돌린 것이라 센다. 돌려 보는 중과 같은 지문의 다시 올림은 세지 않는다.
    if (run.verdict !== "running")
      db.prepare(
        "INSERT OR IGNORE INTO merge_runs (fingerprint, verdict, at, workspace) VALUES (?, ?, ?, ?)",
      ).run(run.fingerprint, run.verdict, Date.now(), ownerOf(repo));
    const finished = run.verdict !== "running" && !run.stale;
    const closes = finished && run.verdict === "pass" && run.omitted.length === 0;
    type Row = { id: number; works: string; files: string; run: string | null; confirmed: number };
    // 판정은 그 쌍을 계산하는 쪽(쓰는 쪽) 러너의 것만 받는다. 다른 쪽이 보낸 것은 버린다.
    const computes = (row: Row) =>
      (JSON.parse(row.files) as AlertSymbol[]).some((symbol) =>
        computedBy("indirect", symbol, JSON.parse(row.works)).includes(login),
      );
    const openRow = () =>
      db
        .prepare(
          "SELECT id, works, files, run, confirmed FROM alerts WHERE repo = ? AND pair = ? AND resolved IS NULL",
        )
        .get(repo, key) as Row | undefined;
    let row = openRow();
    if (row && !computes(row)) return;
    const now = Date.now();
    if (!row) {
      const held = db
        .prepare("SELECT id, run FROM alerts WHERE repo = ? AND pair = ? AND held = 1")
        .get(repo, key) as { id: number; run: string } | undefined;
      if (
        !held ||
        !finished ||
        (JSON.parse(held.run) as AlertRun).fingerprint === run.fingerprint ||
        (JSON.parse(held.run) as AlertRun).login !== login
      )
        return;
      if (closes) {
        // 다시 돌려도 통과다. 닫힌 알림의 판정만 새것으로 둔다.
        db.prepare("UPDATE alerts SET run = ? WHERE id = ?").run(
          JSON.stringify({ ...run, login, at: new Date(now).toISOString() }),
          held.id,
        );
        shareAlert(held.id);
        shareRuns(repo, login);
        return;
      }
      db.prepare("UPDATE alerts SET held = 0 WHERE id = ?").run(held.id);
      reconcile(repo); // 그 쌍을 아직 올리고 있으면 새 알림이 선다
      row = openRow();
      if (!row || !computes(row)) return;
    }
    const next = { ...run, login };
    const { at: _, ...known } = row.run ? (JSON.parse(row.run) as AlertRun) : {};
    if (JSON.stringify(known) === JSON.stringify(next)) return; // 같은 것을 다시 올렸다
    const confirmed = finished
      ? Number(run.verdict === "broken" && run.omitted.length === 0)
      : row.confirmed;
    if (closes) db.prepare("UPDATE alerts SET held = 0 WHERE repo = ? AND pair = ?").run(repo, key);
    db.prepare(
      "UPDATE alerts SET run = ?, confirmed = ?, resolved = ?, held = ?, updated = ? WHERE id = ?",
    ).run(
      JSON.stringify({ ...next, at: new Date(now).toISOString() }),
      confirmed,
      closes ? now : null,
      Number(closes),
      now,
      row.id,
    );
    if (confirmed !== row.confirmed) {
      // 확인됨 라벨을 붙이거나 뗀다(ADR-0039). 논의가 되면 이슈를 연다.
      const post = db
        .prepare(
          "SELECT c.id, c.labels FROM channels c JOIN messages m ON m.id = c.alert WHERE m.alert = ?",
        )
        .get(row.id) as { id: string; labels: string | null };
      const labels = (JSON.parse(post.labels ?? "[]") as string[]).filter(
        (label) => label !== CONFIRMED_LABEL,
      );
      if (confirmed) labels.push(CONFIRMED_LABEL);
      db.prepare("UPDATE channels SET labels = ? WHERE id = ?").run(
        JSON.stringify(labels),
        post.id,
      );
      syncSoon(post.id);
      openDebate(post.id); // 확인되면 토론이 열린다(ADR-0040)
    }
    shareAlert(row.id);
    if (!finished) return;
    deliver(repo, row.id, JSON.parse(row.works), now);
    shareInbox();
    shareRuns(repo, login);
    if (closes || confirmed !== row.confirmed) shareMembers(); // 멤버 목록의 "합치면 깨짐"
  };

  /** 이 멤버의 그 레포 러너들에 서버에 붙은 그 멤버의 판정들을 보낸다(`runs`). 같은 지문은 다시 돌리지 않게 한다. `to`를 주면 그 연결에만. */
  const shareRuns = (repo: string, login: string, to?: WSContext) => {
    const runs = (
      db
        .prepare(
          "SELECT run FROM alerts WHERE repo = ? AND run IS NOT NULL AND (resolved IS NULL OR held = 1)",
        )
        .all(repo) as { run: string }[]
    ).flatMap((row) => {
      const { login: by, at: _, ...run } = JSON.parse(row.run) as AlertRun;
      return by === login && run.verdict !== "running" && !run.stale ? [run] : [];
    });
    const frame = encode(serverToRunner, "runs", { runs });
    for (const [socket, runner] of runners)
      if (
        runner.repo === repo &&
        runner.login === login &&
        (!to || socket === to) &&
        socket.readyState === 1
      )
        socket.send(frame);
  };

  /** 알림이 생기거나 바뀌거나 풀렸다. 두 작업의 편지함에 넣는다. 아직 넘겨주지 않은 같은 알림의 소식은 새 것으로 바꾼다. */
  const deliver = (repo: string, alert: number, works: WorkRef[], now: number) => {
    for (const { login, branch } of works) {
      db.prepare("DELETE FROM inbox WHERE login = ? AND branch = ? AND alert = ?").run(
        login,
        branch,
        alert,
      );
      db.prepare("INSERT INTO inbox (repo, login, branch, alert, at) VALUES (?, ?, ?, ?, ?)").run(
        repo,
        login,
        branch,
        alert,
        now,
      );
    }
  };

  const inboxMs = options.inboxMs ?? INBOX_MS;
  /** 멤버의 그 레포 편지함 전부: 만료되지 않은 것을 들어온 순서로. */
  const inboxOf = (repo: string, login: string): InboxItem[] =>
    (
      db
        .prepare(
          `SELECT i.id, i.branch, i.at, i.news, a.kind, a.works, a.files, a.resolved, a.run, a.confirmed FROM inbox i
           LEFT JOIN alerts a ON a.id = i.alert WHERE i.repo = ? AND i.login = ? AND i.at > ? ORDER BY i.id`,
        )
        .all(repo, login, Date.now() - inboxMs) as {
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
  /** 토론의 소식을 토론의 두 작업의 편지함에 넣는다(`only`가 있으면 그 자리들에만). */
  const debateNews = (
    debate: number,
    news: Omit<Extract<InboxItem, { kind: "debate" }>, "id" | "branch" | "at">,
    only?: number[],
  ) => {
    const now = Date.now();
    const repo = debateRepo(debate);
    for (const seat of seatsOf(debate)) {
      if (only && !only.includes(seat.seat)) continue;
      db.prepare("INSERT INTO inbox (repo, login, branch, news, at) VALUES (?, ?, ?, ?, ?)").run(
        repo,
        seat.login,
        seat.branch,
        JSON.stringify(news),
        now,
      );
    }
    shareInbox();
  };
  /** 러너마다 마지막으로 보낸 편지함. 같은 것을 다시 보내지 않는다. */
  const sentInbox = new Map<WSContext, string>();
  /** 편지함이 달라진 러너에 그 멤버의 편지함을 보낸다. `to`(막 붙은 러너)에는 같아도 보낸다. */
  const shareInbox = (to?: WSContext) => {
    for (const [socket, { login, repo }] of runners) {
      if (socket.readyState !== 1) continue; // OPEN
      const items = inboxOf(repo, login);
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
    repo: string;
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
    db.prepare("INSERT INTO inbox (repo, login, branch, news, at) VALUES (?, ?, ?, ?, ?)").run(
      row.repo,
      row.login,
      row.branch,
      JSON.stringify({ kind: "answer", question, answer }),
      now,
    );
    shareInbox();
  };
  /**
   * 멤버의 그 레포 러너 가운데 마지막에 붙은 것이 그 실행기(고르지 않았으면 첫째 실행기)로 답할 수 있으면 그 연결과 실행기.
   * 실행기를 하나도 알리지 않은 러너는 답할 수 없는 것으로 친다(자리를 비운 것과 같다).
   */
  const answererOf = (target: string, executor: ExecutorId | null, repo: string) => {
    const found = [...runners].findLast(
      ([, runner]) =>
        runner.login === target &&
        runner.repo === repo &&
        runner.executors.length > 0 &&
        (executor === null || runner.executors.includes(executor)),
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
      const answerer = answererOf(target, row.executor, row.repo);
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
  type SeatRow = {
    debate: number;
    seat: number;
    login: string;
    branch: string;
    state: DebateSeat["state"];
    stance: string | null;
    error: string | null;
    proxy: string | null;
  };
  type DebateRow = {
    id: number;
    post: string;
    round: number;
    at: number;
    state: Debate["state"];
    flip: number;
    winner: number | null;
    by: DebateConclusion["by"] | null;
    chooser: string | null;
    decided: number | null;
    expired: number;
  };
  /** 토론의 라운드 수(문답 A13). 서버 설정으로 줄일 수 있다. */
  const debateRounds = Math.max(1, options.debateRounds ?? DEBATE_ROUNDS);
  /** 러너에 보내고 입장을 기다리는 토론 참여 요청. 키는 보낸 `debate`의 id다. 연결이 끊기거나 서버가 다시 뜨면 잃고, 러너가 붙을 때 다시 보낸다. */
  const debatesSent = new Map<
    string,
    { socket: WSContext; executor: ExecutorId; debate: number; seat: number; proxy: string | null }
  >();
  /** 자리가 라운드마다 낸 입장. */
  const stancesOf = (seat: SeatRow): Stance[] => {
    const stored = seat.stance === null ? [] : JSON.parse(seat.stance);
    return Array.isArray(stored) ? stored : [stored];
  };
  const seatsOf = (debate: number) =>
    db.prepare("SELECT * FROM seats WHERE debate = ? ORDER BY seat").all(debate) as SeatRow[];
  /** 토론의 레포: 그 포스트의 레포다. */
  const debateRepo = (debate: number) =>
    (
      db
        .prepare("SELECT c.repo FROM debates d JOIN channels c ON c.id = d.post WHERE d.id = ?")
        .get(debate) as { repo: string }
    ).repo;
  /** 안이 되는 자리: 입장을 하나라도 낸 자리, 섞어 둔 순서(`flip`)대로. 첫 라운드의 입장이 공개된 뒤로 바뀌지 않는다. */
  const optionSeats = (row: DebateRow, seats: SeatRow[]) =>
    (row.flip ? [...seats].reverse() : seats).filter((seat) => stancesOf(seat).length > 0);
  /** 공개된 라운드 수: 그 라운드에 기다리는 자리가 있으면 그 라운드는 아직 가린다. */
  const shownOf = (row: DebateRow, seats: SeatRow[]) =>
    seats.some((seat) => seat.state === "waiting") ? row.round - 1 : row.round;
  /**
   * 포스트의 토론. 라운드의 입장은 그 라운드에 기다리는 자리가 없을 때 싣는다. 안의 주인도 함께 싣고, 화면이 결론 전까지 덮어 둔다(ADR-0040, #202).
   */
  const debateOf = (post: string): Debate | null => {
    const row = db.prepare("SELECT * FROM debates WHERE post = ?").get(post) as
      | DebateRow
      | undefined;
    if (!row) return null;
    const seats = seatsOf(row.id);
    const shown = shownOf(row, seats);
    const concluded = row.state === "concluded";
    const options = shown === 0 ? [] : optionSeats(row, seats);
    return {
      id: row.id,
      state: row.expired ? "expired" : row.state,
      round: row.round,
      rounds: debateRounds,
      revealed: shown > 0,
      seats: seats.map((seat) => ({
        login: seat.login,
        name: nameOf(seat.login),
        branch: seat.branch,
        state: seat.state,
        ...(seat.error !== null && { error: JSON.parse(seat.error) }),
        ...(seat.proxy !== null && { proxy: { login: seat.proxy, name: nameOf(seat.proxy) } }),
        ...(row.state === "open" &&
          seat.state === "waiting" &&
          !answererOf(seat.proxy ?? seat.login, null, postRepo(post) ?? "") && {
            away: true as const,
          }),
      })) as [DebateSeat, DebateSeat],
      options: options.map((seat) => ({
        stances: stancesOf(seat).slice(0, shown),
        owner: { login: seat.login, name: nameOf(seat.login), branch: seat.branch },
      })),
      ...(concluded && {
        conclusion: {
          option: options.findIndex((seat) => seat.seat === row.winner),
          by: row.by ?? "choice",
          ...(row.chooser !== null && {
            chooser: { login: row.chooser, name: nameOf(row.chooser) },
          }),
          at: new Date(row.decided ?? row.at).toISOString(),
        },
      }),
      at: new Date(row.at).toISOString(),
    };
  };
  const requestOf = (post: string): DebateRequest | null => {
    const row = db.prepare("SELECT * FROM debate_requests WHERE post = ?").get(post) as
      | { login: string; agenda: string; grounds: string; opened: number; at: number }
      | undefined;
    return row
      ? {
          login: row.login,
          name: nameOf(row.login),
          agenda: row.agenda,
          grounds: row.grounds,
          opened: row.opened === 1,
          at: new Date(row.at).toISOString(),
        }
      : null;
  };
  /**
   * 포스트에 증거 라벨이 붙었으면 토론을 연다(ADR-0040). 중요도와 상관없다. 이미 열린 토론이 있으면 그대로 둔다.
   * 자리는 알림의 두 작업이다. 자동 참여 스위치(묻기 스위치)를 끈 주인의 자리는 나오지 않는다. 안의 순서는 무작위로 섞는다.
   */
  const openDebate = (post: string, requested = false) => {
    const row = db
      .prepare(
        "SELECT c.labels, a.works FROM channels c JOIN messages m ON m.id = c.alert JOIN alerts a ON a.id = m.alert WHERE c.id = ?",
      )
      .get(post) as { labels: string | null; works: string } | undefined;
    if (!row) return;
    const labels: string[] = JSON.parse(row.labels ?? "[]");
    if (!requested && !labels.some((label) => EVIDENCE_LABELS.includes(label))) return;
    if (db.prepare("SELECT 1 FROM debates WHERE post = ?").get(post)) return;
    const works: WorkRef[] = JSON.parse(row.works);
    const debate = Number(
      db
        .prepare("INSERT INTO debates (post, at, flip) VALUES (?, ?, ?)")
        .run(post, Date.now(), randomInt(2)).lastInsertRowid,
    );
    const seat = db.prepare(
      "INSERT INTO seats (debate, seat, login, branch, state) VALUES (?, ?, ?, ?, ?)",
    );
    for (const [i, work] of works.entries()) {
      const off = db.prepare("SELECT 1 FROM ask_off WHERE login = ?").get(work.login);
      seat.run(debate, i, work.login, work.branch, off ? "off" : "waiting");
    }
    debateNews(debate, {
      kind: "debate",
      event: "opened",
      post: { id: post, name: channelName(post) },
    });
    for (const work of works) dispatchDebates(work.login);
    advance(debate); // 두 자리가 다 나오지 않으면 바로 끝난다
  };
  /** 토론의 자리 하나를 이 라운드에서 끝낸다(입장을 냈거나 내지 못했다). 이미 끝났으면 그대로 둔다. */
  const settleSeat = (
    debate: number,
    seat: number,
    result: { stance: Stance } | { error: ContractError },
  ) => {
    if (stopped) return;
    const row = db
      .prepare(
        "SELECT s.* FROM seats s JOIN debates d ON d.id = s.debate WHERE s.debate = ? AND s.seat = ? AND s.state = 'waiting' AND d.state = 'open'",
      )
      .get(debate, seat) as SeatRow | undefined;
    if (!row) return;
    db.prepare(
      "UPDATE seats SET state = ?, stance = ?, error = ? WHERE debate = ? AND seat = ?",
    ).run(
      "stance" in result ? "submitted" : "failed",
      JSON.stringify("stance" in result ? [...stancesOf(row), result.stance] : stancesOf(row)),
      "error" in result ? JSON.stringify(result.error) : null,
      debate,
      seat,
    );
    advance(debate);
    shareDebates();
  };
  /**
   * 라운드에 기다리는 자리가 없으면 다음으로 간다(ADR-0040, 구현 7장). 두 자리가 다 냈고 라운드가 남았으면 반박 라운드를 연다.
   * 아니면 끝낸다: 마지막 입장의 실험이 한 안만 통과했으면 그 안이, 아니면 마지막 입장에 검증된 근거가 있는 안이 하나뿐이면 그 안이 결론이고,
   * 아니면 사람이 고를 차례다. 낸 입장이 없으면 끝난다.
   */
  const advance = (debate: number) => {
    const row = db.prepare("SELECT * FROM debates WHERE id = ?").get(debate) as DebateRow;
    if (row.state !== "open") return;
    const seats = seatsOf(debate);
    if (seats.some((seat) => seat.state === "waiting")) return;
    const going = seats.filter((seat) => seat.state === "submitted");
    if (going.length === 2 && row.round < debateRounds) {
      db.prepare("UPDATE debates SET round = round + 1 WHERE id = ?").run(debate);
      db.prepare("UPDATE seats SET state = 'waiting' WHERE debate = ? AND state = 'submitted'").run(
        debate,
      );
      // 부재자의 러너가 붙어 있으면 진짜 에이전트가 이 라운드부터 대행의 자리를 이어받는다(문답 A18).
      for (const seat of going)
        if (seat.proxy !== null && answererOf(seat.login, null, debateRepo(debate))) {
          db.prepare("UPDATE seats SET proxy = NULL WHERE debate = ? AND seat = ?").run(
            debate,
            seat.seat,
          );
          seat.proxy = null;
        }
      const post = { id: row.post, name: channelName(row.post) };
      const turn = { kind: "debate", event: "turn", post, round: row.round + 1 } as const;
      debateNews(
        debate,
        turn,
        going.map((seat) => seat.seat),
      );
      for (const seat of going) dispatchDebates(seat.proxy ?? seat.login);
      syncSoon(row.post); // 지난 라운드가 공개됐다
      return;
    }
    const options = optionSeats(row, seats);
    const lastOf = (seat: SeatRow) => stancesOf(seat).at(-1);
    // 실험이 한 안만 통과했으면 그 안, 아니면 검증된 근거가 한 안에만 있으면 그 안이다(ADR-0040의 순서).
    const passed = options.filter((seat) => lastOf(seat)?.experiment?.verdict === "pass");
    const backed = options.filter((seat) =>
      lastOf(seat)?.evidence.some((e) => e.mark === "verified"),
    );
    const [winner, by] =
      passed.length === 1
        ? [passed[0], "experiment" as const]
        : backed.length === 1
          ? [backed[0], "evidence" as const]
          : [];
    if (winner && by) {
      db.prepare(
        "UPDATE debates SET state = 'concluded', winner = ?, by = ?, decided = ? WHERE id = ?",
      ).run(winner.seat, by, Date.now(), debate);
      concluded(debate);
    } else {
      db.prepare("UPDATE debates SET state = ? WHERE id = ?").run(
        options.length > 0 ? "choosing" : "ended",
        debate,
      );
      syncSoon(row.post); // 마지막 라운드가 공개됐다
    }
  };
  /** 결론이 났다: 두 작업의 편지함에 소식을 넣고 이슈에 올린다. */
  const concluded = (debate: number) => {
    const row = db.prepare("SELECT * FROM debates WHERE id = ?").get(debate) as DebateRow;
    const winner = seatsOf(debate).find((seat) => seat.seat === row.winner);
    debateNews(debate, {
      kind: "debate",
      event: "concluded",
      post: { id: row.post, name: channelName(row.post) },
      by: row.by ?? "choice",
      ...(winner && { winner: { login: winner.login, branch: winner.branch } }),
    });
    syncSoon(row.post);
  };
  /**
   * 멤버(`login`)의 기다리는 자리에 토론 참여 요청을 그 멤버의 러너에 보낸다. 반박 라운드면 지난 라운드의 두 입장을 싣는다.
   * 스위치가 꺼졌으면 보내지 않고 나오지 않는 자리로 둔다. 받을 러너가 없으면 남겨 두고 붙을 때 보낸다.
   */
  const dispatchDebates = (login: string) => {
    const rows = db
      .prepare(
        `SELECT s.*, d.post, d.round, c.repo FROM seats s JOIN debates d ON d.id = s.debate
         JOIN channels c ON c.id = d.post
         WHERE COALESCE(s.proxy, s.login) = ? AND s.state = 'waiting' AND d.state = 'open'
         ORDER BY s.debate, s.seat`,
      )
      .all(login) as (SeatRow & { post: string; round: number; repo: string })[];
    const sent = new Set([...debatesSent.values()].map((d) => `${d.debate} ${d.seat}`));
    const off = new Set<number>();
    for (const row of rows) {
      if (sent.has(`${row.debate} ${row.seat}`)) continue;
      // 대행은 부른 멤버가 일부러 부른 것이라 스위치를 보지 않는다(문답 A12).
      if (row.proxy === null && db.prepare("SELECT 1 FROM ask_off WHERE login = ?").get(login)) {
        db.prepare("UPDATE seats SET state = 'off' WHERE debate = ? AND seat = ?").run(
          row.debate,
          row.seat,
        );
        off.add(row.debate);
        continue;
      }
      const answerer = answererOf(login, null, row.repo);
      if (!answerer) continue;
      const other = seatsOf(row.debate).find((seat) => seat.seat !== row.seat);
      const mine = stancesOf(row)[row.round - 2];
      const theirs = other && stancesOf(other)[row.round - 2];
      const frame = encode(serverToRunner, "debate", {
        debate: row.debate,
        round: row.round,
        executor: answerer.executor,
        branch: row.branch,
        post: { id: row.post, name: channelName(row.post) },
        // 토론의 입장은 검토 없이 공개로 올라가므로, 멤버가 아닌 사람이 GitHub에 단 댓글은 넣지 않는다.
        messages: recentOf(row.post).filter(
          (m) =>
            !(
              m.kind === "text" &&
              m.github &&
              !db.prepare("SELECT 1 FROM sessions WHERE login = ?").get(m.login)
            ),
        ),
        ...(mine && { mine }),
        ...(theirs && { theirs }),
        against: { login: other?.login ?? "", branch: other?.branch ?? "" },
        ...(row.proxy !== null && {
          proxy: {
            for: { login: row.login, name: nameOf(row.login) },
            work:
              worksView(row.repo).find((w) => w.login === row.login && w.branch === row.branch) ??
              null,
          },
        }),
      });
      debatesSent.set((JSON.parse(frame) as { id: string }).id, {
        ...answerer,
        debate: row.debate,
        seat: row.seat,
        proxy: row.proxy,
      });
      answerer.socket.send(frame);
    }
    for (const debate of off) advance(debate);
    shareMembers(); // 답하는 중
  };
  /** 멤버의 GitHub 프로필 이름. 모르면 `login`이다. */
  const nameOf = (login: string) =>
    (
      db.prepare("SELECT name FROM people WHERE login = ?").get(login) as
        | { name: string }
        | undefined
    )?.name ?? login;

  /** 레포마다 웹에 마지막으로 보낸 멤버 목록. 같은 것을 다시 보내지 않는다. */
  const sentMembers = new Map<string, string>();
  /**
   * 레포마다 멤버 목록이 달라졌으면 그 레포를 고른 웹 모두에게 보낸다. 그대로면 `to`(막 붙은 웹)에게만 보낸다.
   * 상황이 바뀌는 곳은 `shareSituation`이 부르고, 에이전트만 바뀌는 곳(문답의 시작과 끝)은 따로 부른다.
   * `works`는 레포마다 이미 읽은 작업이다.
   */
  // ponytail: 달라질 때마다 레포마다 목록 전부를 보낸다. 멤버와 작업이 많아지면 사람마다의 차이만 보낸다.
  const shareMembers = (to?: WSContext, works = new Map<string, WorkView[]>()) => {
    for (const repo of allRepos()) {
      const members = membersView(repo, works.get(repo) ?? worksView(repo));
      const json = JSON.stringify(members);
      const changed = json !== sentMembers.get(repo);
      sentMembers.set(repo, json);
      const frame = encode(serverToWeb, "members", { members });
      for (const [socket, watcher] of watchers)
        if (
          watcher.repo === repo &&
          socket.readyState === 1 && // OPEN
          (changed || socket === to)
        )
          socket.send(frame);
    }
    shareDebates(); // 러너가 붙거나 떨어지면 기다리는 자리의 `away`가 바뀐다
  };

  /** 웹에 마지막으로 보낸 포스트마다의 토론과 요청. 같은 것을 다시 보내지 않는다. */
  const sentDebates = new Map<string, string>();
  /** 토론이나 요청이 바뀐 포스트를 붙어 있는 웹 모두에 보낸다. */
  // ponytail: 부를 때마다 토론 전부를 다시 계산한다. 토론이 수백 개가 되면 바뀐 포스트만 넘겨받는다.
  const shareDebates = () => {
    const posts = db
      .prepare("SELECT post FROM debates UNION SELECT post FROM debate_requests")
      .all() as { post: string }[];
    for (const { post } of posts) {
      const payload = { post, debate: debateOf(post), request: requestOf(post) };
      const json = JSON.stringify(payload);
      if (sentDebates.get(post) === json) continue;
      sentDebates.set(post, json);
      broadcastTo(postRepo(post) ?? "", encode(serverToWeb, "debate", payload));
    }
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

  /** 레포마다 러너에 마지막으로 보낸 상황. 같은 것을 다시 보내지 않는다. */
  const sent = new Map<string, string>();
  /**
   * 상황(작업 전부)이 달라졌으면 붙어 있는 러너 모두에게 보낸다. 그대로면 `to`(막 붙은 러너)에게만 보낸다.
   * 상황을 바꾸는 곳(관측, 상태 한 줄, 오프라인, 멤버 자격, GitHub 따라가기)마다 부른다.
   * 닫히는 중인 연결(내보낸 멤버의 러너)에는 보내지 않는다.
   */
  // ponytail: 달라질 때마다 작업 전부(내용 포함)를 러너마다 보낸다. 멤버와 큰 작업이 많아지면 작업마다의 차이만 보낸다.
  const shareSituation = (to?: WSContext) => {
    const all = new Map(allRepos().map((repo) => [repo, worksView(repo)]));
    shareMembers(undefined, all); // 멤버 목록은 상황에서 나온다
    for (const [repo, works] of all) {
      const claims = claimsView(repo);
      const json = JSON.stringify([works, claims]);
      const changed = json !== sent.get(repo);
      sent.set(repo, json);
      const frame = encode(serverToRunner, "situation", { works, claims });
      for (const [socket, runner] of runners)
        if (
          runner.repo === repo &&
          socket.readyState === 1 && // OPEN
          (changed || socket === to)
        )
          socket.send(frame);
    }
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

  /**
   * 멤버가 워크스페이스의 레포마다 push 권한이 있는지 `token`으로 읽어 적는다(ADR-0043). GitHub이 답하지 못한 레포는 지난 것을 둔다.
   * `push`는 권한이 있는 레포, `unknown`은 답하지 못한 레포다.
   */
  const readAccess = async (login: string, token: string) => {
    const push: string[] = [];
    const unknown: string[] = [];
    for (let repo of allRepos()) {
      let can = await github.canPush(token, repo);
      if (stopped) break;
      // 같은 이름의 다른 레포(id가 다르다)에는 권한이 없는 것으로 본다. 옮기지도 않는다.
      if (can?.id !== undefined && !sameRepo(repo, can.id)) can = { push: false, name: repo };
      if (can && can.name !== repo && moveRepo(repo, can.name)) repo = can.name;
      if (can?.account)
        db.prepare("UPDATE workspaces SET kind = ?, avatar = ? WHERE id = ?").run(
          can.account.kind,
          can.account.avatar,
          ownerOf(repo),
        );
      if (can === undefined) unknown.push(repo);
      else if (can.push) {
        push.push(repo);
        db.prepare("INSERT OR IGNORE INTO access (login, repo) VALUES (?, ?)").run(login, repo);
      } else db.prepare("DELETE FROM access WHERE login = ? AND repo = ?").run(login, repo);
    }
    return { push, unknown };
  };

  /**
   * 레포마다인 API를 부른 레포(ADR-0043): `REPO_HEADER`에 실린 것 가운데 부른 사람에게 보이는 첫 레포,
   * 머리말이 없으면 보이는 첫 레포다. 없으면 `not_found`다.
   */
  const repoOf = (c: Context<Env>) => {
    const login = c.get("login") as string;
    const wantedSpace = workspaceHeader(c, login);
    const mine = reposOf(login).filter((repo) => !wantedSpace || ownerOf(repo) === wantedSpace);
    const wanted = (c.req.header(REPO_HEADER) ?? "")
      .split(",")
      .map((repo) => current(repo.trim()).toLowerCase())
      .filter(Boolean);
    const found =
      wanted.length === 0
        ? mine[0]
        : wanted.map((w) => mine.find((repo) => repo.toLowerCase() === w)).find(Boolean);
    if (!found)
      throw new ContractFailure({
        code: "not_found",
        message: `보이는 레포가 없다${wanted.length > 0 ? `: ${wanted.join(", ")}` : ""}`,
      });
    return found;
  };
  /** `WORKSPACE_HEADER`에 실린 워크스페이스. 없으면 없다. 부른 사람의 워크스페이스가 아니면 `not_found`다. */
  const workspaceHeader = (c: Context<Env>, login: string) => {
    const wanted = c.req.header(WORKSPACE_HEADER)?.trim().toLowerCase();
    if (wanted && !workspacesOf(login).includes(wanted))
      throw new ContractFailure({
        code: "not_found",
        message: `들어가 있지 않은 워크스페이스다: ${wanted}`,
      });
    return wanted || undefined;
  };
  /**
   * 워크스페이스마다인 API(채널, 포럼, 지표)와 방문을 부른 워크스페이스(ADR-0043): `WORKSPACE_HEADER`, 없으면 `REPO_HEADER`가 고른 레포의 워크스페이스,
   * 그것도 없으면 들어간 첫 워크스페이스다. 레포마다인 API는 이 워크스페이스의 레포만 고른다(`repoOf`).
   */
  const workspaceOf = (c: Context<Env>) => {
    const login = c.get("login") as string;
    const wanted = workspaceHeader(c, login);
    if (wanted) return wanted;
    const mine = reposOf(login);
    const named = (c.req.header(REPO_HEADER) ?? "")
      .split(",")
      .map((repo) => current(repo.trim()).toLowerCase())
      .filter(Boolean)
      .flatMap((w) => mine.find((repo) => repo.toLowerCase() === w) ?? []);
    const found = named[0] ?? mine[0];
    if (!found)
      throw new ContractFailure({ code: "not_found", message: "들어간 워크스페이스가 없다" });
    return ownerOf(found);
  };

  mount(app, api.login, async (_, c) => {
    const now = Date.now();
    for (const [device, pending] of logins)
      if (pending.expiresAt < now || now - pending.polledAt > ABANDONED_LOGIN_MS)
        logins.delete(device);
    // Fly 앞단은 Fly-Client-IP를 덮어써 보낸다(배포에서 확인할 것). Fly 위에서 돌 때만 믿고, 아니면 연결의 주소다.
    // Fly가 아닌 곳에서 믿으면 요청마다 헤더를 바꿔 주소마다의 상한을 넘을 수 있다.
    const socketAddress =
      (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
        ?.socket?.remoteAddress ?? "";
    const client = (options.behindFly && c.req.header("fly-client-ip")) || socketAddress;
    const mine =
      [...logins.values()].filter((pending) => pending.client === client).length +
      (startingFrom.get(client) ?? 0);
    if (logins.size + startingLogins >= MAX_PENDING_LOGINS || mine >= MAX_PENDING_PER_CLIENT) {
      throw new ContractFailure({
        code: "internal",
        message: "로그인이 밀려 있다. 잠시 뒤 다시 하라",
      });
    }
    // GitHub을 기다리기 전에 전체와 주소마다의 자리를 잡는다. 기다리는 사이에 온 요청도 그 자리를 센다.
    startingLogins++;
    startingFrom.set(client, (startingFrom.get(client) ?? 0) + 1);
    const started = await github.startDevice().finally(() => {
      startingLogins--;
      const left = (startingFrom.get(client) ?? 1) - 1;
      if (left > 0) startingFrom.set(client, left);
      else startingFrom.delete(client);
    });
    const device = randomBytes(16).toString("hex");
    logins.set(device, {
      deviceCode: started.deviceCode,
      expiresAt: now + started.expiresInMs,
      intervalMs: started.intervalMs,
      nextPollAt: now + started.intervalMs,
      client,
      polledAt: now,
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
    pending.polledAt = Date.now();
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

    const { id, login, name, avatar } = await github.user(polled.token);
    // GitHub 이름은 바꾸면 다른 사람이 가져갈 수 있다. 이 이름을 다른 계정이 쓰던 것이면 그 사람의 것을 이어받지 않게 막는다.
    const known = db.prepare("SELECT github_id FROM people WHERE login = ?").get(login) as
      | { github_id: number | null }
      | undefined;
    if (known?.github_id != null && known.github_id !== id)
      throw new ContractFailure({
        code: "forbidden",
        message: `${login}는 이 서버에서 다른 GitHub 계정이 쓰던 이름이라 들어올 수 없다`,
      });
    const access = await readAccess(login, polled.token);
    if (access.unknown.length > 0 && access.push.length === 0) {
      throw new ContractFailure({
        code: "internal",
        message: "GitHub에서 push 권한을 확인하지 못했다. 잠시 뒤 다시 하라",
      });
    }
    if (access.push.length === 0) {
      throw new ContractFailure({
        code: "forbidden",
        // 서버의 레포 이름은 싣지 않는다. 들어오지 못한 사람에게 비공개 레포의 이름이 새지 않는다.
        message: `${login}는 이 서버의 워크스페이스 레포 어디에도 push 권한이 없어 들어올 수 없다`,
      });
    }
    const session = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (hash, login, github_token) VALUES (?, ?, ?)").run(
      hash(session),
      login,
      polled.token,
    );
    db.prepare(
      "INSERT OR REPLACE INTO people (login, name, avatar, github_id) VALUES (?, ?, ?, ?)",
    ).run(login, name ?? login, avatar, id);
    shareSituation(); // 빠졌다 돌아온 멤버의 작업이 다시 보인다
    return { session, login };
  });

  mount(app, api.me, (_, c) => {
    const login = c.get("login") as string;
    const person = db.prepare("SELECT name, avatar FROM people WHERE login = ?").get(login) as
      | { name: string; avatar: string | null }
      | undefined;
    const repos = reposOf(login);
    return {
      login,
      name: person?.name ?? login,
      avatar: person?.avatar ?? null,
      repo: repos[0] ?? "",
      repos,
      gif: !!options.giphy,
    };
  });

  // 브라우저 대신 서버가 키를 붙여 GIPHY에 묻는다. 키는 서버 밖으로 나가지 않고, 찾은 결과는 쌓아 두지 않는다(ADR-0044).
  mount(app, api.gifs, ({ query }) => {
    if (!options.giphy) {
      throw new ContractFailure({ code: "not_found", message: "이 서버에는 GIPHY 키가 없다" });
    }
    return options.giphy.search(query).then((gifs) => ({ gifs }));
  });

  mount(app, api.workspaces, (_, c) => {
    const repos = reposOf(c.get("login") as string);
    const rows = new Map(
      (
        db.prepare("SELECT id, name, kind, avatar FROM workspaces").all() as {
          id: string;
          name: string;
          kind: "organization" | "user";
          avatar: string | null;
        }[]
      ).map((row) => [row.id, row]),
    );
    return {
      workspaces: [...new Set(repos.map(ownerOf))].map((id) => ({
        id,
        name: rows.get(id)?.name ?? id,
        kind: rows.get(id)?.kind ?? "organization",
        avatar: rows.get(id)?.avatar ?? null,
        repos: repos.filter((repo) => ownerOf(repo) === id),
      })),
    };
  });

  /** 넣고 빼는 레포. 그 레포의 GitHub Admin이 아니면 `forbidden`이다. */
  const mustAdmin = async (login: string, token: string, repo: string) => {
    const admin = await github.canAdmin(token, repo);
    if (admin === undefined)
      throw new ContractFailure({
        code: "github_failed",
        message: `GitHub에서 ${repo}의 Admin인지 확인하지 못했다. 잠시 뒤 다시 하라`,
      });
    if (!admin)
      throw new ContractFailure({
        code: "forbidden",
        message: `${login}는 ${repo}의 Admin이 아니라 레포를 넣거나 뺄 수 없다`,
      });
  };

  mount(app, api.addRepo, async ({ repo }, c) => {
    const login = c.get("login") as string;
    if (!accounts.has(repo.split("/")[0]?.toLowerCase() ?? ""))
      throw new ContractFailure({
        code: "forbidden",
        message: `${repo.split("/")[0]}는 이 서버가 받는 GitHub 계정이 아니다`,
      });
    await mustAdmin(login, callerToken(c), repo);
    // 넣을 때 GitHub id를 적는다. 전에 있던 같은 이름의 다른 레포면 그 레포의 것이 이어지지 않게 막는다(#315).
    const found = await github.canPush(callerToken(c), repo);
    if (found?.id !== undefined && !sameRepo(repo, found.id))
      throw new ContractFailure({
        code: "forbidden",
        message: `${repo}는 전에 이 서버에 있던 같은 이름의 다른 레포라 넣을 수 없다`,
      });
    db.prepare("INSERT OR IGNORE INTO repos (name, at) VALUES (?, ?)").run(repo, Date.now());
    const name = (db.prepare("SELECT name FROM repos WHERE name = ?").get(repo) as { name: string })
      .name;
    ensureWorkspace(name);
    seedLabels(name);
    // push 권한은 다음 확인을 기다리지 않고 지금 들어온 멤버마다 읽는다.
    await Promise.all(
      (
        db
          .prepare("SELECT login, MAX(github_token) AS token FROM sessions GROUP BY login")
          .all() as {
          login: string;
          token: string;
        }[]
      ).map(({ login, token }) => readAccess(login, token)),
    );
    shareSituation();
    syncSoon();
    return { repos: reposOf(login) };
  });

  mount(app, api.adminRepos, async (_, c) => {
    const found = await github.adminRepos(callerToken(c), workspaceOf(c));
    if (!found)
      throw new ContractFailure({
        code: "github_failed",
        message: "GitHub에서 Admin인 레포를 읽지 못했다. 잠시 뒤 다시 하라",
      });
    const added = new Set(
      (db.prepare("SELECT name FROM repos").all() as { name: string }[]).map((row) =>
        row.name.toLowerCase(),
      ),
    );
    return {
      repos: found
        .map((repo) => ({ ...repo, added: added.has(repo.name.toLowerCase()) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  mount(app, api.removeRepo, async ({ repo }, c) => {
    const login = c.get("login") as string;
    const found = db.prepare("SELECT name FROM repos WHERE name = ?").get(repo) as
      | { name: string }
      | undefined;
    // 보이지 않는 레포는 없는 레포와 같게 답한다. 다른 워크스페이스에 어떤 레포가 있는지 새지 않는다.
    if (!found || !sees(login, found.name))
      throw new ContractFailure({ code: "not_found", message: `없는 레포다: ${repo}` });
    await mustAdmin(login, callerToken(c), found.name);
    // 그 레포의 것은 지우지 않는다. 다시 넣으면 돌아온다.
    db.prepare("DELETE FROM repos WHERE name = ?").run(found.name);
    db.prepare("DELETE FROM access WHERE repo = ?").run(found.name);
    for (const [socket, runner] of runners)
      if (runner.repo === found.name)
        refuse(socket, { code: "forbidden", message: `${found.name}가 워크스페이스에서 빠졌다` });
    for (const [socket, watcher] of watchers)
      if (watcher.repo === found.name)
        refuse(socket, { code: "forbidden", message: `${found.name}가 워크스페이스에서 빠졌다` });
    shareSituation();
    return { repos: reposOf(login) };
  });

  mount(app, api.logout, (_, c) => {
    endSession(hash(bearer(c.req.header("authorization")) as string), {
      code: "unauthorized",
      message: "로그아웃해 세션이 끝났다",
    });
    return {};
  });

  /** 작업의 에이전트를 바꾼다(ADR-0015). 마지막에 보낸 실행기가 이긴다. */
  const setWorkAgent = (repo: string, login: string, branch: string, executor: ExecutorId) =>
    db
      .prepare(
        "INSERT OR REPLACE INTO work_agents (repo, login, branch, executor) VALUES (?, ?, ?, ?)",
      )
      .run(repo, login, branch, executor);

  mount(app, api.members, (_, c) => {
    const repo = repoOf(c);
    return { members: membersView(repo, worksView(repo)) };
  });

  mount(app, api.works, (_, c) => ({ works: worksView(repoOf(c)) }));

  mount(app, api.setStatus, ({ branch, executor, text }, c) => {
    const at = Date.now();
    const login = c.get("login") as string;
    const repo = repoOf(c);
    db.prepare(
      "INSERT OR REPLACE INTO lines (repo, login, branch, text, at) VALUES (?, ?, ?, ?, ?)",
    ).run(repo, login, branch, text, at);
    if (executor) setWorkAgent(repo, login, branch, executor);
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
    dispatchDebates(login); // 끄면 아직 보내지 않은 자리가 나오지 않는 자리가 된다
    return { on };
  });

  mount(app, api.settings, (_, c) => {
    const login = c.get("login") as string;
    const repo = repoOf(c);
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
      mergeCheck: {
        // ponytail: 레포마다 멤버 하나에 러너 하나로 본다(hello와 같다). 마지막에 붙은 러너의 것이다.
        runner:
          [...runners.values()].findLast((r) => r.login === login && r.repo === repo)?.mergeCheck ??
          ("offline" as const),
        check: JSON.parse(
          (
            db.prepare("SELECT value FROM settings WHERE key = ?").get(`check ${repo}`) as
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
   * 레포의 것(포스트)이면 그 레포의 러너만 답한다(ADR-0043). 꺼져 있으면 쌓아 두지 않고 `runner_offline`이다.
   */
  const runnerOf = (agent: string, executor: ExecutorId, repo?: string, workspace?: string) => {
    const found = [...runners].findLast(
      ([, runner]) =>
        runner.login === agent &&
        runner.executors.includes(executor) &&
        (repo === undefined || runner.repo === repo) &&
        (workspace === undefined || ownerOf(runner.repo) === workspace),
    );
    if (!found) {
      throw new ContractFailure({
        code: "runner_offline",
        message: `${agent}의 ${repo ? `${repo} ` : ""}${EXECUTOR_NAMES[executor]} 러너가 꺼져 있다. 요청은 쌓아 두지 않는다`,
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
    mustWrite(channel, c);
    visit(agent, channelWorkspace(channel) ?? workspaceOf(c));
    // 포스트와 레포 채널은 그 레포의 러너가, 워크스페이스 채널은 그 워크스페이스에서 마지막에 붙은 러너가 답한다(ADR-0043).
    const socket = runnerOf(agent, executor, channelRepo(channel), channelWorkspace(channel));
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
    const repo = seenPost(agent, post);
    visit(agent, workspaceOf(c));
    const socket = runnerOf(agent, executor, repo);
    const messages = recentOf(post);
    // 토론의 결론이 났으면 그 안을 초안의 근거로 싣는다(ADR-0040)
    const debate = debateOf(post);
    const won = debate?.conclusion && debate.options[debate.conclusion.option];
    const last = won?.stances.at(-1);
    const frame = encode(serverToRunner, "draft", {
      executor,
      post: { id: post, name: channelName(post) },
      messages,
      ...(debate?.conclusion &&
        won?.owner &&
        last && { conclusion: { by: debate.conclusion.by, owner: won.owner, stance: last } }),
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
    mustExist(channel, c);
    visit(c.get("login") as string, workspaceOf(c));
    const rows = db
      .prepare(`${QAS} WHERE login = ? AND channel = ? ORDER BY id DESC LIMIT ?`)
      .all(c.get("login") as string, channel, HISTORY_PAGE) as QaRow[];
    // ponytail: 최근 50개만 준다. 더 오래된 DM을 다시 볼 일이 생기면 history처럼 `before`로 넘겨 읽는다.
    return { qas: rows.reverse().map(qaView) };
  });

  /** 채널 하나를 계약의 채널로. */
  const channelView = (row: {
    id: string;
    name: string;
    kind: ChannelKind;
    filter: string | null;
    repo?: string | null;
  }): Channel => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    ...(row.repo && { repo: row.repo }),
    ...(row.filter !== null && { filter: JSON.parse(row.filter) }),
  });

  /**
   * `login`에게 보이는 채널. 포럼의 레포 조건에서 `login`에게 보이지 않는 레포는 빼고, 조건이 있는데 하나도 안 보이면 없다.
   * 비공개 레포의 이름이 권한 없는 멤버에게 새지 않게 한다(DESIGN.md 93-C).
   */
  const channelFor = (login: string, row: Parameters<typeof channelView>[0]) => {
    const view = channelView(row);
    const repos = view.filter?.repos;
    if (!view.filter || !repos?.length) return view;
    const seen = repos.filter((repo) => sees(login, repo));
    return seen.length
      ? ({ ...view, filter: { ...view.filter, repos: seen } } as Channel)
      : undefined;
  };
  /** 워크스페이스의 웹마다 그 사람에게 보이는 채널을 보낸다. 이제 안 보이는 사람에게는 이미 받았을 수 있어 지우라고 보낸다. */
  const broadcastChannel = (workspace: string, row: Parameters<typeof channelView>[0]) => {
    for (const [socket, watcher] of watchers) {
      if (socket.readyState !== 1 || watcher.workspace !== workspace) continue;
      const view = channelFor(watcher.login, row);
      socket.send(
        view
          ? encode(serverToWeb, "channel", view)
          : encode(serverToWeb, "forumDeleted", { id: row.id }),
      );
    }
  };

  mount(app, api.channels, (_, c) => ({
    channels: (
      db
        .prepare(
          "SELECT id, name, kind, filter, repo FROM channels WHERE alert IS NULL AND id != ? AND workspace = ? ORDER BY name",
        )
        .all(ALERTS, workspaceOf(c)) as Parameters<typeof channelView>[0][]
    )
      // 레포 채널은 그 레포가 보이는 멤버만 보고, 포럼의 레포 조건도 보이는 레포만 보인다.
      .flatMap((row) => {
        const login = c.get("login") as string;
        return row.repo && !sees(login, row.repo) ? [] : (channelFor(login, row) ?? []);
      }),
  }));

  /** 이름이 `id` 아닌 채널과 같은 층(워크스페이스, 또는 `repo`)에서 겹치면 `conflict`다. 이름은 대소문자를 가리지 않는다. */
  const mustBeNew = (workspace: string, name: string, id = "", repo = "") => {
    if (
      db
        .prepare(
          "SELECT 1 FROM channels WHERE workspace = ? AND COALESCE(repo, '') = ? AND name = ? AND id != ?",
        )
        .get(workspace, repo, name, id)
    ) {
      throw new ContractFailure({ code: "conflict", message: `#${name} 채널이 이미 있다` });
    }
  };

  mount(app, api.createChannel, ({ name, repo }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const workspace = workspaceOf(c);
    // 레포 채널은 이 워크스페이스의 보이는 레포에만 만든다(대소문자는 들어간 레포의 이름으로 맞춘다).
    const found =
      repo === undefined
        ? undefined
        : reposOf(login).find(
            (r) => r.toLowerCase() === repo.toLowerCase() && ownerOf(r) === workspace,
          );
    if (repo !== undefined && !found)
      throw new ContractFailure({ code: "not_found", message: `보이는 레포가 아니다: ${repo}` });
    mustBeNew(workspace, name, "", found);
    const channel = {
      id: randomBytes(8).toString("hex"),
      name,
      kind: "chat" as const,
      ...(found && { repo: found }),
    };
    db.prepare("INSERT INTO channels (id, name, workspace, repo) VALUES (?, ?, ?, ?)").run(
      channel.id,
      channel.name,
      workspace,
      found ?? null,
    );
    const frame = encode(serverToWeb, "channel", channel);
    if (found) broadcastTo(found, frame);
    else broadcast(workspace, frame);
    return { channel };
  });

  /** 포럼이 바뀌면 포스트마다 보이는 포럼이 바뀌니 알림 줄을 웹 모두에 다시 보낸다. */
  // ponytail: 워크스페이스의 포스트 전부를 다시 보낸다. 포스트가 많아 무거워지면 보이는 포럼이 바뀐 것만 보낸다.
  const shareForums = (workspace: string) => {
    for (const { alert } of db
      .prepare(
        `SELECT m.alert FROM messages m JOIN alerts a ON a.id = m.alert WHERE ${ownerSql("a.repo")} = ? ORDER BY m.id`,
      )
      .all(workspace) as { alert: number }[])
      shareAlert(alert);
  };

  /** 이 워크스페이스의 포럼(`ALERTS`는 빼고)이 없거나 `login`에게 보이지 않으면 `not_found`다. 있으면 그 포럼의 거르기를 돌려준다. */
  const mustBeForum = (login: string, workspace: string, id: string) => {
    const row = db
      .prepare(
        "SELECT id, name, kind, filter FROM channels WHERE id = ? AND filter IS NOT NULL AND workspace = ?",
      )
      .get(id, workspace) as Parameters<typeof channelView>[0] | undefined;
    if (!row || !channelFor(login, row)) {
      throw new ContractFailure({ code: "not_found", message: `없는 포럼이다: ${id}` });
    }
    return JSON.parse(row.filter as string) as ForumFilter;
  };

  /** 포럼을 새로 넣거나(`id`가 없으면) 고치고, 웹마다 그 사람에게 보이는 꼴로 알린다. `old`는 고치는 포럼의 지금 거르기다. */
  const saveForum = (
    login: string,
    workspace: string,
    name: string,
    input: ForumFilter,
    id?: string,
    old?: ForumFilter,
  ) => {
    mustBeNew(workspace, name, id);
    // 레포 조건은 부른 사람에게 보이는 이 워크스페이스의 레포여야 한다(들어간 레포의 이름으로 맞춘다). 안 보이는 레포는 없는 레포와 같게 거절한다.
    const mine = reposOf(login).filter((r) => ownerOf(r) === workspace);
    const repos = (input.repos ?? []).map((repo) => {
      const found = mine.find((r) => r.toLowerCase() === repo.toLowerCase());
      if (!found)
        throw new ContractFailure({
          code: "invalid_request",
          message: `이 워크스페이스의 레포가 아니다: ${repo}`,
        });
      return found;
    });
    // 부른 사람에게 보이지 않던 레포 조건은 고쳐도 지워지지 않고 남는다. 조건을 비우면(모든 레포) 다 지운다.
    if (repos.length) repos.push(...(old?.repos ?? []).filter((r) => !sees(login, r)));
    const { repos: _, ...rest } = input;
    const filter = (repos.length ? { ...rest, repos } : rest) as ForumFilter;
    const row = { id: id ?? randomBytes(8).toString("hex"), name, kind: "forum" as const };
    db.prepare(
      "INSERT INTO channels (id, name, kind, filter, workspace) VALUES (?, ?, 'forum', ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, filter = excluded.filter",
    ).run(row.id, name, JSON.stringify(filter), workspace);
    const stored = { ...row, filter: JSON.stringify(filter) };
    broadcastChannel(workspace, stored);
    shareForums(workspace);
    return { channel: channelFor(login, stored) as Channel };
  };

  mount(app, api.createForum, ({ name, filter }, c) => {
    const login = c.get("login") as string;
    const workspace = workspaceOf(c);
    visit(login, workspace);
    return saveForum(login, workspace, name, filter);
  });

  mount(app, api.updateForum, ({ id, name, filter }, c) => {
    const login = c.get("login") as string;
    const workspace = workspaceOf(c);
    visit(login, workspace);
    const old = mustBeForum(login, workspace, id);
    return saveForum(login, workspace, name, filter, id, old);
  });

  mount(app, api.deleteForum, ({ id }, c) => {
    const workspace = workspaceOf(c);
    visit(c.get("login") as string, workspace);
    mustBeForum(c.get("login") as string, workspace, id);
    db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    broadcast(workspace, encode(serverToWeb, "forumDeleted", { id }));
    shareForums(workspace);
    return {};
  });

  mount(app, api.feed, (_, c) => {
    const login = c.get("login");
    const repo = repoOf(c);
    const since = Date.now() - inboxMs;
    const rows = db
      .prepare(
        "SELECT kind, works, files, resolved, run, confirmed, updated FROM alerts WHERE repo = ? AND updated > ?",
      )
      .all(repo, since) as {
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
      db.prepare("SELECT kind, claim, at FROM feed WHERE repo = ? AND at > ?").all(repo, since) as {
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
  /** 레포의 알림 줄(`WHERE` 뒤에 붙인다)로 포스트와 그 알림 메시지를 읽는다. */
  const postsWhere = (repo: string, where: string, ...args: number[]) =>
    (
      db
        .prepare(`${MESSAGES} WHERE m.alert IS NOT NULL AND a.repo = ?${where} ORDER BY m.id`)
        .all(repo, ...args) as MessageRow[]
    ).map((row) => {
      const message = messageView(row);
      return {
        message,
        post: { ...(message.kind === "alert" && message.post), alert: row.id } as Post,
      };
    });

  mount(app, api.openPost, ({ alert }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const repo = (
      db
        .prepare("SELECT a.repo FROM messages m JOIN alerts a ON a.id = m.alert WHERE m.id = ?")
        .get(alert) as { repo: string } | undefined
    )?.repo;
    const [found] = sees(login, repo) ? postsWhere(repo as string, " AND m.id = ?", alert) : [];
    if (!found)
      throw new ContractFailure({ code: "not_found", message: `없는 알림이다: ${alert}` });
    return found;
  });

  /** 결정의 레포: 그 포스트의 레포다. 없는 결정이면 없다. */
  const decisionRepo = (id: number | bigint) =>
    (
      db
        .prepare("SELECT c.repo FROM decisions d JOIN channels c ON c.id = d.post WHERE d.id = ?")
        .get(id) as { repo: string } | undefined
    )?.repo;
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

  /** 결정 PR에 일어난 일을 결정의 포스트에 한 줄 올린다. 포럼의 알림 줄로는 올리지 않는다(ADR-0027). `by`는 그 일을 한 사람이다. */
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
    shareRow(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow);
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
    if (decision.awaiting?.length) return; // 대행이 낀 결정은 부재자가 확인할 때까지 머지하지 않는다(ADR-0040)
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
            .merge(session.github_token, decisionRepo(id) as string, decision.pull.number)
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
    visit(login, workspaceOf(c));
    const repo = seenPost(login, post);
    const token = callerToken(c);
    // 결정자: 그 포스트에서 말한 멤버(글과 공개된 문답)와, 정리해 결정 줄을 세우는 멤버.
    const deciders = (
      db
        .prepare(
          // GitHub에서 들여온 댓글의 쓴 사람은 그 레포의 지금 멤버일 때만 결정자다.
          `SELECT login FROM messages WHERE channel = ? AND login != '' AND decision IS NULL
           AND (github = 0 OR login IN ${MEMBERS})
           GROUP BY login ORDER BY MIN(id)`,
        )
        .all(post, repo) as { login: string }[]
    ).map((row) => row.login);
    if (!deciders.includes(login)) deciders.push(login);
    // 대행이 낀 토론이면 부재자도 결정자이고, 확인할 때까지 머지하지 않는다(ADR-0040).
    const absent = [
      ...new Set(
        (
          db
            .prepare("SELECT s.* FROM seats s JOIN debates d ON d.id = s.debate WHERE d.post = ?")
            .all(post) as SeatRow[]
        )
          .filter((seat) => stancesOf(seat).some((stance) => stance.proxy))
          .map((seat) => seat.login),
      ),
    ];
    for (const who of absent) if (!deciders.includes(who)) deciders.push(who);
    const name = nameOf(login);
    let opened: { number: number; url: string };
    let path: string;
    let branch: string;
    try {
      const base = await github.defaultBranch(token, repo);
      const numbers = [
        ...(await github.list(token, repo, base.sha, DECISIONS)),
        ...(
          db
            .prepare(
              "SELECT path FROM decisions WHERE state = 'proposed' AND post IN (SELECT id FROM channels WHERE repo = ?)",
            )
            .all(repo) as {
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
          `INSERT INTO decisions (post, login, title, path, pull, url, span, at, branch, deciders, closes, absent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          JSON.stringify(absent),
        ).lastInsertRowid,
    );
    announce(id, "opened");
    await tryMerge(id); // "바로"면 곧이어 머지한다
    return { decision: decisionOf(id) };
  });

  /** `login`에게 보이는 열린 결정 하나의 날 줄. 없으면 `not_found`, 머지되거나 닫혔으면 `conflict`다. */
  const openDecision = (id: number, login: string) => {
    if (!sees(login, decisionRepo(id)))
      throw new ContractFailure({ code: "not_found", message: `없는 결정이다: ${id}` });
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
    visit(login, workspaceOf(c));
    const row = openDecision(id, login);
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
    visit(login, workspaceOf(c));
    const row = openDecision(id, login);
    organizerOnly(row, login, "고친다");
    const number = basename(row.path).slice(0, 4);
    try {
      if (!row.branch) throw new Error("결정 PR의 브랜치를 모른다");
      await github.addCommit(callerToken(c), decisionRepo(id) as string, {
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
    visit(login, workspaceOf(c));
    const row = openDecision(id, login);
    organizerOnly(row, login, "버린다");
    const { pull } = db.prepare("SELECT pull FROM decisions WHERE id = ?").get(id) as {
      pull: number;
    };
    try {
      await github.closePull(callerToken(c), decisionRepo(id) as string, pull);
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `${login}의 GitHub 토큰으로 결정 PR을 닫지 못했다: ${(error as Error).message}`,
      });
    }
    settleDecision(id, "closed", login);
    return { decision: decisionOf(id) };
  });

  mount(app, api.decisions, (_, c) => ({
    decisions: (
      db
        .prepare(
          `SELECT ${DECISION} AS decision FROM decisions d LEFT JOIN people dp ON dp.login = d.login
           WHERE d.post IN (SELECT id FROM channels WHERE repo = ?) ORDER BY d.id`,
        )
        .all(repoOf(c)) as { decision: string }[]
    ).map((row) => decisionView(row.decision)),
  }));

  mount(app, api.posts, (_, c) => ({
    posts: postsWhere(repoOf(c), "").map(({ post, message }) => ({
      ...post,
      message,
      debate: debateOf(post.channel),
      request: requestOf(post.channel),
    })),
  }));

  mount(app, api.proxyDebate, ({ post, seat }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const repo = seenPost(login, post);
    const row = db.prepare("SELECT * FROM debates WHERE post = ?").get(post) as
      | DebateRow
      | undefined;
    const seats = row ? seatsOf(row.id) : [];
    const target = seats.find((s) => s.seat === seat);
    if (!row || !target)
      throw new ContractFailure({ code: "not_found", message: `없는 토론이나 자리다: ${post}` });
    // 같은 사람의 두 작업이 낀 토론은 주인이 늘 있어 대행이 해당하지 않는다(ADR-0041).
    if (seats.every((s) => s.login === target.login))
      throw new ContractFailure({
        code: "conflict",
        message: "같은 사람의 두 작업이 낀 토론에는 대행을 부르지 않는다",
      });
    if (row.state !== "open" || !["waiting", "off"].includes(target.state))
      throw new ContractFailure({
        code: "conflict",
        message: "이번 라운드에 기다리는 자리가 아니다",
      });
    if (target.login === login)
      throw new ContractFailure({
        code: "conflict",
        message: "자기 자리에는 대행을 부르지 않는다",
      });
    if (!answererOf(login, null, repo))
      throw new ContractFailure({
        code: "runner_offline",
        message: `${login}의 러너가 붙어 있지 않아 대행을 띄울 수 없다`,
      });
    db.prepare(
      "UPDATE seats SET proxy = ?, state = 'waiting', error = NULL WHERE debate = ? AND seat = ?",
    ).run(login, row.id, seat);
    // 주인이나 앞선 대행에게 이미 보낸 요청의 답은 받지 않는다.
    for (const [id, sent] of debatesSent)
      if (sent.debate === row.id && sent.seat === seat) debatesSent.delete(id);
    dispatchDebates(login);
    return { debate: debateOf(post) as Debate };
  });

  mount(app, api.requestDebate, ({ post, agenda, grounds }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const found = db
      .prepare(
        "SELECT id, repo FROM channels WHERE alert IS NOT NULL AND (id = ?1 OR alert = CAST(?1 AS INTEGER))",
      )
      .get(post) as { id: string; repo: string } | undefined;
    if (!found || !sees(login, found.repo))
      throw new ContractFailure({ code: "not_found", message: `없는 포스트다: ${post}` });
    if (db.prepare("SELECT 1 FROM debates WHERE post = ?").get(found.id))
      throw new ContractFailure({ code: "conflict", message: "이미 열린 토론이 있다" });
    const opened = agenda.trim() !== "" && grounds.trim() !== "";
    db.prepare(
      "INSERT OR REPLACE INTO debate_requests (post, login, agenda, grounds, opened, at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(found.id, login, agenda.trim(), grounds.trim(), opened ? 1 : 0, Date.now());
    if (opened) openDebate(found.id, true);
    sharePost(found.id);
    shareDebates();
    return { debate: debateOf(found.id), request: requestOf(found.id) as DebateRequest };
  });

  mount(app, api.chooseDebate, ({ post, option }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    seenPost(login, post);
    const row = db.prepare("SELECT * FROM debates WHERE post = ?").get(post) as
      | DebateRow
      | undefined;
    const picked = row && optionSeats(row, seatsOf(row.id))[option];
    if (!row || !picked)
      throw new ContractFailure({ code: "not_found", message: `없는 토론이나 안이다: ${post}` });
    // 먼저 고른 것만 결론이 된다. 고를 차례인지는 바꾸는 문장에서 본다.
    const { changes } = db
      .prepare(
        "UPDATE debates SET state = 'concluded', winner = ?, by = 'choice', chooser = ?, decided = ? WHERE id = ? AND state = 'choosing'",
      )
      .run(picked.seat, login, Date.now(), row.id);
    if (!changes)
      throw new ContractFailure({ code: "conflict", message: "고를 차례인 토론이 아니다" });
    concluded(row.id);
    shareDebates();
    return { debate: debateOf(post) as Debate };
  });

  // 라벨(ADR-0039). 이름, 색, 설명은 부른 멤버의 토큰으로 GitHub 라벨을 바꾸고, 중요도는 Omagari에만 둔다.
  mount(app, api.labels, (_, c) => ({ labels: labelsView(repoOf(c)) }));
  /** GitHub이 받지 않은 것을 `github_failed`로. */
  const onGitHub = async <T>(login: string, what: string, ask: (token: string) => Promise<T>) => {
    const token = tokenOf(login);
    try {
      if (!token) throw new Error("세션이 없다");
      return await ask(token);
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `${login}의 GitHub 토큰으로 ${what}: ${(error as Error).message}`,
      });
    }
  };
  mount(app, api.createLabel, async ({ name, color, description }, c) => {
    const login = c.get("login") as string;
    const repo = repoOf(c);
    if (labelRow(repo, name))
      throw new ContractFailure({ code: "conflict", message: `라벨이 이미 있다: ${name}` });
    const made = await onGitHub(login, "라벨을 만들지 못했다", (token) =>
      github.createLabel(token, repo, { name, color, description }),
    );
    db.prepare(
      "INSERT INTO labels (repo, name, github, color, description) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    ).run(repo, made.name, made.id, made.color, made.description);
    shareLabels(repo);
    return { label: labelsView(repo).find((label) => label.name === made.name) as Label };
  });
  mount(app, api.editLabel, async ({ name, next }, c) => {
    const login = c.get("login") as string;
    const repo = repoOf(c);
    const row = labelRow(repo, name);
    if (!row) throw new ContractFailure({ code: "not_found", message: `없는 라벨이다: ${name}` });
    if (
      next.name !== undefined &&
      labelRow(repo, next.name) &&
      labelRow(repo, next.name)?.id !== row.id
    )
      throw new ContractFailure({ code: "conflict", message: `라벨이 이미 있다: ${next.name}` });
    if (next.name !== undefined || next.color !== undefined || next.description !== undefined) {
      const wanted = {
        name: next.name ?? row.name,
        color: next.color ?? row.color,
        description: next.description ?? row.description,
      };
      // 아직 GitHub에 없는 기본 라벨이면 고친 값으로 만든다.
      const made = await onGitHub(login, "라벨을 고치지 못했다", (token) =>
        row.github === null
          ? github.createLabel(token, repo, wanted)
          : github.updateLabel(token, repo, row.name, wanted),
      );
      db.prepare(
        "UPDATE labels SET name = ?, github = ?, color = ?, description = ? WHERE rowid = ?",
      ).run(made.name, made.id, made.color, made.description, row.id);
      if (made.name !== row.name) renameLabel(repo, row.name, made.name);
    }
    const label = labelRow(repo, next.name ?? name) as { name: string };
    if (next.importance !== undefined) {
      db.prepare("UPDATE labels SET importance = ? WHERE repo = ? AND name = ?").run(
        next.importance,
        repo,
        label.name,
      );
      // 그 라벨을 단 포스트의 중요도가 바뀐다. 논의가 되면 이슈를 연다.
      for (const { id } of db
        .prepare(
          "SELECT c.id FROM channels c WHERE c.alert IS NOT NULL AND c.repo = ? AND EXISTS (SELECT 1 FROM json_each(c.labels) j WHERE j.value = ?)",
        )
        .all(repo, label.name) as { id: string }[]) {
        sharePost(id);
        syncSoon(id);
      }
    }
    shareLabels(repo);
    return { label: labelsView(repo).find((l) => l.name === label.name) as Label };
  });
  mount(app, api.setPostLabels, ({ post, labels }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const repo = seenPost(login, post);
    const found = db
      .prepare("SELECT alert FROM channels WHERE id = ? AND alert IS NOT NULL")
      .get(post) as { alert: number };
    const names = labels.map((name) => {
      const row = labelRow(repo, name);
      if (!row) throw new ContractFailure({ code: "not_found", message: `없는 라벨이다: ${name}` });
      return row.name;
    });
    db.prepare("UPDATE channels SET labels = ? WHERE id = ?").run(
      JSON.stringify([...new Set(names)]),
      post,
    );
    sharePost(post);
    syncSoon(post); // 이슈 라벨을 맞추거나, 논의가 되었으면 이슈를 연다
    openDebate(post); // 증거 라벨을 붙였으면 토론이 열린다(ADR-0040)
    return { post: postsWhere(repo, " AND m.id = ?", found.alert)[0].post };
  });

  /** 부른 사람에게 보이는 채널의 종류. 없거나 보이지 않는 레포의 포스트면 `not_found`다. */
  const mustExist = (channel: string, c: Context<Env>) => {
    const login = c.get("login") as string;
    const found = db
      .prepare("SELECT kind, repo, workspace FROM channels WHERE id = ?")
      .get(channel) as
      | { kind: ChannelKind; repo: string | null; workspace: string | null }
      | undefined;
    // 채팅 채널과 포럼은 그 워크스페이스에 들어간 멤버만 본다. 포스트는 그 레포가 보이는 멤버만 본다.
    if (
      !found ||
      (found.repo !== null && !sees(login, found.repo)) ||
      (found.repo === null &&
        found.workspace !== null &&
        !workspacesOf(login).includes(found.workspace))
    ) {
      throw new ContractFailure({ code: "not_found", message: `없는 채널이다: ${channel}` });
    }
    return found.kind;
  };
  /** 글, DM, `@호출`은 포럼에 쓰지 못하고 포스트 안에서만 쓴다(ADR-0027). */
  const mustWrite = (channel: string, c: Context<Env>) => {
    if (mustExist(channel, c) === "forum") {
      throw new ContractFailure({
        code: "invalid_request",
        message: "포럼에는 쓸 수 없다. 포스트 안에서 쓴다",
      });
    }
  };

  mount(app, api.history, ({ channel, before }, c) => {
    const login = c.get("login") as string;
    mustExist(channel, c);
    visit(login, workspaceOf(c));
    // 알림 줄의 자리(`ALERTS`)는 레포마다의 줄이 섞여 있다. 보이는 레포 가운데 부른 워크스페이스의 것만 준다.
    const rows = db
      .prepare(
        `${MESSAGES} WHERE m.channel = ? AND m.id < ?
         AND (a.repo IS NULL OR (a.repo IN (SELECT repo FROM access WHERE login = ?) AND ${ownerSql("a.repo")} = ?))
         ORDER BY m.id DESC LIMIT ?`,
      )
      .all(
        channel,
        before ?? Number.MAX_SAFE_INTEGER,
        login,
        workspaceOf(c),
        HISTORY_PAGE,
      ) as MessageRow[];
    return { messages: rows.reverse().map(messageView) };
  });

  mount(app, api.send, ({ channel, text }, c) => {
    mustWrite(channel, c);
    visit(c.get("login") as string, workspaceOf(c));
    const { lastInsertRowid } = db
      .prepare("INSERT INTO messages (channel, login, text, at) VALUES (?, ?, ?, ?)")
      .run(channel, c.get("login") as string, text, Date.now());
    const message = shareRow(
      db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow,
    );
    posted(channel);
    syncSoon(channel);
    return { message };
  });

  mount(app, api.metrics, ({ days }, c) => {
    // 지표는 부른 워크스페이스의 것만이다(ADR-0043).
    const workspace = workspaceOf(c);
    const now = Date.now();
    const range = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY_MS));
    const members = new Map(
      (
        db
          .prepare(
            "SELECT day, COUNT(*) AS n FROM visits WHERE workspace = ? AND day >= ? GROUP BY day",
          )
          .all(workspace, range[0] ?? "") as { day: string; n: number }[]
      ).map(({ day, n }) => [day, n]),
    );
    // 문답은 물은 시각으로 센다. 답하지 못한 문답도 물은 것이라 센다. 내용은 읽지 않는다.
    const asked = db
      .prepare(
        "SELECT at FROM qas WHERE at > ? AND channel IN (SELECT id FROM channels WHERE workspace = ?)",
      )
      .all(now - (days + 1) * DAY_MS, workspace) as {
      at: number;
    }[];
    const qas = Map.groupBy(asked, ({ at }) => dayOf(at));
    const ran = Map.groupBy(
      db
        .prepare("SELECT verdict, at FROM merge_runs WHERE workspace = ? AND at > ?")
        .all(workspace, now - (days + 1) * DAY_MS) as {
        verdict: RunVerdict;
        at: number;
      }[],
      ({ at }) => dayOf(at),
    );
    // 토론은 열린 날, 결론이 난 날, 열린 토론의 포스트에 결정 PR이 선 것을 센다. 내용은 읽지 않는다.
    const since = now - (days + 1) * DAY_MS;
    const debates = db
      .prepare(
        `SELECT at, state, by, decided, EXISTS (SELECT 1 FROM messages WHERE channel = post AND decision IS NOT NULL) AS decision
         FROM debates WHERE (at > ? OR decided > ?)
         AND post IN (SELECT id FROM channels WHERE workspace = ?)`,
      )
      .all(since, since, workspace) as {
      at: number;
      state: string;
      by: string | null;
      decided: number | null;
      decision: number;
    }[];
    const debatesOf = (day: string) => {
      const opened = debates.filter((d) => dayOf(d.at) === day);
      const ended = debates.filter(
        (d) => d.state === "concluded" && d.decided && dayOf(d.decided) === day,
      );
      return {
        opened: opened.length,
        ended: {
          experiment: ended.filter((d) => d.by === "experiment").length,
          evidence: ended.filter((d) => d.by === "evidence").length,
          human: ended.filter((d) => d.by === "choice").length,
          expired: 0,
        },
        decided: opened.filter((d) => d.decision).length,
      };
    };
    return {
      timeZone: TIME_ZONE,
      days: range.map((day) => ({
        day,
        members: members.get(day) ?? 0,
        qas: qas.get(day)?.length ?? 0,
        debates: debatesOf(day),
        runs: Object.fromEntries(
          RunVerdict.options.map((v) => [
            v,
            (ran.get(day) ?? []).filter((r) => r.verdict === v).length,
          ]),
        ) as Record<RunVerdict, number>,
      })),
    };
  });

  /** hello를 마쳤다. 시간 제한을 푼다. */
  const greet = (socket: WSContext) => {
    const raw = socket.raw as WebSocket | undefined;
    if (!raw) return;
    clearTimeout(ungreeted.get(raw));
    ungreeted.delete(raw);
  };
  /** hello를 마치지 않은 연결이 hello보다 큰 프레임을 보냈으면 닫는다. */
  const tooBigBeforeHello = (socket: WSContext, data: unknown) => {
    const raw = socket.raw as WebSocket | undefined;
    if (!raw || !ungreeted.has(raw)) return false;
    const size =
      typeof data === "string" ? Buffer.byteLength(data) : (data as ArrayBuffer).byteLength;
    if (size <= MAX_HELLO_BYTES) return false;
    socket.close(1009, "hello가 너무 크다");
    return true;
  };

  // 웹의 실시간 연결. hello 하나를 받으면 welcome과 끊긴 사이의 메시지, 지금의 멤버 목록을 보내고,
  // 그 뒤로는 메시지는 쌓이는 대로, 멤버 목록은 달라질 때마다 보낸다.
  // 이 처리기는 끝까지 동기라 welcome의 seq, 다시 보낸 것, 이어 보낼 것 사이에 빠지는 메시지가 없다.
  // ponytail: 끊긴 사이의 것을 개수 상한 없이 다 보낸다. 오래 끊겼던 웹이 많아 무거워지면 상한을 두고 넘으면 다시 읽으라고 알린다.
  app.get(
    LIVE_SOCKET,
    upgradeWebSocket(() => ({
      onMessage({ data }, socket) {
        // hello를 마치지 않은 연결의 큰 프레임은 읽지 않는다.
        if (tooBigBeforeHello(socket, data)) return;
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
        const mine = reposOf(login);
        const space = payload.workspace?.toLowerCase();
        if (space !== undefined && !mine.some((r) => ownerOf(r) === space)) {
          return refuse(
            socket,
            { code: "not_found", message: `들어가 있지 않은 워크스페이스다: ${payload.workspace}` },
            id,
          );
        }
        // 연결은 한 워크스페이스의 것만 받는다: 고른 레포의, 아니면 고른 워크스페이스의, 아니면 첫 워크스페이스의 것이다.
        const repo = payload.repo
          ? mine.find(
              (r) =>
                r.toLowerCase() === payload.repo?.toLowerCase() &&
                (space === undefined || ownerOf(r) === space),
            )
          : (mine.find((r) => space === undefined || ownerOf(r) === space) ?? "");
        if (repo === undefined) {
          return refuse(
            socket,
            { code: "not_found", message: `보이는 레포가 아니다: ${payload.repo}` },
            id,
          );
        }
        const workspace = ownerOf(repo);
        // 이 워크스페이스의 마지막 메시지 번호. 다른 워크스페이스의 번호는 새지 않는다.
        const { seq } = db
          .prepare(
            `SELECT COALESCE(MAX(m.id), 0) AS seq FROM messages m LEFT JOIN alerts a ON a.id = m.alert
             WHERE COALESCE(${ownerSql("a.repo")}, (SELECT ch.workspace FROM channels ch WHERE ch.id = m.channel)) = ?`,
          )
          .get(workspace) as {
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
          for (const row of missed)
            if (row.workspace === workspace && (row.repo === null || sees(login, row.repo)))
              socket.send(encode(serverToWeb, "message", messageView(row)));
        }
        watchers.set(socket, { hash: hash(payload.session), login, repo, workspace });
        greet(socket);
        visit(login, workspace);
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
        // 닫는 중인 연결(세션이 끝나 거절한 것 포함)의 메시지는 받지 않는다.
        if (socket.readyState !== 1) return;
        if (!runners.has(socket) && tooBigBeforeHello(socket, data)) return;
        const decoded = decode(runnerToServer, data);
        // hello를 마치지 않은 연결이 계약과 다른 것을 보내면 닫는다.
        if ("error" in decoded && !runners.has(socket) && decoded.error.code !== "version_mismatch")
          return refuse(socket, decoded.error, decoded.re);
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
          // 원격 가운데 워크스페이스에 있는 레포(ADR-0043). 한 레포는 워크스페이스 하나에만 있다.
          const workspace = allRepos();
          // 옮겨진 레포의 옛 원격도 새 이름으로 읽는다(GitHub이 옛 주소를 넘겨 준다).
          const inWorkspace = repos.flatMap(
            (r) => workspace.find((w) => w.toLowerCase() === current(r).toLowerCase()) ?? [],
          );
          const repo = inWorkspace.find((r) => sees(login, r));
          if (!repo) {
            return refuse(
              socket,
              {
                code: "forbidden",
                // 없는 레포와 권한 없는 레포를 같게 답한다. 서버의 레포 이름도, 남의 레포가 들어 있는지도 새지 않는다.
                message: `이 폴더는 ${login}에게 보이는 워크스페이스 레포의 폴더가 아니다(GitHub 원격: ${repos.join(", ")}). 워크스페이스에 없으면 그 레포의 Admin이 넣고, 있으면 push 권한이 있어야 한다`,
              },
              message.id,
            );
          }
          runners.set(socket, { login, hash: hash(session), repo, executors, choices, mergeCheck });
          greet(socket);
          db.prepare("DELETE FROM offline WHERE repo = ? AND login = ?").run(repo, login);
          db.prepare("UPDATE claims SET stale = NULL WHERE repo = ? AND login = ?").run(
            repo,
            login,
          );
          // ponytail: 멤버 하나에 러너 하나로 본다. 기기 둘에서 실행기가 다른 러너를 켜면 나중에 붙은 쪽의 것만 남는다.
          db.prepare("DELETE FROM agents WHERE login = ?").run(login);
          const known = db.prepare("INSERT OR IGNORE INTO agents (login, executor) VALUES (?, ?)");
          for (const executor of executors) known.run(login, executor);
          socket.send(encode(serverToRunner, "welcome", { login, repo }, message.id));
          shareSituation(socket);
          shareInbox(socket);
          shareRuns(repo, login, socket);
          dispatchQuestions(login); // 오프라인 사이에 남겨 둔 질문
          dispatchDebates(login); // 오프라인 사이에 열린 토론
          return;
        }
        const runner = runners.get(socket);
        if (!runner) {
          // hello를 마치지 않은 연결의 메시지는 받지 않는다.
          refuse(socket, { code: "unauthorized", message: "hello를 먼저 보내라" }, message.id);
        } else if (message.kind === "checkCommand") {
          db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
            `check ${runner.repo}`,
            JSON.stringify(message.payload),
          );
        } else if (message.kind === "observation") {
          replaceWorks(runner.repo, runner.login, message.payload.works);
          shareSituation();
        } else if (message.kind === "conflicts") {
          reports.set(socket, message.payload.pairs);
          reconcile(runner.repo);
        } else if (message.kind === "merged") {
          attachRun(runner.repo, runner.login, message.payload);
        } else if (message.kind === "delivered") {
          const drop = db.prepare("DELETE FROM inbox WHERE id = ? AND login = ?");
          for (const id of message.payload.ids) drop.run(id, runner.login);
          shareInbox();
        } else if (message.kind === "working") {
          setWorkAgent(runner.repo, runner.login, message.payload.branch, message.payload.executor);
          shareMembers();
        } else if (message.kind === "claim") {
          const { branch, path, unit, symbol, lines, overlaps, plan } = message.payload;
          const { login, repo } = runner;
          const now = Date.now();
          const linesJson = lines ? JSON.stringify(lines) : null;
          db.exec("BEGIN");
          // 같은 작업의 같은 곳은 하나다. 다시 걸면 새로 건 것으로 바꾼다.
          db.prepare(
            `DELETE FROM claims WHERE repo = ? AND login = ? AND branch = ? AND path = ? AND unit = ?
             AND symbol IS ? AND lines IS ?`,
          ).run(repo, login, branch, path, unit, symbol ?? null, linesJson);
          // 같은 작업의 같은 심볼에 걸린 옛 계획은 새 계획이 대체한다. 그 계획의 알림은 쓰는 쪽 러너가 다시 계산해 고쳐진다.
          if (plan)
            db.prepare(
              "UPDATE claims SET plan = NULL WHERE repo = ? AND login = ? AND branch = ? AND plan ->> '$.symbol' = ?",
            ).run(repo, login, branch, plan.symbol);
          const { lastInsertRowid } = db
            .prepare(
              "INSERT INTO claims (repo, login, branch, path, unit, symbol, lines, at, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              repo,
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
          db.prepare("INSERT INTO feed (repo, kind, claim, at) VALUES (?, 'claim', ?, ?)").run(
            repo,
            JSON.stringify(claim),
            now,
          );
          // 겹침은 양쪽 작업의 편지함에 넣는다. 각자 자기 선점이 `mine`이다.
          const put = db.prepare(
            "INSERT INTO inbox (repo, login, branch, news, at) VALUES (?, ?, ?, ?, ?)",
          );
          for (const id of new Set(overlaps)) {
            const row = db
              .prepare("SELECT * FROM claims WHERE id = ? AND repo = ? AND login != ?")
              .get(id, repo, login) as ClaimRow | undefined;
            if (!row) continue;
            const theirs = claimView(row);
            put.run(
              repo,
              login,
              branch,
              JSON.stringify({ kind: "overlap", mine: claim, theirs }),
              now,
            );
            put.run(
              repo,
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
          // 묻기는 레포 안의 것이다. 받는 쪽도 그 레포의 러너가 답한다.
          if (!db.prepare(`SELECT 1 FROM ${MEMBERS} WHERE login = ?`).get(runner.repo, to))
            return fail("not_found", `${runner.repo}의 멤버가 아니다: ${to}`);
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
              "INSERT INTO questions (repo, login, branch, target, executor, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(runner.repo, runner.login, branch, to, executor ?? null, text, Date.now());
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
          const where = ["repo = ?", "login = ?", "branch = ?"];
          const params: string[] = [runner.repo, runner.login, branch];
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
            cancelPlans(runner.repo, claims);
            shareSituation();
          }
        } else {
          // 문답이나 초안의 답, 실패. 그것을 보낸 연결에서 온 것만 받는다.
          const re = message.re ?? "";
          const question = questionsSent.get(re);
          const debate = debatesSent.get(re);
          if (debate?.socket === socket) {
            debatesSent.delete(re);
            settleSeat(
              debate.debate,
              debate.seat,
              message.kind === "stance"
                ? {
                    // 대행 표시는 서버가 붙인다. 러너가 보낸 것은 버린다.
                    stance: {
                      ...message.payload,
                      proxy: debate.proxy
                        ? { login: debate.proxy, name: nameOf(debate.proxy) }
                        : undefined,
                    },
                  }
                : message.kind === "error"
                  ? { error: message.payload }
                  : {
                      error: {
                        code: "invalid_message",
                        message: "토론에 입장 대신 다른 것이 왔다",
                      },
                    },
            );
            shareMembers();
          } else if (question?.socket === socket) {
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
            // 어느 레포의 러너가 본 코드인지 붙인다. 워크스페이스 채널의 답은 이것으로 레포를 안다.
            const repo = runners.get(socket)?.repo;
            settle(re, {
              state: "answered",
              ...message.payload,
              source: { ...message.payload.source, ...(repo && { repo }) },
            });
          } else if (message.kind === "error") {
            settle(re, { state: "failed", error: message.payload });
          }
        }
      },
      onClose(_, socket) {
        const runner = runners.get(socket);
        runners.delete(socket);
        sentInbox.delete(socket);
        if (runner && reports.delete(socket) && !stopped) reconcile(runner.repo);
        // 그 멤버의 그 레포 러너가 다 떨어졌으면 그 레포에서 오프라인이다. 마지막 관측과 상태 한 줄은 이 시각 기준으로 남는다.
        if (
          runner &&
          !stopped &&
          ![...runners.values()].some((r) => r.login === runner.login && r.repo === runner.repo)
        ) {
          db.prepare("INSERT OR REPLACE INTO offline (repo, login, since) VALUES (?, ?, ?)").run(
            runner.repo,
            runner.login,
            Date.now(),
          );
          shareSituation();
        }
        // 떨어진 러너에 보낸 질문은 남겨 두고, 그 멤버의 러너가 다시 붙으면 다시 보낸다.
        for (const [id, question] of questionsSent)
          if (question.socket === socket) questionsSent.delete(id);
        for (const [id, debate] of debatesSent)
          if (debate.socket === socket) debatesSent.delete(id);
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
  /** hello를 마치지 않은 연결과 그 시간 제한. hello를 마치면 빠진다. */
  const ungreeted = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  sockets.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    if (ungreeted.size >= MAX_UNGREETED) return socket.terminate();
    ungreeted.set(
      socket,
      setTimeout(() => socket.terminate(), options.helloMs ?? HELLO_MS),
    );
    socket.once("close", () => {
      clearTimeout(ungreeted.get(socket));
      ungreeted.delete(socket);
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);

  // 레포마다 push 권한을 다시 읽는다(ADR-0043). 권한을 잃은 레포의 러너와 웹은 내보내고, 어느 레포에도 권한이 없는 세션은 지운다.
  // GitHub이 답하지 못한 레포는 지난 것을 두고 다음 주기에 다시 본다.
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
      // GitHub에서 바꾼 이름과 프로필 사진을 따라간다. 토큰마다 읽고, 못 읽으면 지난 것을 둔다.
      // 토큰의 GitHub 이름이 세션의 것과 다르면 그 세션을 끝낸다. 옛 이름을 새로 가진 다른 사람이 그 줄과 권한을 이어받지 않는다.
      let renamed = false;
      const ended = new Set<string>();
      const people = new Set<string>();
      for (const row of rows) {
        const user = await github.user(row.github_token).catch(() => undefined);
        if (stopped) return;
        if (user && user.login !== row.login) {
          ended.add(row.hash);
          endSession(row.hash, {
            code: "unauthorized",
            message: `GitHub 이름이 ${row.login}에서 ${user.login}로 바뀌었다. 다시 로그인하라`,
          });
        }
        if (user?.login !== row.login || people.has(row.login)) continue;
        people.add(row.login);
        renamed ||=
          db
            .prepare(
              "UPDATE people SET name = ?, avatar = ? WHERE login = ? AND (name != ? OR avatar IS NOT ?)",
            )
            .run(
              user.name ?? row.login,
              user.avatar,
              row.login,
              user.name ?? row.login,
              user.avatar,
            ).changes > 0;
      }
      if (renamed) shareMembers();
      for (const row of rows) {
        if (ended.has(row.hash)) continue;
        const access = await readAccess(row.login, row.github_token);
        if (stopped) return;
        if (access.push.length > 0 || access.unknown.length > 0) continue;
        endSession(row.hash, {
          code: "forbidden",
          message: `${row.login}는 이제 워크스페이스 레포 어디에도 push 권한이 없어 빠졌다`,
        });
      }
      for (const [socket, runner] of runners)
        if (!sees(runner.login, runner.repo))
          refuse(socket, {
            code: "forbidden",
            message: `${runner.login}는 이제 ${runner.repo}에 push 권한이 없다`,
          });
      for (const [socket, watcher] of watchers)
        if (watcher.repo && !sees(watcher.login, watcher.repo))
          refuse(socket, {
            code: "forbidden",
            message: `${watcher.login}는 이제 ${watcher.repo}에 push 권한이 없다`,
          });
      shareSituation(); // 권한을 잃은 레포의 작업은 보이지 않는다
    } catch (error) {
      console.error("push 권한을 다시 확인하지 못했다:", error);
    } finally {
      checking = false;
    }
  }, options.recheckMs ?? RECHECK_MS);

  /** 레포의 멤버들의 GitHub 토큰, 나중에 들어온 세션의 것부터. */
  const repoTokens = (repo: string) =>
    (
      db
        .prepare(
          "SELECT github_token FROM sessions WHERE login IN (SELECT login FROM access WHERE repo = ?) ORDER BY rowid DESC",
        )
        .all(repo) as { github_token: string }[]
    ).map((session) => session.github_token);
  /** 멤버의 GitHub 토큰(마지막에 들어온 세션의 것). 세션이 없으면 없다. */
  const tokenOf = (login: string) =>
    (
      db
        .prepare("SELECT github_token FROM sessions WHERE login = ? ORDER BY rowid DESC")
        .get(login) as { github_token: string } | undefined
    )?.github_token;

  /** 포스트의 이슈 제목: 부딪힌 파일(또는 심볼)과 종류. 사람은 넣지 않는다(DESIGN.md "부딪힘 포럼"). */
  /** 러너가 보낸 이름(경로, 심볼, 브랜치)을 이슈의 한 줄 코드로 쓸 수 있게: 줄바꿈과 백틱을 접고 길이를 자른다. */
  const inline = (text: string) =>
    text
      .replace(/[\s`]+/g, " ")
      .trim()
      .slice(0, 200);
  const issueTitle = (alert: Alert) => {
    const first =
      alert.kind === "direct"
        ? alert.files[0] && basename(alert.files[0].path)
        : alert.symbols[0]?.name;
    return `${inline(first ?? alert.works[0].branch)} ${ALERT_LABELS[alert.kind]}`;
  };
  /** 포스트의 이슈 본문: 알림의 두 작업과 곳, 그리고 포스트 링크. */
  const issueBody = (alert: Alert, link: string) => {
    const places =
      alert.kind === "direct"
        ? alert.files.map((file) => `\`${inline(file.path)}\``)
        : alert.symbols.map((symbol) => `\`${inline(symbol.name)}\``);
    const [a, b] = alert.works;
    return [
      "Omagari가 올린 포스트예요. 포스트의 글은 이 이슈의 댓글로, 이 이슈의 댓글은 포스트의 글로 맞춰져요.",
      "",
      `- 종류: ${ALERT_LABELS[alert.kind]}`,
      `- 작업: ${inline(a.name)} (\`${inline(a.branch)}\`) ↔ ${inline(b.name)} (\`${inline(b.branch)}\`)`,
      `- 곳: ${places.join(", ")}${alert.more > 0 ? ` 외 ${alert.more}곳` : ""}`,
      "",
      `포스트: ${link}`,
    ].join("\n");
  };
  /** 판정 댓글의 글: 확인됨, 확인됨에서 벗어남, 통과로 닫힘. 검사 명령과, 올라와 있으면 출력의 끝이 있다. */
  const verdictBody = (state: string, run: AlertRun) => {
    const head =
      state === "confirmed"
        ? "🔴 합쳐 돌려 보니 깨졌어요. 확인됨 라벨을 붙였어요."
        : state === "passed"
          ? "🟢 합쳐 돌려 보니 통과했어요. 알림을 풀림으로 닫았어요."
          : `⚪ 다시 돌린 판정이 "${MERGE_RUN_LABELS[run.verdict]}"이라 확인됨 라벨을 뗐어요.`;
    const fence = "`".repeat(
      Math.max(3, ...[...(run.output ?? "").matchAll(/`+/g)].map((m) => m[0].length + 1)),
    );
    return [
      head,
      ...(run.check ? ["", `검사 명령: \`${run.check}\``] : []),
      ...(state === "confirmed" && run.output ? ["", fence, run.output.trimEnd(), fence] : []),
    ].join("\n");
  };

  /** 토론의 입장 하나를 이슈 댓글로: AI가 쓴 글 표시(DESIGN.md "AI가 쓴 글")와 주장, 근거(표시와 함께). */
  const stanceBody = (seat: SeatRow, round: number, stance: Stance) => {
    const model = [stance.model, stance.effort && `effort ${stance.effort}`]
      .filter(Boolean)
      .join(" · ");
    const changed = stance.changed && (stance.changed.reason ?? "사유 없음");
    return [
      "> [!NOTE]",
      `> 🤖 **AI가 쓴 답** · ${nameOf(seat.login)}의 에이전트${stance.proxy ? ` · 대행: ${stance.proxy.name}이(가) 불렀어요` : ""}${model ? ` (${model})` : ""} · 토론 ${round + 1}라운드`,
      ...(stance.context === "none" ? ["> 맥락 없이 참여했어요."] : []),
      ...(changed ? [`> 지난 입장을 바꿨어요: ${changed}`] : []),
      "",
      stance.claim,
      ...(stance.evidence.length > 0
        ? ["", "근거", ...stance.evidence.map((e) => `- ${e.text} (${EVIDENCE_MARKS[e.mark]})`)]
        : []),
    ].join("\n");
  };
  /**
   * 토론의 결론 댓글: 이긴 쪽과 어느 길로 났는지. 아무 멤버의 토큰으로도 달리므로 서버가 지은 글만 싣는다.
   * 이긴 주장은 그 입장을 쓴 사람의 계정으로 단 입장 댓글에 이미 있다.
   */
  const conclusionBody = (debate: DebateRow, seats: SeatRow[]) => {
    const winner = seats.find((seat) => seat.seat === debate.winner);
    const how =
      debate.by === "experiment"
        ? "실험을 통과한 쪽이 하나여서"
        : debate.by === "evidence"
          ? "검증된 근거가 있는 쪽이 하나여서"
          : `${debate.chooser ? nameOf(debate.chooser) : "멤버"}가 골라서`;
    return [
      `⚖️ 토론이 끝났어요. ${how} 이 안이 결론이 됐어요.`,
      ...(winner
        ? ["", `이긴 쪽: ${inline(nameOf(winner.login))}의 브랜치 \`${inline(winner.branch)}\``]
        : []),
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
   * 1. 이슈가 없고 알림이 풀리지 않은 논의 포스트면 포스트의 라벨을 달아 연다(ADR-0039). 중요도가 내려가도 연 이슈는 닫지 않는다. 알림의 두 사람 가운데 세션이 있는 사람의 토큰으로, 없으면 아무 멤버의 것으로 연다.
   * 2. 아직 올리지 않은 글을 쓴 사람의 토큰으로 댓글로 올린다. 그 사람의 세션이 없으면 들어올 때까지 둔다.
   * 3. 이슈의 제목, 라벨, 열림을 읽고, 모르는 댓글을 포스트의 글로 들인다.
   * 4. 알림이 풀렸고 이슈가 열려 있으면 한 번 닫는다. 사람이 다시 열면 두고, 알림이 풀렸고 이슈도 닫힌 포스트는 더 따라가지 않는다.
   * GitHub이 받지 않으면 그 포스트는 다음 주기에 다시 한다.
   */
  // ponytail: 주기마다 따라가는 이슈 하나에 GitHub 요청 둘이다. 포스트가 많아져 요청 한도가 걱정되면 GitHub 앱의 웹훅으로 바꾼다.
  const syncIssues = async (only?: Set<string>) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.repo, c.issue, c.issue_open, c.issue_closed, c.verdict, c.labels, ${POST_IMPORTANCE} AS importance,
         m.id AS message, m.alert
         FROM channels c JOIN messages m ON m.id = c.alert
         WHERE c.repo IN (SELECT name FROM repos) ORDER BY m.id`,
      )
      .all() as {
      id: string;
      repo: string;
      issue: number | null;
      issue_open: number | null;
      issue_closed: number | null;
      verdict: string | null;
      labels: string | null;
      importance: Importance;
      message: number;
      alert: number;
    }[];
    for (const row of rows) {
      if (only && !only.has(row.id)) continue;
      const view = messageView(
        db.prepare(`${MESSAGES} WHERE m.id = ?`).get(row.message) as MessageRow,
      );
      if (view.kind !== "alert") continue;
      const { alert } = view;
      const { repo } = row;
      const logins = alert.works.map((work) => work.login);
      // 알림의 두 사람의 토큰부터, 그다음 그 레포의 다른 멤버들의 것. GitHub이 받지 않으면(토큰 무효) 다음 것으로 한다.
      const tokens = [...new Set([...logins.map(tokenOf), ...repoTokens(repo)])].filter(
        (token): token is string => token !== undefined,
      );
      /** 토큰을 차례로 넣어 GitHub이 처음 답한 것. 모두 받지 않으면 없다. 마지막 까닭을 남긴다. */
      const answered = async <T>(
        ask: (token: string) => Promise<T | undefined>,
        first?: string,
      ) => {
        for (const token of first ? [first, ...tokens] : tokens) {
          const result = await ask(token).catch((error: Error) => {
            console.error("포스트의 이슈를 GitHub에서 다루지 못했다:", error.message);
            return undefined;
          });
          if (stopped) return undefined;
          if (result !== undefined) return { token, result };
        }
        return undefined;
      };
      if (tokens.length === 0) continue;
      const resolved = alert.resolved !== null;
      let number = row.issue;
      if (number === null) {
        // 풀린 뒤나 참고 포스트에는 열지 않는다(ADR-0039). 포스트의 라벨을 함께 단다.
        const labels: string[] = JSON.parse(row.labels ?? "[]");
        if (resolved || row.importance !== "discuss") continue;
        // 포스트가 보이는 첫 포럼으로 잇는다. 나중에 포럼이 바뀌어도 이슈의 글은 그대로다.
        const link = `${options.publicUrl ?? url}/#${view.post.forums[0] ?? ALERTS}/${row.message}`;
        const title = issueTitle(alert);
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

      // 토론의 공개된 입장과 결론을 댓글로(ADR-0040, 문답 A21). 가린 라운드는 공개될 때 가고, 입장은 그 에이전트 주인의 토큰으로 올린다.
      // 주인의 세션이 없으면 들어올 때까지 두고, 입장이 다 올라가야 결론을 올린다.
      const debate = db.prepare("SELECT * FROM debates WHERE post = ?").get(row.id) as
        | DebateRow
        | undefined;
      if (debate) {
        const seats = seatsOf(debate.id);
        const shown = shownOf(debate, seats);
        const posted = (seat: number, round: number) =>
          db
            .prepare("SELECT 1 FROM debate_comments WHERE debate = ? AND seat = ? AND round = ?")
            .get(debate.id, seat, round) !== undefined;
        const record = (seat: number, round: number, id: number) =>
          db
            .prepare("INSERT INTO debate_comments (debate, seat, round, id) VALUES (?, ?, ?, ?)")
            .run(debate.id, seat, round, id);
        let allSent = true;
        for (let round = 0; round < shown; round++) {
          for (const seat of seats) {
            const stance = stancesOf(seat)[round];
            if (!stance || posted(seat.seat, round)) continue;
            const writer = tokenOf(stance.proxy?.login ?? seat.login);
            const made = writer
              ? await github
                  .comment(writer, repo, number, stanceBody(seat, round, stance))
                  .catch((e: Error) => e)
              : undefined;
            if (stopped) return;
            if (!made || made instanceof Error) {
              if (made) console.error("토론의 입장을 이슈 댓글로 올리지 못했다:", made.message);
              allSent = false;
              continue;
            }
            record(seat.seat, round, made.id);
          }
        }
        if (allSent && debate.state === "concluded" && !posted(-1, 0)) {
          const made = await answered(
            (token) => github.comment(token, repo, number, conclusionBody(debate, seats)),
            debate.chooser ? tokenOf(debate.chooser) : undefined,
          );
          if (stopped) return;
          if (made) record(-1, 0, made.result.id);
        }
      }

      // 판정을 이슈에 맞춘다(#134): 확인됨이면 라벨과 댓글, 확인됨에서 벗어나거나 통과로 닫히면 라벨을 떼고 댓글. 판정을 올린 러너의 멤버 토큰으로 한다.
      // 라벨을 먼저 맞추고 댓글을 달아야 마친 것으로 적는다. GitHub이 받지 않으면 다음 주기에 다시 한다(라벨은 거듭해도 같다).
      if (alert.kind !== "direct" && alert.run) {
        const { run } = alert;
        const passed = resolved && run.verdict === "pass" && run.omitted.length === 0;
        const next = alert.confirmed ? "confirmed" : passed ? "passed" : "cleared";
        // 확인되지 않은 채 지난 알림에는 말할 것이 없다. 통과로 닫힌 것은 확인됨이었든 아니든 검사 명령을 남긴다.
        if (next !== row.verdict && (next !== "cleared" || row.verdict === "confirmed")) {
          const first = tokenOf(run.login);
          const labeled = await answered(
            (token) =>
              (next === "confirmed" ? github.addLabel : github.removeLabel)(
                token,
                repo,
                number,
                CONFIRMED_LABEL,
              ).then(() => true),
            first,
          );
          if (stopped) return;
          const made =
            labeled &&
            (await answered(
              (token) => github.comment(token, repo, number, verdictBody(next, run)),
              labeled.token,
            ));
          if (stopped) return;
          if (made) {
            db.prepare("INSERT INTO verdict_comments (id) VALUES (?)").run(made.result.id);
            db.prepare("UPDATE channels SET verdict = ? WHERE id = ?").run(next, row.id);
          }
        }
      }

      // 포스트에서 붙이고 뗀 라벨을 이슈에 올린다(ADR-0039): 마지막으로 읽은 이슈 라벨과 다른 것만. 하나라도 받지 않으면
      // 이번에는 이슈의 라벨을 들이지 않는다(다음 주기에 다시 올린다).
      const mine = db
        .prepare("SELECT labels, issue_labels FROM channels WHERE id = ?")
        .get(row.id) as { labels: string | null; issue_labels: string | null };
      const local: string[] = JSON.parse(mine.labels ?? "[]");
      const base: string[] = JSON.parse(mine.issue_labels ?? "[]");
      let pushed = true;
      for (const [add, label] of [
        ...local.filter((l) => !base.includes(l)).map((l) => [true, l] as const),
        ...base.filter((l) => !local.includes(l)).map((l) => [false, l] as const),
      ]) {
        const done = await answered((token) =>
          (add ? github.addLabel : github.removeLabel)(token, repo, number, label).then(() => true),
        );
        if (stopped) return;
        pushed &&= done !== undefined;
      }

      // 3. 이슈를 읽고 모르는 댓글을 들인다. GitHub에서 바꾼 이슈 라벨은 포스트가 따라간다.
      let changed = false;
      const read = await answered((token) => github.issue(token, repo, number));
      if (stopped) return;
      const issue = read?.result;
      if (issue) {
        const open = issue.open ? 1 : 0;
        const known = db
          .prepare(
            "SELECT issue_title, issue_labels, issue_open, labels FROM channels WHERE id = ?",
          )
          .get(row.id) as {
          issue_title: string;
          issue_labels: string;
          issue_open: number;
          labels: string | null;
        };
        // 올린 뒤 GitHub에서 붙거나 떨어진 것만 포스트에 옮긴다. 기다리는 사이 포스트에서 바꾼 것은 남아 다음에 올라간다.
        const now: string[] = JSON.parse(known.labels ?? "[]");
        const theirs = issue.labels;
        const labels = pushed
          ? JSON.stringify([
              ...now.filter((l) => !(local.includes(l) && !theirs.includes(l))),
              ...theirs.filter((l) => !local.includes(l) && !now.includes(l)),
            ])
          : (known.labels ?? "[]");
        const issueLabels = pushed ? JSON.stringify(theirs) : known.issue_labels;
        if (
          known.issue_title !== issue.title ||
          known.issue_labels !== issueLabels ||
          known.issue_open !== open ||
          (known.labels ?? "[]") !== labels
        ) {
          db.prepare(
            "UPDATE channels SET issue_title = ?, issue_labels = ?, issue_open = ?, labels = ? WHERE id = ?",
          ).run(issue.title, issueLabels, open, labels, row.id);
          changed = true;
        }
      }
      const comments = read && (await github.comments(read.token, repo, number));
      if (stopped) return;
      for (const comment of comments ?? []) {
        if (db.prepare("SELECT 1 FROM messages WHERE comment = ?").get(comment.id)) continue;
        if (db.prepare("SELECT 1 FROM verdict_comments WHERE id = ?").get(comment.id)) continue;
        if (db.prepare("SELECT 1 FROM debate_comments WHERE id = ?").get(comment.id)) continue;
        const { lastInsertRowid } = db
          .prepare(
            "INSERT INTO messages (channel, login, text, at, comment, github) VALUES (?, ?, ?, ?, ?, 1)",
          )
          .run(row.id, comment.login, comment.body, Date.now(), comment.id);
        shareRow(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow);
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
   * 레포의 GitHub 라벨을 읽어 라벨 목록에 맞춘다(ADR-0039). GitHub 라벨의 id로 짝을 지어, GitHub에서 이름을 바꾸면 포스트의 라벨도 바뀐다.
   * GitHub에서 지운 라벨은 목록과 이슈 없는 포스트에서 빠진다. 기본 라벨(종류 넷과 확인됨)은 지워져도 남기고, 레포에 없으면 만든다.
   */
  const syncLabels = async () => {
    for (const repo of allRepos()) {
      await syncRepoLabels(repo);
      if (stopped) return;
    }
  };
  const syncRepoLabels = async (repo: string) => {
    const tokens = repoTokens(repo);
    let theirs: RepoLabel[] | undefined;
    let token: string | undefined;
    for (token of tokens) {
      theirs = await github.labels(token, repo).catch(() => undefined);
      if (stopped) return;
      if (theirs) break;
    }
    if (!theirs || !token) return;
    seedLabels(repo); // 기본 라벨의 이름을 GitHub에서 바꿨으면 다시 만든다
    let changed = false;
    const seen = new Set<number>();
    for (const label of theirs) {
      const row =
        (db
          .prepare("SELECT rowid AS id FROM labels WHERE repo = ? AND github = ?")
          .get(repo, label.id) as { id: number } | undefined) ?? labelRow(repo, label.name);
      const known =
        row &&
        (db
          .prepare(
            "SELECT rowid AS id, name, github, color, description FROM labels WHERE rowid = ?",
          )
          .get(row.id) as {
          id: number;
          name: string;
          github: number | null;
          color: string;
          description: string;
        });
      if (!known) {
        db.prepare(
          "INSERT INTO labels (repo, name, github, color, description) VALUES (?, ?, ?, ?, ?)",
        ).run(repo, label.name, label.id, label.color, label.description);
        changed = true;
      } else if (
        known.name !== label.name ||
        known.github !== label.id ||
        known.color !== label.color ||
        known.description !== label.description
      ) {
        // 같은 id나 이름의 다른 줄이 있으면(지웠다 다시 만듦) 비켜 둔다.
        db.prepare(
          "UPDATE labels SET github = NULL WHERE repo = ? AND github = ? AND rowid != ?",
        ).run(repo, label.id, known.id);
        db.prepare(
          "UPDATE labels SET name = ?, github = ?, color = ?, description = ? WHERE rowid = ?",
        ).run(label.name, label.id, label.color, label.description, known.id);
        if (known.name !== label.name) renameLabel(repo, known.name, label.name);
        changed = true;
      }
      seen.add(label.id);
    }
    const defaults = Object.keys(DEFAULT_LABEL_COLORS);
    for (const row of db
      .prepare("SELECT rowid AS id, name, github, color, description FROM labels WHERE repo = ?")
      .all(repo) as {
      id: number;
      name: string;
      github: number | null;
      color: string;
      description: string;
    }[]) {
      if (row.github !== null && seen.has(row.github)) continue;
      if (!defaults.includes(row.name)) {
        // GitHub에서 지웠다. 이슈가 있는 포스트는 이슈를 따라간다.
        db.prepare("DELETE FROM labels WHERE rowid = ?").run(row.id);
        for (const post of editPostLabels(
          repo,
          (labels) => labels.filter((l) => l !== row.name),
          false,
        ))
          sharePost(post);
        changed = true;
        continue;
      }
      const made = await github
        .createLabel(token, repo, {
          name: row.name,
          color: row.color,
          description: row.description,
        })
        .catch((error: Error) => console.error("기본 라벨을 만들지 못했다:", error.message));
      if (stopped) return;
      if (!made) continue;
      db.prepare("UPDATE labels SET github = ?, color = ?, description = ? WHERE rowid = ?").run(
        made.id,
        made.color,
        made.description,
        row.id,
      );
      changed = true;
    }
    if (changed) shareLabels(repo);
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
        if (only === "all")
          await syncLabels().catch((error) => console.error("라벨을 맞추지 못했다:", error));
        await syncIssues(only === "all" ? undefined : only).catch((error) =>
          console.error("이슈를 맞추지 못했다:", error),
        );
      }
      syncing = false;
    })();
  };

  /**
   * 알림이 포스트로 설 때 기본 브랜치의 `.github/labeler.yml` 경로 규칙에 맞는 팀 라벨을 단다(ADR-0039). 이미 선 포스트에는 다시 달지 않는다.
   * 레포에 있는 라벨(목록에 있는 것)만 단다. 파일이 없거나 읽지 못하면 종류 라벨만 남는다.
   * ponytail: 기본 브랜치의 커밋이 바뀔 때만 파일을 다시 읽는다(알림이 설 때마다 GitHub 요청 하나). 지금은 한 판만 기억한다.
   */
  const labelers = new Map<string, { sha: string; source: string | null }>();
  const attachTeamLabels = async (post: string) => {
    const repo = postRepo(post);
    if (!repo) return;
    try {
      const row = db
        .prepare(
          "SELECT a.files FROM channels c JOIN messages m ON m.id = c.alert JOIN alerts a ON a.id = m.alert WHERE c.id = ?",
        )
        .get(post) as { files: string } | undefined;
      if (!row) return;
      const files = [
        ...new Set(
          (JSON.parse(row.files) as (AlertFile | AlertSymbol)[]).flatMap((item) =>
            "path" in item ? [item.path] : item.places.flat().map((place) => place.path),
          ),
        ),
      ];
      for (const token of repoTokens(repo)) {
        const base = await github.defaultBranch(token, repo).catch(() => undefined);
        if (!base) continue;
        if (labelers.get(repo)?.sha !== base.sha)
          labelers.set(repo, {
            sha: base.sha,
            source: await github.read(token, repo, base.sha, ".github/labeler.yml"),
          });
        break;
      }
      const labeler = labelers.get(repo);
      if (stopped || !labeler?.source) return;
      const wanted = labelsFor(labeler.source, files).flatMap(
        (name) => labelRow(repo, name)?.name ?? [],
      );
      const current = db.prepare("SELECT labels FROM channels WHERE id = ?").get(post) as
        | { labels: string | null }
        | undefined;
      if (!current) return;
      const labels: string[] = JSON.parse(current.labels ?? "[]");
      const added = wanted.filter((name) => !labels.includes(name));
      if (added.length === 0) return;
      db.prepare("UPDATE channels SET labels = ? WHERE id = ?").run(
        JSON.stringify([...labels, ...added]),
        post,
      );
      sharePost(post);
    } catch (error) {
      console.error("팀 라벨을 달지 못했다:", error);
    }
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
      const forgotten = "SELECT repo, login FROM offline WHERE since < ?";
      const cutoff = Date.now() - (options.forgetMs ?? FORGET_MS);
      const now = Date.now();
      db.exec("BEGIN");
      db.prepare(`DELETE FROM works WHERE (repo, login) IN (${forgotten})`).run(cutoff);
      db.prepare(`DELETE FROM lines WHERE (repo, login) IN (${forgotten})`).run(cutoff);
      // 선점은 지우지 않고 "오래됨"으로 둔다. 오래됨이 된 지 `forgetMs`가 더 지나면 지운다(Room의 오래됨 표시와 7일 만료).
      db.prepare(
        `UPDATE claims SET stale = ? WHERE stale IS NULL AND (repo, login) IN (${forgotten})`,
      ).run(now, cutoff);
      db.prepare("DELETE FROM offline WHERE since < ?").run(cutoff);
      db.prepare("DELETE FROM claims WHERE stale < ?").run(now - (options.forgetMs ?? FORGET_MS));
      db.prepare("DELETE FROM inbox WHERE at <= ?").run(now - inboxMs);
      db.prepare("DELETE FROM feed WHERE at <= ?").run(now - inboxMs);
      db.prepare("DELETE FROM questions WHERE at <= ?").run(now - inboxMs); // 답이 없으면 만료
      // 끝나지 않은 토론은 만료로 끝난다(ADR-0040). 보낸 요청의 답은 `settleSeat`이 받지 않는다.
      db.prepare(
        "UPDATE debates SET state = 'ended', expired = 1 WHERE state = 'open' AND at <= ?",
      ).run(now - (options.debateMs ?? INBOX_MS));
      db.exec("COMMIT");
      shareInbox(); // 만료된 소식이 빠진다
      shareDebates(); // 만료된 토론

      const branches = db
        .prepare(
          `SELECT w.repo, w.branch, MAX(s.github_token) AS token
           FROM (SELECT repo, login, branch FROM works UNION SELECT repo, login, branch FROM claims) w
           JOIN sessions s ON s.login = w.login
           JOIN access a ON a.login = w.login AND a.repo = w.repo
           WHERE w.repo IN (SELECT name FROM repos) GROUP BY w.repo, w.branch`,
        )
        .all() as { repo: string; branch: string; token: string }[];
      const next = new Map<string, string>();
      for (const { repo, branch, token } of branches) {
        const key = JSON.stringify([repo, branch]);
        const pulls = await github.pulls(token, repo, branch);
        if (stopped) return;
        if (!pulls) {
          // GitHub이 답하지 못하면 지난번 것을 둔다.
          const known = drafts.get(key);
          if (known !== undefined) next.set(key, known);
          continue;
        }
        const draft = pulls.find((pull) => pull.open && pull.draft);
        if (draft) next.set(key, draft.title);
        const merged = Math.max(
          ...pulls.map((pull) => Date.parse(pull.mergedAt ?? "")).filter(Number.isFinite),
        );
        if (merged > 0) {
          db.prepare("DELETE FROM lines WHERE repo = ? AND branch = ? AND at < ?").run(
            repo,
            branch,
            merged,
          );
          // 머지된 브랜치의 선점은 저절로 풀린다. 머지 뒤에 같은 브랜치에 새로 건 것은 남는다.
          releaseClaims("repo = ? AND branch = ? AND at < ?", repo, branch, merged);
        }
      }
      drafts = next;
      shareSituation();

      // 열린 결정 PR이 머지되거나 닫혔는지 읽는다. 정리한 멤버의 토큰으로, 그 멤버의 세션이 없으면 다른 멤버의 것으로 읽는다.
      const open = db
        .prepare(
          `SELECT d.id, d.pull, c.repo, COALESCE(
             (SELECT github_token FROM sessions WHERE login = d.login),
             (SELECT github_token FROM sessions WHERE login IN (SELECT login FROM access WHERE repo = c.repo))) AS token
           FROM decisions d JOIN channels c ON c.id = d.post
           WHERE d.state = 'proposed' AND c.repo IN (SELECT name FROM repos)`,
        )
        .all() as { id: number; pull: number; repo: string; token: string | null }[];
      // 열린 것은 GitHub의 변경 요청 리뷰를 이의로 맞추고(ADR-0025), 창이 닫혔으면 머지한다.
      for (const { id, pull: number, repo, token } of open) {
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
          // GitHub의 변경 요청 리뷰는 그 레포의 지금 멤버가 단 것만 이의다.
          const member = (l: string) =>
            !!db.prepare(`SELECT 1 FROM ${MEMBERS} WHERE login = ?`).get(repo, l);
          for (const login of requested.filter((l) => member(l) && !known.includes(l))) {
            db.prepare(
              "INSERT INTO objections (decision, login, via, at) VALUES (?, ?, 'github', ?)",
            ).run(id, login, Date.now());
            announce(id, "objected", { by: login });
          }
          const withdrawn = known.filter((l) => !requested.includes(l) || !member(l));
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

  // 빌드한 웹 화면(ADR-0042). API가 아닌 경로에서 파일을 내고, 없는 경로는 화면의 첫 파일로 보낸다.
  if (options.webDir) {
    const root = relative(process.cwd(), options.webDir) || ".";
    app.use("*", serveStatic({ root }));
    app.get("*", (c, next) =>
      c.req.path.startsWith("/api/") ? next() : serveStatic({ root, path: "index.html" })(c, next),
    );
  }

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
