import {
  api,
  type ChannelMessage,
  ContractFailure,
  call,
  type Decision,
  type DecisionWindow,
  type Draft,
  EXECUTOR_NAMES,
  type ExecutorId,
  type MemberView,
} from "@omagari/contract";
import { GitPullRequest } from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { server } from "./api.ts";
import { timeOf } from "./conversation.tsx";
import { chosen, type Picks } from "./dm.tsx";
import { t } from "./i18n.ts";
import { Mark } from "./members.tsx";
import { Person } from "./profile-card.tsx";
import { Avatar } from "./workspace.tsx";

type Message = Extract<ChannelMessage, { kind: "decision" }>;
export type Fields = { title: string; context: string; decision: string; consequences: string };
const EMPTY: Fields = { title: "", context: "", decision: "", consequences: "" };

/** Redraw every 30 seconds so the time left keeps ticking. */
function useTick() {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
}

/** "18 hours left", "3 days left", "12 minutes left". "Closing soon" once the close time has passed. */
function remaining(closes: string) {
  const minutes = Math.ceil((Date.parse(closes) - Date.now()) / 60_000);
  if (minutes <= 0) return t.decision.closingSoon;
  if (minutes < 60) return t.decision.left(minutes, "minute");
  if (minutes < 48 * 60) return t.decision.left(Math.ceil(minutes / 60), "hour");
  return t.decision.left(Math.ceil(minutes / 1440), "day");
}

const WINDOWS = ["now", "hour", "day", "three_days", "custom"] as const;

/** The window length in words: "1 day", "1 hour", "12 hours". */
export const windowWord = (window: DecisionWindow) =>
  typeof window === "object"
    ? t.decision.amount(window.amount, window.unit)
    : t.decision.windowWords[window];

const objectors = (decision: Decision) =>
  [...new Set(decision.objections.map((objection) => objection.name))].join(", ");

/** The strip's state name, description, and color. */
function describe(decision: Decision): {
  name: string;
  text: string;
  tone: "" | "warning" | "error" | "quiet";
} {
  const agreed = decision.deciders.filter((decider) => decider.agreed).length;
  const left = decision.closes ? `${remaining(decision.closes)} · ` : "";
  const count = t.decision.agreed(agreed, decision.deciders.length);
  switch (decision.status) {
    case "proposed":
      return {
        name: t.decision.proposed,
        text: `${left}${count} · ${t.decision.proposedText}`,
        tone: "",
      };
    case "objected":
      return {
        name: t.decision.objected(decision.objections.length),
        text: t.decision.objectedText(objectors(decision)),
        tone: "warning",
      };
    case "reopened":
      return {
        name: t.decision.reopened,
        text: `${t.decision.reopenedText} · ${left}${count}`,
        tone: "",
      };
    case "blocked":
      return {
        name: t.decision.blocked,
        text: t.decision.blockedText(decision.reason),
        tone: "warning",
      };
    case "stalled":
      return {
        name: t.decision.stalled,
        text: t.decision.stalledText(decision.name),
        tone: "error",
      };
    case "accepted":
      return {
        name: t.decision.accepted,
        text: t.decision.acceptedText(decision.early, decision.path),
        tone: "",
      };
    case "closed":
      return {
        name: t.decision.closed,
        text: t.decision.closedText(decision.name),
        tone: "quiet",
      };
  }
}

/**
 * Decision status strip (app-decision-strip): always sits above the post's conversation. Shows the state, time left and agree count, PR link,
 * and buttons that depend on the viewer (`me`). No buttons once it is merged or dropped.
 */
