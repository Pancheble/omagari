// Contract: the messages the runner and server exchange, and the API the web uses. Every piece uses this one definition.
// Every object is written as `z.strictObject`. Unknown kinds and unknown keys are both rejected.
import * as z from "zod";

/** Contract version. Sent in every envelope; a different one is rejected. Bump it on every breaking change. */
export const CONTRACT_VERSION = 65;

/** Error shape. Shared by the runner/server `error` message and the HTTP error body (`{ error }`). */
export const ContractError = z.strictObject({
  code: z.enum([
    "invalid_message", // The envelope or its content breaks the contract
    "unknown_kind", // The kind is not in the contract
    "version_mismatch", // The contract version differs
    "invalid_request", // The HTTP request body breaks the contract
    "unauthorized", // Not logged in, or the session ended
    "forbidden", // Not a member, or the folder is not a workspace repo
    "not_found",
    "internal",
    "executor_failed", // The agent executor failed or ended without an answer
    "runner_offline", // That agent's runner is not connected to the server. Q&A is not queued
    "refused", // The receiving side turned off answering others' questions (ADR-0024)
    "turn_timeout", // One turn of a runner session hit the time limit and was cut off
    "conflict", // Already exists (a channel with the same name)
    "github_failed", // GitHub rejected the request (invalid member token, no permission, GitHub could not answer)
  ]),
  message: z.string(),
});
export type ContractError = z.infer<typeof ContractError>;

export class ContractFailure extends Error {
  code: ContractError["code"];
  constructor(error: ContractError) {
    super(error.message);
    this.code = error.code;
  }
}

// --- Messages between the runner and the server ---

/** Envelope of every message. `re` is the `id` of the message this one answers. */
const Envelope = z.strictObject({
  v: z.number(),
  id: z.string(),
  re: z.string().optional(),
  kind: z.string(),
  payload: z.unknown(),
});

type Payloads = Record<string, z.ZodType>;

/**
 * Share level: how much an observation uploads to the server. The owner picks it per runner; the default is full (ADR-0007).
 * declared uploads every changed file path but contents only inside paths that work claimed; intent uploads only the work (branch) and the status line.
 * Claims go up regardless of share level.
 */
export const ShareLevel = z.enum(["full", "declared", "intent"]);
export type ShareLevel = z.infer<typeof ShareLevel>;

/** Where each share level sends what, with the server's address (ADR-0054). The hook and `omagari share on` both say it, the same on hosted and self-hosted servers. */
export function shareLevelsText(server: string) {
  return [
    `full (the default): the content of changed files goes to ${server}.`,
    `declared: only the paths of changed files go to ${server}.`,
    `intent: only the status line goes to ${server}.`,
  ];
}

/**
 * One observed file: its current content, a deleted file, or a file sent as a path only, with the reason.
 * `binary` is not text (not UTF-8, or has a NUL), not a file, or unreadable;
 * `too_large` went over the per-file or total limit (ADR-0007);
 * `share` is a file the share level does not send content for.
 */
/**
 * One definition line: a line that declares a named symbol (GLOSSARY). The runner extracts it from TypeScript, TSX, and JavaScript files with tree-sitter (ADR-0026).
 * A method's name is `Class.method`. `line` is the line in that work's copy (from 1); for `removed` it is the line in the base commit's version.
 * `change` is compared with the base commit's version: newly created (`added`), definition line changed (`changed`), gone (`removed`).
 * When absent, the definition line is unchanged (including body-only changes).
 */
export const Definition = z.strictObject({
  name: z.string(),
  kind: z.enum(["function", "method", "class", "interface", "type", "enum"]),
  line: z.number().int().positive(),
  change: z.enum(["added", "changed", "removed"]).optional(),
});
export type Definition = z.infer<typeof Definition>;

/** Human-readable definition kind. */
export const DEFINITION_KINDS = {
  function: "Function",
  method: "Method",
  class: "Class",
  interface: "Interface",
  type: "Type",
  enum: "Enum",
} as const satisfies Record<Definition["kind"], string>;

export const ObservedFile = z.union([
  z.strictObject({
    path: z.string(),
    content: z.string(),
    /** Definition lines in this file. Only present for files whose content is uploaded, in a readable language, and with definitions. */
    definitions: z.array(Definition).optional(),
  }),
  z.strictObject({
    path: z.string(),
    deleted: z.literal(true),
    /** Definition lines that were in the base commit's version (all `removed`). Only present for paths whose content is uploaded (full, or declared's claimed paths). */
    definitions: z.array(Definition).optional(),
  }),
  z.strictObject({ path: z.string(), omitted: z.enum(["binary", "too_large", "share"]) }),
]);
export type ObservedFile = z.infer<typeof ObservedFile>;

/**
 * Observation of one work (member + branch). The files that branch changed since the base commit: committed, uncommitted, and untracked new files.
 * Paths are relative to the top of that work's folder (a registered folder or a linked worktree). Definition lines are included under the same rule as content (ADR-0026).
 */
export const Work = z.strictObject({
  branch: z.string(),
  /** Base commit. The point where this branch and the default branch (remote tracking) diverged (ADR-0002). Only a full commit id (SHA-1 or SHA-256) is accepted. */
  base: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  /** Share level of this observation. An empty `files` in intent does not mean nothing changed; it means nothing was sent. */
  share: ShareLevel,
  files: z.array(ObservedFile),
});
export type Work = z.infer<typeof Work>;

/**
 * The one "working on..." line shown next to each work's name (ADR-0010). The server picks in this order:
 * the line the agent wrote (`at` is when it was written) → draft PR title → the files being edited ("editing payment.ts and 3 more") → none if nothing changed (null).
 * Offline, which comes first in the order, arrives separately as the work's `offlineSince`. This line is then what was left as of that time.
 */
export const StatusLine = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("agent"), text: z.string(), at: z.string() }),
  z.strictObject({ source: z.literal("pull"), text: z.string() }),
  /** The first changed file's name and how many more changed. Each place words it (the web in the viewer's language). */
  z.strictObject({
    source: z.literal("files"),
    file: z.string(),
    more: z.number().int().nonnegative(),
  }),
]);
export type StatusLine = z.infer<typeof StatusLine>;
/** English words for a `files` line, for the CLI and hooks ("Editing payment.ts and 3 more"). */
export const filesText = (line: { file: string; more: number }) =>
  `Editing ${line.file}${line.more > 0 ? ` and ${line.more} more` : ""}`;

/**
 * One work members see: its observation and its status line. The web (`api.works`) and the runner (`situation`) share it.
 * A member's work whose runner dropped is kept as of `offlineSince` (when it dropped) and deleted after 7 days.
 */
export const WorkView = z.strictObject({
  login: z.string(),
  ...Work.shape,
  line: StatusLine.nullable(),
  offlineSince: z.string().nullable(),
});
export type WorkView = z.infer<typeof WorkView>;

/** Max length of the status line an agent writes. Newlines and repeated spaces fold into one space. */
export const MAX_STATUS_CHARS = 200;

/** The executor that runs agent sessions. An agent is an owner-executor pair, so there is one per executor (ADR-0015). */
export const ExecutorId = z.enum(["claude-code", "codex"]);
export type ExecutorId = z.infer<typeof ExecutorId>;

/** Human-readable executor name. An agent is called together with its person, like "Jieun's Claude Code" (ADR-0015). */
export const EXECUTOR_NAMES = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const satisfies Record<ExecutorId, string>;

/**
 * One model an executor announced as selectable. `id` is passed to the executor as is; `name` is the human-readable name.
 * `efforts` are the effort values selectable for this model; if empty, effort is not chosen.
 */
export const ModelChoice = z.strictObject({
  id: z.string(),
  name: z.string(),
  efforts: z.array(z.string()),
});
export type ModelChoice = z.infer<typeof ModelChoice>;

/**
 * What can be chosen for one executor (ADR-0020). The runner asks the executor and reports it when it connects. It differs per executor, and effort values differ per model.
 * `efforts` are the effort values selectable when the model is left at "default" (the executor's own setting). If they could not be reported, both are empty.
 */
export const Choices = z.strictObject({
  models: z.array(ModelChoice),
  efforts: z.array(z.string()),
});
export type Choices = z.infer<typeof Choices>;

/**
 * The model and effort chosen for a Q&A. Missing ones are "default", so the executor's own setting applies. The runner does not start the executor if a value is not in the reported choices.
 */
export const ModelPick = z.strictObject({
  model: z.string().optional(),
  effort: z.string().optional(),
});
export type ModelPick = z.infer<typeof ModelPick>;

/** Sent as a reply (ADR-0047): the original message's number, and whether to notify its author (default: notify). */
export const Replying = z.strictObject({
  replyTo: z.number().int().optional(),
  notify: z.boolean().default(true),
  /**
   * Sent as a reply in a thread (ADR-0047): the thread's original message. Only a channel message that isn't itself in a thread.
   * `alsoInChannel` also shows the reply in the channel ("Also send to # channel").
   */
  threadOf: z.number().int().optional(),
  alsoInChannel: z.boolean().default(false),
});

/**
 * A person's connection state as other members see it. offline when no web window is open or they chose "appear offline".
 * It belongs to the person. It is separate from whether the agent's runner is connected (`MemberView.agents`).
 */
export const Presence = z.enum(["online", "away", "dnd", "offline"]);
export type Presence = z.infer<typeof Presence>;

/** The connection state a person picks themselves. invisible is "appear offline". The picker's own web also receives offline. */
export const ChosenPresence = z.enum(["online", "away", "dnd", "invisible"]);
export type ChosenPresence = z.infer<typeof ChosenPresence>;

/** How long until a picked connection state goes back to online. If not set, it lasts until changed by hand. */
export const PresenceDuration = z.enum(["15m", "1h", "8h", "24h", "3d"]);
export type PresenceDuration = z.infer<typeof PresenceDuration>;
export const PRESENCE_DURATIONS = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
} as const satisfies Record<PresenceDuration, number>;

/**
 * Max length of the status message, counted in code points (one emoji is 1 to several). Follows Slack's 100-character status limit.
 * Newlines and repeated spaces fold into one space.
 */
export const MAX_STATUS_MESSAGE_CHARS = 100;

const graphemes = new Intl.Segmenter();
/**
 * Whether something fits the status message's emoji slot: a single grapheme that is a pictographic character (flags and keycaps included).
 * `\p{RGI_Emoji}` doesn't know emoji newer than the runtime's Unicode version, but the pictographic slots are reserved ahead of time, so new emoji are accepted.
 */
export const isEmoji = (text: string) =>
  [...graphemes.segment(text)].length === 1 &&
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(text);

/**
 * One person in the member list: name, connection state and status message, an agent per executor, and a status line per work. The web's member list draws from this alone.
 * It does not carry a work's changed files and content. Those are in `api.works`.
 */
export const MemberView = z.strictObject({
  login: z.string(),
  /** Name on the GitHub profile. If left empty, same as `login`. */
  name: z.string(),
  /** GitHub profile picture URL. Re-read at login and every 10 minutes. null if none, and the web uses initials. */
  avatar: z.string().nullable(),
  presence: Presence,
  /** Status message the person wrote. Kept as written (HTML is not altered) and shown regardless of connection state. null if none. */
  message: z.string().nullable(),
  /** The status message's emoji slot. Kept apart from the text; the screen shows it before the text. null if none. */
  emoji: z.string().nullable(),
  /**
   * One agent per executor the runner reported when it connected. Empty if a runner has never been turned on.
   * online while the runner is connected; answering ("answering") if it has not yet answered a Q&A it received (queued ones included).
   * `choices` is what the connected runner asked that executor and reported. The owner's DM input box uses it. Empty when off.
   */
  agents: z.array(
    z.strictObject({
      executor: ExecutorId,
      state: z.enum(["online", "answering", "offline"]),
      choices: Choices,
    }),
  ),
  /** When the runner dropped. The works and status lines are kept as of this time. null if connected or never turned on. */
  offlineSince: z.string().nullable(),
  works: z.array(
    z.strictObject({
      branch: z.string(),
      /** This work's agent: the executor that last sent a hook or `status set` on that branch. null if there is only an observation (ADR-0015). */
      executor: ExecutorId.nullable(),
      line: StatusLine.nullable(),
      /** A direct conflict (an alert where lines are confirmed to collide) is on this work. Goes back to false when resolved. */
      conflict: z.boolean(),
      /** An indirect conflict confirmed broken by a merge run is on this work ("breaks when merged"). Goes back to false when the next verdict clears the confirmed state or the alert resolves. */
      broken: z.boolean(),
    }),
  ),
});
export type MemberView = z.infer<typeof MemberView>;

/** The whole member list, by name. The answer to `api.members`, and also arrives as `members` on the live connection. */
export const Members = z.strictObject({ members: z.array(MemberView) });

/**
 * Channel kind (ADR-0027, ADR-0039). A chat channel is read and written by every member. A forum channel holds no posts; it is a view picked by a filter (`filter`).
 * People can't write in a forum, only inside a post. At first there are the "Discuss" and "FYI" forums, and any member can create, edit, and delete forums.
 */
export const ChannelKind = z.enum(["chat", "forum"]);
export type ChannelKind = z.infer<typeof ChannelKind>;

/** Max length of a channel name. Leading and trailing spaces are trimmed; newlines and repeated spaces fold into one space. */
export const MAX_CHANNEL_NAME_CHARS = 80;
const ChannelName = z
  .string()
  .transform((name) => name.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(MAX_CHANNEL_NAME_CHARS));
/** Max length of one message. Leading and trailing spaces are trimmed. */
export const MAX_MESSAGE_CHARS = 4000;
/** Text written along with posting a Q&A to a channel. Trimmed and length-limited like a text message, but empty means none. */
const Note = z
  .string()
  .trim()
  .max(MAX_MESSAGE_CHARS)
  .optional()
  .transform((text) => text || undefined);
/** How many recent items the feed reads at a time. */
export const FEED_PAGE = 20;
/** How many past messages are read at a time. */
export const HISTORY_PAGE = 50;

/**
 * The code a Q&A answer saw: what was checked out in the folder the runner registered when it started that turn (phase 1 question A12).
 * If `dirty`, the answer also saw uncommitted changes (untracked new files included), so it shows as "commit + work in progress changes".
 */
export const Source = z.strictObject({
  /** Branch. null if it is not a branch (detached HEAD). */
  branch: z.string().nullable(),
  commit: z.string(),
  dirty: z.boolean(),
  /** The answering runner's repo `owner/name`. The server attaches it when it receives the answer. A workspace channel's answer uses this to tell which repo it looked at. */
  repo: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

/**
 * A runner session's answer. `model` is the human-readable name of the model that answered; `effort` is the effort chosen for that turn.
 * Missing if it was asked as "default" and the executor did not report the actual model, or no effort was chosen (no badge when unknown).
 */
const Reply = z.strictObject({
  text: z.string(),
  source: Source,
  model: z.string().optional(),
  effort: z.string().optional(),
});

/** Max number of channel messages passed on a channel session's first turn. Later turns only pass what came after the last turn (implementation ch. 3). */
export const CHANNEL_CONTEXT = 50;

/**
 * A Q&A's visibility. Private (DM) is seen only by the asker; public is seen by everyone in the channel.
 * A Q&A asked by DM starts private and becomes public when the owner posts it to the channel; an `@mention` is public from the start. Public never goes back to private.
 */
export const Visibility = z.enum(["private", "public"]);
export type Visibility = z.infer<typeof Visibility>;

/**
 * One Q&A: a question, its answer, and visibility. A DM and an `@mention` are answered by the same channel session; only visibility differs (ADR-0015).
 * `answer` is waiting for an answer (`pending`, queued ones included), answered, or could not answer (`turn_timeout` is a cut-off answer).
 */
export const Qa = z.strictObject({
  /** A number that only grows across the whole workspace. It is the order within a channel. */
  id: z.number(),
  channel: z.string(),
  /** The agent asked. One of the asker's agents. */
  executor: ExecutorId,
  question: z.string(),
  /** When it was asked */
  at: z.string(),
  visibility: Visibility,
  answer: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending") }),
    z.strictObject({ state: z.literal("answered"), ...Reply.shape }),
    z.strictObject({ state: z.literal("failed"), error: ContractError }),
  ]),
});
export type Qa = z.infer<typeof Qa>;

