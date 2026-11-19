import {
  type Channel,
  type ChannelMessage,
  type Choices,
  ContractFailure,
  EXECUTOR_NAMES,
  type ExecutorId,
  type MemberView,
  type ModelChoice,
  type ModelPick,
  type Qa,
} from "@omagari/contract";
import { Bot, Check, ChevronDown, ChevronRight, CornerDownLeft, Forward } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Composer, flash, fullTime, SkeletonRow, timeOf } from "./conversation.tsx";
import { t } from "./i18n.ts";
import { Mark } from "./members.tsx";
import { Person } from "./profile-card.tsx";
import { RightPanel } from "./workspace.tsx";

type Agent = MemberView["agents"][number];
/** My DM in one channel: the loaded Q&As (oldest first), loading, or failed to load. */
export type Dm = Qa[] | "loading" | "error";
/** The model and effort remembered for each agent. */
export type Picks = Partial<Record<ExecutorId, ModelPick>>;

/**
 * Keeps only the remembered values that can still be picked. A model that's gone, or an effort the picked model
 * (or the default, if none) doesn't offer, counts as "Default". The composer chips and the question that gets sent use the same result.
 */
export function chosen(choices: Choices | undefined, pick: ModelPick | undefined): ModelPick {
  const model = choices?.models.find((m) => m.id === pick?.model);
  const efforts = (model ?? choices)?.efforts ?? [];
  const effort = efforts.find((e) => e === pick?.effort);
  return { ...(model && { model: model.id }), ...(effort && { effort }) };
}

/**
 * Opens and closes one button's menu (WAI-ARIA menu). When it opens, focus goes to the checked row; clicking outside or tabbing away closes it.
 * Up and down arrows move between rows, and Esc closes only the menu and returns to the button. The DM panel head and the composer chips use it.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // Don't close the sheet (dialog)
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };
  return { open, setOpen, close, wrap, button, onKeyDown };
}

/**
 * The DM in the right panel (DESIGN.md "DM panel"): the picked agent in the head, its Q&As, and the composer.
 * You can only pick among your agents whose runner is connected. If the picked one disconnects, it switches to the first of the rest,
 * and if there are none, an empty state replaces the composer. The list shows only the picked agent's Q&As (a channel session is one per channel and agent).
 */
