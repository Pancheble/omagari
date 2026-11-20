import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  DEFAULT_PREFS,
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
  type LIMITS,
  LIVE_SOCKET,
  MAX_FRAME_BYTES,
  MERGE_RUN_LABELS,
  type MemberView,
  type MergeCheckState,
  type Message,
  type ObservedFile,
  type Post,
  PRESENCE_DURATIONS,
  type Prefs,
  type Presence,
  type PresenceDuration,
  type Qa,
  type Question,
  REPO_HEADER,
  type Reaction,
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

/** How often push access is rechecked. Starts from Room's 10 minutes (ADR-0011). */
const RECHECK_MS = 10 * 60_000;
/** A GitHub App's token is refreshed this long before it expires, so a call doesn't start with a token that ends midway. */
const REFRESH_AHEAD_MS = 60_000;
/** How often a runner connection is pinged. No answer by the next round closes it. */
const HEARTBEAT_MS = 30_000;
/** Max number of unfinished device authorizations held. This path is called without login, so it doesn't ask GitHub without limit. */
const MAX_PENDING_LOGINS = 100;
/** Max unfinished device authorizations one address can hold. Stops one address from filling the cap and blocking others' logins. */
const MAX_PENDING_PER_CLIENT = 5;
/** A device authorization not polled for this long is treated as abandoned and removed. The CLI and web poll every few seconds. */
const ABANDONED_LOGIN_MS = 60_000;
/** Time allowed to finish hello. The connection is closed after this. */
const HELLO_MS = 10_000;
/** What a runner sends from observing its repo. Dropped from a runner whose member hasn't shared the repo (ADR-0049). */
const OBSERVED = new Set(["observation", "conflicts", "checkCommand", "merged", "working"]);
/** Max size of one frame received before hello finishes. hello is small. */
const MAX_HELLO_BYTES = 64 * 1024;
/** Max number of connections that haven't finished hello. */
const MAX_UNGREETED = 200;
/** How often each work's draft PR title and merge state are reread from GitHub. Long-offline members are also removed on this round. */
const FOLLOW_MS = 60_000;
/** How long an offline member's observations and status line are kept. Room's 7 days (stage 1 Q A10). */
const FORGET_MS = 7 * 24 * 60 * 60_000;
/** How long changed-file content and debate patches are kept once unchanged (ADR-0054). */
const CONTENT_MS = 30 * 24 * 60 * 60_000;
/** Time zone that cuts the metrics day. The building team's day (ADR-0018). Seoul has no daylight saving, so a day is always 24 hours. */
const TIME_ZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60_000;
/** The date (YYYY-MM-DD) of that moment in `TIME_ZONE`. sv-SE writes it in ISO form. */
const dayOf = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(ms);

/** The line for the file being edited, shown when the agent wrote no line. None if nothing changed. */
function filesLine(files: ObservedFile[]): StatusLine | null {
  const [first] = files;
  return first ? { source: "files", file: basename(first.path), more: files.length - 1 } : null;
}

/** A file without its content (and definitions). Its path and whether it was deleted stay. */
const dropContent = (file: ObservedFile): ObservedFile =>
  "content" in file
    ? { path: file.path, omitted: "share" }
    : "deleted" in file
      ? { path: file.path, deleted: true }
      : file;
const hash = (session: string) => createHash("sha256").update(session).digest("hex");