/** One line range. Counted from 1, end included. A place with only deleted lines is written as the line before it. */
export const LineRange = z.strictObject({ from: z.number(), to: z.number() });
export type LineRange = z.infer<typeof LineRange>;

/**
 * Why another person's file content can't be read: the share level and a missing file (`ObservedFile.omitted`), or their base commit is not on this machine (`base`).
 */
export const Unreadable = z.enum(["share", "binary", "too_large", "base"]);
export type Unreadable = z.infer<typeof Unreadable>;

/** One work an alert points to. `name` is that member's GitHub profile name (`login` if left empty). */
export const WorkRef = z.strictObject({ login: z.string(), name: z.string(), branch: z.string() });
export type WorkRef = z.infer<typeof WorkRef>;

/**
 * One file tied to an alert. `lines` are the lines that collide when merged, based on each work's own copy, in the same order as `works`.
 * If one side deleted it and the other edited it, it conflicts without lines. If the other side's content can't be read, it is `unknown` with the reason, meaning "may conflict".
 */
export const AlertFile = z.union([
  z.strictObject({ path: z.string(), lines: z.tuple([z.array(LineRange), z.array(LineRange)]) }),
  z.strictObject({ path: z.string(), unknown: Unreadable }),
]);
export type AlertFile = z.infer<typeof AlertFile>;

/** How many files (or symbols, for a symbol alert) an alert names. The rest are counted as `more` (same as Room). */
export const ALERT_FILES = 8;

/**
 * One place a symbol lives in a work. `line` is based on that work's copy (for `removed`, the base commit's version).
 * `uses` is where it uses that symbol; the rest are changes to that work's definition line (`Definition.change`).
 */
export const SymbolPlace = z.strictObject({
  path: z.string(),
  line: z.number().int().positive(),
  role: z.enum(["added", "changed", "removed", "uses", "declared"]),
});
export type SymbolPlace = z.infer<typeof SymbolPlace>;

/** Human-readable symbol place. */
export const PLACE_ROLES = {
  added: "Added",
  changed: "Definition line changed",
  removed: "Removed",
  uses: "Uses",
  declared: "Declared a change",
} as const satisfies Record<SymbolPlace["role"], string>;

/**
 * A contract about to change (implementation ch. 4, Room's claim plan): attached to a claim and announced before the code changes. The kinds are rename, signature change, delete, and add.
 * `symbol` is the name of the symbol to change (`Class.method` for a method); `detail` is a one-line human-written note on what it becomes.
 */
export const Plan = z.strictObject({
  kind: z.enum(["rename", "signature", "delete", "add"]),
  symbol: z.string().min(1),
  detail: z.string().max(MAX_STATUS_CHARS).optional(),
});
export type Plan = z.infer<typeof Plan>;

/** Human-readable plan kind. */
export const PLAN_KINDS = {
  rename: "Rename",
  signature: "Signature change",
  delete: "Delete",
  add: "Add",
} as const satisfies Record<Plan["kind"], string>;

/**
 * One symbol tied to an alert. `places` are each of the two works' places, in the same order as `works`.
 * An indirect conflict (guessed) is when one work changed or removed a definition line (`changed`, `removed`) and the other work uses that name (`uses`).
 * If each uses what the other changed, there is one of the same name per direction. Duplicate work is when both works newly created it (`added`).
 * A declared contract change is when one work attached a plan (`plan`) to its claim (`declared`, the claimed place) and the other work uses that name (`uses`). It arrives even if the code has not changed yet.
 */
export const AlertSymbol = z.strictObject({
  name: z.string(),
  places: z.tuple([z.array(SymbolPlace), z.array(SymbolPlace)]),
  /** Only on a declared contract change: the plan that was declared. */
  plan: Plan.optional(),
});
export type AlertSymbol = z.infer<typeof AlertSymbol>;

/** Human-readable alert kind. An indirect conflict is a "guess" because it is linked by name only and can link wrongly (ADR-0023). */
export const ALERT_KINDS = {
  direct: "Direct conflict",
  indirect: "Indirect conflict (guessed)",
  duplicate: "Duplicate work",
  declared: "Declared contract change",
} as const satisfies Record<Alert["kind"], string>;

/** Short kind names used for forum tags and badges. When a post's issue is opened, a label with this name is attached (ADR-0032). */
export const ALERT_LABELS = {
  direct: "Direct conflict",
  indirect: "Indirect conflict",
  duplicate: "Duplicate work",
  declared: "Contract change",
} as const satisfies Record<Alert["kind"], string>;

/** Label put on a post confirmed broken by a merge run (ADR-0035, ADR-0039). Removed when the confirmation clears. */
export const CONFIRMED_LABEL = "Confirmed";

/**
 * A post's importance (ADR-0039). One per label; a post follows the highest of its labels. Only Discuss posts open a GitHub issue.
 * FYI is view-only, and the agent receives it in its inbox. The inbox is independent of importance.
 */
export const Importance = z.enum(["reference", "discuss"]);
export type Importance = z.infer<typeof Importance>;
/** Web UI languages (ADR-0045). Everyone starts in English; Korean is a personal choice. */
export const Language = z.enum(["en", "ko"]);
export type Language = z.infer<typeof Language>;
/** Web look (#312). `system` follows the computer's light or dark setting. */
export const Appearance = z.enum(["light", "dark", "system"]);
export type Appearance = z.infer<typeof Appearance>;
/**
 * A member's personal settings, stored on the server so they follow the person across tabs and devices.
 * The `notify*` keys pick which browser notifications to get (#313, DESIGN.md "Notifications"). Whether this browser shows them at all
 * is the browser's permission and stays in that browser.
 */
export const Prefs = z.strictObject({
  language: Language,
  appearance: Appearance,
  /** Conflicts on my work. Only Discuss ones, unless `notifyFyi` is on too. */
  notifyConflicts: z.boolean(),
  /** "FYI too": conflicts whose importance is FYI also notify (only when `notifyConflicts` is on). */
  notifyFyi: z.boolean(),
  /** Answers to what I asked by DM or `@call`. */
  notifyAnswers: z.boolean(),
  /** A decision I decide on is proposed, or a debate needs my agent's stance. */
  notifyDecisions: z.boolean(),
  /** A reply to my message (with its `@` on), or a new message in a thread I started or wrote in (#370). */
  notifyReplies: z.boolean(),
});
export type Prefs = z.infer<typeof Prefs>;
export const DEFAULT_PREFS: Prefs = {
  language: "en",
  appearance: "system",
  notifyConflicts: true,
  notifyFyi: false,
  notifyAnswers: true,
  notifyDecisions: true,
  notifyReplies: true,
};
export const IMPORTANCE_LABELS = {
  reference: "FYI",
  discuss: "Discuss",
} as const satisfies Record<Importance, string>;
/** Labels that start as Discuss. The other labels and newly created labels are FYI. */
export const DISCUSS_LABELS: readonly string[] = [CONFIRMED_LABEL, ALERT_LABELS.declared];
/** Colors of the default labels the server creates when the repo lacks them (the four kinds and Confirmed). */
export const DEFAULT_LABEL_COLORS: Record<string, string> = {
  [ALERT_LABELS.direct]: "d93f0b",
  [ALERT_LABELS.indirect]: "fbca04",
  [ALERT_LABELS.duplicate]: "c5def5",
  [ALERT_LABELS.declared]: "5319e7",
  [CONFIRMED_LABEL]: "b60205",
};

/** A GitHub label color: six hex digits without `#`. */
const LabelColor = z.string().regex(/^[0-9a-fA-F]{6}$/);
/**
 * A label (ADR-0039). It is the repo's GitHub label itself. GitHub is the source of the name, color, and description, and the server reads them every cycle.
 * GitHub labels have no field for importance, so Omagari keeps it. It is one per team, so the same for everyone.
 */
export const Label = z.strictObject({
  name: z.string(),
  color: z.string(),
  description: z.string(),
  importance: Importance,
});
export type Label = z.infer<typeof Label>;
const LabelName = z.string().trim().min(1).max(50);

/**
 * A forum's filter (ADR-0039, ADR-0043): a post shows in that forum if its importance matches, or if it has at least one of the labels in the list.
 * If `repos` (`owner/name`) is present and not empty, only posts from those repos. If absent or empty, every repo.
 * A post shows in every forum it matches, and if it matches no forum it is in "Other posts" (`Post.forums` empty).
 */
const ForumRepos = z.array(z.string().trim().min(1)).optional();
export const ForumFilter = z.union([
  z.strictObject({ importance: Importance, repos: ForumRepos }),
  z.strictObject({ labels: z.array(z.string().trim().min(1)).min(1), repos: ForumRepos }),
]);
export type ForumFilter = z.infer<typeof ForumFilter>;

/** Whether a post matches the filter. */
export const shows = (
  filter: ForumFilter,
  post: { labels: string[]; importance: Importance; repo: string },
) =>
  (!filter.repos?.length || filter.repos.includes(post.repo)) &&
  ("importance" in filter
    ? filter.importance === post.importance
    : filter.labels.some((label) => post.labels.includes(label)));

/**
 * A channel. A forum has a filter (`filter`). A chat channel with a `repo` (`owner/name`) is that repo's channel,
 * seen only by members with push permission on that repo; without one it is a workspace channel, read by every member of the workspace (ADR-0043).
 */
export const Channel = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: ChannelKind,
  repo: z.string().optional(),
  filter: ForumFilter.optional(),
});
export type Channel = z.infer<typeof Channel>;

/** The verdict of running the check command. Pass (exit 0), broken (nonzero exit), couldn't run (no config, no sandbox, setup command failed, cut off at the limit). */
export const Verdict = z.enum(["pass", "broken", "not_run"]);
export type Verdict = z.infer<typeof Verdict>;
export const VERDICT_LABELS = {
  pass: "Pass",
  broken: "Broken",
  not_run: "Couldn't run",
} as const satisfies Record<Verdict, string>;

/**
 * One merge run verdict (ADR-0036). The runner that computed an indirect conflict (guessed) merges the two works, runs the check command, and uploads it.
 * `running` means it is running. `fingerprint` is a fingerprint made from the two works' content and the check command; the same fingerprint is not run again.
 * `stale` means that after the run (including while running) the two works' content changed, so it is an old result. It runs again once things settle.
 * `omitted` is the paths where the other side's content was missing (share level, size, binary) and it ran without that file. `output` is the end of the output (last 25 lines) and only a runner with share level full uploads it.
 * `check` is the check command that ran. Missing if it could not be read. `ms` is the time taken in milliseconds and is missing while running.
 * The verdict follows ADR-0035. If the merged result breaks, it runs once more with only my work and once with only the other work. If both pass, it is `broken`,
 * and if either breaks alone it is `unclear` (can't tell), with `alone` naming the side that broke alone. `mine` is the running runner's work and `theirs` is the other work.
 * If the alone runs could not run (cut off at the limit, etc.), the verdict is `not_run` with a reason.
 */
export const MergeRun = z.strictObject({
  verdict: z.enum(["running", ...Verdict.options, "unclear"]),
  alone: z.array(z.enum(["mine", "theirs"])).optional(),
  reason: z.string().optional(),
  check: z.string().optional(),
  ms: z.number().optional(),
  omitted: z.array(z.string()),
  fingerprint: z.string(),
  output: z.string().optional(),
  stale: z.boolean(),
});
export type MergeRun = z.infer<typeof MergeRun>;
export const MERGE_RUN_LABELS = {
  running: "Running",
  ...VERDICT_LABELS,
  unclear: "Can't tell",
} as const satisfies Record<MergeRun["verdict"], string>;
/** Verdicts that are settled (not running). The metrics count by verdict. */
export const RunVerdict = z.enum(["pass", "broken", "unclear", "not_run"]);
export type RunVerdict = z.infer<typeof RunVerdict>;

/** The verdict attached to an alert: what the runner uploaded, plus the member (`login`) who ran it and when it arrived (`at`). */
export const AlertRun = z.strictObject({ ...MergeRun.shape, login: z.string(), at: z.string() });
export type AlertRun = z.infer<typeof AlertRun>;

const alertCommon = {
  works: z.tuple([WorkRef, WorkRef]),
  more: z.number(),
  resolved: z.string().nullable(),
};

/**
 * An alert: one per pair of works and conflict kind (ADR-0023). The kinds are direct conflict (`direct`), indirect conflict (guessed, `indirect`), duplicate work (`duplicate`),
 * and declared contract change (`declared`).
 * The server groups what the runners computed and uploaded. When the conflict changes, the same alert is updated; when it all clears, `resolved` (the cleared time) is written once and it closes.
 * If they conflict again after it closes, it is a new alert. A direct conflict's `files` lists up to `ALERT_FILES` of them, files confirmed to collide first, then by path; the other two kinds' `symbols` are listed by name
 * up to `ALERT_FILES`, and the rest is `more`.
 */
export const Alert = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct"),
    ...alertCommon,
    files: z.array(AlertFile).max(ALERT_FILES),
  }),
  z.strictObject({
    kind: z.enum(["indirect", "duplicate", "declared"]),
    ...alertCommon,
    symbols: z.array(AlertSymbol).max(ALERT_FILES),
    /** Only on an indirect conflict (guessed): the last verdict of a merge run on that pair. Missing if not run yet. */
    run: AlertRun.optional(),
    /**
     * Only on an indirect conflict (guessed): a merge run showed it breaks, so it is confirmed (`broken` with no missing files). Stays until the next verdict.
     * If it passes with no missing files, the alert closes as resolved and the passing check command is left in `run` (ADR-0035).
     */
    confirmed: z.boolean().optional(),
  }),
]);
export type Alert = z.infer<typeof Alert>;

/**
 * One claim (ADR-0008): a place a work (member + branch) will edit. It blocks nothing and only tells people.
 * The unit is a symbol (a line range found by definition name), a line range, a whole file (a new file not in the base commit), or a folder (`path` ends in `/`).
 * `path` is relative to the repo's top, and `lines` are the lines in the claimer's copy when it was made (from 1, end included), only for symbols and line ranges.
 * `id` is a number that only grows across the whole server. `stale` is when the owner has been offline a long time (7 days) and it shows as "old"; 7 days after that it is deleted.
 * It resolves by itself when the branch is merged or deleted. `plan` is the attached plan (the contract to change). A work has one plan per symbol, and a new one replaces the old.
 */
export const Claim = z.strictObject({
  id: z.number(),
  login: z.string(),
  branch: z.string(),
  path: z.string(),
  unit: z.enum(["symbol", "lines", "file", "folder"]),
  symbol: z.string().optional(),
  lines: LineRange.optional(),
  at: z.string(),
  stale: z.boolean(),
  plan: Plan.optional(),
});
export type Claim = z.infer<typeof Claim>;

/**
 * Another person's claim as seen in my copy. `lines` are the lines in my copy, shifted by the line difference between their version and mine.
 * If their version can't be read (share level, missing file, base commit not on my machine), the lines are theirs as is and `approx` ("roughly") is set.
 */