export function DecisionStrip({
  decision,
  me,
  onRespond,
  onRevise,
  onDiscard,
}: {
  decision: Decision;
  me: string;
  onRespond: (response: "agree" | "object" | "withdraw") => Promise<void>;
  onRevise: () => void;
  onDiscard: () => Promise<void>;
}) {
  useTick();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const { name, text, tone } = describe(decision);
  const over = decision.status === "accepted" || decision.status === "closed";
  const mine = decision.login === me;
  const decider = decision.deciders.find((other) => other.login === me);
  const objected = decision.objections.some((o) => o.login === me && o.via === "post");

  const run = async (act: () => Promise<void>, failed: string) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await act();
    } catch {
      setFailure(failed);
    } finally {
      setBusy(false);
    }
  };
  const button = (label: string, kind: string, act: () => Promise<void>) => (
    <button
      type="button"
      className={`button ${kind} strip-button`}
      disabled={busy}
      onClick={() => void run(act, t.decision.actionFailed(label))}
    >
      {label}
    </button>
  );

  return (
    <div className={tone ? `decision-strip ${tone}` : "decision-strip"} role="status">
      <GitPullRequest size={16} aria-hidden />
      <p className="strip-text">
        <strong>{name}</strong>
        <span>{text}</span>
        <a href={decision.pull.url} target="_blank" rel="noreferrer">
          PR #{decision.pull.number}
        </a>
        {failure && <span className="strip-failure">{failure}</span>}
      </p>
      {!over && (
        <div className="strip-actions">
          {mine ? (
            <>
              <button type="button" className="button quiet strip-button" onClick={onRevise}>
                {t.decision.revise}
              </button>
              {button(t.decision.discard, "danger", onDiscard)}
            </>
          ) : (
            <>
              {decider &&
                !decider.agreed &&
                button(t.decision.agree, "primary", () => onRespond("agree"))}
              {!objected && button(t.decision.object, "outline", () => onRespond("object"))}
              {objected && button(t.decision.withdraw, "outline", () => onRespond("withdraw"))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A decision PR line in the conversation: "Omagari · Jieun opened Decision PR #12 · objection window: 1 day · 10:50 AM". */
export function DecisionLine({ message }: { message: Message }) {
  const { decision, event, by } = message;
  const n = decision.pull.number;
  const pull = t.decision.pr(n);
  const who = by?.name ?? decision.name;
  const e = t.decision.events;
  const words: Record<Message["event"], string> = {
    opened: e.opened(decision.name, pull, windowWord(decision.window)),
    agreed: e.agreed(who, pull),
    objected: e.objected(who, pull),
    withdrawn: e.withdrawn(who),
    revised: e.revised(who),
    merged: e.merged(pull, decision.early),
    closed: e.closed(pull),
    blocked: e.blocked(message.reason),
    stalled: e.stalled(decision.name),
  };
  return (
    <p className="decision-line">
      <GitPullRequest size={16} aria-hidden />
      <span>
        Omagari · {words[event]} ·{" "}
        <time dateTime={message.at} title={message.at}>
          {timeOf(message.at)}
        </time>
      </span>
    </p>
  );
}

const FIELD_ROWS = { context: 4, decision: 4, consequences: 2 } as const;

/**
 * Wrap-up decision dialog (DESIGN.md "Wrapping up a decision"). On open, my agent starts writing a draft right away (#103),
 * and a person reads it, edits it, and opens the decision PR. If opened to revise (`revising`), it writes no draft and starts from that decision's fields, posting to the same PR.
 * The agent is the first connected one; model and effort are the values remembered in the DM.
 */
export function DecisionDialog({
  post,
  title,
  repo,
  me,
  agents,
  picks,
  speakers,
  incoming,
  revising,
  initial,
  session,
  check,
  onDone,
  onClose,
}: {
  /** The post's channel id. */
  post: string;
  /** The post title. It is the text of the source link. */
  title: string;
  repo: string;
  me: { login: string; name: string };
  agents: MemberView["agents"];
  picks: Picks;
  /** Members who spoke in this post. Shown as deciders. */
  speakers: { login: string; name: string }[];
  /** Draft that arrived over the live connection. Only one matching the `draft.id` this dialog received is used. */
  incoming?: Draft;
  revising?: Decision;
  /** What to prefill in the fields when opened to revise (the last fields posted from this browser). The contract does not give the decision body. */
  initial?: Fields;
  session: string;
  check: (error: unknown) => unknown;
  onDone: (decision: Decision, fields: Fields) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [fields, setFields] = useState<Fields>(
    initial ?? (revising ? { ...EMPTY, title: revising.title } : EMPTY),
  );
  /** Current state of the draft request: the draft while writing, "offline" if the runner is off, nothing if not requested yet. */
  const [draft, setDraft] = useState<Draft | "offline">();
  const [everDrafted, setEverDrafted] = useState(false);
  const [unit, setUnit] = useState<(typeof WINDOWS)[number]>("day");
  const [amount, setAmount] = useState("12");
  const [per, setPer] = useState<"hour" | "day">("hour");
  const [failure, setFailure] = useState<string>();
  const [sending, setSending] = useState(false);

  const agent = agents.find((a) => a.state !== "offline");
  const executor: ExecutorId | undefined = agent?.executor;
  const owner = me.name;
  const pending = draft !== undefined && draft !== "offline" && draft.state.state === "pending";

  const write = async () => {
    if (!executor) return setDraft("offline");
    setFailure(undefined);
    try {
      const { draft } = await call(server(session), api.draftDecision, {
        agent: me.login,
        executor,
        post,
        ...chosen(agent?.choices, picks[executor]),
      });
      setDraft(draft);
    } catch (error) {
      check(error);
      if (error instanceof ContractFailure && error.code === "runner_offline") setDraft("offline");
      else setFailure(t.decision.dialog.draftFailed);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: write a draft once when opened
  useEffect(() => {
    dialog.current?.showModal();
    if (!revising) void write();
  }, []);

  // Draft from the live connection: take it if it is the one I requested, and fill the four fields when done.
  const mineId = draft !== undefined && draft !== "offline" ? draft.id : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only look when a new draft arrives
  useEffect(() => {
    if (!incoming || incoming.id !== mineId) return;
    setDraft(incoming);
    if (incoming.state.state === "drafted") {
      const { title, context, decision, consequences } = incoming.state;
      setFields({ title, context, decision, consequences });
      setEverDrafted(true);
    }
  }, [incoming]);

  const stop = () => {
    if (draft === undefined || draft === "offline") return;
    call(server(session), api.stopDraft, { draft: draft.id }).then(
      (reply) => setDraft(reply.draft),
      check,
    );
  };

  const close = () => {
    if (pending) stop();
    dialog.current?.close();
  };

  const amountNumber = Number(amount);
  const custom = unit === "custom";
  const customOk = Number.isInteger(amountNumber) && amountNumber >= 1 && amountNumber <= 9999;
  const win: DecisionWindow = unit === "custom" ? { amount: amountNumber, unit: per } : unit;
  const filled = Object.values(fields).every((value) => value.trim());
  const canOpen = filled && !pending && !sending && (!custom || customOk);
  const length = custom
    ? customOk
      ? t.decision.amount(amountNumber, per)
      : t.decision.unset
    : windowWord(win);

  const submit = async () => {
    setSending(true);
    setFailure(undefined);
    try {
      const { decision } = revising
        ? await call(server(session), api.reviseDecision, { id: revising.id, ...fields })
        : await call(server(session), api.proposeDecision, { post, ...fields, window: win });
      onDone(decision, fields);
      dialog.current?.close();
    } catch (error) {
      check(error);
      setFailure(
        error instanceof ContractFailure && error.code === "github_failed"
          ? t.decision.dialog.githubRefused
          : t.decision.dialog.openFailed,
      );
    } finally {
      setSending(false);
    }
  };

  type Band = { tone: string; title: string; text: string; stop?: boolean; model?: string };
  const band = ((): Band | undefined => {
    if (revising) return undefined;
    const failed = draft !== "offline" && draft?.state.state === "failed" ? draft.state : undefined;
    if (draft === "offline" || failed) {
      const runner = !failed || failed.error.code === "runner_offline";
      return {
        tone: "warning",
        title: t.decision.dialog.draftBlockedTitle,
        text: runner ? t.decision.dialog.runnerOff : t.decision.dialog.agentFailed,
      };
    }
    if (!draft)
      return {
        tone: "",
        title: t.decision.dialog.startingTitle,
        text: t.decision.dialog.startingText,
      };
    const read = t.decision.dialog.read(draft.read.texts, draft.read.qas);
    const name = t.decision.dialog.agentOf(owner, EXECUTOR_NAMES[draft.executor]);
    if (draft.state.state === "pending")
      return {
        tone: "",
        title: t.decision.dialog.writing(name),
        text: t.decision.dialog.reading(read),
        stop: true,
      };
    if (draft.state.state === "stopped")
      return {
        tone: "",
        title: t.decision.dialog.stoppedTitle,
        text: t.decision.dialog.stoppedText,
      };
    if (draft.state.state !== "drafted") return undefined;
    const { model, effort } = draft.state;
    return {
      tone: "",
      title: t.decision.dialog.drafted(name),
      text: t.decision.dialog.draftedText(read),
      model: model ? (effort ? `${model} · ${effort}` : model) : undefined,
    };
  })();

  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    setFields((now) => ({ ...now, [key]: event.target.value }));
  const bones = (rows: number) => (
    <span className="draft-bones" aria-hidden>
      {(["a", "b", "c"] as const).slice(0, rows).map((line) => (
        <span key={line} className="bone" />
      ))}
    </span>
  );
  const field = (key: keyof Fields, label: string, hint: string, rows?: number) => (
    <div className={rows ? "field" : "field wide"}>
      <label htmlFor={`${heading}-${key}`}>{label}</label>
      {pending ? (
        bones(rows ? Math.min(rows, 3) : 1)
      ) : rows ? (
        <textarea
          id={`${heading}-${key}`}
          className="text-input draft-area"
          rows={rows}
          value={fields[key]}
          onChange={set(key)}
          placeholder={hint}
        />
      ) : (
        <input
          id={`${heading}-${key}`}
          className="text-input"
          value={fields[key]}
          onChange={set(key)}
          placeholder={hint}
          autoComplete="off"
        />
      )}
    </div>
  );

  return (
    // Clicking the backdrop closes it. Esc closes it from the keyboard (the dialog handles that).
    // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog handles Esc
    <dialog
      ref={dialog}
      className="dialog decision-dialog"
      aria-labelledby={heading}
      onCancel={() => pending && stop()}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <form
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (canOpen) void submit();
        }}
      >
        <h2 id={heading}>{revising ? t.decision.dialog.reviseTitle : t.decision.dialog.title}</h2>
        {band && (
          <div className={band.tone ? `draft-band ${band.tone}` : "draft-band"} role="status">
            {band.tone ? null : agent && <Mark agent={agent} aria-hidden />}
            <p>
              <strong>{band.title}</strong>
              <span>{band.text}</span>
            </p>
            {band.stop && (
              <button type="button" className="button quiet strip-button" onClick={stop}>
                {t.decision.dialog.stop}
              </button>
            )}
            {band.model && <span className="badge outline">{band.model}</span>}
          </div>
        )}
        <div className="draft-fields">
          {field("title", t.decision.dialog.title_, t.decision.dialog.titleHint)}
          {field(
            "context",
            t.decision.dialog.context,
            t.decision.dialog.contextHint,
            FIELD_ROWS.context,
          )}
          {field(
            "decision",
            t.decision.dialog.decision,
            t.decision.dialog.decisionHint,
            FIELD_ROWS.decision,
          )}
          {field(
            "consequences",
            t.decision.dialog.consequences,
            t.decision.dialog.consequencesHint,
            FIELD_ROWS.consequences,
          )}
        </div>
        {!revising && (
          <fieldset className="window" disabled={sending}>
            <legend>{t.decision.dialog.window}</legend>
            <div className="segments">
              {WINDOWS.map((id) => (
                <label key={id} className="segment">
                  <input
                    type="radio"
                    name={`${heading}-window`}
                    checked={unit === id}
                    onChange={() => setUnit(id)}
                  />
                  <span>{t.decision.windowNames[id]}</span>
                </label>
              ))}
            </div>
            {custom && (
              <div className="window-custom">
                <input
                  className="text-input"
                  type="number"
                  min={1}
                  max={9999}
                  inputMode="numeric"
                  aria-label={t.decision.dialog.windowLength}
                  aria-invalid={!customOk}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <select
                  className="text-input"
                  aria-label={t.decision.dialog.unit}
                  value={per}
                  onChange={(event) => setPer(event.target.value as "hour" | "day")}
                >
                  <option value="hour">{t.decision.dialog.hours}</option>
                  <option value="day">{t.decision.dialog.days}</option>
                </select>
                <span>{t.decision.dialog.for}</span>
              </div>
            )}
            <p className="help">
              {win === "now" ? t.decision.dialog.nowNote : t.decision.dialog.windowNote(length)}
            </p>
          </fieldset>
        )}
        {!revising && (
          <div className="auto-box">
            <p>
              <strong>{t.decision.dialog.deciders}</strong>
              {[me, ...speakers.filter((s) => s.login !== me.login)].map((s) => (
                <span key={s.login} className="decider">
                  <Person login={s.login} className="decider-person">
                    <Avatar name={s.name} login={s.login} size={36} />
                    {s.name}
                  </Person>
                </span>
              ))}
            </p>
            <p>
              <strong>{t.decision.dialog.source}</strong>
              <a href={`${location.pathname}${location.hash}`}>{title}</a>
            </p>
          </div>
        )}
        {failure && (
          <p className="banner error" role="alert">
            {failure}
          </p>
        )}
        <p className="help dialog-note">{t.decision.dialog.note(owner, repo, !!revising)}</p>
        <div className="dialog-actions decision-actions">
          {!revising && (
            <button
              type="button"
              className="button quiet"
              disabled={pending || sending}
              onClick={() => void write()}
            >
              {everDrafted ? t.decision.dialog.writeAgain : t.decision.dialog.write}
            </button>
          )}
          <button type="button" className="button quiet" onClick={close}>
            {t.decision.dialog.cancel}
          </button>
          <button type="submit" className="button primary" disabled={!canOpen}>
            {revising ? t.decision.dialog.revise : t.decision.dialog.open}
          </button>
        </div>
      </form>
    </dialog>
  );
}