const TOKEN_PREFIX = "enc1:";
const isEncrypted = (text: string) => text.startsWith(TOKEN_PREFIX);
/** The key that encrypts GitHub tokens: the setting, else a key file next to the database (made on first start), else a throwaway one for a memory database. */
const tokenKeyFor = (setting: string | undefined, database: string | undefined) => {
  if (setting) return createHash("sha256").update(setting).digest();
  if (!database || database === ":memory:") return randomBytes(32);
  const file = `${database}.key`;
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    console.log(
      `Made ${file}, the key that encrypts GitHub tokens. Keep it with the database. Set OMAGARI_TOKEN_KEY to use your own`,
    );
  }
  return createHash("sha256").update(readFileSync(file, "utf8").trim()).digest();
};
/** AES-256-GCM. The stored text is the prefix, then nonce, tag, and ciphertext (base64). */
const encryptToken = (key: Buffer, plain: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return TOKEN_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
};
/** The plain token, or null if it isn't encrypted text or the key is wrong. */
const decryptToken = (key: Buffer, text: string) => {
  if (!isEncrypted(text)) return null;
  try {
    const raw = Buffer.from(text.slice(TOKEN_PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};
const bearer = (authorization?: string) => authorization?.match(/^Bearer (\S+)$/)?.[1];

/** Reads Q&As. Append WHERE and ORDER BY. */
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

/** The workspace of repo `owner/name`: the account name in lowercase (ADR-0043). */
const ownerOf = (repo: string) => (repo.split("/")[0] ?? "").toLowerCase();
/** `ownerOf` in SQL. `r` is the SQL that yields the repo. */
const ownerSql = (r: string) => `lower(substr(${r}, 1, instr(${r}, '/') - 1))`;

/** The channel where alert lines stand (ADR-0039). Forums are filtered views, so they hold no alert lines. It isn't in the channel list and nobody can write to it. */
const ALERTS = "alerts";
/** The default labels' Korean names before ADR-0045, and their English names. Label sync renames them. */
const KOREAN_LABELS: Record<string, string> = {
  "직접 충돌": ALERT_LABELS.direct,
  "간접 충돌": ALERT_LABELS.indirect,
  "중복 구현": ALERT_LABELS.duplicate,
  "계약 변경": ALERT_LABELS.declared,
  확인됨: CONFIRMED_LABEL,
};

/** Number of messages in a post (a channel line). `c` is the post's channel. Decision PR lines aren't counted. */
const POST_COUNT = "(SELECT COUNT(*) FROM messages WHERE channel = c.id AND decision IS NULL)";

/** The repo folder that holds decision files (implementation doc, section 8). */
const DECISIONS = "docs/decisions";
/** The one line the first decision PR adds if the repo's AGENTS.md doesn't point to the decisions folder. */
const AGENTS_LINE = `Decision records are in \`${DECISIONS}/\`. Read the related decisions before you start work.`;
/** Length of the objection window in hours (ADR-0030). */
const windowHours = (window: DecisionWindow) =>
  typeof window === "object"
    ? window.amount * (window.unit === "day" ? 24 : 1)
    : { now: 0, hour: 1, day: 24, three_days: 72 }[window];
const windowName = (window: DecisionWindow) =>
  typeof window === "object"
    ? `${window.amount} ${window.unit === "day" ? "day" : "hour"}${window.amount === 1 ? "" : "s"}`
    : { now: "right away", hour: "1 hour", day: "1 day", three_days: "3 days" }[window];
/** A named window is kept as is; a custom window goes in the `span` column as JSON. */
const spanOf = (span: string): DecisionWindow =>
  span.startsWith("{") ? JSON.parse(span) : (span as DecisionWindow);

/** A login's profile name. Falls back to the login if unknown. `l` is the SQL that yields the login. */
const nameSql = (l: string) => `COALESCE((SELECT name FROM people WHERE login = ${l}), ${l})`;

/**
 * JSON that reads one decision in the contract's shape. `d` is decisions, `dp` is the people row of the person who wrapped it up. `decisionView` builds the state and fixes the times.
 * Wrap JSON returned by a subquery in `json()`. Otherwise, depending on the SQLite version, an array ends up as a string inside `json_object` (Node 24.22.3, #258).
 * Among the deciders (`d.deciders`, a JSON array of logins), the person who wrapped it up always agrees (ADR-0029).
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
 * Read together with the author's name, the Q&A if it's a public Q&A, or the alert and its post if it's an alert. Append WHERE and ORDER BY.
 */
const POST_LAST = `(SELECT json_object('login', x.login, 'name', COALESCE(pp.name, x.login),
  'line', COALESCE(x.note, x.text, qq.question, ''), 'at', x.at) FROM messages x
  LEFT JOIN people pp ON pp.login = x.login LEFT JOIN qas qq ON qq.id = x.qa
  WHERE x.channel = c.id AND x.decision IS NULL ORDER BY x.id DESC LIMIT 1)`;

/** The id and filter (JSON array) of every forum, by name. */
const FORUMS = `(SELECT json_group_array(json_object('id', f.id, 'filter', json(f.filter)) ORDER BY f.name)
  FROM channels f WHERE f.filter IS NOT NULL AND f.workspace = c.workspace)`;
/** A post's (`c`) importance: Discuss if any label is Discuss (ADR-0039). An unknown label counts as FYI. */
const POST_IMPORTANCE = `CASE WHEN EXISTS (SELECT 1 FROM json_each(c.labels) j
  JOIN labels l ON l.repo = c.repo AND l.name = j.value AND l.importance = 'discuss') THEN 'discuss' ELSE 'reference' END`;

/** The original message (of a reply or a thread) in the same channel as JSON `{ login, name, text, comment }`, or NULL. */
const ORIGINAL = (
  column: string,
) => `(SELECT json_object('login', o.login, 'name', COALESCE(op.name, o.login),
    'text', COALESCE(oq.question, o.text), 'comment', o.comment) FROM messages o
    LEFT JOIN people op ON op.login = o.login LEFT JOIN qas oq ON oq.id = o.qa
    WHERE o.id = ${column} AND o.channel = m.channel)`;
/** The thread under `m` as JSON `{ count, last, writers }` (up to three writers, latest first), or NULL without replies (ADR-0047). */
const THREAD = `(SELECT json_object('count', COUNT(*), 'last', MAX(t.at), 'writers',
    json((SELECT json_group_array(json_object('login', w.login, 'name', COALESCE(wp.name, w.login)) ORDER BY w.latest DESC)
      FROM (SELECT login, MAX(id) AS latest FROM messages WHERE thread_of = m.id GROUP BY login ORDER BY latest DESC LIMIT 3) w
      LEFT JOIN people wp ON wp.login = w.login)))
  FROM messages t WHERE t.thread_of = m.id HAVING COUNT(*) > 0)`;
/** A message that shows in the channel: not in a thread, or a thread reply also sent to the channel. */
const IN_CHANNEL = "(m.thread_of IS NULL OR m.also_in_channel = 1)";

const MESSAGES = `SELECT m.id, m.channel, m.login, m.text, m.note, m.at, m.github, p.name,
  c.issue, c.issue_url, c.issue_title, c.issue_labels, c.issue_open, c.labels, ${POST_IMPORTANCE} AS importance,
  q.id AS qa, q.executor, q.question, q.at AS asked, q.answer, q.visibility,
  m.alert, a.kind, a.works, a.files, a.resolved, a.run, a.confirmed,
  c.id AS post, CASE WHEN c.id IS NULL THEN 0 ELSE ${POST_COUNT} END AS count, ${POST_LAST} AS last,
  CASE WHEN c.id IS NULL THEN NULL ELSE ${FORUMS} END AS forums,
  CASE WHEN d.id IS NULL THEN NULL ELSE ${DECISION} END AS decision,
  COALESCE(a.repo, (SELECT ch.repo FROM channels ch WHERE ch.id = m.channel)) AS repo,
  COALESCE(${ownerSql("a.repo")}, (SELECT ch.workspace FROM channels ch WHERE ch.id = m.channel)) AS workspace,
  (SELECT json_group_array(json_array(r.emoji, r.login, COALESCE(rp.name, r.login)) ORDER BY r.at, r.rowid)
    FROM reactions r LEFT JOIN people rp ON rp.login = r.login WHERE r.message = m.id) AS reactions,
  m.reply_to, m.notify, ${ORIGINAL("m.reply_to")} AS original,
  m.thread_of, m.also_in_channel, ${ORIGINAL("m.thread_of")} AS thread_original,
  CASE WHEN m.thread_of IS NULL THEN NULL ELSE (SELECT json_group_array(DISTINCT w.login) FROM messages w WHERE w.thread_of = m.thread_of) END AS thread_writers,
  ${THREAD} AS thread FROM messages m
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
  /** The repo, if it belongs to a repo (an alert line or a post's message). NULL if it belongs to a chat channel. */
  repo: string | null;
  /** The workspace this line stands in. An alert line's place (`ALERTS`) is also decided by the alert's repo. */
  workspace: string | null;
  /** JSON array of reactions `[emoji, login, name]`, in the order they were added. */
  reactions: string;
  /** For a reply: the original message's number and whether to notify its author (1, 0). */
  reply_to: number | null;
  notify: number | null;
  /** JSON of the original message `{ login, name, text, comment }`. NULL if it can't be read. */
  original: string | null;
  /** For a reply in a thread: the thread's original message number, whether it also shows in the channel (1, 0), and the original like `original`. */
  thread_of: number | null;
  also_in_channel: number | null;
  thread_original: string | null;
  /** JSON array of the logins who wrote in the thread `m` sits in. NULL outside a thread. */
  thread_writers: string | null;
  /** JSON of the thread under this message `{ count, last, writers }`. NULL without replies. */
  thread: string | null;
} & Pick<QaRow, "executor" | "question" | "answer" | "visibility">;

/**
 * One row of the alerts table as a contract alert. The `files` column holds files for a direct conflict and symbols for other kinds.
 * Names up to `ALERT_FILES` are written and the rest are counted.
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

/** The side that uses the symbols of an indirect conflict or a declared contract change (the `works` slot). The runner on that side computed it. */
const usingSide = (symbol: AlertSymbol) =>
  symbol.places[0].some((place) => place.role === "uses") ? 0 : 1;

/** Kinds only the using side's runner computes (they have a direction). */
const oneWay = (kind: Alert["kind"]) => kind === "indirect" || kind === "declared";

/** The key of one thing tied to an alert: a path for a direct conflict, a name for duplicate work, a name and using side for an indirect conflict or a declared contract change (each direction is separate). */
const itemId = (kind: Alert["kind"], item: AlertFile | AlertSymbol) =>
  "path" in item ? item.path : oneWay(kind) ? `${item.name}\0${usingSide(item)}` : item.name;

/** The runner members who can compute one thing tied to an alert (ADR-0023). An indirect conflict or a declared contract change needs an index of the using side's copy. */
const computedBy = (kind: Alert["kind"], item: AlertFile | AlertSymbol, works: WorkRef[]) =>
  oneWay(kind) && "places" in item
    ? [works[usingSide(item)]?.login]
    : works.map((work) => work.login);

/** A post summary (`Post` without `alert`). `row` is the alert line. A line folds line breaks and is cut at `POST_LINE` characters. */
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

/** Groups reaction rows by emoji. Emojis stand in the order they were first added. */
const reactionsOf = (json: string): Reaction[] => {
  const grouped = new Map<string, Reaction["members"]>();
  for (const [emoji, login, name] of JSON.parse(json) as [string, string, string][])
    grouped.set(emoji, [...(grouped.get(emoji) ?? []), { login, name }]);
  return [...grouped].map(([emoji, members]) => ({ emoji, members }));
};

/** The original message's first line: the first line after skipping `>` quote lines and blank lines. If there's none, the first line. */
const firstLine = (text: string) => {
  const lines = text.split("\n").map((line) => line.trim());
  return lines.find((line) => line !== "" && !line.startsWith(">")) ?? lines[0] ?? "";
};

/** The original message's JSON (`ORIGINAL`) as the contract's `original`. */
const originalView = (json: string | null) => {
  if (json === null) return null;
  const original = JSON.parse(json);
  return {
    login: original.login,
    name: original.name,
    line: firstLine(original.text ?? "").slice(0, POST_LINE),
  };
};

const replyView = (row: MessageRow) => ({
  ...(row.reply_to !== null && {
    replyTo: { id: row.reply_to, notify: row.notify === 1, original: originalView(row.original) },
  }),
  ...(row.thread_of !== null && {
    threadOf: {
      id: row.thread_of,
      original: originalView(row.thread_original),
      writers: JSON.parse(row.thread_writers ?? "[]"),
    },
  }),
  ...(row.also_in_channel === 1 && { alsoInChannel: true as const }),
  ...(row.thread !== null && {
    thread: (({ count, last, writers }) => ({
      count,
      writers,
      last: new Date(last).toISOString(),
    }))(JSON.parse(row.thread)),
  }),
});

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
    reactions: reactionsOf(row.reactions),
    ...replyView(row),
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
   * GitHub accounts to accept (ADR-0043). Only this account's repos go into the workspace. An `owner/name` entry accepts that account and
   * is added whenever that repo is turned on. The first `owner/name` is the repo from when there was one repo, so it moves what an existing DB has to that repo.
   */
  accept: string[];
  github: GitHub;
  /**
   * The GitHub App's slug (`GITHUB_APP_SLUG`), when sign-in goes through a GitHub App (ADR-0053). Then "no access" says to install the App, with its link.
   * Not given for an OAuth app.
   */
  githubApp?: string;
  /** GIF search (ADR-0044). Given only when the server config has a GIPHY key. Without it the web has no GIF button. */
  giphy?: Giphy;
  /** SQLite file. If not given, it lives in memory and is lost when the server stops. */
  database?: string;
  /**
   * Secret that encrypts GitHub tokens in the database (`OMAGARI_TOKEN_KEY`, ADR-0053). Any long random string.
   * If not given, the key lives in a file next to the database (made on first start), or in memory for a memory database.
   */
  tokenKey?: string;
  port?: number;
  /** Address to listen on. By default it listens only on this machine. Give something like "0.0.0.0" only to open it outside. */
  hostname?: string;
  recheckMs?: number;
  heartbeatMs?: number;
  followMs?: number;
  forgetMs?: number;
  /** How long changed-file content and debate patches stay once unchanged. Default 30 days (`CONTENT_MS`). Tests shorten it. Swept every `followMs`. */
  contentMs?: number;
  /** How long inbox items are kept. Default 14 days (`INBOX_MS`). Tests shorten it. Expiry is swept every `followMs`. */
  inboxMs?: number;
  /** Time for a chosen presence to go back to online. Tests shorten it. If not given, it's the contract's time. */
  presenceDurations?: Partial<Record<PresenceDuration, number>>;
  /** The address where people open the web. Used for a decision file's source (the post link). If not given, it's the address the server listens on. */
  publicUrl?: string;
  /** Where people can get this server's source (AGPL section 13). If not given, Omagari's own repo. Shown in the settings window. */
  sourceUrl?: string;
  /** Length of one hour in a decision PR's objection window. By default it's really one hour. Tests shorten it. Whether the window closed is checked every `followMs`. */
  hourMs?: number;
  /** Number of debate rounds. Default is `DEBATE_ROUNDS` (a blinded first round and two rebuttal rounds) and it can be reduced. */
  debateRounds?: number;
  /** Time before an unfinished debate expires. Default 14 days (`INBOX_MS`). Tests shorten it. Expiry is checked every `followMs`. */
  debateMs?: number;
  /** Running on Fly (`FLY_APP_NAME` is set). Only then is the Fly-Client-IP the front adds trusted as the client address. */
  behindFly?: boolean;
  /** Time to finish hello. Default 10 seconds. Tests shorten it. */
  helloMs?: number;
  /**
   * Limits (ADR-0052): requests per person a minute, repos and stored megabytes per workspace, and GIF searches per workspace an hour.
   * An unset one is no limit, so a server with none works as before.
   */
  limits?: Partial<Record<(typeof LIMITS)[number], number>>;
  /** Folder of the built web UI (`vite build`'s dist). If given, it's served from the same address as the API. In development it's not given and Vite is used. */
  webDir?: string;
}) {
  /** Where an account's admin installs the GitHub App. None for an OAuth app. */
  const install =
    options.githubApp && `https://github.com/apps/${options.githubApp}/installations/new`;
  /** What to add to a "can't see the repo" message on a GitHub App server: the App may not be installed on that account. */
  const installHint = install
    ? ` If the Omagari GitHub App isn't installed on that account, its admin installs it: ${install}`
    : "";
  /** Sessions whose GitHub token is being refreshed. A refresh token works once, so calls at the same time share one refresh. */
  const refreshing = new Map<string, Promise<string>>();
  /**
   * `token`, or its session's refreshed token if a GitHub App's token is about to expire (ADR-0053). An OAuth app's token never expires and passes as is.
   * If GitHub rejects the refresh token, the session ends and the person signs in again. If the refresh fails, the old token goes on,
   * and GitHub's answer to it is what callers already handle for a token that stopped working.
   */
  const fresh = (token: string) => {
    const row = db
      .prepare(
        "SELECT hash, dec(refresh_token) AS refresh_token, expires_at FROM sessions WHERE token_hash = ?",
      )
      .get(hash(token)) as
      | { hash: string; refresh_token: string | null; expires_at: number | null }
      | undefined;
    if (!row?.refresh_token || (row.expires_at ?? 0) > Date.now() + REFRESH_AHEAD_MS) return token;
    const { hash: session, refresh_token } = row;
    let pending = refreshing.get(session);
    if (!pending) {
      pending = (async () => {
        const got = await options.github.refresh(refresh_token).catch((error: Error) => {
          console.error("Couldn't refresh a GitHub token:", error.message);
          return undefined;
        });
        if (!got) return token; // GitHub didn't answer. Try again on the next call
        if ("error" in got) {
          endSession(session, {
            code: "unauthorized",
            message: "GitHub sign-in expired. Log in again (omagari setup)",
          });
          return token;
        }
        db.prepare(
          "UPDATE sessions SET github_token = ?, token_hash = ?, refresh_token = ?, expires_at = ? WHERE hash = ?",
        ).run(
          enc(got.token),
          hash(got.token),
          enc(got.refreshToken),
          Date.now() + got.expiresInMs,
          session,
        );
        return got.token;
      })().finally(() => refreshing.delete(session));
      refreshing.set(session, pending);
    }
    return pending;
  };
  /** GitHub, but every call that takes a token gets a fresh one first. */
  const github = Object.fromEntries(
    Object.entries(options.github).map(([name, call]) => [
      name,
      ["startDevice", "pollDevice", "refresh"].includes(name)
        ? call
        : async (token: string, ...rest: unknown[]) =>
            (call as (...args: unknown[]) => unknown)(await fresh(token), ...rest),
    ]),
  ) as GitHub;
  /** Accounts to accept (lowercase). */
  const accounts = new Set(options.accept.map((entry) => entry.split("/")[0]?.toLowerCase()));
  /** Repos set by the server config. */
  const seeds = options.accept.filter((entry) => entry.includes("/"));
  /** The repo from when there was one repo. Rows in an existing DB without a repo belong to this repo. */
  const legacy = seeds[0];
  const version = checkoutVersion();
  const hostname = options.hostname ?? "127.0.0.1";
  const db = new DatabaseSync(options.database ?? ":memory:");
  // Sessions are kept only as hashes. The GitHub token never leaves the server.
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    github_token TEXT NOT NULL
  ) STRICT`);
  // A GitHub App's token expires (ADR-0053): the refresh token and when the token expires (ms). Both NULL for an OAuth app's token.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'refresh_token'").get())
    db.exec(`ALTER TABLE sessions ADD COLUMN refresh_token TEXT;
      ALTER TABLE sessions ADD COLUMN expires_at INTEGER`);
  // GitHub tokens are encrypted at rest (ADR-0053). `token_hash` finds a session by its token, since the encrypted text differs each time.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'token_hash'").get())
    db.exec("ALTER TABLE sessions ADD COLUMN token_hash TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS sessions_token ON sessions (token_hash)");
  const tokenKey = tokenKeyFor(options.tokenKey, options.database);
  const enc = (plain: string) => encryptToken(tokenKey, plain);
  const dec = (text: unknown) => decryptToken(tokenKey, String(text));
  db.function("dec", { deterministic: true }, (text) => (text === null ? null : dec(text)));
  // Encrypt tokens an older server left in plain text. A token that doesn't open with this key (the key changed) ends its session: the person signs in again.
  for (const row of db.prepare("SELECT hash, github_token, refresh_token FROM sessions").all() as {
    hash: string;
    github_token: string;
    refresh_token: string | null;
  }[]) {
    if (isEncrypted(row.github_token)) {
      if (decryptToken(tokenKey, row.github_token) === null)
        db.prepare("DELETE FROM sessions WHERE hash = ?").run(row.hash);
      continue;
    }
    db.prepare(
      "UPDATE sessions SET github_token = ?, token_hash = ?, refresh_token = ? WHERE hash = ?",
    ).run(
      enc(row.github_token),
      hash(row.github_token),
      row.refresh_token === null ? null : enc(row.refresh_token),
      row.hash,
    );
  }
  // Each member's GitHub profile name. Rewritten at every login.
  db.exec(`CREATE TABLE IF NOT EXISTS people (
    login TEXT PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT`);
  // The last observation for each work (member + branch). `files` is the contract's ObservedFile array (JSON).
  db.exec(`CREATE TABLE IF NOT EXISTS works (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    base TEXT NOT NULL,
    share TEXT NOT NULL,
    files TEXT NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT`);
  // The one-line status the agent wrote for each work. `at` is the time written (ms). It can be written for a branch with no observation, and shows once observed.
  db.exec(`CREATE TABLE IF NOT EXISTS lines (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT`);
  // The executors each member's runner reported when it connected. There is one agent per executor (ADR-0015). They stay after the runner drops and show as offline.
  db.exec(`CREATE TABLE IF NOT EXISTS agents (
    login TEXT NOT NULL,
    executor TEXT NOT NULL,
    PRIMARY KEY (login, executor)
  ) STRICT`);
  // Each work's agent: the executor that last sent a hook or status set on that branch (ADR-0015). A work with only observations has none.
  db.exec(`CREATE TABLE IF NOT EXISTS work_agents (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    executor TEXT NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT`);
  // Members whose runner dropped, and when it dropped (ms). Removed when the runner connects.
  db.exec(`CREATE TABLE IF NOT EXISTS offline (
    login TEXT PRIMARY KEY,
    since INTEGER NOT NULL
  ) STRICT`);
  // Each person's self-chosen presence and status message. `presence` is the contract's ChosenPresence, `until` is when the choice ends (ms),
  // and NULL means until they change it. `message` and `emoji` (one emoji before the text) are absent if empty. Whether they're present (a web window) isn't kept here.
  db.exec(`CREATE TABLE IF NOT EXISTS profiles (
    login TEXT PRIMARY KEY,
    presence TEXT NOT NULL,
    until INTEGER,
    message TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT ''
  ) STRICT`);
  // The v0.1.0 table has no `emoji`.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('profiles') WHERE name = 'emoji'").get())
    db.exec("ALTER TABLE profiles ADD COLUMN emoji TEXT NOT NULL DEFAULT ''");
  // Chat channels. Names are case-insensitive and unique.
  db.exec(`CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  ) STRICT`);
  // Channel messages. `id` only grows across the whole workspace (AUTOINCREMENT never reuses one even after a delete).
  // When the web reconnects, it resumes from the messages after this number. `at` is the time written (ms).
  // Exactly one of `text` (a message a person wrote) or `qa` (a Q&A number, for a public Q&A) is set. A Q&A's `login` is that agent's owner.
  // `note` is what the person who posted the Q&A wrote with it (NULL if none). Changing the CHECK on `text` means rebuilding the table, so it's separate.
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
  // The v0.1.0 table has no `note`.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'note'").get())
    db.exec("ALTER TABLE messages ADD COLUMN note TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel, id)");
  // Message reactions (ADR-0044): one row per (message, emoji, member). `at` is the time added (ms).
  // A message's `reacted` is when its reactions last changed (ms). It lets a reconnecting web resend what changed while it was disconnected (since removing a reaction leaves no row).
  db.exec(`CREATE TABLE IF NOT EXISTS reactions (
    message INTEGER NOT NULL REFERENCES messages (id),
    emoji TEXT NOT NULL,
    login TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (message, emoji, login)
  ) STRICT`);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'reacted'").get())
    db.exec("ALTER TABLE messages ADD COLUMN reacted INTEGER");
  // Replies (ADR-0047): `reply_to` is the original message's number in the same channel, `notify` is whether to notify its author (1, 0).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'reply_to'").get())
    db.exec(`ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages (id);
      ALTER TABLE messages ADD COLUMN notify INTEGER`);
  // Threads (ADR-0047): `thread_of` is the thread's original message in the same chat channel, `also_in_channel` whether the reply also shows in the channel (1, 0).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'thread_of'").get())
    db.exec(`ALTER TABLE messages ADD COLUMN thread_of INTEGER REFERENCES messages (id);
      ALTER TABLE messages ADD COLUMN also_in_channel INTEGER;
      CREATE INDEX messages_thread ON messages (thread_of)`);
  // The post on an alert (Q&A Q3) is one line of a channel. So text, past conversation, DMs, `@mentions`, and posting to the channel run the same way as in a channel.
  // `alert` is the number of the message the alert stands on, and NULL for a chat channel. A post's `name` is a name a person can't write (it starts with a line break),
  // so it never collides with a chat channel's name. `postName` builds the name people read. The v0.1.0 table has no `alert`.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'alert'").get())
    db.exec("ALTER TABLE channels ADD COLUMN alert INTEGER REFERENCES messages (id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS channels_by_alert ON channels (alert)");
  // The verdict posted to the issue (#134): `verdict` is what the issue was last matched to (confirmed, cleared, passed), and the numbers of the comments posted are kept in
  // `verdict_comments` so reading comments doesn't bring them back in as post messages.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'verdict'").get())
    db.exec("ALTER TABLE channels ADD COLUMN verdict TEXT");
  db.exec("CREATE TABLE IF NOT EXISTS verdict_comments (id INTEGER PRIMARY KEY) STRICT");
  // A decision wrapped up from a post and its decision PR (ADR-0025). `login` is the member who wrapped it up, `pull` and `url` are the PR's number and address, `span` is the objection window,
  // `state` is the state read from the PR (proposed, accepted, closed), and `at` is when it was wrapped up (ms).
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
  // A decision PR's line has `decision` (the decision number). `text` is what happened, `note` is why it's blocked, and `login` is who did it (an empty name if none).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'decision'").get())
    db.exec("ALTER TABLE messages ADD COLUMN decision INTEGER REFERENCES decisions (id)");
  // Objection window and agreements (#86). `branch` is the decision PR's branch, `deciders` is a JSON array of decider logins, `closes` is when the window closes (ms),
  // `reopened` is whether it reopened after all objections were withdrawn, `early` is whether it merged early because everyone agreed, and `stuck` is a blocked or stalled merge ({kind, reason}).
  // Decision #83 doesn't know its deciders, so it doesn't merge early, and its window counts from when it was wrapped up.
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
  // Absentees of a debate with a proxy (#198). A JSON array of logins, and all of them must agree to merge.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('decisions') WHERE name = 'absent'").get())
    db.exec("ALTER TABLE decisions ADD COLUMN absent TEXT NOT NULL DEFAULT '[]'");
  // Deciders' agreements. The wrapper-up's isn't stored (they always agree).
  db.exec(`CREATE TABLE IF NOT EXISTS agreements (
    decision INTEGER NOT NULL REFERENCES decisions (id),
    login TEXT NOT NULL,
    PRIMARY KEY (decision, login)
  ) STRICT`);
  // Objections raised. One from a post (`post`) and one from a GitHub changes-requested review (`github`). Removed when withdrawn. `at` is when it was raised (ms).
  db.exec(`CREATE TABLE IF NOT EXISTS objections (
    decision INTEGER NOT NULL REFERENCES decisions (id),
    login TEXT NOT NULL,
    via TEXT NOT NULL CHECK (via IN ('post', 'github')),
    at INTEGER NOT NULL,
    PRIMARY KEY (decision, login, via)
  ) STRICT`);
  // Channel kind (ADR-0027). A post's line is 'chat' and is told apart by `alert`. Tables from before stage 2 have no `kind`.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('channels') WHERE name = 'kind'").get())
    db.exec(
      "ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'forum'))",
    );
  // A post's GitHub issue (ADR-0032). `issue` is the number (NULL if it couldn't be opened yet), and the title, labels (JSON), and open state are what was last read from GitHub.
  // `issue_closed` is when Omagari closed the issue because the alert resolved (ms). If a person reopens it, it's not closed again.
  // A message's `comment` is the number of the issue comment matched to that message. A post's message was posted as a comment, or a comment came in as a message. `github` set to 1 means it came in.
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
  // Alerts (ADR-0023): one per pair of works and kind (`kind`). In a channel it stands as one messages row (`alert`). That row's `text` is empty and `login` is an empty name
  // (changing the CHECK on `text` means rebuilding the table). `pair` is the key with the two works in a fixed order, `works` is two contract WorkRefs (JSON),
  // and `files` is everything grouped (for a direct conflict, the contract's AlertFile array with confirmed ones first and then by path; for other kinds, an AlertSymbol array by name). `resolved` is when it resolved (ms), and there is one unresolved alert per pair.
  // `updated` is when it was last changed (ms). When a live connection reconnects, alerts changed while it was down are resent.
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
  // A table with only direct conflicts has no `kind`. A direct conflict's `pair` stays as is, and other kinds put the kind before `pair`.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'kind'").get())
    db.exec("ALTER TABLE alerts ADD COLUMN kind TEXT NOT NULL DEFAULT 'direct'");
  // Merge run (ADR-0036): `run` is the last verdict attached to an indirect conflict alert (the contract's AlertRun, JSON), and `confirmed` is whether it broke and was confirmed (0, 1).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'run'").get())
    db.exec(`ALTER TABLE alerts ADD COLUMN run TEXT;
      ALTER TABLE alerts ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;`);
  // Indirect conflict closed as passed (ADR-0035): if `held` is 1, the alert isn't raised again for that pair until a rerun verdict comes. At most one per pair.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('alerts') WHERE name = 'held'").get())
    db.exec("ALTER TABLE alerts ADD COLUMN held INTEGER NOT NULL DEFAULT 0");
  // The v0.1.0 table has no `alert`.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'alert'").get())
    db.exec("ALTER TABLE messages ADD COLUMN alert INTEGER REFERENCES alerts (id)");
  // A post's labels (ADR-0039, JSON array). Kept in Omagari separately from the issue's labels (`issue_labels`). For posts in a DB without this column,
  // the alert's kind label is added, plus Confirmed if it was confirmed. Issues already opened are left alone (Q&A A10).
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
  // Labels (ADR-0039): the repo's GitHub labels and the importance the team set. Name, color, and description are read from GitHub every round. `github` is the GitHub label id,
  // and a default label not yet on GitHub (the four kinds and Confirmed) is NULL and is created on the next round. As on GitHub, names are case-insensitive.
  db.exec(`CREATE TABLE IF NOT EXISTS labels (
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    github INTEGER UNIQUE,
    color TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    importance TEXT NOT NULL DEFAULT 'reference' CHECK (importance IN ('reference', 'discuss'))
  ) STRICT`);
  /** Adds the repo's default labels if they're missing from the list. If they're not on GitHub, they're created on the next round. */
  const seedLabels = (repo: string) => {
    for (const [name, color] of Object.entries(DEFAULT_LABEL_COLORS))
      db.prepare(
        "INSERT OR IGNORE INTO labels (repo, name, color, importance) VALUES (?, ?, ?, ?)",
      ).run(repo, name, color, DISCUSS_LABELS.includes(name) ? "discuss" : "reference");
  };
  // A forum's filter (ADR-0039, the contract's ForumFilter JSON). Only forums have it; chat, posts, and the alert lines' place (`ALERTS`) are NULL.
  // For a DB without this column: all alert lines move to `ALERTS`, existing forums are filtered to Discuss, and "Conflict" becomes "Discuss" (left alone if the name collides).
  // A freshly started server also gets the "Discuss" and "FYI" forums. A forum deleted after that isn't recreated.
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
    db.prepare(
      "UPDATE OR IGNORE channels SET name = ? WHERE kind = 'forum' AND name = '부딪힘'",
    ).run(IMPORTANCE_LABELS.discuss);
    for (const importance of Importance.options) {
      const filter = JSON.stringify({ importance });
      if (!db.prepare("SELECT 1 FROM channels WHERE filter = ?").get(filter))
        db.prepare(
          "INSERT OR IGNORE INTO channels (id, name, kind, filter) VALUES (?, ?, 'forum', ?)",
        ).run(randomBytes(8).toString("hex"), IMPORTANCE_LABELS[importance], filter);
    }
    db.exec("COMMIT");
  }
  // Inbox (stage 2 Q A5~A7): news to hand to each work (`login` + `branch`). It's either an alert (`alert`) or other news (`news`, JSON of the contract's InboxItem
  // without id, branch, at). `at` is when it came in (ms).
  // There is one undelivered item per work and alert. When a delivery receipt comes it's removed, and after `inboxMs` it's removed as expired.
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
  // The #82 table has no `news` and `alert` is NOT NULL. The table is rebuilt and moved over (numbers continue as they were).
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
  // Claims (ADR-0008). `lines` is a LineRange (JSON) and exists only for symbols and line ranges. `at` is when it was set (ms).
  // `stale` is when the owner went offline past `forgetMs` and it became "stale" (ms); after another `forgetMs` it's removed. Removed when the runner reconnects.
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
  // The #85 table has no plan (`plan`, the contract's Plan JSON).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('claims') WHERE name = 'plan'").get())
    db.exec("ALTER TABLE claims ADD COLUMN plan TEXT");
  // News that stays only in the feed: a claim set or released (`kind` is claim or released, `claim` is the contract's Claim JSON). Removed after `inboxMs`.
  db.exec(`CREATE TABLE IF NOT EXISTS feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`);
  // One setting per workspace: the config file the runner last reported (`check`, the contract's CheckReading JSON).
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`);
  // Q&As. The asker (`login`) is that agent's owner. If private, only that person sees it; if public, one line stands in messages and everyone sees it.
  // `answer` is the contract's Qa.answer (JSON) and is NULL while waiting for an answer. `settled` is when the answer or failure was written (ms).
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
  // Asks (ADR-0024). A question sent by the asking work (`login` + `branch`) to the receiving member (`target`). `executor` is the receiving side's executor, chosen at send time if none was picked.
  // `answer` is the answer or failure put in the inbox (JSON) and is NULL while waiting. `at` is when it was asked (ms) and it's removed after `inboxMs`.
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
  // Members who turned off the switch so they don't answer others' questions (ADR-0024). The default is on, so a missing row means on.
  db.exec("CREATE TABLE IF NOT EXISTS ask_off (login TEXT PRIMARY KEY) STRICT");
  // Each member's personal settings (contract Prefs, JSON). No row means DEFAULT_PREFS.
  db.exec("CREATE TABLE IF NOT EXISTS prefs (login TEXT PRIMARY KEY, prefs TEXT NOT NULL) STRICT");
  // A post's debate (ADR-0040). A post has one debate. `round` is the current round and `state` is `Debate.state`.
  // If `flip` is 1, the order of the sides is reversed from the seats (to blind the owner). `winner` is the seat that became the conclusion, `by` is how it was decided, and `chooser` and `decided` are the member who chose and when (ms).
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
  // A debate request from a member or agent without an evidence label (ADR-0040). Only the latest one per post. If the agenda or evidence is empty, it doesn't open and only this remains.
  db.exec(`CREATE TABLE IF NOT EXISTS debate_requests (
    post TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    agenda TEXT NOT NULL,
    grounds TEXT NOT NULL,
    opened INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) STRICT`);
  // The #195 table has no ending.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('debates') WHERE name = 'state'").get()) {
    db.exec(`ALTER TABLE debates ADD COLUMN state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'choosing', 'concluded', 'ended'));
      ALTER TABLE debates ADD COLUMN flip INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE debates ADD COLUMN winner INTEGER;
      ALTER TABLE debates ADD COLUMN by TEXT;
      ALTER TABLE debates ADD COLUMN chooser TEXT;
      ALTER TABLE debates ADD COLUMN decided INTEGER`);
  }
  // The #196 table has no expiry. Expiry is `state` ended with `expired` 1 (the CHECK isn't changed).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('debates') WHERE name = 'expired'").get())
    db.exec("ALTER TABLE debates ADD COLUMN expired INTEGER NOT NULL DEFAULT 0");
  // A debate's seats. `seat` is the alert's `works` slot (0, 1). `stance` is a JSON array of the stance given each round (the #195 row has one stance), and `error` is why it couldn't give one (JSON).
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
  // The issue comments that posted a debate's stances and conclusion (ADR-0040). `seat` is the seat (0, 1) and the conclusion is -1, and `round` is the stance's round (from 0). These comments aren't brought back in as post messages.
  db.exec(`CREATE TABLE IF NOT EXISTS debate_comments (
    debate INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    round INTEGER NOT NULL,
    id INTEGER NOT NULL,
    PRIMARY KEY (debate, seat, round)
  ) STRICT`);
  // Proxy (#198). `proxy` is the member who called a proxy for this seat.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('seats') WHERE name = 'proxy'").get())
    db.exec("ALTER TABLE seats ADD COLUMN proxy TEXT");
  // Members who showed up each day (ADR-0018). The day is a date in `TIME_ZONE`. This is all the metrics keep, and the Q&A count is counted from `qas`.
  // Metrics are per workspace (ADR-0043). If one person enters two workspaces, they're counted once a day in each.
  db.exec(`CREATE TABLE IF NOT EXISTS visits (
    day TEXT NOT NULL,
    workspace TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (day, workspace, login)
  ) STRICT`);
  // Merge run verdict counts (ADR-0018, ADR-0036). Counted once per fingerprint. No names are kept, only the fingerprint, verdict, and time.
  db.exec(`CREATE TABLE IF NOT EXISTS merge_runs (
    fingerprint TEXT PRIMARY KEY,
    verdict TEXT NOT NULL,
    at INTEGER NOT NULL,
    workspace TEXT NOT NULL DEFAULT ''
  ) STRICT`);
  // A workspace's repos (ADR-0043). Names are case-insensitive like GitHub, and other tables keep the form written here. `at` is when it was added (ms).
  db.exec(`CREATE TABLE IF NOT EXISTS repos (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    at INTEGER NOT NULL
  ) STRICT`);
  // Repos each member has push access to (ADR-0043). Reread at login and every `recheckMs`. Having any one makes them a member.
  const hadAccess = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'access'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS access (
    login TEXT NOT NULL,
    repo TEXT NOT NULL,
    PRIMARY KEY (login, repo)
  ) STRICT`);
  // Per-repo tables (ADR-0043). A DB from when there was one repo has no `repo` column. Those rows move to the old repo (`legacy`).
  // A table whose key changes is rebuilt, and only a column is added to a table that other tables point to (alerts) or whose key stays the same.
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
        "This is a DB from when there was one repo, and OMAGARI_REPO has no owner/name, so existing data isn't visible in any repo",
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
        // Only posts belong to a repo. Chat channels and forums belong to the workspace, so they're NULL (the channel's two layers are #237).
        db.exec("ALTER TABLE channels ADD COLUMN repo TEXT");
        db.prepare("UPDATE channels SET repo = ? WHERE alert IS NOT NULL").run(legacy ?? "");
      } else {
        db.exec(`ALTER TABLE ${table} ADD COLUMN repo TEXT NOT NULL DEFAULT ''`);
        db.prepare(`UPDATE ${table} SET repo = ?`).run(legacy ?? "");
      }
    }
    // There is one unresolved alert per pair in a repo.
    db.exec("DROP INDEX IF EXISTS alerts_open");
    db.exec("CREATE UNIQUE INDEX alerts_open ON alerts (repo, pair) WHERE resolved IS NULL");
    // Check commands are per repo.
    if (legacy !== undefined)
      db.prepare("UPDATE settings SET key = ? WHERE key = 'check'").run(`check ${legacy}`);
    db.exec("COMMIT");
  }
  // Repos that moved or were renamed (ADR-0043). Config, remotes, and headers that come with the old name are read as the new name.
  db.exec(`CREATE TABLE IF NOT EXISTS repo_moves (
    old TEXT PRIMARY KEY COLLATE NOCASE,
    new TEXT NOT NULL
  ) STRICT`);
  // The repo's GitHub numeric id (#315). Written when added or when push access is first read, and kept even if the repo is removed.
  // The same name with a different id is a different repo: a repo recreated with the same name after being deleted can't see the old repo's data.
  db.exec(`CREATE TABLE IF NOT EXISTS repo_ids (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    id INTEGER NOT NULL
  ) STRICT`);
  /** Whether the repo GitHub calls `repo` (`id`) is the repo this server knows. If the name is new, its id is written. */
  const sameRepo = (repo: string, id: number) => {
    db.prepare("INSERT OR IGNORE INTO repo_ids (name, id) VALUES (?, ?)").run(repo, id);
    return (
      (db.prepare("SELECT id FROM repo_ids WHERE name = ?").get(repo) as { id: number }).id === id
    );
  };
  /** The current name if the repo moved, otherwise the same name. */
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
  // Sessions from when there was one repo came in as having push access to that repo. They're treated that way until rechecked.
  if (!hadAccess && legacy !== undefined)
    db.prepare("INSERT OR IGNORE INTO access (login, repo) SELECT login, ? FROM sessions").run(
      (db.prepare("SELECT name FROM repos WHERE name = ?").get(legacy) as { name: string }).name,
    );
  /** The workspace's repos, in the order added. */
  const allRepos = () =>
    (db.prepare("SELECT name FROM repos ORDER BY at, rowid").all() as { name: string }[]).map(
      (row) => row.name,
    );
  for (const repo of allRepos()) seedLabels(repo);

  // Workspaces (ADR-0043): one per repo account (`ownerOf`). Chat channels, forums, daily visits, and merge run verdict counts are split per workspace.
  // A workspace is created when a repo of that account first comes in.
  db.exec(
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL) STRICT",
  );
  const hasColumn = (table: string, column: string) =>
    db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = '${column}'`).get();
  // A person's GitHub profile picture (#288). Reread with the name at login and every 10 minutes.
  if (!hasColumn("people", "avatar")) db.exec("ALTER TABLE people ADD COLUMN avatar TEXT");
  // A person's GitHub numeric id (#315). Written at login. If another id used this name before, they can't get in.
  if (!hasColumn("people", "github_id")) db.exec("ALTER TABLE people ADD COLUMN github_id INTEGER");
  // The account kind and avatar (the name line of mockup 101). Read from GitHub and updated when a member's push access is read.
  if (!hasColumn("workspaces", "kind")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'organization'");
    db.exec("ALTER TABLE workspaces ADD COLUMN avatar TEXT");
  }
  if (!hasColumn("channels", "workspace")) {
    // A channel's name is unique per workspace. The table is rebuilt to drop the UNIQUE that covered the whole table. messages points to this table, so foreign keys are briefly turned off.
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
      throw new Error(`Couldn't rebuild the channels table: ${sql}`);
    db.exec(next);
    db.exec("INSERT INTO channels_next SELECT * FROM channels");
    db.exec("DROP TABLE channels");
    db.exec("ALTER TABLE channels_next RENAME TO channels");
    db.exec(`UPDATE channels SET workspace = ${ownerSql("repo")} WHERE repo IS NOT NULL`);
    db.exec("CREATE UNIQUE INDEX channels_by_alert ON channels (alert)");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");
  }
  // A chat channel's name is unique per layer within a workspace: among workspace channels, and a repo channel within its repo. So a name can't be revealed by colliding with a channel name in a repo you can't access.
  // Forums aren't in the index: a forum you can't see may share a name with one you can, so `mustBeNew` checks only what the caller can see.
  db.exec("DROP INDEX IF EXISTS channels_by_name");
  db.exec("DROP INDEX IF EXISTS channels_by_layer_name");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS channels_by_chat_name ON channels (workspace, COALESCE(repo, ''), name) WHERE kind != 'forum'",
  );
  /** Puts the "Discuss" and "FYI" forums in a new workspace. */
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
   * Creates the workspace of `repo` if it doesn't exist. Chat channels and forums with no workspace, left over from a DB from when there was one workspace,
   * are taken over by the first workspace created, and if there's nothing to take over, the default forums are added.
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
   * Moves everything of repo `from`, which moved or was renamed on GitHub, under the new name `to` (ADR-0043). Every table with a `repo` column,
   * the repo's channels (to that workspace if it went to another account), the filters of forums in the same workspace, check commands, and connected runners and webs.
   * If it went outside the accepted accounts or the new name is already in the workspace, it isn't moved and the old name stays (GitHub hands over the old name, so it keeps working).
   */
  const moveRepo = (from: string, to: string) => {
    if (!accounts.has(ownerOf(to))) {
      console.warn(
        `${from} moved to ${to}, but that's outside the accepted accounts (OMAGARI_REPO), so the old name stays`,
      );
      return false;
    }
    if (
      to.toLowerCase() !== from.toLowerCase() &&
      allRepos().some((r) => r.toLowerCase() === to.toLowerCase())
    ) {
      console.warn(
        `${from} moved to ${to}, but ${to} is already in the workspace, so the old name stays`,
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
      console.error(`Couldn't move ${from} to ${to}:`, error);
      return false;
    }
    ensureWorkspace(to);
    for (const runner of runners.values()) if (runner.repo === from) runner.repo = to;
    for (const watcher of watchers.values())
      if (watcher.repo === from) Object.assign(watcher, { repo: to, workspace: ownerOf(to) });
    console.log(`${from} moved to ${to} on GitHub, so we followed`);
    return true;
  };
  // Chat channels belong to a repo or a workspace (ADR-0043). Chat channels that existed before become channels of that workspace's first repo.
  // Done only once: a mark is left so workspace channels created later (no repo) aren't moved again.
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
  /** Visits and verdict counts from when there was one workspace belong to the first workspace created. */
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

  // The server just started, so answers to Q&As sent to a runner won't come. Mark them failed so they don't stay waiting.
  db.prepare("UPDATE qas SET answer = ?, settled = ? WHERE answer IS NULL").run(
    JSON.stringify({
      state: "failed",
      error: {
        code: "runner_offline",
        message: "The server restarted, so the answer never arrived",
      },
    }),
    Date.now(),
  );
  // Repo sharing (ADR-0049): each member's yes, once per repo, to let their runner observe it.
  // Members who already observed a repo before sharing existed (a work or a dropped runner there) count as shared.
  const hadShares = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'shares'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS shares (
    repo TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (repo, login)
  ) STRICT`);
  if (!hadShares)
    db.exec(
      "INSERT OR IGNORE INTO shares (repo, login) SELECT repo, login FROM works UNION SELECT repo, login FROM offline",
    );
  // When a work's files last changed (ms), and a digest of the files as the runner sent them. Content older than `contentMs` is dropped (ADR-0054).
  if (!db.prepare("SELECT 1 FROM pragma_table_info('works') WHERE name = 'changed'").get()) {
    db.exec(
      "ALTER TABLE works ADD COLUMN changed INTEGER NOT NULL DEFAULT 0; ALTER TABLE works ADD COLUMN digest TEXT NOT NULL DEFAULT ''",
    );
    db.prepare("UPDATE works SET changed = ?").run(Date.now());
  }
  // Members whose runner has connected here at least once. The web shows "Connect your computer" until then (#354).
  const hadSeen = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'runner_seen'").get();
  db.exec("CREATE TABLE IF NOT EXISTS runner_seen (login TEXT PRIMARY KEY) STRICT");
  if (!hadSeen)
    db.exec(
      "INSERT OR IGNORE INTO runner_seen (login) SELECT login FROM shares UNION SELECT login FROM agents",
    );
  const shared = (repo: string, login: string) =>
    !!db.prepare("SELECT 1 FROM shares WHERE repo = ? AND login = ?").get(repo, login);

  // The server just started, so no runner is connected. Members who were already dropped keep their drop time.
  db.prepare(
    `INSERT OR IGNORE INTO offline (repo, login, since)
     SELECT repo, login, ? FROM works UNION SELECT repo, login, ? FROM lines`,
  ).run(Date.now(), Date.now());

  /**
   * Replaces a member's works with what the runner sees now.
   * A work that had observed changes and went to 0 loses the line the agent wrote. A work that was 0 from the start keeps its line (ADR-0010).
   */
  // ponytail: one runner per member per repo. If a member starts runners for the same repo on two machines, the later sender overwrites. Split per runner then.
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
    const before = new Map(
      (
        db
          .prepare("SELECT branch, changed, digest FROM works WHERE repo = ? AND login = ?")
          .all(repo, login) as { branch: string; changed: number; digest: string }[]
      ).map((row) => [row.branch, row]),
    );
    db.prepare("DELETE FROM works WHERE repo = ? AND login = ?").run(repo, login);
    const insert = db.prepare(
      "INSERT OR REPLACE INTO works (repo, login, branch, base, share, files, changed, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const now = Date.now();
    const clear = db.prepare("DELETE FROM lines WHERE repo = ? AND login = ? AND branch = ?");
    for (const work of works) {
      // Files that look the same as last time haven't changed. Old ones come back without content even if the runner sends it again.
      const digest = hash(JSON.stringify(work.files));
      const prev = before.get(work.branch);
      const changedAt = prev?.digest === digest ? prev.changed : now;
      const old = changedAt < now - (options.contentMs ?? CONTENT_MS);
      const files = old ? work.files.map(dropContent) : work.files;
      insert.run(
        repo,
        login,
        work.branch,
        work.base,
        work.share,
        JSON.stringify(files),
        changedAt,
        digest,
      );
      // An empty files in an intent means not sent, not that changes went to 0. Even if the level drops, the written line stays.
      if (work.share !== "intent" && work.files.length === 0 && changed.has(work.branch)) {
        clear.run(repo, login, work.branch);
      }
    }
    db.exec("COMMIT");
  };
  /**
   * Drops changed-file content of works unchanged for `contentMs`, and debate patches whose work is gone or whose debate opened that long ago (ADR-0054).
   * Paths, status lines and chat stay. A work whose branch is gone is deleted from `works` when its runner reports, so only patches need the gone check here.
   * ponytail: reads every old work and every seat with a patch each period. When that gets big, keep a flag for rows already dropped.
   */
  const dropStaleContent = (now: number) => {
    const cutoff = now - (options.contentMs ?? CONTENT_MS);
    const putFiles = db.prepare(
      "UPDATE works SET files = ? WHERE repo = ? AND login = ? AND branch = ?",
    );
    for (const row of db
      .prepare("SELECT repo, login, branch, files FROM works WHERE changed < ?")
      .all(cutoff) as { repo: string; login: string; branch: string; files: string }[]) {
      const files: ObservedFile[] = JSON.parse(row.files);
      const dropped = JSON.stringify(files.map(dropContent));
      if (dropped !== row.files) putFiles.run(dropped, row.repo, row.login, row.branch);
    }
    const putStance = db.prepare("UPDATE seats SET stance = ? WHERE debate = ? AND seat = ?");
    for (const row of db
      .prepare(
        `SELECT s.debate, s.seat, s.stance, d.at,
           EXISTS (SELECT 1 FROM works w WHERE w.repo = c.repo AND w.login = s.login AND w.branch = s.branch) AS live
         FROM seats s JOIN debates d ON d.id = s.debate JOIN channels c ON c.id = d.post
         WHERE s.stance LIKE '%"patch":"_%'`,
      )
      .all() as { debate: number; seat: number; stance: string; at: number; live: number }[]) {
      if (row.live && row.at >= cutoff) continue;
      const stored = JSON.parse(row.stance);
      const next = (Array.isArray(stored) ? stored : [stored]).map((stance: Stance) =>
        stance.experiment ? { ...stance, experiment: { ...stance.experiment, patch: "" } } : stance,
      );
      putStance.run(JSON.stringify(next), row.debate, row.seat);
    }
  };
  /** The title of the open draft PR for each repo and branch. The key is JSON of `[repo, branch]`. Reread from GitHub every `followMs`. Lost when the server stops and reread on the next round. */
  let drafts = new Map<string, string>();
  /** SQL that yields a repo's members (they have a session and push access to that repo). Takes one repo. */
  const MEMBERS =
    "(SELECT login FROM access WHERE repo = ? AND login IN (SELECT login FROM sessions))";
  /** Repos visible to a member (ones they have push access to), in the order added. */
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
  /** The repo of a post (channel id). None if it isn't a post. */
  const postRepo = (post: string) =>
    (
      db.prepare("SELECT repo FROM channels WHERE id = ? AND alert IS NOT NULL").get(post) as
        | { repo: string }
        | undefined
    )?.repo;
  /** A channel's workspace. None for the alert lines' place (`ALERTS`) and for a missing channel. */
  const channelWorkspace = (channel: string) =>
    (
      db.prepare("SELECT workspace FROM channels WHERE id = ?").get(channel) as
        | { workspace: string | null }
        | undefined
    )?.workspace ?? undefined;
  /** A channel's repo: posts and repo channels. None for workspace channels and missing channels. */
  const channelRepo = (channel: string) =>
    (
      db.prepare("SELECT repo FROM channels WHERE id = ?").get(channel) as
        | { repo: string | null }
        | undefined
    )?.repo ?? undefined;
  /** The workspaces (`id`) a member is in, in the order added. */
  const workspacesOf = (login: string) => [...new Set(reposOf(login).map(ownerOf))];
  /** The repo of a post visible to the member. `not_found` if it's missing or not visible. */
  const seenPost = (login: string, post: string) => {
    const repo = postRepo(post);
    if (!sees(login, repo))
      throw new ContractFailure({ code: "not_found", message: `No such post: ${post}` });
    return repo as string;
  };
  const sessionLogin = (session: string) =>
    (
      db.prepare("SELECT login FROM sessions WHERE hash = ?").get(hash(session)) as
        | { login: string }
        | undefined
    )?.login;

  /** Records that a member came in today. Only call from places only the web calls (live connection, reading and writing in a channel). Runners and the CLI aren't counted. */
  const visit = (login: string, workspace: string) =>
    db
      .prepare("INSERT OR IGNORE INTO visits (day, workspace, login) VALUES (?, ?, ?)")
      .run(dayOf(Date.now()), workspace, login);

  /** Unfinished device authorizations. Lost when the server stops. Just log in again. */
  const logins = new Map<
    string,
    {
      deviceCode: string;
      expiresAt: number;
      intervalMs: number;
      nextPollAt: number;
      /** The starter's address and when it last polled. Abandoned ones are removed and counted per address. */
      client: string;
      polledAt: number;
    }
  >();
  /** Number currently opening a device authorization with GitHub. Counted ahead of time so the cap holds even while waiting. */
  let startingLogins = 0;
  /** Number per address currently opening a device authorization with GitHub. The per-address cap holds even if one address sends many at once. */
  const startingFrom = new Map<string, number>();
  /** Runner connections that finished hello, the executors those runners run, and each executor's pick count. */
  const runners = new Map<
    WSContext,
    {
      login: string;
      hash: string;
      /** The repo this runner is attached to (ADR-0043). */
      repo: string;
      executors: ExecutorId[];
      choices: Partial<Record<ExecutorId, Choices>>;
      mergeCheck: MergeCheckState;
      /** The member shared this repo (ADR-0049). Until then nothing it observes is taken. */
      shared: boolean;
    }
  >();
  /** Live web connections that finished hello, with each session's hash, member, and chosen repo. Closed when the session ends. */
  const watchers = new Map<
    WSContext,
    { hash: string; login: string; repo: string; workspace: string }
  >();
  /**
   * Whether it's OK to send to a web or runner connection. It must be open, and the repo that connection chose (for a runner, the one it's linked to) must still be visible to that person.
   * Every send to the web and to runners goes through this, so a connection that lost access while push access is being reread doesn't receive anything before it's closed.
   */
  const open = (socket: WSContext, watcher: { login: string; repo: string }) =>
    socket.readyState === 1 && sees(watcher.login, watcher.repo); // OPEN
  /** Sends a workspace's item to every web that chose that workspace. It doesn't go to a connection that chose another workspace, even the same person's. */
  const broadcast = (workspace: string, frame: string) => {
    for (const [socket, watcher] of watchers)
      if (watcher.workspace === workspace && open(socket, watcher)) socket.send(frame);
  };
  /** Sends a repo's item only to webs that can see that repo, and only to connections that chose that repo's workspace. */
  const broadcastTo = (repo: string, frame: string) => {
    for (const [socket, watcher] of watchers)
      if (watcher.workspace === ownerOf(repo) && sees(watcher.login, repo) && open(socket, watcher))
        socket.send(frame);
  };
  /** Sends one channel line to the webs that can see it and returns it in the contract's shape. */
  const shareRow = (row: MessageRow) => {
    const message = messageView(row);
    const frame = encode(serverToWeb, "message", message);
    if (row.repo !== null) broadcastTo(row.repo, frame);
    else if (row.workspace !== null) broadcast(row.workspace, frame);
    return message;
  };
  /** Sends only to `login`'s web connections. Private DMs go out only this way. If `workspace` is given, it goes only to connections that chose that workspace. */
  const sendTo = (login: string, frame: string, workspace?: string) => {
    for (const [socket, watcher] of watchers) {
      if (
        watcher.login === login &&
        (workspace === undefined || watcher.workspace === workspace) &&
        open(socket, watcher)
      )
        socket.send(frame);
    }
  };
  /** Q&As sent to a runner and waiting for an answer. The key is the sent `ask`'s id. Lost when the server stops, and marked failed when it starts again. */
  const asks = new Map<
    string,
    { socket: WSContext; login: string; executor: ExecutorId; qa: number }
  >();
  /** Questions (asks) sent to the receiving runner and waiting for an answer. The key is the sent `question`'s id. Lost when the connection drops or the server restarts, and resent when the runner connects. */
  const questionsSent = new Map<string, { socket: WSContext; executor: ExecutorId; id: number }>();
  /**
   * A Q&A was created or changed. Sent to the asker's connections, and if the Q&A is public, the line standing in the channel is resent to everyone.
   * Returns the line standing in the channel, if any.
   */
  const shareQa = (id: number) => {
    const asked = db.prepare(`${QAS} WHERE id = ?`).get(id) as QaRow;
    const qa = qaView(asked);
    const row = db.prepare(`${MESSAGES} WHERE m.qa = ?`).get(id) as MessageRow | undefined;
    sendTo(asked.login, encode(serverToWeb, "qa", qa), channelWorkspace(asked.channel));
    if (!row) return { qa };
    return { qa, message: shareRow(row) };
  };
  /** Writes the answer or failure to a waiting Q&A, sends it to those who can see it, and clears the in-progress marker. */
  const settle = (id: string, answer: Exclude<Qa["answer"], { state: "pending" }>) => {
    const ask = asks.get(id);
    // If the server is shutting down, the DB may already be closed. Remaining Q&As are marked failed when it starts again.
    if (!ask || stopped) return;
    asks.delete(id);
    db.prepare("UPDATE qas SET answer = ?, settled = ? WHERE id = ?").run(
      JSON.stringify(answer),
      Date.now(),
      ask.qa,
    );
    const { message } = shareQa(ask.qa);
    if (message) syncSoon(message.channel); // the `@mention` answer goes to the issue comment
    shareMembers();
  };
  /** Decision drafts sent to a runner and waiting (ADR-0028). The key is the sent `draft`'s id and is `Draft.id`. Not stored. */
  const drafting = new Map<
    string,
    { socket: WSContext; login: string; executor: ExecutorId; draft: Draft }
  >();
  /** Finishes a waiting draft and sends it to the person who asked. None if it's already finished. */
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

  /** All works in a repo that its members see. The web and runners see the same thing. */
  const worksView = (repo: string): WorkView[] => {
    // Works of people who left the repo (no session or no push access) aren't visible.
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
      // Order of choice: the line the agent wrote -> the draft PR title -> the file being edited -> none. Offline goes separately through offlineSince.
      const line: StatusLine | null =
        text !== null && at !== null
          ? { source: "agent", text, at: new Date(at).toISOString() }
          : draft !== undefined
            ? { source: "pull", text: draft }
            : changes;
      const offlineSince = since === null ? null : new Date(since).toISOString();
      return { login, branch, base, share, files, line, offlineSince };
    });
  };

  /**
   * The works to show in the member list (and `omagari status`, which filters by it) (ADR-0006). A work with no changes, so no status line (the agent's line, draft PR, changed files),
   * and no claim is hidden. `api.works`, the runner's situation, and conflict computation use the unfiltered worksView as is.
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
  /** All claims in the repo. Claims by people who left the repo, like work, are hidden. */
  const claimsView = (repo: string): Claim[] =>
    (
      db
        .prepare(`SELECT * FROM claims WHERE repo = ? AND login IN ${MEMBERS} ORDER BY id`)
        .all(repo, repo) as ClaimRow[]
    ).map(claimView);

  /** Releases a claim. Logs it to the feed and returns what was released. The caller sends the situation. */
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

  /** The change a plan would make to the claimed work's definition line. A rename drops the old name. */
  const PLAN_CHANGE = { rename: "removed", signature: "changed", delete: "removed", add: "added" };
  /**
   * Alerts a cancel for the parts of a released claim's plan that never happened (the work's observation never changed the definition line as planned).
   * Puts it in the inbox of other work that got an open declared contract change alert for that plan. Not called for claims released by a merge.
   */
  // ponytail: whether it happened is judged only by the definition line in the observation the server received. Intent work never raises a definition line, so it always counts as cancelled.
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
   * Member list: per person, name, online status and status message, the agents per executor, and the one-line status per work. Sorted by name.
   * Online if any web window (live connection) is attached, unless they picked "appear offline" or none is attached; then offline.
   * Someone appearing offline looks the same as someone who really left. The status message shows either way.
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
    // Online status and agents only count what this repo's workspace sees. Windows and runners in other workspaces don't show in this list.
    const workspace = ownerOf(repo);
    const open = new Set(
      [...watchers.values()]
        .filter((watcher) => watcher.workspace === workspace)
        .map((watcher) => watcher.login),
    );
    const now = Date.now();
    const presenceOf = (login: string, chosen: ChosenPresence | null, until: number | null) => {
      // Ended ones are online even before the timer clears them.
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
      // The choices belong to the runner that will get the Q&A (the last one attached).
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

  /** Work of unreleased alerts whose lines are confirmed to conflict. The key is the JSON of `[login, branch]`. */
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

  /** Work of unreleased indirect conflicts that the merge run confirmed as broken ("breaks when merged"). The key is the JSON of `[login, branch]`. */
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

  /** The last direct conflict computation each attached runner sent. Cleared on disconnect. A runner that hasn't sent one has none. */
  const reports = new Map<WSContext, ConflictPair[]>();

  /** Sends one alert's channel line to every attached web. */
  const shareAlert = (alert: number) =>
    shareRow(db.prepare(`${MESSAGES} WHERE m.alert = ?`).get(alert) as MessageRow);

  /** Resends a post's (channel id) alert line to every attached web. Call it when the label or importance changed. */
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
  /** All labels in the repo, in name order. */
  const labelsView = (repo: string) =>
    db
      .prepare(
        "SELECT name, color, description, importance FROM labels WHERE repo = ? ORDER BY name",
      )
      .all(repo) as Label[];
  /** Sends the repo's labels to the webs that picked that repo. */
  const shareLabels = (repo: string) => {
    const frame = encode(serverToWeb, "labels", labelsView(repo));
    for (const [socket, watcher] of watchers)
      if (watcher.repo === repo && open(socket, watcher)) socket.send(frame);
  };
  /** One label in the repo (the name is case-insensitive). */
  const labelRow = (repo: string, name: string) =>
    db
      .prepare(
        "SELECT rowid AS id, name, github, color, description FROM labels WHERE repo = ? AND name = ?",
      )
      .get(repo, name) as
      | { id: number; name: string; github: number | null; color: string; description: string }
      | undefined;
  /**
   * Edits labels per post. `edit` applies the same to the post's labels and, if there's an issue, to the last read issue labels (`issue_labels`).
   * `withIssue` picks whether to edit only posts with an issue (all if not given). Returns the ids of the posts that changed.
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
      openDebate(row.id); // a debate opens if the issue got an evidence label (ADR-0040)
    }
    return changed;
  };
  const labelNameExists = (name: string) =>
    !!db.prepare("SELECT 1 FROM labels WHERE name = ?").get(name);
  /** A repo label was renamed. Renames it in posts and issue labels and tells the webs. */
  const renameLabel = (repo: string, from: string, to: string) => {
    for (const post of editPostLabels(repo, (labels) => labels.map((l) => (l === from ? to : l))))
      sharePost(post);
    // Forums filtering by that label follow the new name too. A forum filtering only that repo gets renamed,
    // and a forum that also filters other repos gets the new name added, so it doesn't lose other repos' posts with the old name.
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
        : [
            // Keep the old name only if another repo still has a label with it. Otherwise the old name of a repo you can't see would leak into the forum.
            ...old.labels.filter((l) => l !== from || labelNameExists(from)),
            ...(old.labels.includes(to) ? [] : [to]),
          ];
      const filter = { ...old, labels: [...new Set(labels)] };
      db.prepare("UPDATE channels SET filter = ? WHERE id = ?").run(JSON.stringify(filter), row.id);
      broadcastChannel(ownerOf(repo), { ...row, filter: JSON.stringify(filter) });
    }
  };
  /**
   * Renames the repo's Korean default labels (before ADR-0045) to English here: the label, posts, their issue labels, and forums.
   * Skips a label GitHub still has under the Korean name, or one whose English name is already linked to GitHub.
   */
  const englishLabels = (repo: string, theirs: RepoLabel[] = []) => {
    for (const [from, to] of Object.entries(KOREAN_LABELS)) {
      const local = labelRow(repo, from);
      if (!local || theirs.some((l) => l.name === from) || labelRow(repo, to)?.github) continue;
      db.prepare("DELETE FROM labels WHERE repo = ? AND name = ?").run(repo, to); // unlinked seed
      db.prepare("UPDATE labels SET name = ? WHERE rowid = ?").run(to, local.id);
      renameLabel(repo, from, to);
    }
  };

  /** A message landed in a channel. For a post, the alert's post count changed, so resend the alert line to everyone. */
  const posted = (channel: string) => {
    const row = db
      .prepare("SELECT a.alert FROM channels c JOIN messages a ON a.id = c.alert WHERE c.id = ?")
      .get(channel) as { alert: number } | undefined;
    if (row) shareAlert(row.alert);
  };

  /** A post's alert message. None for a chat channel. */
  const postAlert = (channel: string) =>
    db.prepare(`${MESSAGES} WHERE m.id = (SELECT alert FROM channels WHERE id = ?)`).get(channel) as
      | MessageRow
      | undefined;

  /** The channel name passed to the runner. For a post, it's built from the alert's number. */
  const channelName = (channel: string) => {
    const alert = postAlert(channel);
    const name = (id: string) =>
      (db.prepare("SELECT name FROM channels WHERE id = ?").get(id) as { name: string }).name;
    return alert ? `Post for alert ${alert.id}` : name(channel);
  };

  /**
   * Merges the runners' computations into one alert per pair of work and kind, then raises, updates, and closes resolved alerts (ADR-0023).
   * Every thing an alert is tied to (files for a direct conflict, symbols for the rest) has a runner that can compute it (`computedBy`).
   * If that runner is attached and didn't send it, it's resolved. If that runner is off, we can't know, so the old state stays.
   * Direct conflicts and duplicate work are computed by both sides' runners, indirect conflicts only by the using side's runner. If both runners sent a file, use the one with confirmed lines.
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
    // Both ends of a pair must be work the server knows (an observation or a claim). Pairs naming unknown work are dropped.
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
        // The direct conflict key is kept as it was when there was only one kind.
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
    // A pair closed by passing (ADR-0035) isn't raised again until a re-run verdict comes. If the using side's runner is attached and doesn't send the pair, the conflict is resolved, so let it go.
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
      // If the runner that would compute it is off, the old state stays.
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
      // Direct conflicts go files with confirmed lines first, then by path. Symbols go by name.
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
      // One alert is one post (ADR-0027). The post's name is one a person can't type (it starts with a line break).
      const post = randomBytes(8).toString("hex");
      db.prepare(
        "INSERT INTO channels (id, name, alert, labels, repo, workspace) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(post, `\n${post}`, message, JSON.stringify([ALERT_LABELS[kind]]), repo, ownerOf(repo));
      db.exec("COMMIT");
      shareAlert(Number(lastInsertRowid));
      deliver(repo, Number(lastInsertRowid), works, now);
      void attachTeamLabels(post).finally(() => syncSoon(post)); // open the post's issue after the team labels are attached (ADR-0032)
      openDebate(post); // a debate opens for a contract change (ADR-0040)
    }
    if (changed) {
      shareMembers(); // direct conflict marker in the member list
      shareInbox();
    }
  };

  /**
   * Attaches the verdict of a merge run a runner sent to the open indirect conflict alert of that pair (ADR-0035, ADR-0036). When a verdict lands (not running, not stale), it goes back into both works' inboxes.
   * - Broken with no missing files is confirmed. Passing with no missing files closes the alert as resolved and holds the pair (`held`). Any other verdict stays a guess.
   * - A held pair has no open alert. A verdict for a different fingerprint releases it, and if it isn't a pass, a new alert is raised with that verdict.
   * - With no open alert and no held pair, drop it. Confirmed stays until the next verdict (running or stale results don't change it).
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
    // Verdict count (metric). Counted even with no open alert, since it ran. Running and re-sends of the same fingerprint aren't counted.
    if (run.verdict !== "running")
      db.prepare(
        "INSERT OR IGNORE INTO merge_runs (fingerprint, verdict, at, workspace) VALUES (?, ?, ?, ?)",
      ).run(run.fingerprint, run.verdict, Date.now(), ownerOf(repo));
    const finished = run.verdict !== "running" && !run.stale;
    const closes = finished && run.verdict === "pass" && run.omitted.length === 0;
    type Row = { id: number; works: string; files: string; run: string | null; confirmed: number };
    // Only take verdicts from the runner on the side that computes the pair (the using side). Drop the other side's.
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
        // Passing again is still a pass. Only update the verdict of the closed alert.
        db.prepare("UPDATE alerts SET run = ? WHERE id = ?").run(
          JSON.stringify({ ...run, login, at: new Date(now).toISOString() }),
          held.id,
        );
        shareAlert(held.id);
        shareRuns(repo, login);
        return;
      }
      db.prepare("UPDATE alerts SET held = 0 WHERE id = ?").run(held.id);
      reconcile(repo); // if it's still raising that pair, a new alert appears
      row = openRow();
      if (!row || !computes(row)) return;
    }
    const next = { ...run, login };
    const { at: _, ...known } = row.run ? (JSON.parse(row.run) as AlertRun) : {};
    if (JSON.stringify(known) === JSON.stringify(next)) return; // same thing sent again
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
      // Add or remove the Confirmed label (ADR-0039). If it becomes Discuss, open the issue.
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
      openDebate(post.id); // a debate opens once confirmed (ADR-0040)
    }
    shareAlert(row.id);
    if (!finished) return;
    deliver(repo, row.id, JSON.parse(row.works), now);
    shareInbox();
    shareRuns(repo, login);
    if (closes || confirmed !== row.confirmed) shareMembers(); // "breaks when merged" in the member list
  };

  /** Sends this member's runners in that repo the verdicts the server holds for that member (`runs`). Makes them not re-run the same fingerprint. With `to`, only that connection. */
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
        open(socket, runner)
      )
        socket.send(frame);
  };

  /** An alert was created, changed, or resolved. Puts it in both works' inboxes. Replaces news of the same alert that hasn't been handed over yet with the new one. */
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
  /** All of a member's inbox in that repo: the unexpired ones, in arrival order. */
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
  /** Puts debate news in the inboxes of the debate's two works (only those seats if `only` is given). */
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
  /** The last inbox sent to each runner. Doesn't resend the same one. */
  const sentInbox = new Map<WSContext, string>();
  /** Sends that member's inbox to runners whose inbox changed. To `to` (a runner that just attached), send even if it's the same. */
  const shareInbox = (to?: WSContext) => {
    for (const [socket, { login, repo }] of runners) {
      if (!open(socket, { login, repo })) continue;
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
  /** Records an answer or failure on a question and puts it in the asking work's inbox. If it's already recorded (including ones deleted on expiry), leaves it alone. */
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
   * The connection and executor of the member's last-attached runner in that repo, if it can answer with that executor (the first executor if none was picked).
   * A runner that reported no executors can't answer (same as being away).
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
   * Sends the remaining questions (unanswered, unexpired, not yet sent) for the member (`target`) to that member's runner, in the order they were asked.
   * If the switch is off, doesn't send and puts a failure in the asker's inbox. If there's no runner to receive, keeps them.
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
          error: {
            code: "refused",
            message: `${target} set their agent not to answer other people's questions`,
          },
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
    shareMembers(); // answering
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
  /** Number of debate rounds (Q&A A13). The server config can lower it. */
  const debateRounds = Math.max(1, options.debateRounds ?? DEBATE_ROUNDS);
  /** Debate join requests sent to a runner that are waiting for a stance. The key is the sent `debate` id. Lost if the connection drops or the server restarts, and resent when the runner attaches. */
  const debatesSent = new Map<
    string,
    { socket: WSContext; executor: ExecutorId; debate: number; seat: number; proxy: string | null }
  >();
  /** The stance each seat gave per round. */
  const stancesOf = (seat: SeatRow): Stance[] => {
    const stored = seat.stance === null ? [] : JSON.parse(seat.stance);
    return Array.isArray(stored) ? stored : [stored];
  };
  const seatsOf = (debate: number) =>
    db.prepare("SELECT * FROM seats WHERE debate = ? ORDER BY seat").all(debate) as SeatRow[];
  /** The debate's repo: the post's repo. */
  const debateRepo = (debate: number) =>
    (
      db
        .prepare("SELECT c.repo FROM debates d JOIN channels c ON c.id = d.post WHERE d.id = ?")
        .get(debate) as { repo: string }
    ).repo;
  /** The seats that become options: seats that gave at least one stance, in shuffled order (`flip`). Doesn't change once the first round's stances are public. */
  const optionSeats = (row: DebateRow, seats: SeatRow[]) =>
    (row.flip ? [...seats].reverse() : seats).filter((seat) => stancesOf(seat).length > 0);
  /** Number of public rounds: a round stays hidden while any seat is still waiting in it. */
  const shownOf = (row: DebateRow, seats: SeatRow[]) =>
    seats.some((seat) => seat.state === "waiting") ? row.round - 1 : row.round;
  /**
   * A post's debate. A round's stances are included once no seat is waiting in that round. Includes the option's owner too, and the screen covers it until the conclusion (ADR-0040, #202).
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
   * Opens a debate if the post got an evidence label (ADR-0040). Importance doesn't matter. If a debate is already open, leaves it.
   * The seats are the alert's two works. The seat of an owner who turned off the auto-join switch (the ask switch) doesn't show up. The order of options is shuffled.
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
    advance(debate); // if neither seat shows up, it ends right away
  };
  /** Finishes one seat of a debate for this round (it gave a stance or couldn't). If it's already finished, leaves it. */
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
   * If no seat is waiting in the round, moves on (ADR-0040, implementation section 7). If both seats gave one and rounds remain, opens a rebuttal round.
   * Otherwise it ends: if the last stance's experiment passed for only one option, that option is the conclusion; else if only one option has verified evidence in the last stance, that one is;
   * else it's a person's turn to pick. Ends if no stance was given.
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
      // If the absent person's runner is attached, the real agent takes over the proxy seat from this round (Q&A A18).
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
      syncSoon(row.post); // the previous round went public
      return;
    }
    const options = optionSeats(row, seats);
    const lastOf = (seat: SeatRow) => stancesOf(seat).at(-1);
    // If the experiment passed for only one option, that one; else if verified evidence is only in one option, that one (the order in ADR-0040).
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
      syncSoon(row.post); // the last round went public
    }
  };
  /** A conclusion was reached: puts the news in both works' inboxes and posts it to the issue. */
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
   * Sends a debate join request to the runner of the member (`login`) for their waiting seat. For a rebuttal round, includes both stances from the previous round.
   * If the switch is off, doesn't send and leaves the seat as one that doesn't show up. If there's no runner to receive, keeps it and sends it when one attaches.
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
      // A proxy was called on purpose by the member who called it, so it ignores the switch (Q&A A12).
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
        // Debate stances go public without review, so comments posted on GitHub by non-members aren't included.
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
    shareMembers(); // answering
  };
  /** A member's GitHub profile name. `login` if unknown. */
  const nameOf = (login: string) =>
    (
      db.prepare("SELECT name FROM people WHERE login = ?").get(login) as
        | { name: string }
        | undefined
    )?.name ?? login;

  /** The last member list sent to the webs per repo. Doesn't resend the same one. */
  const sentMembers = new Map<string, string>();
  /**
   * If a repo's member list changed, sends it to every web that picked that repo. If unchanged, sends only to `to` (a web that just attached).
   * `shareSituation` calls it where the situation changes, and where only agents change (a Q&A starting and ending) calls it separately.
   * `works` is the work already read per repo.
   */
  // ponytail: every change sends the whole list per repo. When members and work grow, send only per-person diffs.
  const shareMembers = (to?: WSContext, works = new Map<string, WorkView[]>()) => {
    for (const repo of allRepos()) {
      const members = membersView(repo, works.get(repo) ?? worksView(repo));
      const json = JSON.stringify(members);
      const changed = json !== sentMembers.get(repo);
      sentMembers.set(repo, json);
      const frame = encode(serverToWeb, "members", { members });
      for (const [socket, watcher] of watchers)
        if (watcher.repo === repo && open(socket, watcher) && (changed || socket === to))
          socket.send(frame);
    }
    shareDebates(); // when a runner attaches or detaches, a waiting seat's `away` changes
  };

  /** The last debates and requests sent to the webs per post. Doesn't resend the same one. */
  const sentDebates = new Map<string, string>();
  /** Sends posts whose debate or request changed to every attached web. */
  // ponytail: every call recomputes all debates. When there are hundreds, take only the changed posts.
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
  /** The timer that turns a person back online when the picked status ends. One per person, replaced when they pick again. */
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
  // If the server restarted, re-arm what's left. Ones that ended meanwhile go back online right away.
  for (const { login, until } of db
    .prepare("SELECT login, until FROM profiles WHERE until IS NOT NULL")
    .all() as { login: string; until: number }[]) {
    expireAt(login, until);
  }

  /** The last situation sent to runners per repo. Doesn't resend the same one. */
  const sent = new Map<string, string>();
  /**
   * If the situation (all work) changed, sends it to every attached runner. If unchanged, sends only to `to` (a runner that just attached).
   * Called wherever the situation changes (observation, status line, offline, membership, following GitHub).
   * Doesn't send to closing connections (runners of removed members).
   */
  // ponytail: every change sends all work (with content) to each runner. When members and big work grow, send only per-work diffs.
  const shareSituation = (to?: WSContext) => {
    const all = new Map(allRepos().map((repo) => [repo, worksView(repo)]));
    shareMembers(undefined, all); // the member list comes from the situation
    for (const [repo, works] of all) {
      const claims = claimsView(repo);
      const json = JSON.stringify([works, claims]);
      const changed = json !== sent.get(repo);
      sent.set(repo, json);
      const frame = encode(serverToRunner, "situation", { works, claims });
      for (const [socket, runner] of runners)
        if (runner.repo === repo && open(socket, runner) && (changed || socket === to))
          socket.send(frame);
    }
  };

  /** Sends `error` and closes with 1008. A runner's and a web's `error` have the same shape. */
  const refuse = (socket: WSContext, error: ContractError, re?: string) => {
    socket.send(encode(serverToRunner, "error", error, re));
    socket.close(1008, error.code);
  };

  /** Ends one session. The runner and web live connections that attached with that session get an `error` and drop. */
  const endSession = (sessionHash: string, error: ContractError) => {
    db.prepare("DELETE FROM sessions WHERE hash = ?").run(sessionHash);
    for (const [socket, runner] of runners) if (runner.hash === sessionHash) refuse(socket, error);
    for (const [socket, watcher] of watchers)
      if (watcher.hash === sessionHash) refuse(socket, error);
    shareSituation(); // work of a member with no sessions left is hidden
  };

  /** The address the server listens on. Set after it starts. */
  let url = "";

  const app = createApp((authorization) => {
    const session = bearer(authorization);
    return session && sessionLogin(session);
  });

  const limits = options.limits ?? {};
  const LIMITED = {
    requests: (max: number) => `Hit the limit of ${max} requests a minute. Try again in a minute`,
    repos: (max: number) => `This workspace can have up to ${max} repos. Remove one to add another`,
    storage: (max: number) =>
      `This workspace is over its ${max} MB of storage. Ask the server's operators`,
    gifs: (max: number) =>
      `This workspace used its ${max} GIF searches for this hour. Try again later`,
  } satisfies Record<(typeof LIMITS)[number], (max: number) => string>;
  /** The one error shape for a hit limit. The web and CLI name the limit from it. */
  const limited = (name: keyof typeof LIMITED, max: number) =>
    new ContractFailure({ code: "limited", message: LIMITED[name](max), limit: { name, max } });
  /** When each person's requests and each workspace's GIF searches happened, within their window. Not kept across restarts. */
  const spent = new Map<string, number[]>();
  /** Counts one use of `name` by `key` within `windowMs`. `limited` once the setting's number is reached in that window. */
  const spend = (name: "requests" | "gifs", key: string, windowMs: number) => {
    const max = limits[name];
    if (max === undefined) return;
    const now = Date.now();
    const recent = (spent.get(`${name} ${key}`) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) throw limited(name, max);
    recent.push(now);
    spent.set(`${name} ${key}`, recent);
  };
  app.use(async (c, next) => {
    const login = c.get("login");
    if (login) spend("requests", login, 60_000);
    await next();
  });
  /** Bytes a workspace keeps: messages and Q&A in its channels and posts, and the file content and conflict snapshots its runners shared. */
  const storedBytes = (workspace: string) => {
    const bytes = (x: string) => `COALESCE(LENGTH(CAST(${x} AS BLOB)), 0)`;
    const inWorkspace = `COALESCE(c.workspace, ${ownerSql("c.repo")}) = :ws`;
    return (
      db
        .prepare(
          `SELECT ${[
            `SELECT SUM(${bytes("m.text")} + ${bytes("m.note")}) FROM messages m JOIN channels c ON c.id = m.channel WHERE ${inWorkspace}`,
            `SELECT SUM(${bytes("q.question")} + ${bytes("q.answer")}) FROM qas q JOIN channels c ON c.id = q.channel WHERE ${inWorkspace}`,
            `SELECT SUM(${bytes("files")}) FROM works WHERE ${ownerSql("repo")} = :ws`,
            `SELECT SUM(${bytes("works")} + ${bytes("files")}) FROM alerts WHERE ${ownerSql("repo")} = :ws`,
          ]
            .map((sum) => `COALESCE((${sum}), 0)`)
            .join(" + ")} AS total`,
        )
        .get({ ws: workspace }) as { total: number }
    ).total;
  };
  /**
   * New messages and Q&A stop once the workspace keeps more than its storage limit. Runners keep sharing; that content drops after 30 days (`CONTENT_MS`).
   * ponytail: sums the workspace's rows on every write, and only when the limit is set. Keep a running total if sends get slow.
   */
  const mustHaveRoom = (workspace: string) => {
    const max = limits.storage;
    if (max !== undefined && storedBytes(workspace) > max * 1_000_000)
      throw limited("storage", max);
  };

  mount(app, api.health, () => ({ contract: CONTRACT_VERSION }));

  /**
   * Reads with `token` whether the member has push access to each repo in the workspace and records it (ADR-0043). For repos GitHub didn't answer, keeps the old value.
   * `push` is the repos with access, `unknown` the repos it didn't answer for.
   */
  const readAccess = async (login: string, token: string) => {
    const push: string[] = [];
    const unknown: string[] = [];
    for (let repo of allRepos()) {
      let can = await github.canPush(token, repo);
      if (stopped) break;
      // A different repo with the same name (different id) is treated as no access. It isn't carried over either.
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
   * The repo of a per-repo API call (ADR-0043): the first repo in `REPO_HEADER` that the caller can see,
   * or the first visible repo if there's no header. `not_found` if none.
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
        message: `No repo you can see${wanted.length > 0 ? `: ${wanted.join(", ")}` : ""}`,
      });
    return found;
  };
  /** The workspace in `WORKSPACE_HEADER`. None if absent. `not_found` if it isn't one of the caller's workspaces. */
  const workspaceHeader = (c: Context<Env>, login: string) => {
    const wanted = c.req.header(WORKSPACE_HEADER)?.trim().toLowerCase();
    if (wanted && !workspacesOf(login).includes(wanted))
      throw new ContractFailure({
        code: "not_found",
        message: `You're not in that workspace: ${wanted}`,
      });
    return wanted || undefined;
  };
  /**
   * The workspace of a per-workspace API call (channels, forums, metrics) and visits (ADR-0043): `WORKSPACE_HEADER`, else the workspace of the repo `REPO_HEADER` picked,
   * else the first workspace they're in. Per-repo APIs only pick repos in this workspace (`repoOf`).
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
      throw new ContractFailure({ code: "not_found", message: "You're not in any workspace" });
    return ownerOf(found);
  };

  mount(app, api.login, async (_, c) => {
    const now = Date.now();
    for (const [device, pending] of logins)
      if (pending.expiresAt < now || now - pending.polledAt > ABANDONED_LOGIN_MS)
        logins.delete(device);
    // The Fly front end overwrites Fly-Client-IP. Trust it only when running on Fly (check on deploy); otherwise use the connection's address.
    // Trusting it elsewhere would let someone change the header per request and get past the per-address limit.
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
        message: "Too many logins are waiting. Try again in a bit",
      });
    }
    // Take the overall and per-address slots before waiting on GitHub. Requests that arrive during the wait count against those slots too.
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
      ...(install && { install }),
    };
  });

  mount(app, api.loginPoll, async ({ device }) => {
    const pending = logins.get(device);
    if (!pending || pending.expiresAt < Date.now()) {
      logins.delete(device);
      throw new ContractFailure({
        code: "unauthorized",
        message: "Device auth is done. Log in again",
      });
    }
    pending.polledAt = Date.now();
    // If it asks too often, don't pass it to GitHub (don't trigger GitHub's slow_down).
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
    // A GitHub name can be taken by someone else once it's changed. If another account used this name, block it so this person doesn't inherit that account's stuff.
    const known = db.prepare("SELECT github_id FROM people WHERE login = ?").get(login) as
      | { github_id: number | null }
      | undefined;
    if (known?.github_id != null && known.github_id !== id)
      throw new ContractFailure({
        code: "forbidden",
        message: `${login} can't join: another GitHub account used that name on this server`,
      });
    const access = await readAccess(login, polled.token);
    if (access.unknown.length > 0 && access.push.length === 0) {
      throw new ContractFailure({
        code: "internal",
        message: "Couldn't check push access on GitHub. Try again in a bit",
      });
    }
    if (access.push.length === 0) {
      throw new ContractFailure({
        code: "forbidden",
        // Don't include the server's repo names. A private repo's name doesn't leak to someone who couldn't join.
        message: `${login} can't join: no push access to any of this server's workspace repos.${installHint}`,
      });
    }
    const session = randomBytes(32).toString("hex");
    db.prepare(
      "INSERT INTO sessions (hash, login, github_token, token_hash, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      hash(session),
      login,
      enc(polled.token),
      hash(polled.token),
      polled.refreshToken === undefined ? null : enc(polled.refreshToken),
      polled.expiresInMs === undefined ? null : Date.now() + polled.expiresInMs,
    );
    db.prepare(
      "INSERT OR REPLACE INTO people (login, name, avatar, github_id) VALUES (?, ?, ?, ?)",
    ).run(login, name ?? login, avatar, id);
    shareSituation(); // work of a member who left and came back shows again
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
      prefs: prefsOf(login),
      connected: !!db.prepare("SELECT 1 FROM runner_seen WHERE login = ?").get(login),
      shared: repos.filter((r) => shared(r, login)),
    };
  });

  // The server adds the key and asks GIPHY instead of the browser. The key never leaves the server, and results aren't stored (ADR-0044).
  mount(app, api.gifs, ({ query }, c) => {
    if (!options.giphy) {
      throw new ContractFailure({ code: "not_found", message: "This server has no GIPHY key" });
    }
    spend("gifs", workspaceOf(c), 3_600_000);
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

  /** Adds or removes a repo. `forbidden` unless they're a GitHub Admin of that repo. */
  const mustAdmin = async (login: string, token: string, repo: string) => {
    const admin = await github.canAdmin(token, repo);
    if (admin === undefined)
      throw new ContractFailure({
        code: "github_failed",
        message: `Couldn't check on GitHub whether you're an Admin of ${repo}. Try again in a bit`,
      });
    if (!admin)
      throw new ContractFailure({
        code: "forbidden",
        message: `${login} isn't an Admin of ${repo}, so they can't add or remove it`,
      });
  };

  mount(app, api.addRepo, async ({ repo }, c) => {
    const login = c.get("login") as string;
    if (!accounts.has(repo.split("/")[0]?.toLowerCase() ?? ""))
      throw new ContractFailure({
        code: "forbidden",
        message: `${repo.split("/")[0]} isn't a GitHub account this server accepts`,
      });
    await mustAdmin(login, callerToken(c), repo);
    const others = allRepos().filter((r) => ownerOf(r) === ownerOf(repo));
    if (
      limits.repos !== undefined &&
      others.length >= limits.repos &&
      !others.some((r) => r.toLowerCase() === repo.toLowerCase())
    )
      throw limited("repos", limits.repos);
    // Record the GitHub id when adding. If a different repo with the same name was here before, block it so that repo's stuff isn't carried over (#315).
    const found = await github.canPush(callerToken(c), repo);
    if (found?.id !== undefined && !sameRepo(repo, found.id))
      throw new ContractFailure({
        code: "forbidden",
        message: `${repo} is a different repo with the same name as one this server had before, so it can't be added`,
      });
    db.prepare("INSERT OR IGNORE INTO repos (name, at) VALUES (?, ?)").run(repo, Date.now());
    const name = (db.prepare("SELECT name FROM repos WHERE name = ?").get(repo) as { name: string })
      .name;
    ensureWorkspace(name);
    seedLabels(name);
    // Read push access now for each member who's in, without waiting for the next check.
    await Promise.all(
      (
        db
          .prepare("SELECT login, dec(MAX(github_token)) AS token FROM sessions GROUP BY login")
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
        message: "Couldn't read the repos you're Admin of on GitHub. Try again in a bit",
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
      ...(install && { install }),
    };
  });

  mount(app, api.removeRepo, async ({ repo }, c) => {
    const login = c.get("login") as string;
    const found = db.prepare("SELECT name FROM repos WHERE name = ?").get(repo) as
      | { name: string }
      | undefined;
    // A repo you can't see gets the same answer as one that doesn't exist. Which repos another workspace has doesn't leak.
    if (!found || !sees(login, found.name))
      throw new ContractFailure({ code: "not_found", message: `No such repo: ${repo}` });
    await mustAdmin(login, callerToken(c), found.name);
    // That repo's stuff isn't deleted. It comes back if the repo is added again.
    db.prepare("DELETE FROM repos WHERE name = ?").run(found.name);
    db.prepare("DELETE FROM access WHERE repo = ?").run(found.name);
    for (const [socket, runner] of runners)
      if (runner.repo === found.name)
        refuse(socket, {
          code: "forbidden",
          message: `${found.name} was removed from the workspace`,
        });
    for (const [socket, watcher] of watchers)
      if (watcher.repo === found.name)
        refuse(socket, {
          code: "forbidden",
          message: `${found.name} was removed from the workspace`,
        });
    shareSituation();
    return { repos: reposOf(login) };
  });

  mount(app, api.accounts, () => ({ accounts: [...accounts].sort() }));

  mount(app, api.share, ({ on }, c) => {
    const login = c.get("login") as string;
    const repo = repoOf(c);
    if (on) db.prepare("INSERT OR IGNORE INTO shares (repo, login) VALUES (?, ?)").run(repo, login);
    else {
      // Like going offline, but nothing is kept: other members stop seeing these works right away.
      db.exec("BEGIN");
      db.prepare("DELETE FROM shares WHERE repo = ? AND login = ?").run(repo, login);
      for (const table of ["works", "lines", "work_agents"])
        db.prepare(`DELETE FROM ${table} WHERE repo = ? AND login = ?`).run(repo, login);
      db.exec("COMMIT");
    }
    for (const [socket, runner] of runners) {
      if (runner.repo !== repo || runner.login !== login) continue;
      runner.shared = on;
      if (!on) reports.delete(socket);
      if (open(socket, runner)) socket.send(encode(serverToRunner, "sharing", { shared: on }));
    }
    if (!on) reconcile(repo);
    shareSituation();
    shareMembers();
    return { repo, shared: on };
  });

  mount(app, api.logout, (_, c) => {
    endSession(hash(bearer(c.req.header("authorization")) as string), {
      code: "unauthorized",
      message: "You logged out, so the session ended",
    });
    return {};
  });

  /** Changes the work's agent (ADR-0015). The last executor sent wins. */
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
    dispatchDebates(login); // turning it off makes seats not yet sent into seats that don't show up
    return { on };
  });

  const prefsOf = (login: string): Prefs => {
    const row = db.prepare("SELECT prefs FROM prefs WHERE login = ?").get(login) as
      | { prefs: string }
      | undefined;
    return { ...DEFAULT_PREFS, ...(row && JSON.parse(row.prefs)) };
  };

  mount(app, api.setPrefs, (next, c) => {
    const login = c.get("login") as string;
    const prefs = { ...prefsOf(login), ...next };
    db.prepare("INSERT OR REPLACE INTO prefs (login, prefs) VALUES (?, ?)").run(
      login,
      JSON.stringify(prefs),
    );
    sendTo(login, encode(serverToWeb, "prefs", prefs));
    return prefs;
  });

  mount(app, api.settings, (_, c) => {
    const login = c.get("login") as string;
    const repo = repoOf(c);
    // Count only answered ones. Kept questions that aren't answered yet or couldn't be answered aren't counted.
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
      version,
      sourceUrl: options.sourceUrl ?? "https://github.com/omagari-dev/omagari",
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
        // ponytail: one runner per member per repo (same as hello). It's the last one attached.
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

  /** Only the owner can call an agent. */
  const mustOwn = (agent: string, login: string) => {
    if (agent !== login) {
      throw new ContractFailure({
        code: "forbidden",
        message: `Only ${agent} can call ${agent}'s agent`,
      });
    }
  };

  /**
   * The connection of the runner that runs `agent`'s `executor`. If the same member has several runners, the last attached one answers.
   * For something in a repo (a post), only that repo's runner answers (ADR-0043). If it's off, nothing is queued and it's `runner_offline`.
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
        message: `${agent}'s ${repo ? `${repo} ` : ""}${EXECUTOR_NAMES[executor]} runner is off. Requests aren't queued`,
      });
    }
    return found[0];
  };

  /**
   * The channel's recent conversation to pass to the runner, oldest first, up to `CHANNEL_CONTEXT`. For a post, the alert goes first.
   * The alert's number comes before the post's messages, so the runner only passes it on the first turn of a channel session.
   */
  const recentOf = (channel: string) => {
    const alert = postAlert(channel);
    return [
      ...(alert ? [alert] : []),
      ...(
        db
          .prepare(`${MESSAGES} WHERE m.channel = ? AND ${IN_CHANNEL} ORDER BY m.id DESC LIMIT ?`)
          .all(channel, CHANNEL_CONTEXT - (alert ? 1 : 0)) as MessageRow[]
      ).reverse(),
    ].map(messageView);
  };

  /**
   * A reply's original message (ADR-0047). Only a message a person wrote (text, public Q&A) in the same channel or post works.
   * Something elsewhere, something missing, and alert or decision lines all get the same `invalid_request`, so it doesn't leak whether it exists (#239).
   */
  const originalOf = (channel: string, replyTo: number | undefined) => {
    if (replyTo === undefined) return undefined;
    const row = db
      .prepare(
        `${MESSAGES} WHERE m.id = ? AND m.channel = ? AND m.alert IS NULL AND m.decision IS NULL`,
      )
      .get(replyTo, channel) as MessageRow | undefined;
    if (!row)
      throw new ContractFailure({
        code: "invalid_request",
        message: "You can only reply to a message in the same channel or post",
      });
    return messageView(row);
  };

  /**
   * A thread's original message (ADR-0047): a message a person wrote in the same chat channel that isn't itself in a thread.
   * Posts and DMs have no threads, and threads don't nest. All of these, and anything `originalOf` refuses, get the same `invalid_request`.
   */
  const threadOriginalOf = (channel: string, threadOf: number | undefined, replyTo?: number) => {
    if (threadOf === undefined) return undefined;
    const row =
      replyTo === undefined &&
      (db
        .prepare(
          `${MESSAGES} WHERE m.id = ? AND m.channel = ? AND m.alert IS NULL AND m.decision IS NULL
           AND m.thread_of IS NULL AND (SELECT alert FROM channels WHERE id = m.channel) IS NULL`,
        )
        .get(threadOf, channel) as MessageRow | undefined);
    if (!row)
      throw new ContractFailure({
        code: "invalid_request",
        message:
          "A thread opens only under a message in the same chat channel, not in a post, a DM, another thread, or a reply",
      });
    return row;
  };
  /** Inserts the reply and thread columns of a message being sent. */
  const sentColumns = (body: {
    replyTo?: number;
    notify: boolean;
    threadOf?: number;
    alsoInChannel: boolean;
  }) => [
    body.replyTo ?? null,
    body.replyTo === undefined ? null : Number(body.notify),
    body.threadOf ?? null,
    body.threadOf === undefined ? null : Number(body.alsoInChannel),
  ];

  mount(app, api.ask, (body, c) => {
    const { agent, executor, channel, message, visibility, model, effort } = body;
    mustOwn(agent, c.get("login") as string);
    mustWrite(channel, c);
    const { replyTo, threadOf } = body;
    // Only a public `@mention` can be a reply or sit in a thread. DMs have neither.
    if ((replyTo !== undefined || threadOf !== undefined) && visibility !== "public")
      throw new ContractFailure({
        code: "invalid_request",
        message: "DMs don't have replies or threads",
      });
    const original = originalOf(channel, replyTo);
    const opened = threadOriginalOf(channel, threadOf, replyTo);
    // The thread so far, read before the `@mention` lands in it: the original, then its latest replies.
    const thread =
      opened &&
      [
        opened,
        ...(
          db
            .prepare(`${MESSAGES} WHERE m.thread_of = ? ORDER BY m.id DESC LIMIT ?`)
            .all(opened.id, CHANNEL_CONTEXT - 1) as MessageRow[]
        ).reverse(),
      ].map(messageView);
    visit(agent, channelWorkspace(channel) ?? workspaceOf(c));
    // For posts and repo channels, that repo's runner answers; for workspace channels, the last runner attached in that workspace (ADR-0043).
    const socket = runnerOf(agent, executor, channelRepo(channel), channelWorkspace(channel));
    // The channel conversation is read before this Q&A lands in the channel. The `@call` question doesn't go in again as data.
    // ponytail: if the alert is edited after the first turn, it isn't passed to that channel session again. If the edited alert becomes needed, the runner passes the alert again on its own.
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
      db.prepare(
        "INSERT INTO messages (channel, login, qa, at, reply_to, notify, thread_of, also_in_channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(channel, agent, id, at, ...sentColumns(body));
    }
    const frame = encode(serverToRunner, "ask", {
      executor,
      channel: { id: channel, name },
      message,
      recent,
      ...(original && { replyTo: original }),
      ...(thread && { thread }),
      model,
      effort,
    });
    asks.set((JSON.parse(frame) as { id: string }).id, { socket, login: agent, executor, qa: id });
    socket.send(frame);
    const shared = shareQa(id); // to the same member's other screens too, and to everyone in the channel if it's an `@call`
    if (opened) shareRow(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(opened.id) as MessageRow); // its thread summary
    if (visibility === "public") posted(channel);
    shareMembers(); // answering
    return shared;
  });

  mount(app, api.draftDecision, ({ agent, executor, post, model, effort }, c) => {
    mustOwn(agent, c.get("login") as string);
    const repo = seenPost(agent, post);
    visit(agent, workspaceOf(c));
    const socket = runnerOf(agent, executor, repo);
    const messages = recentOf(post);
    // If the debate reached a conclusion, include that option as the draft's basis (ADR-0040)
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
    shareMembers(); // answering
    return { draft };
  });

  mount(app, api.stopDraft, ({ draft: id }, c) => {
    const found = drafting.get(id);
    if (!found || found.login !== c.get("login")) {
      throw new ContractFailure({
        code: "not_found",
        message: `Not your draft in progress: ${id}`,
      });
    }
    found.socket.send(encode(serverToRunner, "stopDraft", { id }));
    return { draft: settleDraft(id, { state: "stopped" }) as Draft };
  });

  mount(app, api.postQa, ({ qa, text }, c) => {
    const login = c.get("login") as string;
    // Someone else's Q&A is answered as if it doesn't exist. It doesn't leak that a private DM exists.
    const row = db.prepare(`${QAS} WHERE id = ? AND login = ?`).get(qa, login) as QaRow | undefined;
    if (!row) throw new ContractFailure({ code: "not_found", message: `No such Q&A: ${qa}` });
    if (row.visibility === "public") {
      throw new ContractFailure({
        code: "conflict",
        message: "That Q&A is already posted to a channel",
      });
    }
    if (qaView(row).answer.state !== "answered") {
      throw new ContractFailure({
        code: "invalid_request",
        message:
          "Only answered Q&As can be posted to a channel. The question and answer go up together",
      });
    }
    mustHaveRoom(channelWorkspace(row.channel) ?? ownerOf(channelRepo(row.channel) ?? ""));
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
    // ponytail: gives only the latest 50. If someone needs to see older DMs again, read them with `before` like history.
    return { qas: rows.reverse().map(qaView) };
  });

  /** Turns one channel into the contract's channel. */
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
   * The channels `login` can see. Drops repos from a forum's repo filter that `login` can't see, and if there's a filter but none are visible, the forum is gone.
   * Keeps a private repo's name from leaking to members without access (DESIGN.md 93-C).
   */
  const channelFor = (login: string, row: Parameters<typeof channelView>[0]) => {
    const view = channelView(row);
    if (!view.filter) return view;
    let filter = view.filter;
    const repos = filter.repos;
    if (repos?.length) {
      const seen = repos.filter((repo) => sees(login, repo));
      if (!seen.length) return undefined;
      filter = { ...filter, repos: seen };
    }
    // Same for label names. Drop label names that are only in repos they can't see and not in any visible repo. Keep names that are in no repo.
    if ("labels" in filter) {
      const hidden = new Set(
        (
          db
            .prepare(
              "SELECT DISTINCT name FROM labels WHERE repo NOT IN (SELECT repo FROM access WHERE login = ?) AND name NOT IN (SELECT l.name FROM labels l JOIN access a ON a.repo = l.repo WHERE a.login = ?)",
            )
            .all(login, login) as { name: string }[]
        ).map((l) => l.name.toLowerCase()),
      );
      const labels = filter.labels.filter((l) => !hidden.has(l.toLowerCase()));
      if (!labels.length) return undefined;
      filter = { ...filter, labels } as typeof filter;
    }
    return { ...view, filter } as Channel;
  };
  /** Sends each web in the workspace the channels that person can see. For people who can't see one anymore, sends a delete, since they may already have it. */
  const broadcastChannel = (workspace: string, row: Parameters<typeof channelView>[0]) => {
    for (const [socket, watcher] of watchers) {
      if (watcher.workspace !== workspace || !open(socket, watcher)) continue;
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
      // A repo channel is seen only by members who can see that repo, and a forum's repo filter only shows visible repos.
      .flatMap((row) => {
        const login = c.get("login") as string;
        return row.repo && !sees(login, row.repo) ? [] : (channelFor(login, row) ?? []);
      }),
  }));

  /** `conflict` if the name overlaps with a channel other than `id` at the same level (workspace, or `repo`) that `login` can see. Names are case-insensitive. */
  const mustBeNew = (login: string, workspace: string, name: string, id = "", repo = "") => {
    const rows = db
      .prepare(
        "SELECT id, name, kind, filter, repo FROM channels WHERE workspace = ? AND COALESCE(repo, '') = ? AND name = ? AND id != ?",
      )
      .all(workspace, repo, name, id) as Parameters<typeof channelView>[0][];
    // A forum the caller can't see doesn't count, or its name would leak.
    if (rows.some((row) => channelFor(login, row))) {
      throw new ContractFailure({ code: "conflict", message: `A #${name} channel already exists` });
    }
  };

  mount(app, api.createChannel, ({ name, repo }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const workspace = workspaceOf(c);
    // A repo channel is only made in a visible repo of this workspace (case is matched to the joined repo's name).
    const found =
      repo === undefined
        ? undefined
        : reposOf(login).find(
            (r) => r.toLowerCase() === repo.toLowerCase() && ownerOf(r) === workspace,
          );
    if (repo !== undefined && !found)
      throw new ContractFailure({ code: "not_found", message: `Not a repo you can see: ${repo}` });
    mustBeNew(login, workspace, name, "", found);
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

  /** When a forum changes, each post's visible forums change, so resend the alert line to every web. */
  // ponytail: resends every post in the workspace. If there are so many posts it gets heavy, send only the ones whose visible forums changed.
  const shareForums = (workspace: string) => {
    for (const { alert } of db
      .prepare(
        `SELECT m.alert FROM messages m JOIN alerts a ON a.id = m.alert WHERE ${ownerSql("a.repo")} = ? ORDER BY m.id`,
      )
      .all(workspace) as { alert: number }[])
      shareAlert(alert);
  };

  /** `not_found` if this workspace has no such forum (not counting `ALERTS`) or `login` can't see it. Otherwise returns that forum's filter. */
  const mustBeForum = (login: string, workspace: string, id: string) => {
    const row = db
      .prepare(
        "SELECT id, name, kind, filter FROM channels WHERE id = ? AND filter IS NOT NULL AND workspace = ?",
      )
      .get(id, workspace) as Parameters<typeof channelView>[0] | undefined;
    if (!row || !channelFor(login, row)) {
      throw new ContractFailure({ code: "not_found", message: `No such forum: ${id}` });
    }
    return JSON.parse(row.filter as string) as ForumFilter;
  };

  /** Adds a new forum (no `id`) or edits one, and tells each web in the form that person can see. `old` is the forum's current filter when editing. */
  const saveForum = (
    login: string,
    workspace: string,
    name: string,
    input: ForumFilter,
    id?: string,
    old?: ForumFilter,
  ) => {
    mustBeNew(login, workspace, name, id);
    // The repo filter must be repos in this workspace that the caller can see (matched to the joined repo's name). A repo they can't see is rejected the same as one that doesn't exist.
    const mine = reposOf(login).filter((r) => ownerOf(r) === workspace);
    const repos = (input.repos ?? []).map((repo) => {
      const found = mine.find((r) => r.toLowerCase() === repo.toLowerCase());
      if (!found)
        throw new ContractFailure({
          code: "invalid_request",
          message: `Not a repo in this workspace: ${repo}`,
        });
      return found;
    });
    // Repo filters the caller couldn't see stay even after an edit. Clearing the filter (all repos) removes them all.
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
  /** Reads posts and their alert messages by the repo's alert line (appended after `WHERE`). */
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
      throw new ContractFailure({ code: "not_found", message: `No such alert: ${alert}` });
    return found;
  });

  /** The decision's repo: the post's repo. None if there's no such decision. */
  const decisionRepo = (id: number | bigint) =>
    (
      db
        .prepare("SELECT c.repo FROM decisions d JOIN channels c ON c.id = d.post WHERE d.id = ?")
        .get(id) as { repo: string } | undefined
    )?.repo;
  /** Reads one decision. */
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

  /** Posts one line to the decision's post about what happened to the decision PR. Not posted as a forum alert line (ADR-0027). `by` is who did it. */
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

  /** An open decision PR was merged or closed. Does nothing if it already knew. */
  const settleDecision = (decision: number | bigint, state: "accepted" | "closed", by?: string) => {
    const { changes } = db
      .prepare("UPDATE decisions SET state = ? WHERE id = ? AND state = 'proposed'")
      .run(state, decision);
    if (changes > 0) announce(decision, state === "accepted" ? "merged" : "closed", { by });
  };

  const hourMs = options.hourMs ?? 3_600_000;
  /** Reopens the decision's window from now with the same length. Clears blocked or stalled too. */
  const restartWindow = (id: number) => {
    const { span } = db.prepare("SELECT span FROM decisions WHERE id = ?").get(id) as {
      span: string;
    };
    db.prepare("UPDATE decisions SET closes = ?, stuck = NULL WHERE id = ?").run(
      Date.now() + windowHours(spanOf(span)) * hourMs,
      id,
    );
  };
  /** If all objections were withdrawn, reopens the window from the start (ADR-0025). */
  const reopenIfClear = (id: number) => {
    if (db.prepare("SELECT 1 FROM objections WHERE decision = ?").get(id)) return;
    restartWindow(id);
    db.prepare("UPDATE decisions SET reopened = 1 WHERE id = ?").run(id);
  };

  /**
   * Merges with the organizer's token when it's time: no objection standing, and the window closed or all deciders agreed (ADR-0029).
   * `blocked` if GitHub blocks it, `stalled` if the token doesn't work (401, 403) or the organizer has no session. Posts a line only when the reason changes,
   * and tries again on the next call (every interval). Never merges the same decision twice together.
   */
  const merging = new Set<number>();
  const tryMerge = async (id: number) => {
    if (merging.has(id)) return;
    const decision = decisionOf(id);
    if (decision.state !== "proposed" || decision.closes === null) return;
    if (decision.awaiting?.length) return; // a decision with a proxy isn't merged until the absent person confirms (ADR-0040)
    const all = decision.deciders.length > 0 && decision.deciders.every((d) => d.agreed);
    const closes = Date.parse(decision.closes);
    const now = Date.now();
    if (now < closes && !all) return;
    merging.add(id);
    try {
      const session = db
        .prepare(
          "SELECT dec(github_token) AS github_token FROM sessions WHERE login = ? ORDER BY rowid DESC",
        )
        .get(decision.login) as { github_token: string } | undefined;
      const merged = session
        ? await github
            .merge(session.github_token, decisionRepo(id) as string, decision.pull.number)
            .catch((error: Error) => ({ reason: error.message }))
        : { reason: `${decision.login} isn't logged in` };
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

  /** The decision file's content. Deciders are logins, and names are the current profile names. */
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
      `- Deciders: ${named.join(", ")}`,
      `- Source: ${options.publicUrl ?? url}/#${post}`,
      "",
      "## Context",
      "",
      fields.context,
      "",
      "## Decision",
      "",
      fields.decision,
      "",
      "## Consequences",
      "",
      fields.consequences,
      "",
    ].join("\n");
  };

  /** The calling session's GitHub token. */
  const callerToken = (c: { req: { header(name: string): string | undefined } }) =>
    (
      db
        .prepare("SELECT dec(github_token) AS github_token FROM sessions WHERE hash = ?")
        .get(hash(bearer(c.req.header("authorization")) as string)) as { github_token: string }
    ).github_token;

  /**
   * Opens a decision PR with the organizer's token (ADR-0025): branches off the default branch, commits the decision file (and a line in AGENTS.md if needed)
   * in one commit, and opens a PR to the default branch. The number follows the highest of the default branch's decision files and open decision PRs.
   */
  mount(app, api.proposeDecision, async ({ post, window, ...fields }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const repo = seenPost(login, post);
    const token = callerToken(c);
    // Deciders: members who spoke in that post (posts and public Q&As), and the member who organizes and sets up the decision line.
    const deciders = (
      db
        .prepare(
          // A comment imported from GitHub counts its author as a decider only if they're a current member of that repo.
          `SELECT login FROM messages WHERE channel = ? AND login != '' AND decision IS NULL
           AND (github = 0 OR login IN ${MEMBERS})
           GROUP BY login ORDER BY MIN(id)`,
        )
        .all(post, repo) as { login: string }[]
    ).map((row) => row.login);
    if (!deciders.includes(login)) deciders.push(login);
    // With a proxy in the debate, the absent member is also a decider, and we don't merge until they confirm (ADR-0040).
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
          `This is a decision written up from an Omagari post. When this PR is merged, the decision is accepted.`,
          "",
          `- Decision file: \`${path}\``,
          `- Written up by: ${name} (@${login})`,
          `- Source: ${options.publicUrl ?? url}/#${post}`,
          `- Objection window: ${windowName(window)}`,
        ].join("\n"),
      });
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `Couldn't open the decision PR with ${login}'s GitHub token: ${(error as Error).message}`,
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
    await tryMerge(id); // "Right away" merges immediately
    return { decision: decisionOf(id) };
  });

  /** One open decision row visible to `login`. `not_found` if there is none, `conflict` if it's merged or closed. */
  const openDecision = (id: number, login: string) => {
    if (!sees(login, decisionRepo(id)))
      throw new ContractFailure({ code: "not_found", message: `No such decision: ${id}` });
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
    if (!row) throw new ContractFailure({ code: "not_found", message: `No such decision: ${id}` });
    if (row.state !== "proposed")
      throw new ContractFailure({
        code: "conflict",
        message: `That decision is already done: ${id}`,
      });
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
          message: `${login} isn't a decider on this decision, so they can't agree. They can only object`,
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
        throw new ContractFailure({ code: "not_found", message: `${login} has no objection here` });
      reopenIfClear(id);
      announce(id, "withdrawn", { by: login });
    }
    await tryMerge(id);
    return { decision: decisionOf(id) };
  });

  /** Only the one who wrote it up can edit or discard it. */
  const organizerOnly = (row: { login: string }, login: string, what: string) => {
    if (row.login !== login)
      throw new ContractFailure({
        code: "forbidden",
        message: `Only the one who wrote up the decision (${row.login}) can ${what}`,
      });
  };

  mount(app, api.reviseDecision, async ({ id, ...fields }, c) => {
    const login = c.get("login") as string;
    visit(login, workspaceOf(c));
    const row = openDecision(id, login);
    organizerOnly(row, login, "edit it");
    const number = basename(row.path).slice(0, 4);
    try {
      if (!row.branch) throw new Error("Don't know the decision PR's branch");
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
        message: `Couldn't push the decision edit with ${login}'s GitHub token: ${(error as Error).message}`,
      });
    }
    // An edited decision needs agreement again, and the window starts over (ADR-0031).
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
    organizerOnly(row, login, "discard it");
    const { pull } = db.prepare("SELECT pull FROM decisions WHERE id = ?").get(id) as {
      pull: number;
    };
    try {
      await github.closePull(callerToken(c), decisionRepo(id) as string, pull);
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `Couldn't close the decision PR with ${login}'s GitHub token: ${(error as Error).message}`,
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
      throw new ContractFailure({ code: "not_found", message: `No such debate or seat: ${post}` });
    // A debate with two works by the same person always has an owner, so a proxy doesn't apply (ADR-0041).
    if (seats.every((s) => s.login === target.login))
      throw new ContractFailure({
        code: "conflict",
        message: "Can't call a proxy in a debate with two works by the same person",
      });
    if (row.state !== "open" || !["waiting", "off"].includes(target.state))
      throw new ContractFailure({
        code: "conflict",
        message: "That seat isn't waiting this round",
      });
    if (target.login === login)
      throw new ContractFailure({
        code: "conflict",
        message: "Can't call a proxy for your own seat",
      });
    if (!answererOf(login, null, repo))
      throw new ContractFailure({
        code: "runner_offline",
        message: `${login}'s runner isn't connected, so a proxy can't start`,
      });
    db.prepare(
      "UPDATE seats SET proxy = ?, state = 'waiting', error = NULL WHERE debate = ? AND seat = ?",
    ).run(login, row.id, seat);
    // Answers to a request already sent to the owner or an earlier proxy are not accepted.
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
      throw new ContractFailure({ code: "not_found", message: `No such post: ${post}` });
    if (db.prepare("SELECT 1 FROM debates WHERE post = ?").get(found.id))
      throw new ContractFailure({ code: "conflict", message: "A debate is already open" });
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
      throw new ContractFailure({
        code: "not_found",
        message: `No such debate or proposal: ${post}`,
      });
    // Only the first pick becomes the conclusion. Whether it's their turn to pick is checked in the statement that updates it.
    const { changes } = db
      .prepare(
        "UPDATE debates SET state = 'concluded', winner = ?, by = 'choice', chooser = ?, decided = ? WHERE id = ? AND state = 'choosing'",
      )
      .run(picked.seat, login, Date.now(), row.id);
    if (!changes)
      throw new ContractFailure({ code: "conflict", message: "Not a debate waiting for a pick" });
    concluded(row.id);
    shareDebates();
    return { debate: debateOf(post) as Debate };
  });

  // Labels (ADR-0039). Name, color, and description change the GitHub label with the calling member's token; importance lives only in Omagari.
  mount(app, api.labels, (_, c) => ({ labels: labelsView(repoOf(c)) }));
  /** Turn what GitHub rejected into `github_failed`. */
  const onGitHub = async <T>(login: string, what: string, ask: (token: string) => Promise<T>) => {
    const token = tokenOf(login);
    try {
      if (!token) throw new Error("No session");
      return await ask(token);
    } catch (error) {
      throw new ContractFailure({
        code: "github_failed",
        message: `${login}'s GitHub token ${what}: ${(error as Error).message}`,
      });
    }
  };
  mount(app, api.createLabel, async ({ name, color, description }, c) => {
    const login = c.get("login") as string;
    const repo = repoOf(c);
    if (labelRow(repo, name))
      throw new ContractFailure({ code: "conflict", message: `Label already exists: ${name}` });
    const made = await onGitHub(login, "couldn't create the label", (token) =>
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
    if (!row) throw new ContractFailure({ code: "not_found", message: `No such label: ${name}` });
    if (
      next.name !== undefined &&
      labelRow(repo, next.name) &&
      labelRow(repo, next.name)?.id !== row.id
    )
      throw new ContractFailure({
        code: "conflict",
        message: `Label already exists: ${next.name}`,
      });
    if (next.name !== undefined || next.color !== undefined || next.description !== undefined) {
      const wanted = {
        name: next.name ?? row.name,
        color: next.color ?? row.color,
        description: next.description ?? row.description,
      };
      // A default label not on GitHub yet is created with the edited values.
      const made = await onGitHub(login, "couldn't edit the label", (token) =>
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
      // The importance of posts with that label changes. If it becomes Discuss, open the issue.
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
      if (!row) throw new ContractFailure({ code: "not_found", message: `No such label: ${name}` });
      return row.name;
    });
    db.prepare("UPDATE channels SET labels = ? WHERE id = ?").run(
      JSON.stringify([...new Set(names)]),
      post,
    );
    sharePost(post);
    syncSoon(post); // Match the issue labels, or open the issue if it became Discuss
    openDebate(post); // Adding an evidence label opens the debate (ADR-0040)
    return { post: postsWhere(repo, " AND m.id = ?", found.alert)[0].post };
  });

  /** The kind of channel visible to the caller. `not_found` if it doesn't exist or is a post of a repo they can't see. */
  const mustExist = (channel: string, c: Context<Env>) => {
    const login = c.get("login") as string;
    const found = db
      .prepare("SELECT kind, repo, workspace FROM channels WHERE id = ?")
      .get(channel) as
      | { kind: ChannelKind; repo: string | null; workspace: string | null }
      | undefined;
    // Only members who joined the workspace see chat channels and forums. Only members who can see the repo see its posts.
    if (
      !found ||
      (found.repo !== null && !sees(login, found.repo)) ||
      (found.repo === null &&
        found.workspace !== null &&
        !workspacesOf(login).includes(found.workspace))
    ) {
      throw new ContractFailure({ code: "not_found", message: `No such channel: ${channel}` });
    }
    return found.kind;
  };
  /** Articles, DMs, and `@mentions` can't be written in a forum, only inside a post (ADR-0027). */
  const mustWrite = (channel: string, c: Context<Env>) => {
    if (mustExist(channel, c) === "forum") {
      throw new ContractFailure({
        code: "invalid_request",
        message: "Can't write in a forum. Write inside a post",
      });
    }
    mustHaveRoom(channelWorkspace(channel) ?? ownerOf(channelRepo(channel) ?? ""));
  };

  mount(app, api.history, ({ channel, before, thread }, c) => {
    const login = c.get("login") as string;
    mustExist(channel, c);
    visit(login, workspaceOf(c));
    // The alert line's place (`ALERTS`) mixes lines from every repo. Give only those of the called workspace among visible repos.
    const rows = db
      .prepare(
        `${MESSAGES} WHERE m.channel = ? AND m.id < ?
         AND ${thread === undefined ? IN_CHANNEL : "(m.id = ? OR m.thread_of = ?)"}
         AND (a.repo IS NULL OR (a.repo IN (SELECT repo FROM access WHERE login = ?) AND ${ownerSql("a.repo")} = ?))
         ORDER BY m.id DESC LIMIT ?`,
      )
      .all(
        channel,
        before ?? Number.MAX_SAFE_INTEGER,
        ...(thread === undefined ? [] : [thread, thread]),
        login,
        workspaceOf(c),
        HISTORY_PAGE,
      ) as MessageRow[];
    return { messages: rows.reverse().map(messageView) };
  });

  mount(app, api.send, (body, c) => {
    const { channel, text, replyTo, threadOf } = body;
    mustWrite(channel, c);
    visit(c.get("login") as string, workspaceOf(c));
    originalOf(channel, replyTo);
    threadOriginalOf(channel, threadOf, replyTo);
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO messages (channel, login, text, at, reply_to, notify, thread_of, also_in_channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(channel, c.get("login") as string, text, Date.now(), ...sentColumns(body));
    const message = shareRow(
      db.prepare(`${MESSAGES} WHERE m.id = ?`).get(lastInsertRowid) as MessageRow,
    );
    // The original's thread summary changed, so it goes to everyone again.
    if (threadOf !== undefined)
      shareRow(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(threadOf) as MessageRow);
    posted(channel);
    syncSoon(channel);
    return { message };
  });

  mount(app, api.react, ({ message, emoji, on }, c) => {
    const login = c.get("login") as string;
    // A message you can't see gets the same answer as one that doesn't exist (#239). `mustExist` decides whether the channel is visible.
    const row = db.prepare(`${MESSAGES} WHERE m.id = ?`).get(message) as MessageRow | undefined;
    const missing = () =>
      new ContractFailure({ code: "not_found", message: `No such message: ${message}` });
    // The alert line's place (`ALERTS`) mixes lines from every repo, so check the line's repo too.
    if (!row || (row.repo !== null && !sees(login, row.repo))) throw missing();
    try {
      mustExist(row.channel, c);
    } catch {
      throw missing();
    }
    if (row.alert !== null || row.decision !== null) {
      throw new ContractFailure({
        code: "invalid_request",
        message: "Can't react to alert or decision lines",
      });
    }
    const now = Date.now();
    db.exec("BEGIN");
    if (on)
      db.prepare(
        "INSERT OR IGNORE INTO reactions (message, emoji, login, at) VALUES (?, ?, ?, ?)",
      ).run(message, emoji, login, now);
    else
      db.prepare("DELETE FROM reactions WHERE message = ? AND emoji = ? AND login = ?").run(
        message,
        emoji,
        login,
      );
    db.prepare("UPDATE messages SET reacted = ? WHERE id = ?").run(now, message);
    db.exec("COMMIT");
    visit(login, workspaceOf(c));
    return {
      message: shareRow(db.prepare(`${MESSAGES} WHERE m.id = ?`).get(message) as MessageRow),
    };
  });

  mount(app, api.metrics, ({ days }, c) => {
    // Metrics are only for the called workspace (ADR-0043).
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
    // Q&A is counted by the time it was asked. Unanswered Q&A counts too, since it was asked. Content isn't read.
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
    // Debates are counted by opening day, conclusion day, and when a decision PR stands on an open debate's post. Content isn't read.
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

  /** hello is done. Remove the time limit. */
  const greet = (socket: WSContext) => {
    const raw = socket.raw as WebSocket | undefined;
    if (!raw) return;
    clearTimeout(ungreeted.get(raw));
    ungreeted.delete(raw);
  };
  /** Close a connection that hasn't finished hello if it sends a frame bigger than hello. */
  const tooBigBeforeHello = (socket: WSContext, data: unknown) => {
    const raw = socket.raw as WebSocket | undefined;
    if (!raw || !ungreeted.has(raw)) return false;
    const size =
      typeof data === "string" ? Buffer.byteLength(data) : (data as ArrayBuffer).byteLength;
    if (size <= MAX_HELLO_BYTES) return false;
    socket.close(1009, "hello is too big");
    return true;
  };

  // The web's live connection. On one hello it sends the welcome, the messages missed while disconnected, and the current member list,
  // then sends messages as they come and the member list whenever it changes.
  // This handler is synchronous to the end, so no message slips between the welcome's seq, the resent ones, and the ones that follow.
  // ponytail: sends everything missed while disconnected with no count cap. If long-disconnected webs get heavy, add a cap and tell them to reload past it.
  app.get(
    LIVE_SOCKET,
    upgradeWebSocket(() => ({
      onMessage({ data }, socket) {
        // Don't read big frames from a connection that hasn't finished hello.
        if (tooBigBeforeHello(socket, data)) return;
        // The web only sends hello. Anything else means a broken web, so close.
        const decoded = decode(webToServer, data);
        if ("error" in decoded) return refuse(socket, decoded.error, decoded.re);
        const { id, payload } = decoded.message;
        const login = sessionLogin(payload.session);
        if (!login) {
          return refuse(
            socket,
            { code: "unauthorized", message: "No session or it ended. Log in again" },
            id,
          );
        }
        const mine = reposOf(login);
        const space = payload.workspace?.toLowerCase();
        if (space !== undefined && !mine.some((r) => ownerOf(r) === space)) {
          return refuse(
            socket,
            { code: "not_found", message: `Not in that workspace: ${payload.workspace}` },
            id,
          );
        }
        // A connection takes one workspace only: the chosen repo's, else the chosen workspace's, else the first workspace's.
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
            { code: "not_found", message: `Not a visible repo: ${payload.repo}` },
            id,
          );
        }
        const workspace = ownerOf(repo);
        // The last message number of this workspace. Other workspaces' numbers don't leak.
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
          // Also resend public Q&A that was answered while disconnected. Disconnect came after `after`, so cover generously if the answer came after that message stood.
          // Also resend alerts edited while disconnected, and alerts whose post's article count changed while disconnected.
          const missed = db
            .prepare(
              `${MESSAGES} WHERE m.id > ? OR q.settled >= (SELECT at FROM messages WHERE id = ?)
               OR a.updated >= (SELECT at FROM messages WHERE id = ?) OR m.reacted >= (SELECT at FROM messages WHERE id = ?)
               OR (c.id IS NOT NULL AND EXISTS (SELECT 1 FROM messages WHERE channel = c.id AND id > ?))
               OR EXISTS (SELECT 1 FROM messages t WHERE t.thread_of = m.id AND t.id > ?)
               ORDER BY m.id`,
            )
            .all(
              payload.after,
              payload.after,
              payload.after,
              payload.after,
              payload.after,
              payload.after,
            ) as MessageRow[];
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
        // If it was that person's last window, they go offline.
        if (watchers.delete(socket) && !stopped) shareMembers();
      },
    })),
  );

  app.get(
    RUNNER_SOCKET,
    upgradeWebSocket(() => ({
      onMessage({ data }, socket) {
        // Don't accept messages from a connection that is closing (including ones refused because the session ended).
        if (socket.readyState !== 1) return;
        if (!runners.has(socket) && tooBigBeforeHello(socket, data)) return;
        const decoded = decode(runnerToServer, data);
        // Close a connection that hasn't finished hello if it sends something that breaks the contract.
        if ("error" in decoded && !runners.has(socket) && decoded.error.code !== "version_mismatch")
          return refuse(socket, decoded.error, decoded.re);
        if ("error" in decoded) {
          // A runner with a different contract version gets refused with this server's version, in a shape it can read too. That tells the runner what to do.
          if (decoded.error.code === "version_mismatch") {
            socket.send(encodeVersionMismatch(decoded.error.message, version, decoded.re));
            socket.close(1008, "version_mismatch");
          } else socket.send(encode(serverToRunner, "error", decoded.error, decoded.re));
          return;
        }
        const { message } = decoded;
        if (message.kind === "hello") {
          const { session, repos, shareRepo, executors, choices, mergeCheck } = message.payload;
          const login = sessionLogin(session);
          if (!login) {
            return refuse(
              socket,
              { code: "unauthorized", message: "No session or it ended. Log in again" },
              message.id,
            );
          }
          // The repos among the remotes that are in the workspace (ADR-0043). A repo belongs to only one workspace.
          const workspace = allRepos();
          // A moved repo's old remote is read as the new name too (GitHub forwards the old address).
          const inWorkspace = repos.flatMap(
            (r) => workspace.find((w) => w.toLowerCase() === current(r).toLowerCase()) ?? [],
          );
          const repo = inWorkspace.find((r) => sees(login, r));
          if (!repo) {
            return refuse(
              socket,
              {
                code: "forbidden",
                // A missing repo and a repo without permission get the same answer. It leaks neither the server's repo names nor whether someone else's repo is there.
                message: `This folder isn't a workspace repo visible to ${login} (GitHub remote: ${repos.join(", ")}). If it isn't in the workspace, that repo's Admin can add it. If it is, you need push permission.${installHint}`,
              },
              message.id,
            );
          }
          // A runner a person started by hand shares the repo (ADR-0049).
          if (shareRepo)
            db.prepare("INSERT OR IGNORE INTO shares (repo, login) VALUES (?, ?)").run(repo, login);
          db.prepare("INSERT OR IGNORE INTO runner_seen (login) VALUES (?)").run(login);
          const isShared = shared(repo, login);
          runners.set(socket, {
            login,
            hash: hash(session),
            repo,
            executors,
            choices,
            mergeCheck,
            shared: isShared,
          });
          greet(socket);
          db.prepare("DELETE FROM offline WHERE repo = ? AND login = ?").run(repo, login);
          db.prepare("UPDATE claims SET stale = NULL WHERE repo = ? AND login = ?").run(
            repo,
            login,
          );
          // ponytail: one runner per member. If two devices run runners with different executors, only the later one stays.
          db.prepare("DELETE FROM agents WHERE login = ?").run(login);
          const known = db.prepare("INSERT OR IGNORE INTO agents (login, executor) VALUES (?, ?)");
          for (const executor of executors) known.run(login, executor);
          socket.send(
            encode(serverToRunner, "welcome", { login, repo, shared: isShared }, message.id),
          );
          shareSituation(socket);
          shareInbox(socket);
          shareRuns(repo, login, socket);
          dispatchQuestions(login); // Questions left while offline
          dispatchDebates(login); // Debates opened while offline
          return;
        }
        const runner = runners.get(socket);
        if (!runner) {
          // Don't accept messages from a connection that hasn't finished hello.
          refuse(socket, { code: "unauthorized", message: "Send hello first" }, message.id);
        } else if (!runner.shared && OBSERVED.has(message.kind)) {
          // Not shared: what it observed isn't taken (ADR-0049). It may have sent it just before sharing stopped.
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
          // The same place in the same work is one claim. Claiming again replaces it with the new one.
          db.prepare(
            `DELETE FROM claims WHERE repo = ? AND login = ? AND branch = ? AND path = ? AND unit = ?
             AND symbol IS ? AND lines IS ?`,
          ).run(repo, login, branch, path, unit, symbol ?? null, linesJson);
          // A new plan replaces the old plan on the same symbol in the same work. Its alerts are fixed when the writing runner recomputes them.
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
          // An overlap goes into the inbox of both works. Each one's own claim is `mine`.
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
          if (to === runner.login) return fail("invalid_request", "Can't ask your own agent");
          // Asking stays inside a repo. The receiving side's runner for that repo answers too.
          if (!db.prepare(`SELECT 1 FROM ${MEMBERS} WHERE login = ?`).get(runner.repo, to))
            return fail("not_found", `Not a member of ${runner.repo}: ${to}`);
          if (
            executor &&
            !db.prepare("SELECT 1 FROM agents WHERE login = ? AND executor = ?").get(to, executor)
          ) {
            return fail("not_found", `${to} has no ${EXECUTOR_NAMES[executor]} agent`);
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
          // An answer to Q&A or a draft, or a failure. Only accept it from the connection that was sent it.
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
                    // The server adds the proxy mark. Whatever the runner sent is dropped.
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
                        message: "Got something else instead of a stance in the debate",
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
                      error: {
                        code: "invalid_message",
                        message: "Got a draft instead of an answer to the question",
                      },
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
              console.warn("The runner refused a server message:", message.payload);
          } else if (message.kind === "answer") {
            // Attach which repo's runner saw this code. Answers in a workspace channel use it to know the repo.
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
        // If all of that member's runners for that repo dropped, they're offline in that repo. The last observation and status line are kept as of this time.
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
        // Questions sent to the dropped runner stay, and are sent again when the member's runner reconnects.
        for (const [id, question] of questionsSent)
          if (question.socket === socket) questionsSent.delete(id);
        for (const [id, debate] of debatesSent)
          if (debate.socket === socket) debatesSent.delete(id);
        // The dropped runner's answers won't come. Mark the drafts and Q&A it was waiting on as failed.
        for (const [id, { socket: to, login }] of drafting) {
          if (to !== socket) continue;
          settleDraft(id, {
            state: "failed",
            error: {
              code: "runner_offline",
              message: `${login}'s runner dropped before writing the draft`,
            },
          });
        }
        for (const [id, ask] of asks) {
          if (ask.socket !== socket) continue;
          settle(id, {
            state: "failed",
            error: {
              code: "runner_offline",
              message: `${ask.login}'s runner dropped before answering`,
            },
          });
        }
      },
    })),
  );

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  // Connection liveness: send a ping every period, and cut the connection if no pong arrives by the next period.
  // A runner that vanishes without a close, like a sleeping device, goes offline this way too. The runner (built-in WebSocket) sends pong on its own.
  const alive = new WeakSet<WebSocket>();
  /** Connections that haven't finished hello and their time limit. Finishing hello removes them. */
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

  // Re-read push permission for each repo (ADR-0043). Kick the runners and webs of repos that lost permission, and delete sessions with permission to no repo.
  // For a repo GitHub couldn't answer about, keep the last result and look again next period.
  let stopped = false;
  let checking = false;
  const recheck = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const rows = db
        .prepare("SELECT hash, login, dec(github_token) AS github_token FROM sessions")
        .all() as {
        hash: string;
        login: string;
        github_token: string;
      }[];
      // Follow the name and profile picture changed on GitHub. Read per token; if it can't be read, keep the last one.
      // If the token's GitHub name differs from the session's, end that session. Someone else who takes the old name doesn't inherit that line and permissions.
      let renamed = false;
      const people = new Set<string>();
      for (const row of rows) {
        const user = await github.user(row.github_token).catch(() => undefined);
        if (stopped) return;
        if (user && user.login !== row.login) {
          endSession(row.hash, {
            code: "unauthorized",
            message: `GitHub name changed from ${row.login} to ${user.login}. Log in again`,
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
        // Skip sessions that ended above, or when GitHub rejected their refresh.
        if (!db.prepare("SELECT 1 FROM sessions WHERE hash = ?").get(row.hash)) continue;
        const access = await readAccess(row.login, row.github_token);
        if (stopped) return;
        if (access.push.length > 0 || access.unknown.length > 0) continue;
        endSession(row.hash, {
          code: "forbidden",
          message: `${row.login} was removed: no push permission on any workspace repo anymore`,
        });
      }
      for (const [socket, runner] of runners)
        if (!sees(runner.login, runner.repo))
          refuse(socket, {
            code: "forbidden",
            message: `${runner.login} no longer has push permission on ${runner.repo}`,
          });
      for (const [socket, watcher] of watchers)
        if (watcher.repo && !sees(watcher.login, watcher.repo))
          refuse(socket, {
            code: "forbidden",
            message: `${watcher.login} no longer has push permission on ${watcher.repo}`,
          });
      shareSituation(); // Work in a repo that lost permission is no longer shown
    } catch (error) {
      console.error("Couldn't re-check push permission:", error);
    } finally {
      checking = false;
    }
  }, options.recheckMs ?? RECHECK_MS);

  /** GitHub tokens of a repo's members, newest session first. */
  const repoTokens = (repo: string) =>
    (
      db
        .prepare(
          "SELECT dec(github_token) AS github_token FROM sessions WHERE login IN (SELECT login FROM access WHERE repo = ?) ORDER BY rowid DESC",
        )
        .all(repo) as { github_token: string }[]
    ).map((session) => session.github_token);
  /** A member's GitHub token (from their latest session). None if they have no session. */
  const tokenOf = (login: string) =>
    (
      db
        .prepare(
          "SELECT dec(github_token) AS github_token FROM sessions WHERE login = ? ORDER BY rowid DESC",
        )
        .get(login) as { github_token: string } | undefined
    )?.github_token;

  /** The post's issue title: the conflicting file (or symbol) and the kind. No people (DESIGN.md "Conflict forum"). */
  /** Make a name sent by the runner (path, symbol, branch) safe as inline code in an issue: fold newlines and backticks, and cut the length. */
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
  /** The post's issue body: the alert's two works and places, and a link to the post. */
  const issueBody = (alert: Alert, link: string) => {
    const places =
      alert.kind === "direct"
        ? alert.files.map((file) => `\`${inline(file.path)}\``)
        : alert.symbols.map((symbol) => `\`${inline(symbol.name)}\``);
    const [a, b] = alert.works;
    return [
      "This is a post Omagari opened. The post's articles sync to this issue's comments, and this issue's comments sync to the post's articles.",
      "",
      `- Kind: ${ALERT_LABELS[alert.kind]}`,
      `- Works: ${inline(a.name)} (\`${inline(a.branch)}\`) ↔ ${inline(b.name)} (\`${inline(b.branch)}\`)`,
      `- Places: ${places.join(", ")}${alert.more > 0 ? ` and ${alert.more} more` : ""}`,
      "",
      `Post: ${link}`,
    ].join("\n");
  };
  /** The verdict comment text: confirmed, moved off confirmed, or closed as passed. It has the check command and, if uploaded, the end of the output. */
  const verdictBody = (state: string, run: AlertRun) => {
    const head =
      state === "confirmed"
        ? "🔴 The merge run broke. Added the Confirmed label."
        : state === "passed"
          ? "🟢 The merge run passed. Closed the alert as resolved."
          : `⚪ The rerun's verdict is "${MERGE_RUN_LABELS[run.verdict]}", so I removed the Confirmed label.`;
    const fence = "`".repeat(
      Math.max(3, ...[...(run.output ?? "").matchAll(/`+/g)].map((m) => m[0].length + 1)),
    );
    return [
      head,
      ...(run.check ? ["", `Check command: \`${run.check}\``] : []),
      ...(state === "confirmed" && run.output ? ["", fence, run.output.trimEnd(), fence] : []),
    ].join("\n");
  };

  /** One stance in a debate as an issue comment: the AI-written mark (DESIGN.md "AI-written text"), the claim, and the evidence (with its marks). */
  const stanceBody = (seat: SeatRow, round: number, stance: Stance) => {
    const model = [stance.model, stance.effort && `effort ${stance.effort}`]
      .filter(Boolean)
      .join(" · ");
    const changed = stance.changed && (stance.changed.reason ?? "no reason given");
    return [
      "> [!NOTE]",
      `> 🤖 **AI-written answer** · ${nameOf(seat.login)}'s agent${stance.proxy ? ` · proxy: called by ${stance.proxy.name}` : ""}${model ? ` (${model})` : ""} · debate round ${round + 1}`,
      ...(stance.context === "none" ? ["> Joined without context."] : []),
      ...(changed ? [`> Changed their earlier stance: ${changed}`] : []),
      "",
      stance.claim,
      ...(stance.evidence.length > 0
        ? ["", "Evidence", ...stance.evidence.map((e) => `- ${e.text} (${EVIDENCE_MARKS[e.mark]})`)]
        : []),
    ].join("\n");
  };
  /**
   * The debate's conclusion comment: the winner and how it was decided. It's posted with any member's token, so it only carries text the server wrote.
   * The winning claim is already in the stance comment posted from the account of whoever wrote that stance.
   */
  const conclusionBody = (debate: DebateRow, seats: SeatRow[]) => {
    const winner = seats.find((seat) => seat.seat === debate.winner);
    const how =
      debate.by === "experiment"
        ? "only one side passed the experiment"
        : debate.by === "evidence"
          ? "only one side has verified evidence"
          : `${debate.chooser ? nameOf(debate.chooser) : "a member"} picked it`;
    return [
      `⚖️ The debate is over: ${how}. This proposal is the conclusion.`,
      ...(winner
        ? ["", `Winner: branch \`${inline(winner.branch)}\` of ${inline(nameOf(winner.login))}`]
        : []),
    ].join("\n");
  };

  /**
   * One article of a post as an issue comment. A person's text goes as is. For public Q&A, after the poster's text it adds the AI-written mark (DESIGN.md "AI-written text"), then
   * the question and the answer. If the Q&A hasn't been answered yet, there's nothing (it's posted when the answer comes). Unanswered Q&A that failed isn't posted.
   */
  /**
   * A post's text written as an issue comment. For a reply, the head carries the original message (ADR-0047): `> **login** · [original](comment link)` and
   * `> first line`, then a blank line. If the original isn't a comment yet, it links the issue. It doesn't use `@`, so GitHub doesn't send mail again.
   */
  const commentBody = (message: ChannelMessage, row: MessageRow, issueUrl: string) => {
    const body = commentText(message);
    const original = row.original === null ? null : JSON.parse(row.original);
    if (body === undefined || !original) return body;
    const link =
      original.comment === null ? issueUrl : `${issueUrl}#issuecomment-${original.comment}`;
    const line = firstLine(original.text ?? "").slice(0, POST_LINE);
    return [`> **${original.login}** · [original](${link})`, `> ${line}`, "", body].join("\n");
  };
  const commentText = (message: ChannelMessage) => {
    if (message.kind === "text") return message.text;
    if (message.kind !== "qa" || message.qa.answer.state !== "answered") return undefined;
    const { answer, executor, question } = message.qa;
    const model = [answer.model, answer.effort && `effort ${answer.effort}`]
      .filter(Boolean)
      .join(" · ");
    return [
      ...(message.text ? [message.text, ""] : []),
      "> [!NOTE]",
      `> 🤖 **AI-written answer** · ${message.name}'s ${EXECUTOR_NAMES[executor]}${model ? ` (${model})` : ""}`,
      ...question.split("\n").map((line, i) => `> ${i === 0 ? "Question: " : ""}${line}`),
      "",
      answer.text,
    ].join("\n");
  };

  /**
   * Match posts and GitHub issues (ADR-0032). For each post:
   * 1. If there's no issue and it's a Discuss post whose alert isn't resolved, open one with the post's labels (ADR-0039). An issue that's already open isn't closed if importance drops. It opens with the token of whichever of the alert's two people has a session, else any member's.
   * 2. Post articles not yet uploaded go up as comments, with the token of whoever wrote them. If that person has no session, wait until they join.
   * 3. Read the issue's title, labels, and open state, and take comments we don't know as post articles.
   * 4. If the alert is resolved and the issue is open, close it once. If a person reopens it, leave it; a post whose alert is resolved and issue is closed isn't followed anymore.
   * If GitHub doesn't accept it, that post is retried next period.
   */
  // ponytail: each followed issue costs two GitHub requests per period. If many posts make the rate limit a worry, switch to a GitHub app webhook.
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
      // Start with the tokens of the alert's two people, then the repo's other members. If GitHub rejects one (invalid token), go to the next.
      const tokens = [...new Set([...logins.map(tokenOf), ...repoTokens(repo)])].filter(
        (token): token is string => token !== undefined,
      );
      /** The first answer GitHub gives as we try tokens in turn. None if none accepts. Keeps the last reason. */
      const answered = async <T>(
        ask: (token: string) => Promise<T | undefined>,
        first?: string,
      ) => {
        for (const token of first ? [first, ...tokens] : tokens) {
          const result = await ask(token).catch((error: Error) => {
            console.error("Couldn't handle the post's issue on GitHub:", error.message);
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
        // Don't open one after it's resolved or for an FYI post (ADR-0039). Put the post's labels on it too.
        const labels: string[] = JSON.parse(row.labels ?? "[]");
        if (resolved || row.importance !== "discuss") continue;
        // Link to the first forum where the post is visible. If forums change later, the issue's text stays as is.
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

      // 2. Post articles as comments. Decision PR lines and incoming comments aren't uploaded.
      const unsent = db
        .prepare(
          `${MESSAGES} WHERE m.channel = ? AND m.comment IS NULL AND m.decision IS NULL ORDER BY m.id`,
        )
        .all(row.id) as MessageRow[];
      const issueUrl = (
        db.prepare("SELECT issue_url FROM channels WHERE id = ?").get(row.id) as {
          issue_url: string;
        }
      ).issue_url;
      for (const sent of unsent) {
        const message = messageView(sent);
        const body = commentBody(message, sent, issueUrl);
        const writer = "login" in message ? tokenOf(message.login) : undefined;
        if (body === undefined || !writer) continue;
        const made = await github.comment(writer, repo, number, body).catch((e: Error) => e);
        if (stopped) return;
        if (made instanceof Error) {
          console.error("Couldn't post the post's article as an issue comment:", made.message);
          continue;
        }
        db.prepare("UPDATE messages SET comment = ? WHERE id = ?").run(made.id, message.id);
      }

      // Post the debate's public stances and conclusion as comments (ADR-0040, Q&A A21). A hidden round goes when it's revealed, and a stance goes with the token of that agent's owner.
      // If the owner has no session, wait until they join, and post the conclusion only after all stances are up.
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
              if (made)
                console.error(
                  "Couldn't post the debate's stance as an issue comment:",
                  made.message,
                );
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

      // Match the verdict to the issue (#134): if confirmed, label and comment; if it moves off confirmed or closes as passed, remove the label and comment. Done with the token of the member whose runner uploaded the verdict.
      // Count it as done only after the label is matched and then the comment is posted. If GitHub doesn't accept it, retry next period (repeating a label is harmless).
      if (alert.kind !== "direct" && alert.run) {
        const { run } = alert;
        const passed = resolved && run.verdict === "pass" && run.omitted.length === 0;
        const next = alert.confirmed ? "confirmed" : passed ? "passed" : "cleared";
        // An alert that went by without being confirmed has nothing to say. One closed as passed leaves the check command, whether it was confirmed or not.
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

      // Push labels added and removed on the post to the issue (ADR-0039): only those that differ from the last issue labels we read. If any one isn't accepted,
      // don't take in the issue's labels this time (we push again next period).
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

      // 3. Read the issue and take in comments we don't know. Issue labels changed on GitHub are followed by the post.
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
        // Only carry over to the post what got added or removed on GitHub after we pushed. Changes made on the post while waiting stay and go up next time.
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

      // 4. If the alert is resolved, close the issue once.
      if (read && issue?.open && resolved && row.issue_closed === null) {
        const closed = await github.closeIssue(read.token, repo, number).catch((e: Error) => e);
        if (stopped) return;
        if (closed instanceof Error)
          console.error("Couldn't close the post's issue:", closed.message);
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
   * Read the repo's GitHub labels and match the label list to them (ADR-0039). Pair them by GitHub label id, so renaming on GitHub renames the post's label too.
   * A label deleted on GitHub leaves the list and posts without an issue. Default labels (the four kinds and Confirmed) stay even if deleted, and are created if the repo lacks them.
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
    // Default labels were Korean before ADR-0045. Rename them on GitHub (a rename keeps them on issues), then here.
    // If the English name already exists on GitHub, the Korean one stays as a plain label.
    for (const [from, to] of Object.entries(KOREAN_LABELS)) {
      const old: RepoLabel | undefined = theirs.find((l) => l.name === from);
      if (old && !theirs.some((l) => l.name.toLowerCase() === to.toLowerCase())) {
        const renamed: RepoLabel | void = await github
          .updateLabel(token, repo, from, {
            name: to,
            color: old.color,
            description: old.description,
          })
          .catch((error: Error) => console.error("Couldn't rename the label:", error.message));
        if (stopped) return;
        if (renamed) theirs = theirs.map((l) => (l.id === renamed.id ? renamed : l));
      }
    }
    englishLabels(repo, theirs);
    seedLabels(repo); // recreate a default label if it was renamed on GitHub
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
        // If another line has the same id or name (deleted and recreated), step aside.
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
        // Deleted on GitHub. A post with an issue follows the issue.
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
        .catch((error: Error) =>
          console.error("Couldn't create the default labels:", error.message),
        );
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
   * Run issue syncing. With `post`, only that post; without it (every period), all of them. If one is running, run once more after it ends with what piled up.
   * Call it for a post when an article stands, an answer arrives, or an alert appears.
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
          await syncLabels().catch((error) => console.error("Couldn't sync labels:", error));
        await syncIssues(only === "all" ? undefined : only).catch((error) =>
          console.error("Couldn't sync issues:", error),
        );
      }
      syncing = false;
    })();
  };

  /**
   * When an alert stands as a post, add team labels that match the path rules in the default branch's `.github/labeler.yml` (ADR-0039). A post that already stands doesn't get them again.
   * Only add labels the repo has (ones in the list). If the file is missing or can't be read, only the kind label stays.
   * ponytail: re-reads the file only when the default branch's commit changes (one GitHub request each time an alert stands). Remembers just one version for now.
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
      console.error("Couldn't add team labels:", error);
    }
  };

  // Delete observations and status lines of members offline for 7 days, and read each work's draft PR title and merge state from GitHub.
  // When merged, delete the lines written before the merge on that branch. Lines newly written on the same branch after the merge stay.
  // ponytail: one GitHub request per branch each period. If many works make the rate limit a worry, switch to a GitHub app webhook.
  for (const repo of allRepos()) englishLabels(repo); // before the first label sync
  let following = false;
  const follow = setInterval(async () => {
    if (following) return;
    following = true;
    syncSoon(); // Match the posts' issues (ADR-0032). Runs separately.
    try {
      const forgotten = "SELECT repo, login FROM offline WHERE since < ?";
      const cutoff = Date.now() - (options.forgetMs ?? FORGET_MS);
      const now = Date.now();
      db.exec("BEGIN");
      db.prepare(`DELETE FROM works WHERE (repo, login) IN (${forgotten})`).run(cutoff);
      db.prepare(`DELETE FROM lines WHERE (repo, login) IN (${forgotten})`).run(cutoff);
      // Claims aren't deleted; they're set to "stale". Once stale for `forgetMs` more, they're deleted (Room's stale mark and 7-day expiry).
      db.prepare(
        `UPDATE claims SET stale = ? WHERE stale IS NULL AND (repo, login) IN (${forgotten})`,
      ).run(now, cutoff);
      db.prepare("DELETE FROM offline WHERE since < ?").run(cutoff);
      db.prepare("DELETE FROM claims WHERE stale < ?").run(now - (options.forgetMs ?? FORGET_MS));
      dropStaleContent(now);
      db.prepare("DELETE FROM inbox WHERE at <= ?").run(now - inboxMs);
      db.prepare("DELETE FROM feed WHERE at <= ?").run(now - inboxMs);
      db.prepare("DELETE FROM questions WHERE at <= ?").run(now - inboxMs); // Expire if unanswered
      // Unfinished debates end by expiry (ADR-0040). `settleSeat` doesn't accept answers to requests already sent.
      db.prepare(
        "UPDATE debates SET state = 'ended', expired = 1 WHERE state = 'open' AND at <= ?",
      ).run(now - (options.debateMs ?? INBOX_MS));
      db.exec("COMMIT");
      shareInbox(); // Expired items drop out
      shareDebates(); // Expired debates

      const branches = db
        .prepare(
          `SELECT w.repo, w.branch, dec(MAX(s.github_token)) AS token
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
          // If GitHub can't answer, keep the last one.
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
          // A merged branch's claims release themselves. Ones newly placed on the same branch after the merge stay.
          releaseClaims("repo = ? AND branch = ? AND at < ?", repo, branch, merged);
        }
      }
      drafts = next;
      shareSituation();

      // Read whether open decision PRs were merged or closed. Use the token of the member who wrote it up, or another member's if that member has no session.
      const open = db
        .prepare(
          `SELECT d.id, d.pull, c.repo, COALESCE(
             (SELECT dec(github_token) AS github_token FROM sessions WHERE login = d.login),
             (SELECT dec(github_token) AS github_token FROM sessions WHERE login IN (SELECT login FROM access WHERE repo = c.repo))) AS token
           FROM decisions d JOIN channels c ON c.id = d.post
           WHERE d.state = 'proposed' AND c.repo IN (SELECT name FROM repos)`,
        )
        .all() as { id: number; pull: number; repo: string; token: string | null }[];
      // For open ones, treat GitHub's request-changes reviews as objections (ADR-0025), and merge if the window is closed.
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
          // A GitHub request-changes review counts as an objection only if a current member of that repo left it.
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
      console.error("Couldn't follow the status line:", error);
    } finally {
      following = false;
    }
  }, options.followMs ?? FOLLOW_MS);

  // The built web UI (ADR-0042). Serve files on non-API paths, and send unknown paths to the screen's first file.
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
    /** This server's version (`git describe --tags`). Included when refusing a runner with a different contract version. */
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