export const SeenClaim = z.strictObject({ ...Claim.shape, approx: z.boolean() });
export type SeenClaim = z.infer<typeof SeenClaim>;

/** Where to claim: a path, and either a symbol name or a line range. With neither, it is a whole new file or a folder (ends in `/` or an existing folder). */
const ClaimTarget = z.strictObject({
  branch: z.string().min(1),
  path: z.string().min(1),
  symbol: z.string().min(1).optional(),
  lines: LineRange.optional(),
});

/**
 * How long inbox items are kept even without confirmation they were handed over. After that they expire (Room's 14 days, phase 2 question A7).
 * Answers to asks (ADR-0024) use the same time.
 */
export const INBOX_MS = 14 * 24 * 60 * 60_000;

/** Number of days counted in settings' "What my agent answered" (`api.settings`). Counts asks over a shorter period than `INBOX_MS`. */
export const ANSWERED_DAYS = 7;

/**
 * One inbox item (GLOSSARY): something to hand directly to the agent of a work (`branch`, owned by the receiving runner's member). The kinds are a conflict alert with my work (all four kinds), a claim that overlaps mine, and cancellation of a declared change to a contract I use.
 * It goes into both works' inboxes whenever an alert is created, changed, or resolved. An item for the same alert not yet handed over is replaced with the new one (it gets a new `id` too).
 * `id` only grows across the whole server and is what the delivery confirmation (`delivered`) points to. `at` is when it came in and `alert` is the alert as of then.
 */
const InboxHead = { id: z.number(), branch: z.string(), at: z.string() };

/** Max length of another person's question in an ask. Same as a channel message. */
export const MAX_QUESTION_CHARS = 4000;

/**
 * One question in an ask (ADR-0024). The asking work's agent sent it to another member's (`to`) agent. `id` is a number that only grows across the whole server.
 * `executor` is the receiving side's executor that answers (will answer). null if the asker did not choose and it has not been sent yet.
 */
export const Question = z.strictObject({
  id: z.number(),
  to: z.string(),
  executor: ExecutorId.nullable(),
  text: z.string(),
  at: z.string(),
});
export type Question = z.infer<typeof Question>;
export const InboxItem = z.discriminatedUnion("kind", [
  z.strictObject({ ...InboxHead, kind: z.literal("alert"), alert: Alert }),
  /** My claim (`mine`) and another work's claim (`theirs`) overlap. The lines are from each one's copy when it was made. Whoever claimed later finds out and puts it in both. */
  z.strictObject({ ...InboxHead, kind: z.literal("overlap"), mine: Claim, theirs: Claim }),
  /**
   * The answer to a question this work asked (`omagari ask`). The receiving runner's session answered, or could not (`error`: executor failed, the receiving side turned the switch off in the meantime).
   * A question with no answer within 14 days expires without a notice.
   */
  z.strictObject({
    ...InboxHead,
    kind: z.literal("answer"),
    question: Question,
    answer: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("answered"), ...Reply.shape }),
      z.strictObject({ state: z.literal("failed"), error: ContractError }),
    ]),
  }),
  /**
   * Another work released its claim without carrying out its plan (`claim.plan`): that declared contract change is cancelled. Goes to the works that got an alert for that plan.
   * Releasing after the definition line changed as planned, or because the branch merged, is not a cancellation.
   */
  z.strictObject({ ...InboxHead, kind: z.literal("cancelled"), claim: Claim }),
  /**
   * News of a debate this work is in (ADR-0040): it opened (`opened`), it is my turn (`turn`, a rebuttal round opened and it is time for the `round`th stance), it concluded (`concluded`, by which path in `by`).
   * It goes to both works in the debate. The owners inside are only revealed after it concludes, so only `concluded` carries the winner (`winner`, the work's `branch`).
   */
  z.strictObject({
    ...InboxHead,
    kind: z.literal("debate"),
    event: z.enum(["opened", "turn", "concluded"]),
    post: z.strictObject({ id: z.string(), name: z.string() }),
    round: z.number().int().positive().optional(),
    by: z.enum(["experiment", "evidence", "choice"]).optional(),
    winner: z.strictObject({ login: z.string(), branch: z.string() }).optional(),
  }),
]);
export type InboxItem = z.infer<typeof InboxItem>;

/**
 * The GitHub issue matched to a post (ADR-0032). One Discuss post is one issue (ADR-0039). The title, labels, and open/closed state are read from GitHub, and
 * if a person changes them on GitHub, they follow on the next cycle. A post's messages go to issue comments, and issue comments come in as a post's messages.
 * If it is an FYI post or the issue could not be opened yet (GitHub did not accept it, no member has a token), the post's `issue` is null.
 * Even if importance drops after the issue was opened, the issue is not closed. It only closes when the alert resolves.
 */
export const PostIssue = z.strictObject({
  number: z.number(),
  url: z.string(),
  title: z.string(),
  labels: z.array(z.string()),
  open: z.boolean(),
});
export type PostIssue = z.infer<typeof PostIssue>;

/**
 * An alert's post (ADR-0027). One post per alert, created together when the alert shows up in a forum. The post's first message is that alert.
 * A post behaves like a channel: put `channel` where a channel goes to use writing, past messages, DM, `@mention`, and posting to a channel as they are.
 * It is not in the channel list (`api.channels`). `alert` is the number of the channel message the alert sits in, and `count` is the number of messages (messages and public Q&As) in the post.
 * It also holds the summary the forum list draws: `last` is the author and one line of the last message (not counting the alert; `null` if none),
 * and `activity` is when the last message was posted (when the alert arrived if none). The arrival time is the alert message's `at`.
 */
export const Post = z.strictObject({
  channel: z.string(),
  /** This post's repo `owner/name`. */
  repo: z.string(),
  alert: z.number(),
  count: z.number(),
  last: z.strictObject({ login: z.string(), name: z.string(), line: z.string() }).nullable(),
  activity: z.string(),
  issue: PostIssue.nullable(),
  /** The post's labels (ADR-0039). The kind label is attached when the alert is created, and Confirmed when confirmed. If there is no issue, they exist only in Omagari. */
  labels: z.array(z.string()),
  /** The highest importance among the labels. */
  importance: Importance,
  /** Ids of the forums this post shows in, by name. If empty, it is in "Other posts". When labels, importance, or forums change, the alert line arrives again on the live connection. */
  forums: z.array(z.string()),
});
export type Post = z.infer<typeof Post>;

/** Evidence label (ADR-0040). When a post gets this, a debate opens by itself. It is independent of the label's importance and the team can't change it. */
export const EVIDENCE_LABELS: readonly string[] = [CONFIRMED_LABEL, ALERT_LABELS.declared];

/**
 * A mark on one piece of a stance's evidence (implementation ch. 7, Q&A A15). The runner of the side that gave the stance checks it in its own repo. The server doesn't judge.
 * With a reference (a commit, `file:line`, a decision file) it is verified; if the reference doesn't exist it is missing; free text that is not a reference is unverified.
 */
export const EvidenceMark = z.enum(["verified", "unverified", "missing"]);
export type EvidenceMark = z.infer<typeof EvidenceMark>;
export const EVIDENCE_MARKS = {
  verified: "Verified",
  unverified: "Unverified",
  missing: "Doesn't exist",
} as const satisfies Record<EvidenceMark, string>;

/** One piece of evidence: exactly what the agent wrote (`text`), and its mark. */
export const Evidence = z.strictObject({ text: z.string(), mark: EvidenceMark });
export type Evidence = z.infer<typeof Evidence>;

/** Max size of a patch put on an experiment (characters). If over, it doesn't run and is kept truncated. */
export const MAX_PATCH_CHARS = 64_000;

/**
 * A debate experiment (ADR-0040, Q&A A14): the verdict from taking the patch an agent attached to a stance (a unified diff applied with `git apply`), and the runner that gave that stance runs it in the same temporary worktree as a merge run,
 * puts it on top of the merge of the two works, and runs the check command inside the sandbox. It is that stance's verified evidence. The experiment branch is neither created nor pushed.
 * If it could not run (no check command or sandbox, they don't merge, the patch doesn't apply, the other work is not observed), it is `not_run` with a reason.
 * `check` is the check command that ran. Missing if it could not be read.
 */
export const Experiment = z.strictObject({
  patch: z.string().max(MAX_PATCH_CHARS),
  verdict: Verdict,
  reason: z.string().optional(),
  check: z.string().optional(),
  ms: z.number(),
});
export type Experiment = z.infer<typeof Experiment>;

/**
 * One stance in a debate (ADR-0040): a claim and a list of evidence. `context` is how it picked up context: it forked the owner's recent work session on that branch
 * read-only and started it (`session`), or it could not fork and gave its stance with only the draft PR's plan, diff, and related decisions (`none`, "joined without context").
 * `model` and `effort` are what answered (same as `Reply`).
 */
export const Stance = z.strictObject({
  claim: z.string().min(1),
  evidence: z.array(Evidence),
  context: z.enum(["session", "none"]),
  /**
   * The agent said it changed its own stance from the previous round in a rebuttal round (implementation ch. 7). `reason` is the reason for the change (new evidence).
   * A stance that changed without a reason (`changed` is set and `reason` is not) shows "changed without a reason" on screen. Not present in the first round or in a stance that held.
   */
  changed: z.strictObject({ reason: z.string().min(1).optional() }).optional(),
  /**
   * A stance given by a stand-in (ADR-0040, Q&A A18). A member called in for the absentee, and that member's runner gave it on that member's usage.
   * The server attaches it. A value the runner sent is dropped.
   */
  proxy: z.strictObject({ login: z.string(), name: z.string() }).optional(),
  /** The experiment, if a patch was attached to the stance. */
  experiment: Experiment.optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
});
export type Stance = z.infer<typeof Stance>;

/**
 * One seat in a debate: the owner's agent of the conflicting work (`branch` of `login`). `state` is waiting for a stance in the current round (sent when the runner connects if it is off),
 * gave one, did not show up because the owner turned off the auto-join switch (the ask switch, ADR-0024) ("turned off joining debates"), or could not give one (`error`).
 * A seat has no stance. The stances are in the owner-hidden option (`DebateOption`).
 */
export const DebateSeat = z.strictObject({
  login: z.string(),
  name: z.string(),
  branch: z.string(),
  state: z.enum(["waiting", "submitted", "off", "failed"]),
  error: ContractError.optional(),
  /** The stand-in called to this seat (the member who called). When the next round opens, if the owner's runner is connected, the real agent takes over and this goes away. */
  proxy: z.strictObject({ login: z.string(), name: z.string() }).optional(),
  /** A waiting seat whose runner to give it (the caller's, for a stand-in) is not connected. When it connects, a join request is sent and it continues. */
  away: z.literal(true).optional(),
});
export type DebateSeat = z.infer<typeof DebateSeat>;

/**
 * One option in a debate: one seat's stances (one per finished round, in round order). The screen calls them "Option 1", "Option 2" in order.
 * Which seat an option is from was shuffled by the server when it opened the debate (ADR-0040). `owner` is always attached once an option is public, and the screen covers it like a spoiler until the conclusion (#202).
 * It opens only on the screen of the person who clicked. The owner is not sent in the join request to the runner.
 */
export const DebateOption = z.strictObject({
  stances: z.array(Stance),
  owner: z.strictObject({ login: z.string(), name: z.string(), branch: z.string() }).optional(),
});
export type DebateOption = z.infer<typeof DebateOption>;

/**
 * A debate's conclusion (ADR-0040, implementation ch. 7): an option (`option`, a seat of `options`) and the path taken. `experiment` is when only one option passed the last stance's experiment and the server proposed that one (before evidence),
 * `evidence` is when verified evidence is on only one side in the last stance, so
 * the server proposed that side, and `choice` is one a member of the post (`chooser`) chose first. A conclusion is a proposal and goes into the draft request for writing up a decision (ADR-0028).
 */
export const DebateConclusion = z.strictObject({
  option: z.number().int().nonnegative(),
  by: z.enum(["experiment", "evidence", "choice"]),
  chooser: z.strictObject({ login: z.string(), name: z.string() }).optional(),
  at: z.string(),
});
export type DebateConclusion = z.infer<typeof DebateConclusion>;

/** Default number of debate rounds (Q&A A13): a hidden first round and two rebuttal rounds. The server settings can reduce it. */
export const DEBATE_ROUNDS = 3;

/**
 * A post's debate (ADR-0040, implementation ch. 7). The server opens it when a post gets an evidence label, and a post has one debate.
 * The server runs the process, and the judging is done by the two owners' agents on their own machines. The seats are in the same order as the alert's two works (`Alert.works`).
 * A round's stances are not exposed to the server API, the web, or the runner until every seat in that round has given theirs (until no seat is waiting).
 * `revealed` is whether the hidden first round was made public. After a round both seats gave, the next round (rebuttal) runs. The other side's previous stance is passed into a rebuttal round.
 * `state`: a round is running (`open`), the last round ended and it is a person's turn to choose (`choosing`), it concluded (`concluded`),
 * it ended with no stance given (`ended`), or no round finished within 14 days (`INBOX_MS`) of opening so it ended (`expired`). On expiry, a round that did not finish stays hidden. If verified evidence is on only one side in the last stance, nobody chooses and that side becomes the conclusion.
 */
export const Debate = z.strictObject({
  id: z.number(),
  state: z.enum(["open", "choosing", "concluded", "ended", "expired"]),
  round: z.number().int().positive(),
  rounds: z.number().int().positive(),
  revealed: z.boolean(),
  seats: z.tuple([DebateSeat, DebateSeat]),
  options: z.array(DebateOption).max(2),
  conclusion: DebateConclusion.optional(),
  at: z.string(),
});
export type Debate = z.infer<typeof Debate>;

/**
 * A debate request (ADR-0040, implementation ch. 7, Q&A A16): a member (web) or agent (CLI) asked to open a debate on a post without an evidence label, attaching an agenda and evidence.
 * If the agenda or evidence is empty (`opened` is false), the debate doesn't open and only the request stays marked on the post. Only the latest request is kept.
 */
export const DebateRequest = z.strictObject({
  login: z.string(),
  name: z.string(),
  agenda: z.string(),
  grounds: z.string(),
  opened: z.boolean(),
  at: z.string(),
});
export type DebateRequest = z.infer<typeof DebateRequest>;

/**
 * Length of a decision PR's objection window (ADR-0025, ADR-0030). "Immediately" means Omagari merges as soon as it opens the PR. "One day" is the default.
 * "Custom" is a number and a unit (hours, days). The longest value is not decided, and the upper limit of `amount` is set so the time doesn't overflow.
 */
export const DecisionWindow = z.union([
  z.enum(["now", "hour", "day", "three_days"]),
  z.strictObject({ amount: z.number().int().min(1).max(9999), unit: z.enum(["hour", "day"]) }),
]);
export type DecisionWindow = z.infer<typeof DecisionWindow>;

/**
 * One decision written up in a post, and its decision PR (ADR-0025). A PR is opened against the repo's default branch in the name of the member who wrote it up (`login`).
 * `state` is read from the PR: proposed (`proposed`) while open, accepted (`accepted`) once merged, `closed` if closed without a merge.
 * `post` is the post's channel, and `path` is the decision file (`docs/decisions/NNNN-title.md`).
 *
 * What the decision status strip (DESIGN.md) draws:
 * - `status`: proposed, objected (`objected`, count in `objections`), reopened after every objection was withdrawn (`reopened`),
 *   the window closed or everyone agreed but GitHub blocked it (`blocked`), stalled because the writer's token stopped working (`stalled`), accepted, dropped (`closed`).
 *   `reason` is why it is blocked or stalled (what GitHub gave).
 * - `closes`: when the window closes. null if an objection is open, or it merged or closed. The time left is the difference between this and now.
 * - `deciders`: the deciders (ADR-0029) and whether they agreed. The one who wrote it up has always agreed. The agreement count is the number of deciders who are `agreed`.
 * - `objections`: open objections. Ones made in the post (`post`) and GitHub change-request reviews (`github`). Withdrawing one removes it.
 * - `early`: merged before the window closed because every decider agreed.
 */