export function DmPanel({
  id,
  sheet,
  channel,
  post,
  agents,
  dm,
  messages = [],
  picks,
  attached,
  onPick,
  onAsk,
  onAttach,
  onReload,
  onClose,
}: {
  id: string;
  sheet: boolean;
  /** For a post, `channel.name` is the post's title. */
  channel: Channel;
  /** `channel` is a post ("post to channel" becomes "add to post"). */
  post?: boolean;
  /** All my agents, including the ones that are off. */
  agents: Agent[];
  dm?: Dm;
  /** The messages loaded in the channel. A public Q&A's channel line (for "View") is found here. */
  messages?: ChannelMessage[];
  /** The model and effort remembered for each agent. Asking with the picked values is up to whoever calls `onAsk`. */
  picks: Picks;
  /** The id of the Q&A attached to the channel composer. */
  attached?: number;
  onPick: (executor: ExecutorId, pick: ModelPick) => void;
  onAsk: (executor: ExecutorId, question: string) => Promise<void>;
  /** Attaches a Q&A to the channel composer. When sent, the question and answer go up together. */
  onAttach: (qa: Qa) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const connected = agents.filter((agent) => agent.state !== "offline");
  const [picked, setPicked] = useState<ExecutorId>();
  const selected = connected.find((agent) => agent.executor === picked) ?? connected[0];
  // If the picked one disconnected and it switched to the first, keep that as the pick. It doesn't switch back when the old one reconnects.
  const now = selected?.executor;
  useEffect(() => {
    if (now) setPicked(now);
  }, [now]);
  /** The agent whose Q&As the list shows. With none connected, the last picked one's Q&As stay. */
  const shown = selected?.executor ?? picked;

  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const ask = async (executor: ExecutorId, question: string) => {
    setFailure(undefined);
    scroller.current?.scrollTo({ top: 0 }); // The list stacks in reverse, so 0 is the bottom
    try {
      await onAsk(executor, question);
    } catch (error) {
      const offline = error instanceof ContractFailure && error.code === "runner_offline";
      setFailure(offline ? t.dm.askOffline(EXECUTOR_NAMES[executor]) : t.dm.askFailed);
      throw error;
    }
  };
  const send = (executor: ExecutorId) => {
    const question = text.trim();
    if (!question) return;
    setText("");
    ask(executor, question).catch(() => setText((now) => now || question));
  };

  const qas = Array.isArray(dm) ? dm.filter((qa) => qa.executor === shown) : [];
  const retry = (qa: Qa) =>
    connected.some((agent) => agent.executor === qa.executor)
      ? () => void ask(qa.executor, qa.question).catch(() => {})
      : undefined;
  const lines = messages.filter((message) => message.kind === "qa");

  // When opening and when an answer arrives: if the last Q&A is taller than the list, put the top of its question at the top of the list (so you read from the question, not the end of the answer); if it's shorter, stick it to the bottom.
  const last = qas.at(-1);
  const settled = last?.answer.state === "pending" ? undefined : last?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: realign each time the last Q&A gets its answer
  useLayoutEffect(() => {
    const box = scroller.current;
    const item = box?.querySelector(".dm-qa:last-child");
    if (!box || !item) return;
    if (item.clientHeight <= box.clientHeight)
      box.scrollTo({ top: 0 }); // The list stacks in reverse, so 0 is the bottom
    else box.scrollBy({ top: item.getBoundingClientRect().top - box.getBoundingClientRect().top });
  }, [settled]);

  /** "View" on a public Q&A: scrolls to its message in the channel and briefly highlights it. The sheet covers the conversation, so it closes. */
  const show = (qa: Qa) => {
    if (sheet) onClose();
    flash(qa.id);
  };

  return (
    <RightPanel
      id={id}
      title={t.dm.myAgents}
      sheet={sheet}
      full
      onClose={onClose}
      head={
        <DmHead
          channel={channel}
          post={post}
          connected={connected}
          selected={selected}
          onPick={setPicked}
        />
      }
    >
      {dm === undefined || dm === "loading" ? (
        <div className="skeleton" role="status" aria-busy="true" aria-label={t.dm.loading}>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : dm === "error" ? (
        <div className="empty">
          <h2>{t.dm.loadFailed}</h2>
          <p>{t.dm.loadFailedBody}</p>
          <button type="button" className="button outline" onClick={onReload}>
            {t.dm.retry}
          </button>
        </div>
      ) : qas.length > 0 ? (
        <div className="scroller" ref={scroller}>
          <div className="dm-list" role="log" aria-label={t.dm.log(channel.name)}>
            {qas.map((qa) => (
              <DmQa
                key={qa.id}
                qa={qa}
                channel={post ? t.dm.thisPost : `# ${channel.name}`}
                post={post}
                line={lines.find((line) => line.qa.id === qa.id)}
                attached={qa.id === attached}
                onRetry={retry(qa)}
                onAttach={() => onAttach(qa)}
                onShow={() => show(qa)}
              />
            ))}
          </div>
        </div>
      ) : selected ? (
        <div className="empty">
          <h2>{t.dm.notAskedYet(EXECUTOR_NAMES[selected.executor])}</h2>
          <p>{t.dm.notAskedBody}</p>
        </div>
      ) : null}
      {failure && (
        <div className="banner error" role="alert">
          {failure}
        </div>
      )}
      {selected ? (
        <Composer
          label={t.dm.askLabel(EXECUTOR_NAMES[selected.executor])}
          value={text}
          onChange={setText}
          onSubmit={() => send(selected.executor)}
          tools={
            selected.choices.models.length + selected.choices.efforts.length > 0 && (
              <Chips
                choices={selected.choices}
                pick={chosen(selected.choices, picks[selected.executor])}
                onPick={(pick) => onPick(selected.executor, pick)}
              />
            )
          }
        />
      ) : (
        <div className={qas.length > 0 ? "empty no-agent" : "empty"}>
          <h2>{t.dm.noAgent}</h2>
          <p>{t.dm.noAgentBody}</p>
        </div>
      )}
    </RightPanel>
  );
}

/**
 * The DM panel head: the picked agent and "Only you can see this · # channel". With two or more connected agents the whole head is a button,
 * and pressing it opens a menu right below with one row per agent. With one there's nothing to pick, and with none it just says "My agents".
 */
function DmHead({
  channel,
  post,
  connected,
  selected,
  onPick,
}: {
  channel: Channel;
  post?: boolean;
  connected: Agent[];
  selected?: Agent;
  onPick: (executor: ExecutorId) => void;
}) {
  const { open, setOpen, close, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const many = connected.length > 1;

  // Close the menu when there's one or none left to pick.
  if (open && !many) setOpen(false);

  const names = (
    <span className="dm-names">
      <span className="dm-title">
        {selected ? EXECUTOR_NAMES[selected.executor] : t.dm.myAgents}
        {many && <ChevronDown size={14} className="dm-chevron" aria-hidden />}
      </span>
      <span className="dm-sub">
        {t.dm.onlyYou} · {post ? channel.name : `# ${channel.name}`}
      </span>
    </span>
  );
  const face = (
    <>
      {selected && <Mark agent={selected} aria-hidden />}
      {names}
    </>
  );
  if (!many) return <div className="dm-head">{face}</div>;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: handles keys for the menu and button inside in one place
    <div className="dm-picker" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="dm-head"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        aria-label={`${t.dm.askAgent}: ${selected ? EXECUTOR_NAMES[selected.executor] : ""}`}
        onClick={() => setOpen(!open)}
      >
        {face}
      </button>
      {open && (
        <div className="menu agent-menu" id={menu} role="menu" aria-label={t.dm.askAgent}>
          {connected.map((agent) => (
            <button
              key={agent.executor}
              type="button"
              role="menuitemradio"
              aria-checked={agent.executor === selected?.executor}
              className="menu-item"
              tabIndex={-1}
              onClick={() => {
                onPick(agent.executor);
                close();
              }}
            >
              <Mark agent={agent} aria-hidden />
              <span className="agent-name">{EXECUTOR_NAMES[agent.executor]}</span>
              <span className={agent.state === "answering" ? "agent-state busy" : "agent-state"}>
                {agent.state === "answering" ? t.dm.answering : t.dm.idle}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The model chip and effort chip on the line under the DM composer (DESIGN.md "Model and effort", app-composer-chip). The options are only what that agent's Executor reported.
 * If it reported no models there's no model chip, and if the picked model (or the default, if none) reports no efforts there's no effort chip.
 */
function Chips({
  choices,
  pick,
  onPick,
}: {
  choices: Choices;
  /** The picked values, fitted to what can be picked now */
  pick: ModelPick;
  onPick: (pick: ModelPick) => void;
}) {
  const model = choices.models.find((m) => m.id === pick.model);
  const efforts = (model ?? choices).efforts;
  const { latest, older } = splitModels(choices.models);
  const row = (m: ModelChoice) => ({ value: m.id, label: m.name });
  return (
    <>
      {choices.models.length > 0 && (
        <ChoiceChip
          name={t.dm.chips.model}
          face={model?.name ?? t.dm.chips.defaultModel}
          options={latest.map(row)}
          older={older.map(row)}
          value={pick.model}
          // Leave effort as is. If the new model doesn't have it, it shows as "Default", and it applies again when you return to a model that has it.
          onPick={(id) => onPick({ ...pick, model: id })}
        />
      )}
      {efforts.length > 0 && (
        <ChoiceChip
          name="effort"
          face={t.dm.chips.effort(pick.effort)}
          options={efforts.map((e) => ({ value: e, label: e }))}
          value={pick.effort}
          onPick={(effort) => onPick({ ...pick, effort })}
        />
      )}
    </>
  );
}

/**
 * The Executor reports every past version too. Among models with the same name once the trailing version number is dropped ("Opus 5.5" and "Opus 4.8"),
 * only the first reported stays on top and the rest fold into "older models". Names without a version number all stay on top.
 */
function splitModels(models: ModelChoice[]) {
  const seen = new Set<string>();
  const latest: ModelChoice[] = [];
  const older: ModelChoice[] = [];
  for (const model of models) {
    const family = model.name.replace(/[\d.]+$/, "");
    if (family !== model.name && seen.has(family)) older.push(model);
    else latest.push(model);
    seen.add(family);
  }
  return { latest, older };
}

/**
 * Puts the chip menu 4px above the composer (DESIGN.md "Menu placement"). Its left edge lines up with the pressed chip but is pulled in so it doesn't pass the composer's right edge (8px inside the panel),
 * and its height is whatever is left up to the top of the panel body. If it overflows, it scrolls inside the menu.
 */
function place(menu: HTMLElement | null, chip: HTMLElement | null) {
  const form = menu?.offsetParent; // the composer (.composer)
  const body = form?.closest(".panel-body");
  if (!menu || !chip || !(form instanceof HTMLElement) || !body) return;
  const box = form.getBoundingClientRect();
  menu.style.maxHeight = `${box.top - 4 - body.getBoundingClientRect().top}px`;
  const left = Math.min(chip.getBoundingClientRect().left, box.right - menu.offsetWidth);
  menu.style.left = `${Math.max(left, box.left) - box.left - form.clientLeft}px`;
}

/** A menu row. A row with no value is "Default". */
type Row = { value?: string; label: string };

/**
 * One chip and the menu that opens above the composer. The top row is "Default" (the Executor's own setting).
 * If there's `older`, it folds into an "N older models" row at the bottom, and pressing it expands them in the same menu. If the picked one is inside, it opens expanded.
 */
function ChoiceChip({
  name,
  face,
  options,
  older = [],
  value,
  onPick,
}: {
  name: string;
  face: string;
  options: Row[];
  older?: Row[];
  /** The picked value. If none, it's "Default". */
  value?: string;
  onPick: (value: string | undefined) => void;
}) {
  const { open, setOpen, close, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const list = useRef<HTMLDivElement>(null);
  const [unfolded, setUnfolded] = useState(false);
  const rows: Row[] = [{ label: t.dm.chips.default }, ...options];
  // biome-ignore lint/correctness/useExhaustiveDependencies: reposition on open and when expanding changes the width
  useLayoutEffect(() => place(list.current, button.current), [open, unfolded]);
  const item = (row: Row) => (
    <button
      key={row.value ?? ""}
      type="button"
      role="menuitemradio"
      aria-checked={row.value === value}
      className="menu-item"
      tabIndex={-1}
      onClick={() => {
        onPick(row.value);
        close();
      }}
    >
      <span>{row.label}</span>
      {row.value === undefined && <span className="menu-note">{t.dm.chips.fromSettings}</span>}
    </button>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: handles keys for the menu and button inside in one place
    <div className="chip-picker" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="composer-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        aria-label={`${name}: ${[...rows, ...older].find((row) => row.value === value)?.label ?? t.dm.chips.default}`}
        onClick={() => {
          if (!open) setUnfolded(older.some((row) => row.value === value));
          setOpen(!open);
        }}
      >
        {face}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div ref={list} className="menu chip-menu" id={menu} role="menu" aria-label={name}>
          {rows.map(item)}
          {older.length > 0 && (
            <button
              type="button"
              role="menuitem"
              aria-expanded={unfolded}
              className="menu-item"
              tabIndex={-1}
              onClick={() => setUnfolded(!unfolded)}
            >
              <span>{t.dm.chips.older(older.length)}</span>
              <ChevronRight size={14} className="older-chevron" aria-hidden />
            </button>
          )}
          {unfolded && older.map(item)}
        </div>
      )}
    </div>
  );
}

type QaMessage = Extract<ChannelMessage, { kind: "qa" }>;

/** The mark for AI-written text (DESIGN.md "AI-written text"). It means the same as the "🤖 Written by AI" on a post's issue comments. */
export const AiBadge = () => (
  <span className="badge outline ai-badge" title={t.dm.aiBadge}>
    <Bot size={12} aria-hidden />
    AI
  </span>
);

/**
 * A Q&A posted in the channel (DESIGN.md "Q&A"): a folded line (app-qa-line) by default, and pressing it makes it an expanded card (app-qa-card).
 * It sits inside the poster's message body. `state` is that agent's current state (whether its runner is connected).
 */
export function QaLine({ message, state }: { message: QaMessage; state: Agent["state"] }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const toggled = useRef(false);
  // Expanding or folding removes the pressed button, so move focus to the expand or fold button on the new side.
  // biome-ignore lint/correctness/useExhaustiveDependencies: move on every expand and fold
  useEffect(() => {
    if (toggled.current) row.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
  }, [open]);
  const toggle = (next: boolean) => {
    toggled.current = true;
    setOpen(next);
  };
  const { qa } = message;
  const agent = { executor: qa.executor, state };
  const owner = t.dm.agentOf(message.name, EXECUTOR_NAMES[qa.executor]);
  return (
    <div className="qa-row" ref={row}>
      {open ? (
        <QaCard qa={qa} agent={agent} posted={message} onFold={() => toggle(false)} />
      ) : (
        <button
          type="button"
          className="qa-line"
          aria-expanded={false}
          onClick={() => toggle(true)}
        >
          <Mark agent={agent} aria-hidden />
          <strong className="qa-line-owner">{owner}</strong>
          <AiBadge />
          <span className="qa-line-question">{qa.question}</span>
          <span className="qa-line-toggle" aria-hidden>
            {qa.answer.state === "pending" ? t.dm.answering : t.dm.expand}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * A Q&A expanded in the channel (app-qa-card): the head shows whose agent it is and who posted it, then the question, the answer, and below "Code it read" and "Collapse".
 * The card in the channel has no "Ask again".
 */
function QaCard({
  qa,
  agent,
  posted,
  onFold,
}: {
  qa: Qa;
  agent: Pick<Agent, "executor" | "state">;
  posted: QaMessage;
  onFold: () => void;
}) {
  const { answer } = qa;
  return (
    <article className="qa-card">
      <div className="qa-head posted">
        <Mark agent={agent} aria-hidden />
        <p className="qa-owner">
          <strong className="qa-owner-name">
            {t.dm.agentOf(posted.name, EXECUTOR_NAMES[qa.executor])}
          </strong>
          <span className="qa-owner-meta">
            <Person login={posted.login}>{t.dm.postedName(posted.name)}</Person> {t.dm.postedBy} ·{" "}
            <time dateTime={posted.at} title={fullTime(posted.at)}>
              {timeOf(posted.at)}
            </time>
          </span>
        </p>
        <AiBadge />
        <span className="badge outline">{t.dm.public}</span>
      </div>
      <p className="qa-question">{qa.question}</p>
      <Reply qa={qa} />
      <div className="qa-source posted">
        {answer.state === "answered" && (
          <>
            <span className="qa-source-label">{t.dm.codeRead}</span>
            <Source answer={answer} />
          </>
        )}
        <button
          type="button"
          className="button quiet qa-action"
          aria-expanded={true}
          onClick={onFold}
        >
          {t.dm.collapse}
        </button>
      </div>
    </article>
  );
}

/**
 * One Q&A in the DM (DESIGN.md "DM panel"): the question in a right-aligned bubble (app-dm-question) and the answer placed directly on the panel background (app-dm-answer).
 * Under the answer are the branch and commit it read plus badges, and in the action line below: if private, "Post to channel" (app-post-action, which attaches to the channel composer when pressed)
 * or, while attached, "Added to the channel composer"; if public, where it was posted and "View". "Ask again" appears only while that agent is connected.
 */
function DmQa({
  qa,
  channel,
  post,
  line,
  attached,
  onRetry,
  onAttach,
  onShow,
}: {
  qa: Qa;
  /** What to call the place it was posted ("# payments", "this post"). */
  channel: string;
  post?: boolean;
  /** That Q&A's line loaded in the channel. Without it there's no "View". */
  line?: QaMessage;
  /** It's attached to the channel composer. */
  attached: boolean;
  onRetry?: () => void;
  onAttach: () => void;
  onShow: () => void;
}) {
  const { answer } = qa;
  // An `@call` goes into the channel when asked, so the line's time is when it was asked. A posted one comes after the answer, so it's later.
  // ponytail: a past `@call` not loaded in the channel shows as "Posted in". If the contract gives a value that tells them apart, use it.
  const called = answer.state === "pending" || line?.at === qa.at;
  return (
    <article className="dm-qa">
      <div className="dm-ask">
        <p className="dm-question">{qa.question}</p>
        <time className="dm-time" dateTime={qa.at} title={fullTime(qa.at)}>
          {timeOf(qa.at)}
        </time>
      </div>
      <Reply qa={qa} onRetry={onRetry} />
      {answer.state === "answered" && (
        <div className="qa-source">
          <span className="sr-only">{t.dm.codeRead}</span>
          <Source answer={answer} />
        </div>
      )}
      {qa.visibility === "public" ? (
        <div className="dm-actions">
          <p className="dm-shared">
            <Check size={16} aria-hidden />
            {called ? t.dm.calledIn(channel) : t.dm.postedIn(channel)}
          </p>
          {line && (
            <button type="button" className="dm-show" onClick={onShow}>
              {t.dm.show}
            </button>
          )}
        </div>
      ) : (
        answer.state === "answered" && (
          <div className="dm-actions">
            {attached ? (
              <p className="dm-shared">
                <CornerDownLeft size={16} aria-hidden />
                {post ? t.dm.attachedPost : t.dm.attachedChannel}
              </p>
            ) : (
              <button type="button" className="post-action" onClick={onAttach}>
                <Forward size={16} aria-hidden />
                {post ? t.dm.toPost : t.dm.toChannel}
              </button>
            )}
          </div>
        )
      )}
    </article>
  );
}

/** Answering, the answer (Markdown), or the notice of a failed answer. With `onRetry`, the notice gets an "Ask again" button. */
function Reply({ qa, onRetry }: { qa: Qa; onRetry?: () => void }) {
  const name = EXECUTOR_NAMES[qa.executor];
  const { answer } = qa;
  if (answer.state === "pending") {
    return (
      <p className="qa-pending" role="status">
        <Mark agent={{ executor: qa.executor, state: "answering" }} aria-hidden />
        {t.dm.pending(name)}
      </p>
    );
  }
  if (answer.state === "answered") return <Answer text={answer.text} />;
  return (
    <div className={answer.error.code === "turn_timeout" ? "banner warning" : "banner error"}>
      {(t.dm.failed as Partial<Record<string, string>>)[answer.error.code] ??
        t.dm.couldntAnswer(name)}
      {onRetry && (
        <button type="button" className="banner-action" onClick={onRetry}>
          {t.dm.askAgain}
        </button>
      )}
    </div>
  );
}

/** The branch and commit the answer read (app-source-ref), a badge if there were uncommitted changes, and the badge of the model that answered. */
function Source({ answer }: { answer: Extract<Qa["answer"], { state: "answered" }> }) {
  return (
    <>
      <span className="source-ref" title={answer.source.commit}>
        {answer.source.repo && `${answer.source.repo} · `}
        {answer.source.branch ?? t.dm.noBranch} · {answer.source.commit.slice(0, 7)}
      </span>
      {answer.source.dirty && <span className="badge warning">{t.dm.dirty}</span>}
      {answer.model && (
        <span className="badge outline" title={t.dm.modelAnswered}>
          {answer.effort ? `${answer.model} · ${answer.effort}` : answer.model}
        </span>
      )}
    </>
  );
}

/**
 * The agent's answer (Markdown and code). react-markdown doesn't build HTML; it renders only React elements.
 * HTML in the answer shows as text, and links like `javascript:` are emptied. Links open in a new tab.
 */
function Answer({ text }: { text: string }) {
  return (
    <div className="answer">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // An emptied link (`javascript:` etc.) has nothing to press, so it stays as plain text.
          a: ({ node: _, href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
