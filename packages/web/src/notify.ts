import { type Alert, EXECUTOR_NAMES, type MemberView, type Prefs } from "@omagari/contract";
import { t } from "./i18n.ts";
import type { LiveEvent } from "./live.ts";

/** One browser notification to show (DESIGN.md "Notifications", draft 112-A). `tag` is the same in every tab, so the browser shows it once. */
export type Notice = {
  tag: string;
  title: string;
  body: string;
  /** Where pressing it goes: a chat channel or a post's channel. */
  channel: string;
  /** An answer to a DM opens the DM column there. */
  dm?: true;
  /** A message in a thread opens that thread (its original's number). */
  thread?: number;
};

export type NoticeContext = {
  me: string;
  prefs: Prefs;
  members?: MemberView[];
  /** This browser's switch is on and the browser allowed notifications. */
  allowed: boolean;
  /** I'm looking at this tab. */
  looking: boolean;
  /** The last message number when this tab first connected. An alert at or under it is old news coming again with a change. */
  since: number;
  /** Q&As this tab saw waiting for an answer. Only those turn into an answer notification. */
  asking: ReadonlySet<number>;
  /** Message numbers this tab already got. A message coming again with a change (a reaction) isn't new. */
  heard: ReadonlySet<number>;
  /** A post's title by its channel (for a debate without an agenda). */
  postTitle: (channel: string) => string | undefined;
};

const base = (path: string) => path.split("/").at(-1) ?? path;
const subject = (alert: Alert) =>
  (alert.kind === "direct"
    ? alert.files[0] && base(alert.files[0].path)
    : alert.symbols[0]?.name) ?? alert.works[0].branch;

/**
 * Which live event becomes a notification, under my settings (#313). Nothing while I'm on Do not disturb or looking at this tab;
 * what happened meanwhile isn't sent later (only the unread dots show it).
 */
export function noticeFor(event: LiveEvent, ctx: NoticeContext): Notice | undefined {
  const { me, prefs } = ctx;
  const mine = ctx.members?.find((member) => member.login === me);
  if (!ctx.allowed || ctx.looking || mine?.presence === "dnd") return;

  if (event.kind === "message") {
    const message = event.payload;
    if (message.kind === "alert") {
      const { alert, post } = message;
      const other = alert.works.find((work) => work.login !== me);
      if (!prefs.notifyConflicts || message.id <= ctx.since || alert.resolved !== null) return;
      if (!other || !alert.works.some((work) => work.login === me)) return;
      if (post.importance === "reference" && !prefs.notifyFyi) return;
      const executor = ctx.members
        ?.find((member) => member.login === other.login)
        ?.works.find((work) => work.branch === other.branch)?.executor;
      return {
        tag: `alert-${message.id}`,
        title: t.notify.conflictTitle,
        body: t.notify.conflictBody(
          other.name,
          executor ? EXECUTOR_NAMES[executor] : undefined,
          subject(alert),
        ),
        channel: message.channel,
      };
    }
    if (message.kind === "decision") {
      const { decision } = message;
      const deciding = [...decision.deciders, ...(decision.awaiting ?? [])];
      if (!prefs.notifyDecisions || message.event !== "opened" || message.id <= ctx.since) return;
      if (decision.login === me || !deciding.some((person) => person.login === me)) return;
      return {
        tag: `decision-${decision.id}`,
        title: t.notify.decisionTitle,
        body: t.notify.decisionBody(decision.title),
        channel: decision.post,
      };
    }
    if (message.kind === "text" || message.kind === "qa") {
      // DESIGN.md "Who gets called" (#370): a reply calls the original's author unless its `@` is off; a thread calls its original's author
      // and everyone who wrote in it. A quote is plain text and calls nobody.
      const { replyTo, threadOf } = message;
      if (!prefs.notifyReplies || message.login === me) return;
      if (message.id <= ctx.since || ctx.heard.has(message.id)) return;
      const replied = replyTo?.notify === true && replyTo.original?.login === me;
      const inThread =
        threadOf !== undefined &&
        (threadOf.original?.login === me || threadOf.writers.includes(me));
      if (!replied && !inThread) return;
      const text = (message.kind === "qa" ? (message.text ?? message.qa.question) : message.text)
        .split("\n")
        .find((line) => line.trim() && !line.startsWith(">"));
      return {
        tag: `reply-${message.id}`,
        title: replied ? t.notify.replyTitle : t.notify.threadTitle,
        body: t.notify.replyBody(message.name || message.login, text?.trim().slice(0, 200) ?? ""),
        channel: message.channel,
        ...(threadOf && { thread: threadOf.id }),
      };
    }
    return;
  }

  if (event.kind === "qa") {
    const qa = event.payload;
    if (!prefs.notifyAnswers || qa.answer.state !== "answered" || !ctx.asking.has(qa.id)) return;
    const line = qa.answer.text.trim().split("\n")[0]?.slice(0, 200) ?? "";
    return {
      tag: `qa-${qa.id}`,
      title: t.notify.answerTitle,
      body: t.notify.answerBody(EXECUTOR_NAMES[qa.executor], line),
      channel: qa.channel,
      ...(qa.visibility === "private" && { dm: true as const }),
    };
  }

  if (event.kind === "debate") {
    const { post, debate, request } = event.payload;
    // Only when my agent can't give its stance by itself: my runner is off (2026-11-20 @Pancheble).
    const seat = debate?.seats.find((one) => one.login === me);
    if (!prefs.notifyDecisions || debate?.state !== "open") return;
    if (seat?.state !== "waiting" || !seat.away || seat.proxy) return;
    return {
      tag: `debate-${debate.id}-${debate.round}`,
      title: t.notify.decisionTitle,
      body: t.notify.debateBody(request?.agenda || ctx.postTitle(post) || ""),
      channel: post,
    };
  }
}

const KEY = "omagari.notify";

/** The "Get notifications in this browser" switch. Per browser, like the permission (DESIGN.md "Settings window"). */
export function browserSwitch() {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}
export function setBrowserSwitch(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // A browser that blocks storage keeps it off after a refresh.
  }
}

/** This browser can show notifications now: the switch is on and the browser allows it. */
export const browserAllows = () =>
  typeof Notification !== "undefined" && Notification.permission === "granted" && browserSwitch();