export const Decision = z.strictObject({
  id: z.number(),
  post: z.string(),
  login: z.string(),
  name: z.string(),
  title: z.string(),
  path: z.string(),
  pull: z.strictObject({ number: z.number(), url: z.string() }),
  window: DecisionWindow,
  state: z.enum(["proposed", "accepted", "closed"]),
  status: z.enum(["proposed", "objected", "reopened", "blocked", "stalled", "accepted", "closed"]),
  reason: z.string().optional(),
  closes: z.string().nullable(),
  deciders: z.array(z.strictObject({ login: z.string(), name: z.string(), agreed: z.boolean() })),
  objections: z.array(
    z.strictObject({
      login: z.string(),
      name: z.string(),
      via: z.enum(["post", "github"]),
      at: z.string(),
    }),
  ),
  early: z.boolean(),
  /**
   * For a decision made in a post with a stand-in in the debate (ADR-0040): the absentees who have not yet confirmed (agreed). Absentees count as deciders.
   * If not empty, it does not merge even when the window closes or the other deciders all agree. None if no stand-in was involved.
   */
  awaiting: z.array(z.strictObject({ login: z.string(), name: z.string() })).optional(),
  at: z.string(),
});
export type Decision = z.infer<typeof Decision>;

/**
 * One reaction on a message (ADR-0044): an emoji and the members who added it. Members come in the order they added it, and reactions in the order first added.
 * One member adds one emoji only once. If everyone who added it removes it, the reaction is gone.
 */
export const Reaction = z.strictObject({
  emoji: z.string(),
  members: z.array(z.strictObject({ login: z.string(), name: z.string() })).min(1),
});
export type Reaction = z.infer<typeof Reaction>;

/**
 * The original message a reply points to (ADR-0047). Only a message a person wrote (text or public Q&A) in the same channel or post.
 * `original` is how the original message looks now: its author and first line (for a Q&A, the question's first line; `>` quote lines are skipped). null if it can't be read (deleted or not visible, same thing, #239).
 * `notify` is whether to notify the original message's author (the sender can turn it off). #313 delivers the notification.
 */
export const ReplyTo = z.strictObject({
  id: z.number(),
  notify: z.boolean(),
  original: z.strictObject({ login: z.string(), name: z.string(), line: z.string() }).nullable(),
});
export type ReplyTo = z.infer<typeof ReplyTo>;

/**
 * The thread a reply sits in (ADR-0047): the original message's number and how it looks now (like `ReplyTo.original`).
 * `writers` is everyone who has written in the thread so far (logins), so the web knows who a new reply calls (#370). `ThreadSummary.writers` only holds three.
 */
export const ThreadOf = z.strictObject({
  id: z.number(),
  original: ReplyTo.shape.original,
  writers: z.array(z.string()),
});
export type ThreadOf = z.infer<typeof ThreadOf>;

/**
 * The thread under a channel message (DESIGN.md "Reply, thread, and quote", draft 114-A): how many replies, up to three people who wrote in it
 * (latest first), and when the last reply came. Missing while the message has no thread.
 */
export const ThreadSummary = z.strictObject({
  count: z.number().int(),
  writers: z.array(z.strictObject({ login: z.string(), name: z.string() })).max(3),
  last: z.string(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

/** What text and Q&A messages share about threads. A reply in a thread shows in the channel only with `alsoInChannel`. */
const Threaded = {
  /** For a reply in a thread, the thread's original message. */
  threadOf: ThreadOf.optional(),
  /** A reply in a thread that also shows in the channel. */
  alsoInChannel: z.literal(true).optional(),
  /** The thread under this message. Changes come again with the same `id` on the live connection. */
  thread: ThreadSummary.optional(),
};

/**
 * One item stacked in a channel. `id` is a number that only grows across the whole workspace, so it is both the order within a channel and
 * the place to resume from when the live connection reconnects (`after` in `webToServer.hello`).
 * A message people wrote (`text`), a public Q&A (`qa`), and an alert Omagari posted (`alert`) sit on the same numbered line.
 */
export const ChannelMessage = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    id: z.number(),
    channel: z.string(),
    login: z.string(),
    /** The author's GitHub profile name. If left empty, same as `login`. */
    name: z.string(),
    /** Text as written. The server doesn't alter it even if it contains HTML, and the web shows it only as text. */
    text: z.string(),
    at: z.string(),
    /** A comment added on GitHub to the post's issue came in (ADR-0032). `login` is a GitHub login, so it may not be a member. */
    github: z.literal(true).optional(),
    /** Reactions added (`api.react`). When reactions change, the one with the same `id` arrives again on the live connection. */
    reactions: z.array(Reaction),
    /** For a reply, its original message. Comments that came in from GitHub are never replies. */
    replyTo: ReplyTo.optional(),
    ...Threaded,
  }),
  /**
   * A public Q&A: a DM or `@mention` posted to the channel. The question and answer are always together. `login` and `name` are the owner (who posted it) of that agent,
   * and `at` is when it was posted to the channel (when it was asked, for an `@mention`). When the answer arrives, the one with the same `id` arrives again on the live connection.
   * `text` is text the poster wrote along with it. Missing if posted without text or an `@mention`. Like a text message's `text`, the web shows it only as text.
   */
  z.strictObject({
    kind: z.literal("qa"),
    id: z.number(),
    channel: z.string(),
    login: z.string(),
    name: z.string(),
    at: z.string(),
    text: z.string().optional(),
    qa: Qa,
    /** Reactions added. Same as on a text message. */
    reactions: z.array(Reaction),
    /** If the `@mention` was made inside a reply, the original message. It goes to the agent along with the question. */
    replyTo: ReplyTo.optional(),
    /** An `@mention` in a thread answers in that thread. */
    ...Threaded,
  }),
  /**
   * An alert Omagari posted. It has no author. When the alert is updated or resolved or the post's message count changes, the one with the same `id` arrives again on the live connection.
   * `channel` is where the alert line sits (not in any forum and not in the channel list), and `at` is when it was first posted.
   * `post` is the summary of this alert's post. The forums it shows in are `post.forums`.
   */
  z.strictObject({
    kind: z.literal("alert"),
    id: z.number(),
    channel: z.string(),
    at: z.string(),
    alert: Alert,
    post: Post.omit({ alert: true }),
  }),
  /**
   * A decision PR line Omagari posted. It sits only in the decision's post (not posted as a forum alert line, ADR-0027).
   * `event` is what happened then: the PR opened, a decider agreed, an objection was raised, an objection was withdrawn, the writer pushed a fix,
   * it merged, it closed without a merge, Omagari tried to merge but GitHub blocked it (`blocked`), or the writer's token stopped working and it stalled (`stalled`).
   * `reason` is why it was blocked or stalled. `by` is who did it (agree, object, withdraw, push a fix). For a GitHub review, they may not be a member.
   * `decision` is the decision as of when it was read, so even for a past line `state` is the current one. It doesn't count toward the post's message count.
   */
  z.strictObject({
    kind: z.literal("decision"),
    id: z.number(),
    channel: z.string(),
    at: z.string(),
    event: z.enum([
      "opened",
      "agreed",
      "objected",
      "withdrawn",
      "revised",
      "merged",
      "closed",
      "blocked",
      "stalled",
    ]),
    reason: z.string().optional(),
    by: z.strictObject({ login: z.string(), name: z.string() }).optional(),
    decision: Decision,
  }),
]);
export type ChannelMessage = z.infer<typeof ChannelMessage>;

/**
 * The four fields of a decision draft (ADR-0028). It follows the shape of a decision record (Nygard's ADR). What each holds is in the instruction the runner gives the executor.
 */
export const DraftFields = z.strictObject({
  title: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
});
export type DraftFields = z.infer<typeof DraftFields>;

/**
 * One decision draft: what my agent read from a post's (`post`, the post's channel) messages and Q&A and wrote (ADR-0028). It is an unsaved proposal, so it is lost if the server shuts down.
 * `id` is set by the server and used when stopping (`api.stopDraft`). `read` is the number of the post's messages (`texts`) and public Q&As (`qas`) passed to the agent.
 * `state` is writing, done (`drafted`, with the answering model and effort attached, same as `Reply`), stopped, or couldn't write.
 */
export const Draft = z.strictObject({
  id: z.string(),
  post: z.string(),
  executor: ExecutorId,
  read: z.strictObject({ texts: z.number(), qas: z.number() }),
  state: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending") }),
    z.strictObject({
      state: z.literal("drafted"),
      ...DraftFields.shape,
      model: z.string().optional(),
      effort: z.string().optional(),
    }),
    z.strictObject({ state: z.literal("stopped") }),
    z.strictObject({ state: z.literal("failed"), error: ContractError }),
  ]),
});
export type Draft = z.infer<typeof Draft>;

const pairCommon = {
  branch: z.string(),
  theirs: z.strictObject({ login: z.string(), branch: z.string() }),
};
/**
 * One pair of conflicts the runner computed: this runner's work (`branch`) and another member's work (`theirs`).
 * A direct conflict has the files that collide or can't be read; an indirect conflict (guessed) and duplicate work have symbols.
 * An indirect conflict only carries the direction where this runner's copy uses a symbol whose definition line the other side changed (the other direction is computed by the other runner).
 * A declared contract change is the same: it only carries the direction where this runner's copy uses the symbol of the plan attached to the other side's claim, and it carries `plan`.
 */
export const ConflictPair = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct"),
    ...pairCommon,
    /** `mine` is lines based on this runner's copy, `theirs` on the other side's copy. */
    files: z.array(
      z.union([
        z.strictObject({ path: z.string(), mine: z.array(LineRange), theirs: z.array(LineRange) }),
        z.strictObject({ path: z.string(), unknown: Unreadable }),
      ]),
    ),
  }),
  z.strictObject({
    kind: z.enum(["indirect", "duplicate", "declared"]),
    ...pairCommon,
    symbols: z.array(
      z.strictObject({
        name: z.string(),
        mine: z.array(SymbolPlace),
        theirs: z.array(SymbolPlace),
        plan: Plan.optional(),
      }),
    ),
  }),
]);
export type ConflictPair = z.infer<typeof ConflictPair>;

/** The config file that holds the check command. Committed at the repo's top, and the runner reads only the version merged into the default branch (remote tracking) (ADR-0034). */
export const CHECK_FILE = ".omagari.json";

/**
 * Shape of the config file: the check command (`check`), and optionally a setup command (`setup`) to run once before it. Both are one-line shell commands.
 * Unknown keys are rejected. This is so a setup command with a misspelled key doesn't drop out silently.
 */
export const CheckConfig = z.strictObject({
  check: z.string().trim().min(1),
  setup: z.string().trim().min(1).optional(),
});
export type CheckConfig = z.infer<typeof CheckConfig>;

/**
 * This runner's merge run: on, turned off (`omagari runner --merge-check off`), or turned on but not run because this machine has no sandbox tool (ADR-0033, ADR-0034).
 */
export const MergeCheckState = z.enum(["on", "off", "no_sandbox"]);
export type MergeCheckState = z.infer<typeof MergeCheckState>;

/**
 * The config file the runner read from the default branch. If read, `config`; if not, the reason:
 * the default branch is unknown (`unknown_branch`), the file is missing (`missing`), or it is not JSON or has the wrong shape (`invalid`).
 */
export const CheckReading = z.union([
  z.strictObject({ config: CheckConfig }),
  z.strictObject({ problem: z.enum(["unknown_branch", "missing", "invalid"]) }),
]);
export type CheckReading = z.infer<typeof CheckReading>;

/** What the runner sends to the server. Later issues add their own messages here. */
/** Max number of overlapping claims carried on one claim. The runner doesn't carry more. */
export const MAX_OVERLAPS = 100;

export const runnerToServer = {
  /**
   * Sent right after connecting. `repos` are the repos (`owner/name`) the runner folders' GitHub remotes point to. The server connects the runner to the first of them that is in the workspace and
   * the member has push permission on (ADR-0043). If there is no such repo, it refuses with `forbidden`.
   * `executors` are the executors this runner can run on this machine. One agent is created per executor (ADR-0015).
   * `choices` is what can be chosen per executor. Ones that could not be asked of the executor are left out (ADR-0020).
   * `mergeCheck` is this runner's merge run. Turning it on and off is only done on the runner (ADR-0034), so it is announced once when connecting.
   * `repos` only has remotes under the accounts the server accepts (`api.accounts`). The runner never sends the others, not even by name (ADR-0049).
   * `shareRepo` says a person started this runner by hand (`omagari runner`), which shares the repo (repo sharing, ADR-0049). The background runner sends false.
   */
  hello: z.strictObject({
    session: z.string(),
    repos: z.array(z.string()),
    shareRepo: z.boolean(),
    executors: z.array(ExecutorId),
    choices: z.partialRecord(ExecutorId, Choices),
    mergeCheck: MergeCheckState,
  }),
  /**
   * The config file read from the default branch (the check command). Sent once on each connect, then whenever what was read changes.
   * There is one per repo, so the server keeps the last one, whichever member's runner in that repo sent it.
   */
  checkCommand: CheckReading,
  /**
   * Observation. All the works the runner sees now: one checked-out branch per registered folder and per worktree linked to it (ADR-0006).
   * The server replaces that member's works with this. So lowering the share level removes what was uploaded before from the server.
   * Sent on each connect and whenever the observation changes. If it is not a branch (detached HEAD), there is no work.
   */
  observation: z.strictObject({ works: z.array(Work) }),
  /**
   * Conflict computation (ADR-0023). A direct conflict is the result of merging, with `git merge-file`, the files this runner's work and another member's work both changed, using the version at the point where the two works' base commits diverged as the ancestor.
   * Only pairs with a file whose lines collide or whose other-side content can't be read are carried. A pair not carried is clean.
   * An indirect conflict (guessed) is a symbol whose definition line the other side changed or removed, found by name in my work's copy; duplicate work is a new definition of the same name appearing in both works.
   * One per pair and kind.
   * The server replaces this runner's computation with this. Sent once on each connect (even if empty), then whenever it changes. Works whose share level is intent are not carried.
   */
  conflicts: z.strictObject({ pairs: z.array(ConflictPair) }),
  /**
   * Merge run verdicts (ADR-0036). A merge run of the indirect conflict (guessed) between this runner's work (`branch`) and another member's work (`theirs`).
   * Sent when a run starts (`running`), when a verdict is made, and when the content changes afterward and it becomes an old result. The server attaches it to that pair's open indirect conflict alert,
   * and drops it if there is no open alert. There is no way for the server to tell the runner to run (ADR-0033).
   */
  merged: z.strictObject({
    branch: z.string(),
    theirs: z.strictObject({ login: z.string(), branch: z.string() }),
    run: MergeRun,
  }),
  /**
   * Inbox items were handed to a work session or the CLI (the `id`s of `inbox`). The server clears only that member's.
   * What was handed over while disconnected is sent as soon as it reconnects. What was shown to a subagent doesn't count as handed over, so it isn't carried.
   */
  delivered: z.strictObject({ ids: z.array(z.number()) }),
  /**
   * A hook of `executor` fired on this member's work (`branch`). The work's agent is the executor that sent last (ADR-0015).
   * The runner only sends it when the executor the hook carried differs from what it last sent for that work. The server keeps it even across a restart.
   */
  working: z.strictObject({ branch: z.string().min(1), executor: ExecutorId }),
  /**
   * Sets a claim (ADR-0008). The server always accepts it and returns the claim that was set as `claimed` (`re`). If the same work has a claim on the same place (path, symbol, lines), it replaces it.
   * `overlaps` are other people's claims (`Claim.id`) the runner shifted into my copy's lines and found to overlap. The server puts the overlap into both works' inboxes.
   * `unit` and `lines` are set by the runner (for a symbol, the line range where the definition was found; for a new file, the whole file).
   * If `plan` is set, it replaces an older plan on the same symbol of the same work.
   */
  claim: z.strictObject({
    branch: z.string(),
    path: z.string(),
    unit: Claim.shape.unit,
    symbol: z.string().optional(),
    lines: LineRange.optional(),
    overlaps: z.array(z.number()).max(MAX_OVERLAPS),
    plan: Plan.optional(),
  }),
  /**
   * Releases the claims of this member's work (`branch`). Without `path`, all claims of that work; with it, the claims on that path (only that symbol or lines if given).
   * The server answers with `released` (`re`) holding the released claims. The runner sends this on its own when the branch is deleted.
   * If a released claim's plan did not come true (the definition lines of that work did not change as planned), the server puts a cancellation (`cancelled`) in the inbox of the work that got that plan's alert.
   */
  release: z.strictObject({
    branch: z.string(),
    path: z.string().optional(),
    symbol: z.string().optional(),
    lines: LineRange.optional(),
  }),
  /**
   * The agent of this member's work (`branch`) asks the agent of another member (`to`) (ADR-0024). `executor` is the receiving executor you chose; the server picks one if it's missing.
   * The server answers right away with `questioned` (`re`), and the answer goes into that work's inbox (`answer`) later. Asking yourself or a non-member is an `error`.
   */
  question: z.strictObject({
    branch: z.string().min(1),
    to: z.string().min(1),
    executor: ExecutorId.optional(),
    text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  }),
  /** A runner session answered an `ask` or `question` (`re`). If it couldn't answer, it sends `error` with `re`. */
  answer: Reply,
  /**
   * The stance given to a `debate` (`re`). Evidence marks are what this runner saw in its own repo. If it couldn't give one, it sends `error` with `re`.
   * If the runner disconnected in between, the server doesn't accept it and sends the join request again when the runner reconnects.
   */
  stance: Stance,
  /** The draft for `draft` (`re`). If it couldn't write one, it sends `error` with `re`. The server drops the answer of a stopped draft. */
  drafted: z.strictObject({
    ...DraftFields.shape,
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
  error: ContractError,
} satisfies Payloads;

/** What the server sends to the runner. The runner accepts only the kinds listed here. */
export const serverToRunner = {
  /**
   * Accepts the hello. The runner is paired with this repo as this member's agent.
   * `shared` says whether this member shared the repo (repo sharing, ADR-0049). Until then the runner sends no observation, conflicts, check command, merge runs or agents, and the server drops them.
   */
  welcome: z.strictObject({ login: z.string(), repo: z.string(), shared: z.boolean() }),
  /** The member shared the repo or stopped sharing it (`api.share`). Sent to that member's runners in that repo. */
  sharing: z.strictObject({ shared: z.boolean() }),
  /**
   * Q&A. The runner gets only this and decision drafts (`draft`). Only the agent to ask (`executor`), the channel, the question, and the channel conversation come; the runner decides tools, folders, and sessions.
   * The runner keeps one channel session per channel and executor (ADR-0015), runs one turn at a time, and queues the rest in arrival order.
   * Posts come through a channel too (`channel.id` is the post's channel). So a post's channel session is kept apart from the sessions of the same channel.
   * `recent` is the recent conversation of that channel (oldest first, up to `CHANNEL_CONTEXT`). For a post, the first is its alert and the rest is the post's conversation. The runner wraps only what comes after that channel session's last turn
   * as data, not instructions. The question was written by the owner of that agent.
   * `model` and `effort` are what the owner picked. If they aren't among the choices the runner announced in hello, it doesn't start the executor and answers with an error.
   */
  ask: z.strictObject({
    executor: ExecutorId,
    channel: Channel.omit({ kind: true }),
    message: z.string().min(1),
    recent: z.array(ChannelMessage).max(CHANNEL_CONTEXT),
    /** If the `@mention` was made inside a reply, the original message (ADR-0047). The runner wraps it as data, not instructions, like channel conversation, and puts it before the question. */
    replyTo: ChannelMessage.optional(),
    /** If the `@mention` was made in a thread, the thread: its original message, then its replies, oldest first (ADR-0047). Wrapped as data like `replyTo`. */
    thread: z.array(ChannelMessage).max(CHANNEL_CONTEXT).optional(),
    ...ModelPick.shape,
  }),
  /**
   * Write a decision draft (ADR-0028). `messages` is the post's conversation (the first is its alert, oldest first, up to `CHANNEL_CONTEXT`).
   * The runner doesn't use a channel session; it runs one new runner session read-only, in the same queue as Q&A. The conversation is wrapped as data, not instructions (ADR-0017).
   * The answer is `drafted` (`re`). `model` and `effort` are the same as in `ask`.
   */
  draft: z.strictObject({
    executor: ExecutorId,
    post: Channel.omit({ kind: true }),
    messages: z.array(ChannelMessage).max(CHANNEL_CONTEXT),
    /** If the post's debate reached a conclusion, the option (owner and last stance) and the path taken (ADR-0040). The runner wraps it as data and passes it as grounds for the draft. */
    conclusion: z
      .strictObject({
        by: DebateConclusion.shape.by,
        owner: z.strictObject({ login: z.string(), name: z.string(), branch: z.string() }),
        stance: Stance,
      })
      .optional(),
    ...ModelPick.shape,
  }),
  /**
   * A request to join a debate (ADR-0040). Gives the stance for round `round` in the `debate` of the post where this runner's member's work (`branch`) conflicted.
   * `messages` is the post's conversation (the first is its alert, same as `draft`). The first round is blinded, so the other side's stance doesn't come.
   * Rebuttal rounds (2 and up) get my stance from the last round (`mine`) and the other side's stance (`theirs`). The runner wraps the other side's stance as data, not instructions (ADR-0017),
   * and asks for a reason when the stance changes (`Stance.changed`). The runner forks the owner's recent work session on that branch read-only; if it can't, it passes only the draft PR's plan, diff, and related decisions
   * and starts it as "joining without context". A debate session doesn't edit files (ADR-0003). It waits in the same queue as Q&A, and the answer is `stance` (`re`).
   * If the agent attaches a patch to the stance, the runner runs an experiment on top of my work merged with `against` and sends it as `Stance.experiment`.
   */
  debate: z.strictObject({
    debate: z.number(),
    round: z.number().int().positive(),
    executor: ExecutorId,
    branch: z.string(),
    post: Channel.omit({ kind: true }),
    messages: z.array(ChannelMessage).max(CHANNEL_CONTEXT),
    mine: Stance.optional(),
    theirs: Stance.optional(),
    /**
     * For a proxy: the absent member (`for`) and that person's work on the server (per share level, null if none). `branch` is the absent member's branch (ADR-0040, Q&A A17).
     * The runner doesn't fork a work session; it wraps this work as data, not instructions, in its own repo and has the agent read decisions from the repo.
     */
    proxy: z
      .strictObject({
        for: z.strictObject({ login: z.string(), name: z.string() }),
        work: WorkView.nullable(),
      })
      .optional(),
    /** The other side's work. The experiment merges this work (the observation in the `situation` the runner got) with my work. */
    against: z.strictObject({ login: z.string(), branch: z.string() }),
  }),
  /** Stops `draft` (the `id` of what was sent). If it's queued, it won't run; if it's running, the executor is shut down. No answer. */
  stopDraft: z.strictObject({ id: z.string() }),
  /**
   * Current situation: all works in the workspace (including the receiving runner's member's, same as `api.works`) and all claims. Claims stay even if the work isn't observed (for example after checking out another branch).
   * Sent right after welcome, and again every time it changes. The runner keeps it and hands it to hooks (ADR-0005).
   */
  situation: z.strictObject({ works: z.array(WorkView), claims: z.array(Claim) }),
  /** The claim made for `claim` (`re`). */
  claimed: z.strictObject({ claim: Claim }),
  /**
   * The answer to `question` (`re`): sent to the receiving runner (`sent`); kept because the receiving runner is offline and sent when it connects (`offline`, expires after 14 days);
   * not accepted because the receiving side turned the switch off (`refused`, not kept).
   */
  questioned: z.discriminatedUnion("state", [
    z.strictObject({ state: z.enum(["sent", "offline"]), question: Question }),
    z.strictObject({ state: z.literal("refused") }),
  ]),
  /**
   * A question from the agent of another member (the work of `from`) to the `executor` agent of this runner's member. The runner starts a new read-only runner session,
   * wraps the question as data, not instructions (same way as ADR-0017), and answers with `answer` or `error` (`re`). It waits in the same queue as Q&A.
   */
  question: z.strictObject({
    id: z.number(),
    from: WorkRef,
    executor: ExecutorId,
    text: z.string(),
  }),
  /** The claims released by `release` (`re`). Empty if there were none. */
  released: z.strictObject({ claims: z.array(Claim) }),
  /**
   * The whole inbox of this runner's member (per work, items not yet marked delivered and not expired). Sent right after welcome, and again every time it changes.
   * The runner keeps it and hands it to hooks and the CLI.
   */
  inbox: z.strictObject({ items: z.array(InboxItem) }),
  /**
   * The merge run verdicts of this member's works that reached the server (only the ones that came out: not those still running or past results). They cover open alerts and pairs closed as pass that don't raise an alert until they are run again.
   * Sent right after welcome, and again every time a verdict arrives. The runner doesn't rerun the same fingerprint (ADR-0036). This is not an order to run (ADR-0033).
   */
  runs: z.strictObject({ runs: z.array(MergeRun) }),
  error: ContractError,
} satisfies Payloads;

/**
 * The WebSocket path the runner connects to. If the server rejects hello, it sends `error` and closes with 1008.
 * An `error` for rejecting a different contract version has the `VersionMismatch` shape.
 * A runner closed with 1008 doesn't reconnect. For any other reason it reconnects.
 */
export const RUNNER_SOCKET = "/api/runner";

/**
 * The `error` the server sends when it rejects a different contract version (the envelope's `v` is the server's contract version). ADR-0019.
 * Runners with a different contract version read it, so this shape doesn't change even when `CONTRACT_VERSION` goes up. Keys are only added,
 * and this is the one that accepts unknown keys, so earlier runners can read added ones.
 * `version` is the server's version (`git describe --tags`), `contract` is the server's contract version.
 */
export const VersionMismatch = z.object({
  kind: z.literal("error"),
  payload: z.object({
    code: z.literal("version_mismatch"),
    message: z.string(),
    version: z.string(),
    contract: z.number(),
  }),
});

/** Builds a `VersionMismatch` frame. `encode` only builds this contract's `error` (which has no unknown keys), so this is kept separate. */
export function encodeVersionMismatch(message: string, version: string, re?: string) {
  const refusal: z.infer<typeof VersionMismatch> = {
    kind: "error",
    payload: { code: "version_mismatch", message, version, contract: CONTRACT_VERSION },
  };
  return JSON.stringify({ v: CONTRACT_VERSION, id: crypto.randomUUID(), re, ...refusal });
}

/** The limit of one HTTP body. The server doesn't read more. An issue that needs more raises it knowingly. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/** The limit of one frame on the runner socket. The server doesn't read more. Sized so one observation (8MiB of content in total, plus paths) fits. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type Message<P extends Payloads> = {
  [K in keyof P & string]: {
    v: number;
    id: string;
    re?: string;
    kind: K;
    payload: z.infer<P[K]>;
  };
}[keyof P & string];

/** Builds a frame to send. A kind or content not in the contract is caught by the type check, and this throws too. */
export function encode<P extends Payloads, K extends keyof P & string>(
  payloads: P,
  kind: K,
  payload: z.input<P[K]>,
  re?: string,
): string {
  return JSON.stringify({
    v: CONTRACT_VERSION,
    id: crypto.randomUUID(),
    re,
    kind,
    payload: payloads[kind].parse(payload),
  });
}

/** Reads a received frame with the contract. If it differs from the contract, it returns an error to send back instead of a message. */
export function decode<P extends Payloads>(
  payloads: P,
  frame: unknown,
): { message: Message<P> } | { error: ContractError; re?: string } {
  let json: unknown;
  try {
    json = JSON.parse(String(frame));
  } catch {
    return { error: { code: "invalid_message", message: "Not JSON" } };
  }
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) {
    return {
      error: { code: "invalid_message", message: "The envelope doesn't match the contract" },
    };
  }
  const { v, id, re, kind } = envelope.data;
  const refuse = (code: ContractError["code"], message: string) => ({
    re: id,
    error: { code, message },
  });
  if (v !== CONTRACT_VERSION) {
    return refuse(
      "version_mismatch",
      `Contract version mismatch: got ${v}, this side is ${CONTRACT_VERSION}`,
    );
  }
  if (!Object.hasOwn(payloads, kind)) {
    return refuse("unknown_kind", `Not a kind in the contract: ${kind}`);
  }
  const payload = payloads[kind].safeParse(envelope.data.payload);
  if (!payload.success) {
    return refuse("invalid_message", `The content of ${kind} doesn't match the contract`);
  }
  return { message: { v, id, re, kind, payload: payload.data } as Message<P> };
}

// --- Between the CLI and the runner (same machine) ---
// The envelope, `encode`, and `decode` are the same ones used between the runner and the server.

/**
 * One nearby work: another member's work that is changing the file you're about to edit, and where they changed it in that file.
 * Line numbers in `lines` are in that person's copy (1-based, end included); a place with only deleted lines is written as the line before it.
 * If the content can't be read, it's `unknown` with a reason: the share level and missing files (`ObservedFile.omitted`), or their base commit isn't on this machine (`base`).
 */
export const NearbyWork = z.strictObject({
  login: z.string(),
  branch: z.string(),
  offlineSince: z.string().nullable(),
  change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("lines"), ranges: z.array(LineRange) }),
    z.strictObject({ kind: z.literal("deleted") }),
    z.strictObject({ kind: z.literal("unknown"), reason: Unreadable }),
  ]),
});
export type NearbyWork = z.infer<typeof NearbyWork>;

/** What the CLI and hooks send to the runner. The runner accepts only Q&A and asking for the current situation. */
export const cliToRunner = {
  /** Ask from the terminal (`omagari runner ask`). Keeps one terminal session apart from channel sessions. */
  ask: z.strictObject({ message: z.string().min(1) }),
  /** Asks for the current situation. The runner doesn't call the server; it answers right away with what it has kept. It doesn't wait in the Q&A queue. */
  situation: z.strictObject({ executor: ExecutorId }),
  /**
   * Asks for the nearby works of one file (`path`, relative to the repo root). The pre-edit hook calls it on every edit.
   * Like `situation`, it answers right away with what it has kept, and gives only the works of other members that changed that file.
   */
  nearby: z.strictObject({
    path: z.string().min(1),
    executor: ExecutorId,
    /** The work doing the editing. If given, moves others' claims onto this work's copy lines and checks whether this work claimed the file. */
    branch: z.string().optional(),
  }),
  /**
   * Asks who uses and who is changing one symbol (`omagari impact <symbol>`). Ask for a method as `Class.method` or by method name.
   * Where it's used is found in the runner's copy; works that change it are found in the kept situation.
   */
  impact: z.strictObject({
    symbol: z.string().min(1),
    /** The branch of the asking work. Only the same branch of the same login is left out; my other branches' works are seen (ADR-0041). */
    branch: z.string().optional(),
  }),
  /**
   * Asks for the inbox of a work (`branch`). Hooks and every `omagari` command call it. It answers right away with what it has kept and doesn't count it as delivered.
   * Report with `delivered` after handing it to the agent.
   */
  inbox: z.strictObject({
    branch: z.string().min(1),
    /** The executor of the hook that called. If given, the runner tells the server it is that work's agent (`working`). The CLI doesn't send it. */
    executor: ExecutorId.optional(),
  }),
  /** Inbox items (`id`s) were handed to the agent. The runner won't hand them out again and tells the server. Items shown to a subagent aren't sent. */
  delivered: z.strictObject({ ids: z.array(z.number()) }),
  /**
   * Claims for a work (`branch`) (`omagari claim`). `path` is relative to the root of that work's folder. The runner claims on the server and answers.
   * `plan` is the plan to attach (the contract to change).
   */
  claim: ClaimTarget.extend({ plan: Plan.optional() }),
  /** Releases a work's claims (`omagari release`). Without `path`, all claims of that work. */
  release: ClaimTarget.partial({ path: true }),
  /** The agent of a work (`branch`) asks the agent of another member (`omagari ask`). The runner sends it to the server and returns the server's answer as is. */
  question: runnerToServer.question,
  /**
   * Moves my work in a folder (`folder`, the root of that work's folder), including uncommitted changes, to a temporary worktree, and runs the default branch's check command
   * once inside the sandbox (`omagari runner check`). It doesn't merge the other work. The runner doesn't call the server.
   */
  check: z.strictObject({ folder: z.string().min(1) }),
} satisfies Payloads;

/** What the runner sends to the CLI and hooks. */
export const runnerToCli = {
  answer: runnerToServer.answer,
  /** The answer to `situation`. If nothing has been received from the server yet, it's `error` (`runner_offline`). */
  situation: z.strictObject({
    /** The member of this runner */
    login: z.string(),
    /** All works last received from the server */
    works: z.array(WorkView),
    /** If disconnected from the server, the time it disconnected. `works` is what was received up to then. null while connected. */
    disconnectedAt: z.string().nullable(),
    /** My works this runner observed last. Includes the paths of changed files regardless of share level (they go to the server per level). */
    mine: z.array(Work),
    /** All claims last received from the server (lines are in each person's own copy) */
    claims: z.array(Claim),
    /** Whether this member shared the repo (ADR-0049). If not, the session-start hook says how to share. */
    shared: z.boolean(),
    /** The server's address, so the session-start hook can say where sharing sends the content (ADR-0054). */
    server: z.string(),
  }),
  /** The answer to `nearby`. If there are no nearby works, `works` is empty. If nothing has been received yet, it's `error` (`runner_offline`). */
  nearby: z.strictObject({
    works: z.array(NearbyWork),
    /** Claims of other works on that file (including folder claims). Lines are moved onto the editing work's copy. */
    claims: z.array(SeenClaim),
    /** The editing work (`branch`) claimed that file. false if `branch` wasn't given. */
    claimed: z.boolean(),
    /** Same as in `situation`. */
    disconnectedAt: z.string().nullable(),
  }),
  /** The answer to `impact`. If nothing has been received yet, it's `error` (`runner_offline`). */
  impact: z.strictObject({
    /** Places in the runner's copy that use that name (the defining spot is left out). Matching by name also catches other symbols with the same name. */
    uses: z.array(z.strictObject({ path: z.string(), line: z.number() })),
    /** Works of other members that are changing the definition lines of that name (adding, changing, or removing). */
    works: z.array(
      z.strictObject({
        login: z.string(),
        branch: z.string(),
        offlineSince: z.string().nullable(),
        path: z.string(),
        definition: Definition,
      }),
    ),
    /** Claims of other members that put a plan (a contract to change) on that name. They exist even if the code hasn't changed yet. */
    plans: z.array(Claim),
    /** Same as in `situation`. */
    disconnectedAt: z.string().nullable(),
  }),
  /** The answer to `inbox`: that work's items, in arrival order. If nothing has been received yet, it's `error` (`runner_offline`). */
  inbox: z.strictObject({
    /** The member of this runner */
    login: z.string(),
    items: z.array(InboxItem),
    /** Same as in `situation`. */
    disconnectedAt: z.string().nullable(),
  }),
  /** `delivered` was received. */
  delivered: z.strictObject({}),
  /** The answer to `claim`: the claim made, and other people's claims that overlap when moved onto lines of my copy. It's made even if they overlap. If disconnected from the server, it's `error` (`runner_offline`). */
  claimed: z.strictObject({ claim: Claim, overlaps: z.array(SeenClaim) }),
  /** The answer to `release`: the claims released. Empty if there were none. */
  released: z.strictObject({ claims: z.array(Claim) }),
  /** The answer to `question` (same as the server's `questioned`). If disconnected from the server, it's `error` (`runner_offline`). */
  questioned: serverToRunner.questioned,
  /** The answer to `check`. Even a check that couldn't run comes back as a verdict (`not_run`) with a reason. */
  checked: z.strictObject({
    verdict: Verdict,
    /** If it couldn't run, the reason and how to fix it. */
    reason: z.string().optional(),
    /** The default branch the config was read from (remote tracking, like `origin/main`). Missing if unknown. */
    branch: z.string().optional(),
    /** The config that was read. Missing if it couldn't be read. */
    config: CheckConfig.optional(),
    /** Time taken (milliseconds). */
    ms: z.number(),
    /** The tail of the output of the last command that ran (the setup command, if it failed). Empty if nothing ran. */
    output: z.string(),
  }),
  error: ContractError,
} satisfies Payloads;

// --- API the web uses ---

export type Route = {
  method: "GET" | "POST";
  path: string;
  /** Can be called without login. If not, the member's session (`Authorization: Bearer`) is required. */
  public?: true;
  body?: z.ZodType;
  response: z.ZodType;
};
export type BodyOf<R extends Route> = R["body"] extends z.ZodType ? z.output<R["body"]> : undefined;
export type ReplyOf<R extends Route> = z.input<R["response"]>;

/**
 * A header that says which repo to call a per-repo API (works, members, posts, labels, decisions, feed) for (ADR-0043). The value is `owner/name`;
 * for several, join them with commas (the CLI sends all GitHub remotes of the folder). It calls with the first of them that the caller can see.
 * If missing, it calls with the `repo` of `api.me`. If no repo is visible, it's `not_found`.
 */
export const REPO_HEADER = "omagari-repo";

/**
 * A header that says which workspace to call a per-workspace API (channels, forums, metrics) and a per-repo API for (ADR-0043). The value is `Workspace.id`.
 * A per-repo API picks the repo with `REPO_HEADER` among the repos of the chosen workspace. If missing, it's the workspace of the repo `REPO_HEADER` picked,
 * and if that's missing too, the first of `api.workspaces`. If it isn't the caller's workspace, it's `not_found`.
 */
export const WORKSPACE_HEADER = "omagari-workspace";

/** A workspace: paired with one GitHub account (an organization or a person), and created when you add that account's repo (ADR-0043). */
/** An access request (ADR-0052): asks the server's operators to accept GitHub account `account` (lowercase). */
export const AccessRequest = z.strictObject({
  id: z.number().int(),
  account: z.string(),
  state: z.enum(["pending", "approved", "denied"]),
  /** When it was requested. */
  at: z.string(),
});
export type AccessRequest = z.output<typeof AccessRequest>;

/** A waiting request as an operator sees it: who asked. */
export const PendingAccess = AccessRequest.extend({ login: z.string(), name: z.string() });
export type PendingAccess = z.output<typeof PendingAccess>;

/** `api.myAccess`: whether the server takes requests, its legal text links, and the caller's requests, newest first. */
export const AccessStatus = z.strictObject({
  open: z.boolean(),
  terms: z.string().optional(),
  privacy: z.string().optional(),
  requests: z.array(AccessRequest),
});
export type AccessStatus = z.output<typeof AccessStatus>;

export const Workspace = z.strictObject({
  /** The account name in lowercase. Used in `WORKSPACE_HEADER` and `hello.workspace`. */
  id: z.string(),
  /** The account name as is (the owner in `owner/name`). */
  name: z.string(),
  /**
   * The GitHub account type. The web only uses it for the avatar shape (square for an organization, round for a person). Whether you're the only member is decided by the member count, not this.
   * Read from GitHub along with members' push permission; `organization` if it hasn't been read yet.
   */
  kind: z.enum(["organization", "user"]),
  /** The GitHub account avatar URL. null if it hasn't been read yet; the web uses the first letter of the account name. */
  avatar: z.string().nullable(),
  /** The repos of this workspace that this member can see, in the order they were added. */
  repos: z.array(z.string()),
});
export type Workspace = z.output<typeof Workspace>;

/**
 * One GIF found on GIPHY (ADR-0044). The server passes on only this part of the GIPHY response and doesn't store it.
 * `url` is the address of the small picture (200px wide) shown in the search box, and the browser gets it from GIPHY directly.
 */
export const Gif = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9]+$/),
  title: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
});
export type Gif = z.output<typeof Gif>;

/** The API the web uses. Later issues add their own paths here. */
export const api = {
  health: {
    method: "GET",
    path: "/api/health",
    public: true,
    response: z.strictObject({ contract: z.number() }),
  },
  /** Opens GitHub device authorization. The person enters `userCode` at `verificationUri`, and the caller waits with `loginPoll`. */
  login: {
    method: "POST",
    path: "/api/login",
    public: true,
    response: z.strictObject({
      device: z.string(),
      userCode: z.string(),
      verificationUri: z.string(),
      intervalMs: z.number(),
      /** Where an account's admin installs the server's GitHub App (ADR-0053). Absent on a server with an OAuth app. Shown if the login is refused. */
      install: z.string().optional(),
    }),
  },
  /**
   * Checks whether device authorization is done. If it's done and the person has push permission on that repo, it gives a session (ADR-0011).
   * The GitHub token stays only on the server. Without push permission, it's `forbidden`.
   */
  loginPoll: {
    method: "POST",
    path: "/api/login/poll",
    public: true,
    body: z.strictObject({ device: z.string() }),
    response: z.union([
      z.strictObject({ pending: z.literal(true) }),
      z.strictObject({ session: z.string(), login: z.string() }),
    ]),
  },
  /** The member and workspaces of this session. After a refresh, the web uses this to check whether the session it kept is still usable. */
  me: {
    method: "GET",
    path: "/api/me",
    response: z.strictObject({
      login: z.string(),
      /** The name on the GitHub profile. Same as `login` if left blank. Read again at login and every 10 minutes. */
      name: z.string(),
      /** The GitHub profile picture URL. null if there is none. */
      avatar: z.string().nullable(),
      /** The repo `owner/name` used when called without `REPO_HEADER`: the first of `repos` (ADR-0043). */
      repo: z.string(),
      /** The workspace repos this member seems to have push permission on, in the order they were added. Read again at login and every 10 minutes. */
      repos: z.array(z.string()),
      /** The server config has a GIPHY key, so `api.gifs` can be used. If not, the web doesn't show a GIF button (ADR-0044). */
      gif: z.boolean(),
      /** My personal settings (`api.setPrefs`). `DEFAULT_PREFS` until I change one. */
      prefs: Prefs,
      /** A runner of this member has connected to this server at least once. If not, the web shows how to connect a computer (#354). */
      connected: z.boolean(),
      /** The repos in `repos` this member has shared (repo sharing, ADR-0049). In the others, the web offers a Share button. */
      shared: z.array(z.string()),
      /** This member is one of the server's operators (`OMAGARI_OPERATORS`, ADR-0052). The web shows them the access requests in settings. */
      operator: z.boolean(),
    }),
  },
  /**
   * The workspaces this member belongs to, in the order they were added (the first is used when called without `WORKSPACE_HEADER`). Follows the push permission read at login and every 10 minutes.
   * Workspaces are never mixed in any API response or realtime message.
   */
  workspaces: {
    method: "GET",
    path: "/api/workspaces",
    response: z.strictObject({ workspaces: z.array(Workspace) }),
  },
  /**
   * Adds the repo `owner/name` to the workspace (ADR-0043). The caller must be GitHub Admin of that repo (`forbidden`),
   * and the repo's account must be in the server config's list of accounts it accepts (`forbidden`). The answer is the repos the caller can see.
   */
  addRepo: {
    method: "POST",
    path: "/api/repos/add",
    body: z.strictObject({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }),
    response: z.strictObject({ repos: z.array(z.string()) }),
  },
  /**
   * The list for adding repos (ADR-0043, mockup 91-A): among the repos of the chosen workspace account, the ones where the caller is GitHub Admin, in name order.
   * `added` says whether it's in the workspace, and `pushers` is the number of people with push permission on that repo. Neither the name nor the count is included for repos where the caller isn't Admin.
   * The web shows "Add repo" only when this isn't empty, and the repo menu (remove) only for repos with `added`. If GitHub can't answer, it's `github_failed`.
   */
  adminRepos: {
    method: "GET",
    path: "/api/repos/admin",
    response: z.strictObject({
      repos: z.array(
        z.strictObject({
          name: z.string(),
          private: z.boolean(),
          pushers: z.number().int().nonnegative(),
          added: z.boolean(),
        }),
      ),
      /** Where to install the server's GitHub App (ADR-0053): a repo without the App isn't listed. Absent on a server with an OAuth app. */
      install: z.string().optional(),
    }),
  },
  /** Removes a repo from the workspace. Like adding, only that repo's GitHub Admin can do it. Its data isn't deleted and comes back if you add it again. */
  removeRepo: {
    method: "POST",
    path: "/api/repos/remove",
    body: z.strictObject({ repo: z.string() }),
    response: z.strictObject({ repos: z.array(z.string()) }),
  },
  /**
   * The GitHub accounts this server accepts, in lowercase (ADR-0043). The runner and CLI check a folder's remotes against them on the machine,
   * and send only remotes under these accounts (ADR-0049).
   */
  accounts: {
    method: "GET",
    path: "/api/accounts",
    response: z.strictObject({ accounts: z.array(z.string()) }),
  },
  /**
   * My access requests and whether this server takes them (ADR-0052). `open` is false when the server has no operators; then requesting is `forbidden`.
   * `terms` and `privacy` are the server's legal text links; when either is set, requesting needs `agree`. Only the caller's own requests are listed.
   */
  myAccess: {
    method: "GET",
    path: "/api/access",
    response: AccessStatus,
  },
  /**
   * Asks the operators to accept a GitHub account (an organization or the caller's own). A pending request for the same account isn't made twice.
   * Whether the account is already accepted isn't told, so a request reveals nothing about other workspaces.
   */
  requestAccess: {
    method: "POST",
    path: "/api/access",
    body: z.strictObject({
      account: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
      agree: z.boolean(),
    }),
    response: AccessStatus,
  },
  /** The requests waiting for an operator, oldest first. `forbidden` for anyone who isn't an operator. */
  accessRequests: {
    method: "GET",
    path: "/api/access/pending",
    response: z.strictObject({ requests: z.array(PendingAccess) }),
  },
  /**
   * An operator approves or denies a waiting request. An approved account joins the accepted accounts right away and stays after restarts.
   * `not_found` if it isn't waiting anymore. The answer is the requests still waiting.
   */
  decideAccess: {
    method: "POST",
    path: "/api/access/decide",
    body: z.strictObject({ id: z.number().int(), approve: z.boolean() }),
    response: z.strictObject({ requests: z.array(PendingAccess) }),
  },
  /**
   * Shares the repo `REPO_HEADER` picks, or stops sharing it (repo sharing, ADR-0049). Per member and repo, so it follows the member to other machines.
   * Stopping removes that member's works in the repo, so other members stop seeing them, and their runners there stop observing.
   */
  share: {
    method: "POST",
    path: "/api/share",
    body: z.strictObject({ on: z.boolean() }),
    response: z.strictObject({ repo: z.string(), shared: z.boolean() }),
  },
  /** Ends this session. Other sessions of the same member (other browsers, the CLI, and the runner) stay as they are. */
  logout: {
    method: "POST",
    path: "/api/logout",
    response: z.strictObject({}),
  },
  /**
   * The workspace's members with their connection state, status message, agent, and one status line per work. In name order.
   * It also comes through the realtime connection when it changes. If you aren't a member (no session or it ended), it's `unauthorized`.
   */
  members: {
    method: "GET",
    path: "/api/members",
    response: Members,
  },
  /** The members' works with their observations and status lines. Changed files and their content come too. Only members see it. */
  works: {
    method: "GET",
    path: "/api/works",
    response: z.strictObject({ works: z.array(WorkView) }),
  },
  /**
   * Writes the one-line status of my work (`branch`). Writing again on the same work keeps the later one.
   * It's erased when that branch is merged, or when observed changes go from some to 0 (ADR-0010).
   * `executor` is the executor the CLI is running in. If given, that work's agent changes to that executor (ADR-0015).
   */
  setStatus: {
    method: "POST",
    path: "/api/status",
    body: z.strictObject({
      branch: z.string().min(1),
      executor: ExecutorId.optional(),
      text: z
        .string()
        .transform((text) => text.replace(/\s+/g, " ").trim())
        .pipe(z.string().min(1).max(MAX_STATUS_CHARS)),
    }),
    response: z.strictObject({ text: z.string(), at: z.string() }),
  },
  /**
   * Picks my presence. After `duration` passes it goes back to online; without it, it stays until I change it myself (ignored for online).
   * The member list goes to everyone through the realtime connection. `until` in the answer is the time it goes back to online.
   */
  setPresence: {
    method: "POST",
    path: "/api/presence",
    body: z.strictObject({ presence: ChosenPresence, duration: PresenceDuration.optional() }),
    response: z.strictObject({ until: z.string().nullable() }),
  },
  /**
   * Writes my status message as text and one emoji slot. Send both together; empty text clears the text, and null clears the emoji.
   * The emoji slot takes only one emoji (one grapheme). There is no expiry. The member list goes to everyone through the realtime connection.
   */
  setStatusMessage: {
    method: "POST",
    path: "/api/status-message",
    body: z.strictObject({
      message: z
        .string()
        .transform((text) => text.replace(/\s+/g, " ").trim())
        .refine((text) => Array.from(text).length <= MAX_STATUS_MESSAGE_CHARS, {
          message: `The status message can be up to ${MAX_STATUS_MESSAGE_CHARS} characters`,
        }),
      emoji: z.string().refine(isEmoji, { message: "Use just one emoji" }).nullable(),
    }),
    response: z.strictObject({ message: z.string().nullable(), emoji: z.string().nullable() }),
  },
  /**
   * Asks the `executor` agent of `agent` (a member's login) in a channel. Only the owner can call an agent (`forbidden`).
   * If `visibility` is private (default) it's a DM; if public it's an `@mention`. Either way, that channel's session of the agent answers.
   * It doesn't wait for the answer; it returns the Q&A that is waiting for one. The answer reaches the asker through `qa` on the realtime connection,
   * and for an `@mention` it also returns the Q&A posted in the channel (`message`) and goes to everyone through `message` on the realtime connection (sent again with the same number when the answer arrives).
   * If that agent's runner is off, it doesn't queue and is `runner_offline` right away. If the channel doesn't exist, `not_found`.
   * `model` and `effort` are the picks, and "default" if missing. The server passes them to the runner as is, and if they aren't among the choices, the runner fails the Q&A.
   * `replyTo` is only for a public `@mention` and is refused like in `send`. The original message goes to the runner as a `> **login**` quote before the question (ADR-0047).
   * `threadOf` is also only for a public `@mention` and is refused like in `send`. The thread goes to the runner with the question, and the answer stands in the thread.
   */
  ask: {
    method: "POST",
    path: "/api/ask",
    body: z.strictObject({
      agent: z.string(),
      executor: ExecutorId,
      channel: z.string(),
      message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      visibility: Visibility.default("private"),
      ...ModelPick.shape,
      ...Replying.shape,
    }),
    response: z.strictObject({ qa: Qa, message: ChannelMessage.optional() }),
  },
  /**
   * Has my `executor` agent write a decision draft for a post (`post`, the post's channel) (ADR-0028). Only the owner can call an agent (`forbidden`).
   * It doesn't wait for the answer; it returns the draft being written (with the number of texts to read and Q&As). When it's done, stopped, or couldn't be written,
   * it comes through `draft` on the realtime connection, only to the person who asked. The draft isn't stored.
   * If the runner is off, it doesn't queue and is `runner_offline` right away. If it isn't a post, `not_found`. `model` and `effort` are the same as in `ask`.
   */
  draftDecision: {
    method: "POST",
    path: "/api/drafts",
    body: z.strictObject({
      agent: z.string(),
      executor: ExecutorId,
      post: z.string(),
      ...ModelPick.shape,
    }),
    response: z.strictObject({ draft: Draft }),
  },
  /**
   * Stops my draft being written (`draft`, `Draft.id`) ("Stop writing"). Returns the stopped draft and also sends it through `draft` on the realtime connection.
   * If it isn't mine or is already finished, it's `not_found`.
   */
  stopDraft: {
    method: "POST",
    path: "/api/drafts/stop",
    body: z.strictObject({ draft: z.string() }),
    response: z.strictObject({ draft: Draft }),
  },
  /**
   * Posts one Q&A from my DM to the channel. The question and answer go up together; you can't post only the answer. Public isn't turned back to private.
   * `text` is a note to go with it. In the channel it appears as one message from the poster (text and Q&A). If empty or only whitespace, it's posted without text.
   * Only a Q&A with an answer can be posted (`invalid_request`). If already posted, `conflict`. If it isn't my Q&A, `not_found` even if it exists.
   * The Q&A that appeared in the channel goes to everyone through `message` on the realtime connection, and the one that became public goes to me through `qa`.
   */
  postQa: {
    method: "POST",
    path: "/api/qas/post",
    body: z.strictObject({ qa: z.number().int(), text: Note }),
    response: z.strictObject({ message: ChannelMessage }),
  },
  /**
   * My Q&As in a channel (answered by my channel sessions in that channel). Private (DM) and ones I made public (posted, `@mention`) come together. Gives the latest `HISTORY_PAGE`, oldest first. Other members' DMs don't come.
   * It's a read, but POST so the channel goes in the body. If the channel doesn't exist, `not_found`.
   */
  dms: {
    method: "POST",
    path: "/api/dms",
    body: z.strictObject({ channel: z.string() }),
    response: z.strictObject({ qas: z.array(Qa) }),
  },
  /**
   * Feed: recent news (alerts created or changed within `INBOX_MS`, claims made or released) that don't involve the calling member's works. The ones that do go to that work's inbox.
   * `FEED_PAGE` items, newest first. This is the recent news in `omagari status`. `at` is when the alert last changed.
   */
  feed: {
    method: "GET",
    path: "/api/feed",
    response: z.strictObject({
      news: z.array(
        z.union([
          z.strictObject({ at: z.string(), alert: Alert }),
          /** A claim made by another member. `at` is when it was made. */
          z.strictObject({ at: z.string(), claim: Claim }),
          /** A claim released by another member (including ones released on their own because the branch was merged or deleted). `at` is when it was released. */
          z.strictObject({ at: z.string(), released: Claim }),
        ]),
      ),
    }),
  },
  /**
   * Reads the post of an alert (`alert`, the number of the alert message in a forum) and its first text, the alert message (`message`).
   * The post was already created when the alert came up. If it isn't an alert message, `not_found`.
   */
  openPost: {
    method: "POST",
    path: "/api/posts",
    body: z.strictObject({ alert: z.number().int() }),
    response: z.strictObject({ post: Post, message: ChannelMessage }),
  },
  /**
   * All posts, in alert order. Each post comes with its first text, the alert message (`message`), so the forum list can be drawn at once:
   * the alert kind, the two people and branches, the file or symbol, whether it was resolved (`alert.resolved`), and when it came up (`at`) are there. Resolved posts stay.
   * When new text appears, that alert line comes again through the realtime connection, and its `post` is the changed summary. `debate` is the post's debate, and null if one has never been opened.
   */
  posts: {
    method: "GET",
    path: "/api/posts",
    response: z.strictObject({
      posts: z.array(
        Post.extend({
          message: ChannelMessage,
          debate: Debate.nullable(),
          request: DebateRequest.nullable(),
        }),
      ),
    }),
  },
  /**
   * Picks one of the options with the owner hidden (`option`, a slot in `Debate.options`) in the post's debate (`post`, the post's channel) (ADR-0040).
   * Any member of the post can pick, and the first pick becomes the conclusion. There is no vote or gate. Once picked, the owner of every option is revealed.
   * If it isn't time to pick (`choosing`) (someone already picked, a round is running, or a conclusion was reached by evidence), it's `conflict`.
   * If there is no debate or no such option, it's `not_found`.
   */
  chooseDebate: {
    method: "POST",
    path: "/api/debates/choose",
    body: z.strictObject({ post: z.string(), option: z.number().int().nonnegative() }),
    response: z.strictObject({ debate: Debate }),
  },
  /**
   * Calls a proxy for one seat (`seat`, a slot in `Debate.seats`) in the post's debate (ADR-0040). Any member of the post can call at any time.
   * The calling member's runner gives the stance with that member's executor and usage, using only the absent member's draft PR, their observations on the server (per share level), and decisions.
   * Only seats that are waiting or not showing up this round can be called. The answer to a request already sent to the owner isn't accepted.
   * If the calling member's runner isn't connected, `runner_offline`; if the debate isn't in a running round, or the seat already gave a stance, or it's their own seat, `conflict`; if it doesn't exist, `not_found`.
   */
  proxyDebate: {
    method: "POST",
    path: "/api/debates/proxy",
    body: z.strictObject({ post: z.string(), seat: z.number().int().min(0).max(1) }),
    response: z.strictObject({ debate: Debate }),
  },
  /**
   * Writes up the decision from a post (`post`, the post's channel) and opens a decision PR in the calling member's name (ADR-0025).
   * What people write is the title, context, decision, consequences, and the window length. The deciders (members who spoke in that post, and the member who wrote it up) and the source (a link to the post) are added by the server.
   * The decision file is placed in `docs/decisions/` with the next number, and if the repo's AGENTS.md doesn't point to that folder, one line is added in the same PR.
   * Once it opens, a `decision` line (`opened`) appears in the post. When the window closes with no open objection, Omagari merges it with the token of the member who wrote it up ("right away" follows immediately).
   * If GitHub blocks it, a `blocked` line gives the reason and it retries every cycle. If the token stops working, a `stalled` line is written and it pauses until the member logs in again.
   * If it isn't a post, `not_found`; if GitHub doesn't accept the calling member's token, `github_failed`.
   */
  proposeDecision: {
    method: "POST",
    path: "/api/decisions",
    body: z.strictObject({
      post: z.string(),
      title: z
        .string()
        .transform((title) => title.replace(/\s+/g, " ").trim())
        .pipe(z.string().min(1).max(MAX_CHANNEL_NAME_CHARS)),
      context: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      decision: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      consequences: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      window: DecisionWindow.default("day"),
    }),
    response: z.strictObject({ decision: Decision }),
  },
  /**
   * Agrees with a decision PR (`agree`), objects (`object`), or withdraws my objection (`withdraw`) (ADR-0025, ADR-0029).
   * Only deciders can agree (otherwise `forbidden`). The member who wrote it up already agreed, so doing it again changes nothing. If all deciders agree and no objection is open, it merges right away.
   * Any member can object. With even one open objection, it doesn't merge. Only the member who objected can withdraw (if I have no objection, `not_found`).
   * When all objections are withdrawn, the window reopens from the start with the same length. If the decision was already merged or closed, `conflict`.
   * A `decision` line appears in the post for every agreement, objection, and withdrawal. Doing the same thing twice changes nothing and adds no line.
   */
  respondToDecision: {
    method: "POST",
    path: "/api/decisions/respond",
    body: z.strictObject({
      id: z.number().int(),
      response: z.enum(["agree", "object", "withdraw"]),
    }),
    response: z.strictObject({ decision: Decision }),
  },
  /**
   * The member who wrote it up edits the decision and pushes it to the same decision PR as a new commit (ADR-0025). The decision file's path stays the same.
   * When edited, other deciders' agreements are cleared and the window reopens from the start with the same length (ADR-0031). Open objections stay.
   * If you aren't the member who wrote it up, `forbidden`; if it was already merged or closed, `conflict`; if GitHub doesn't accept it, `github_failed`.
   */
  reviseDecision: {
    method: "POST",
    path: "/api/decisions/revise",
    body: z.strictObject({
      id: z.number().int(),
      title: z
        .string()
        .transform((title) => title.replace(/\s+/g, " ").trim())
        .pipe(z.string().min(1).max(MAX_CHANNEL_NAME_CHARS)),
      context: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      decision: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      consequences: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    }),
    response: z.strictObject({ decision: Decision }),
  },
  /**
   * The member who wrote it up discards the decision: closes the decision PR without merging. The decision file doesn't go into the default branch.
   * If you aren't the member who wrote it up, `forbidden`; if it was already merged or closed, `conflict`; if GitHub doesn't accept it, `github_failed`.
   */
  discardDecision: {
    method: "POST",
    path: "/api/decisions/discard",
    body: z.strictObject({ id: z.number().int() }),
    response: z.strictObject({ decision: Decision }),
  },
  /** All decisions written up, in the order they were written up. The state is what the server read from GitHub every cycle. */
  decisions: {
    method: "GET",
    path: "/api/decisions",
    response: z.strictObject({ decisions: z.array(Decision) }),
  },
  /**
   * The switch that sets whether my agent answers questions from other members (`omagari ask`) (ADR-0024). On by default.
   * When off, questions that come after that get "not accepted" right away, and questions already kept aren't answered either (they go to the asker's inbox as a failure).
   */
  setAskSwitch: {
    method: "POST",
    path: "/api/ask-switch",
    body: z.strictObject({ on: z.boolean() }),
    response: z.strictObject({ on: z.boolean() }),
  },
  /**
   * Changes some of my personal settings and returns all of them. My other web connections get them as `prefs`;
   * other members never see them.
   */
  setPrefs: {
    method: "POST",
    path: "/api/prefs",
    body: Prefs.partial(),
    response: Prefs,
  },
  /**
   * What the settings window reads: my "Answer others' questions" switch (`setAskSwitch`), the number of questions from others my agent answered in the last `ANSWERED_DAYS` days,
   * and the last of those questions (the member who asked, the question text, and the time asked).
   */
  settings: {
    method: "GET",
    path: "/api/settings",
    response: z.strictObject({
      /** This server's version (`git describe --tags`), shown under Info in the settings window. */
      version: z.string(),
      /** Where the server's source is (AGPL section 13). `OMAGARI_SOURCE_URL`, or Omagari's GitHub repo if unset. Shown under Info as "Source code". */
      sourceUrl: z.string(),
      askSwitch: z.boolean(),
      answered: z.strictObject({
        count: z.number(),
        last: z
          .strictObject({ login: z.string(), name: z.string(), text: z.string(), at: z.string() })
          .nullable(),
      }),
      /**
       * Merge run (DESIGN.md settings window, mockup 30-C). The web only reads it. Turning it on and off is done on the runner (ADR-0034).
       * `runner` is about my runner, and `offline` if no runner is connected. With several runners, it's the last one that connected.
       * `check` is the repo config file the runner reported last, and null if no runner has reported yet.
       */
      mergeCheck: z.strictObject({
        runner: z.union([MergeCheckState, z.literal("offline")]),
        check: CheckReading.nullable(),
      }),
    }),
  },
  /** All labels, in name order (ADR-0039). The repo's GitHub labels read every cycle, with their importance. */
  labels: {
    method: "GET",
    path: "/api/labels",
    response: z.strictObject({ labels: z.array(Label) }),
  },
  /**
   * Creates a label. Creates a GitHub label on the repo with the calling member's token, and importance starts as FYI.
   * If the same name exists (case-insensitive), `conflict`; if GitHub doesn't accept it, `github_failed`.
   * `labels` goes to every web client with a realtime connection.
   */
  createLabel: {
    method: "POST",
    path: "/api/labels",
    body: z.strictObject({
      name: LabelName,
      color: LabelColor,
      description: z.string().max(100).default(""),
    }),
    response: z.strictObject({ label: Label }),
  },
  /**
   * Edits a label (`name`). Name, color, and description edit the GitHub label with the calling member's token (the label name on posts changes too),
   * and importance is changed only in Omagari. Any member can change it. When importance changes, the importance of posts with that label is recalculated, and if it becomes Discuss, an issue is opened.
   * If the label doesn't exist, `not_found`; if the new name is the same as another label's, `conflict`; if GitHub doesn't accept it, `github_failed`.
   */
  editLabel: {
    method: "POST",
    path: "/api/labels/edit",
    body: z.strictObject({
      name: z.string(),
      next: z.strictObject({
        name: LabelName.optional(),
        color: LabelColor.optional(),
        description: z.string().max(100).optional(),
        importance: Importance.optional(),
      }),
    }),
    response: z.strictObject({ label: Label }),
  },
  /**
   * Changes the labels of a post (`post`, the post's channel) to `labels` (adds and removes). If there is an issue, it's reflected in the issue's labels too,
   * and if there isn't, it only exists in Omagari until an issue is opened and gets attached then. If the changed importance is Discuss, an issue is opened.
   * If the post or label doesn't exist, `not_found`. That alert line goes again to the web on the realtime connection.
   */
  setPostLabels: {
    method: "POST",
    path: "/api/posts/labels",
    body: z.strictObject({ post: z.string(), labels: z.array(z.string()) }),
    response: z.strictObject({ post: Post }),
  },
  /**
   * Requests a debate by attaching an agenda (`agenda`) and grounds (`grounds`) to a post (`omagari debate`, "Open debate" on the web). `post` is the post's channel id or the alert's number.
   * If neither is empty, a debate opens and comes back as `debate`. If either is empty, it doesn't open; it only leaves the request marked on the post and `debate` is null.
   * If a debate is already open, `conflict`; if the post doesn't exist, `not_found`. An open debate takes the same path as one opened by an evidence label.
   */
  requestDebate: {
    method: "POST",
    path: "/api/posts/debate",
    body: z.strictObject({ post: z.string().min(1), agenda: z.string(), grounds: z.string() }),
    response: z.strictObject({ debate: Debate.nullable(), request: DebateRequest }),
  },
  /** All channels (chat and forums), in name order. Posts don't come (`api.posts`). Only members see it. */
  channels: {
    method: "GET",
    path: "/api/channels",
    response: z.strictObject({ channels: z.array(Channel) }),
  },
  /**
   * Creates a chat channel. With `repo`, it's that repo's channel (only members who can see that repo create and see it, otherwise `not_found`); without it, it's a workspace channel.
   * If the same name (case-insensitive) exists on the same level (workspace channels and forums together; a repo channel within that repo), `conflict`.
   * `channel` goes to the web clients with a realtime connection that can see that channel.
   */
  createChannel: {
    method: "POST",
    path: "/api/channels",
    body: z.strictObject({ name: ChannelName, repo: z.string().optional() }),
    response: z.strictObject({ channel: Channel }),
  },
  /**
   * Creates a forum (ADR-0039). Any member can. If a channel or forum with the same name (case-insensitive) exists, `conflict`.
   * `filter.repos` must be repos of this workspace that the calling member can see; otherwise (a missing repo and an invisible repo look the same) `invalid_request` (`updateForum` is the same).
   * A forum's `filter.repos` carries only the repos visible to the receiving member, and if none is visible, that member has no forum (editing and deleting are `not_found` too).
   * A repo condition the calling member couldn't see stays when editing.
   * `channel` goes to every web client with a realtime connection, and the alert lines of posts whose visible forums changed go again.
   */
  createForum: {
    method: "POST",
    path: "/api/forums",
    body: z.strictObject({ name: ChannelName, filter: ForumFilter }),
    response: z.strictObject({ channel: Channel }),
  },
  /**
   * Edits a forum's name and filter. The default forums ("Discuss", "FYI") can be edited too. If the forum doesn't exist, `not_found`; if the name collides with another channel, `conflict`.
   * The same thing as `createForum` goes to the realtime connection.
   */
  updateForum: {
    method: "POST",
    path: "/api/forums/update",
    body: z.strictObject({ id: z.string(), name: ChannelName, filter: ForumFilter }),
    response: z.strictObject({ channel: Channel }),
  },
  /**
   * Deletes a forum. The default forums can be deleted too. Posts aren't deleted; one that no longer fits any forum becomes an "other post". If the forum doesn't exist, `not_found`.
   * `forumDeleted` goes to every web client with a realtime connection, and the alert lines of posts whose visible forums changed go again.
   */
  deleteForum: {
    method: "POST",
    path: "/api/forums/delete",
    body: z.strictObject({ id: z.string() }),
    response: z.strictObject({}),
  },
  /**
   * A channel's past conversation. Gives the last `HISTORY_PAGE` messages before `before` (a message number), oldest first.
   * Without `before`, it starts from the very end. If the channel doesn't exist, `not_found`. It's a read, but POST so the channel goes in the body.
   */
  history: {
    method: "POST",
    path: "/api/channels/history",
    body: z.strictObject({
      channel: z.string(),
      before: z.number().optional(),
      /** Read one thread instead (ADR-0047): its original message and its replies. Without it, the channel's messages; a reply in a thread shows only with `alsoInChannel`. */
      thread: z.number().int().optional(),
    }),
    response: z.strictObject({ messages: z.array(ChannelMessage) }),
  },
  /**
   * Writes text in a channel or post. `message` goes to every web client with a realtime connection (including the writer's).
   * You can't write in a forum (`invalid_request`). Same for DMs and `@mentions` (`api.ask`).
   * If `replyTo` isn't a message a person wrote in this channel or post (one elsewhere, a missing one, an alert or decision line), it's `invalid_request`.
   * A reply in a post puts the original message in the head of the GitHub issue comment (without `@`, ADR-0047).
   * `threadOf` must be a person's message in this chat channel that isn't itself in a thread; otherwise `invalid_request` (posts and DMs have no threads, and threads don't nest).
   * A reply in a thread can't also be a `replyTo` reply. The original message comes again with its new `thread` summary on the live connection.
   */
  send: {
    method: "POST",
    path: "/api/channels/messages",
    body: z.strictObject({
      channel: z.string(),
      text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      ...Replying.shape,
    }),
    response: z.strictObject({ message: ChannelMessage }),
  },
  /**
   * Searches GIPHY for GIFs (ADR-0044). The server adds the key and asks on the caller's behalf, and the rating goes up to R. If `query` is empty, it's GIPHY's popular GIFs.
   * If the server has no GIPHY key, `not_found`; if GIPHY doesn't answer or the server's hourly limit is exceeded, `internal`.
   */
  gifs: {
    method: "POST",
    path: "/api/gifs",
    body: z.strictObject({ query: z.string().trim().max(50) }),
    response: z.strictObject({ gifs: z.array(Gif) }),
  },
  /**
   * Adds a reaction to a message written by a person (text or a public Q&A) (`on: true`) or removes it (ADR-0044). Adding one already added or removing one not added isn't an error.
   * If the message doesn't exist or can't be seen, `not_found` (the two aren't told apart). You can't react to alert lines and decision lines (`invalid_request`).
   * The message whose reactions changed goes again through `message` on the realtime connection to every web client that can see it. Reactions on a post aren't moved to the GitHub issue.
   */
  react: {
    method: "POST",
    path: "/api/channels/react",
    body: z.strictObject({
      message: z.number().int(),
      emoji: z.string().refine(isEmoji, { message: "A reaction is one emoji" }),
      on: z.boolean(),
    }),
    response: z.strictObject({ message: ChannelMessage }),
  },
  /**
   * For each of the last `days` days (including today): the number of members who came in and the number of Q&As. Starts from the oldest day, and a day with nothing is 0 (ADR-0018).
   * Days are cut at midnight in `timeZone` (Seoul). Members who came in are those who opened the web that day or read and wrote in a channel.
   * Q&As are the DMs and `@mentions` the server received that day. Only the count comes, not who asked what.
   * The number of runs (`runs`) counts the merge run verdicts the server received that day, by verdict (ADR-0035, ADR-0036). "Running" and a resend with the same fingerprint aren't counted.
   * The number of debates (`debates`) counts the day a debate opened, the day it reached a conclusion, and decision PRs that appeared on a post with an open debate.
   * It's a read, but POST so the number of days goes in the body.
   */
  metrics: {
    method: "POST",
    path: "/api/metrics",
    body: z.strictObject({ days: z.number().int().min(1).max(366).default(14) }),
    response: z.strictObject({
      timeZone: z.string(),
      days: z.array(
        z.strictObject({
          /** The date in that time zone, YYYY-MM-DD */
          day: z.string(),
          members: z.number(),
          qas: z.number(),
          /** Count per verdict (pass, broken, can't tell, not run). */
          runs: z.record(RunVerdict, z.number()),
          /**
           * Debates (ADR-0040): the number opened that day, the number ended that day per path, and the number of debates opened that day that led to a decision PR. Only counts come, not content.
           * The paths are experiment (`experiment`), evidence (`evidence`), human pick (`human`), and expiry (`expired`). The experiment and expiry paths don't exist yet, so they're 0.
           */
          debates: z.strictObject({
            opened: z.number(),
            ended: z.strictObject({
              experiment: z.number(),
              evidence: z.number(),
              human: z.number(),
              expired: z.number(),
            }),
            decided: z.number(),
          }),
        }),
      ),
    }),
  },
} satisfies Record<string, Route>;

// --- The web's realtime connection ---
// The web does actions through the HTTP API and only receives through this WebSocket (ADR-0014). The envelope, `encode`, and `decode` are the same as the runner's.

/** The WebSocket path the web receives realtime messages on. */
export const LIVE_SOCKET = "/api/live";

/** What the web sends on the realtime connection. It sends only one hello right after connecting. */
export const webToServer = {
  /**
   * A browser's WebSocket can't carry headers, so the session goes here.
   * `after` is the last message number received on the last connection (or that connection's welcome `seq`).
   * If given, messages that piled up after that, including ones from the disconnected gap, are received again. Not given on the first connection.
   */
  hello: z.strictObject({
    session: z.string(),
    after: z.number().int().nonnegative().optional(),
    /** The repo to receive per-repo things like the member list and labels. If not given, the first repo of `workspace`. */
    repo: z.string().optional(),
    /** The workspace to receive (`Workspace.id`). A connection receives only one workspace's. If neither `repo` nor `workspace` is given, the first of `api.workspaces`. */
    workspace: z.string().optional(),
  }),
} satisfies Payloads;

/** What the server sends on the web's realtime connection. If there is no session or it ended, it sends `error` and closes with 1008. */
export const serverToWeb = {
  /** Accepts the hello. `seq` is the current last message number. Use it as `after` when connecting again next time. */
  welcome: z.strictObject({ seq: z.number() }),
  /**
   * What newly piled up in a channel. Right after welcome it sends what's after `after` in number order, and after that it sends as they pile up.
   * When an answer comes to a public Q&A, or reactions change, the one with the same number is sent again. Answers or reaction changes during a disconnect are also sent again after welcome.
   */
  message: ChannelMessage,
  /** A new channel was created or a forum was edited (the same `id` replaces). What happened during a disconnect isn't sent again, so read `api.channels` when reconnecting. */
  channel: Channel,
  /** A forum was deleted. What happened during a disconnect isn't sent again. */
  forumDeleted: z.strictObject({ id: z.string() }),
  /** The whole member list (same as `api.members`). Sent once after welcome on every connect, and after that every time it changes. */
  members: Members,
  /**
   * My Q&A was created, got an answer, or was posted to a channel (same as `api.ask` and `api.dms`). Goes only to the asker's connections.
   * A public Q&A also goes to everyone in the channel as `message` (kind `qa`). What happened during a disconnect isn't sent again, so read `api.dms` when reconnecting.
   */
  qa: Qa,
  /** The whole label list (same as `api.labels`). Sent every time a label is created, changed, or removed. Read `api.labels` when reconnecting. */
  labels: z.array(Label),
  /** My decision draft ended (written, stopped, or couldn't be written). Goes only to the requester's connections. What happened during a disconnect isn't sent again. */
  draft: Draft,
  /**
   * A post's debate or debate request changed (same as `debate` and `request` in `api.posts`) (`post`, the post's channel). Sent when a round advances, a stance comes in,
   * a proxy is called, an option is picked, it expires, or the runner of a waiting seat connects or disconnects. Read `api.posts` when reconnecting.
   */
  debate: z.strictObject({
    post: z.string(),
    debate: Debate.nullable(),
    request: DebateRequest.nullable(),
  }),
  /** My personal settings changed (`api.setPrefs`). Goes only to my own connections. */
  prefs: Prefs,
  error: ContractError,
} satisfies Payloads;

/** Calls one API. The web, CLI, and tests all use it. An error answer is thrown as `ContractFailure`. */
export async function call<R extends Route>(
  server: { url: string; session?: string; repos?: string[]; workspace?: string },
  route: R,
  ...[body]: R["body"] extends z.ZodType ? [z.input<R["body"]>] : []
): Promise<z.output<R["response"]>> {
  const headers: Record<string, string> = {};
  if (server.session) headers.authorization = `Bearer ${server.session}`;
  if (server.repos?.length) headers[REPO_HEADER] = server.repos.join(",");
  if (server.workspace) headers[WORKSPACE_HEADER] = server.workspace;
  if (route.body) headers["content-type"] = "application/json";
  const response = await fetch(new URL(route.path, server.url), {
    method: route.method,
    headers,
    ...(route.body && { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const failure = z.strictObject({ error: ContractError }).safeParse(json);
    throw new ContractFailure(
      failure.data?.error ?? { code: "internal", message: `HTTP ${response.status}` },
    );
  }
  return route.response.parse(json) as z.output<R["response"]>;
}

/** Time counted back from now, like "3m ago". Attached to the time a status line was written and to the offline reference time. */
export function ago(iso: string) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (24 * 60))}d ago`;
}
