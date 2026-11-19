import { EXECUTOR_NAMES, type ExecutorId, type MemberView, type Qa } from "@omagari/contract";
import { X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Composer, type ComposerGifs } from "./conversation.tsx";
import { t } from "./i18n.ts";
import { Mark } from "./members.tsx";

type Agent = MemberView["agents"][number];

/** The word starting with `@` right before the caret. The `@` must be at the start or after whitespace (an @ in an email address doesn't count). */
const TRIGGER = /(?:^|\s)@(\S*)$/;

/**
 * The channel composer and `@call`. Typing `@` opens a menu (app-popover) of your connected Agents right above it. Same rules as picking in the DM pane:
 * Agents whose Runner is off don't show, and even a single Agent is picked from a one-line menu. If there are none, the menu says so.
 * Picking one deletes the typed `@…` and puts that Agent before the textarea as a token. With a token, what you send is a question to that Agent, asked in front of everyone.
 * The menu is a WAI-ARIA combobox (listbox): focus stays in the textarea, arrow keys move, Enter or Tab inserts, Esc closes.
 * When a DM Q&A is attached (`attached`), it sits on the top line of the composer (app-qa-attachment) and the note goes on the line below (DESIGN.md "Posting to a channel").
 * An attached Q&A never sits with a token: attaching clears the token (the typed text stays), and while attached, `@` doesn't open the menu.
 */
export function CallComposer({
  label,
  agents,
  owner,
  value,
  onChange,
  token,
  onToken,
  attached,
  onDetach,
  onSubmit,
  gifs,
}: {
  label: string;
  /** All of your Agents, including ones that are off. */
  agents: Agent[];
  /** Your name. Used in the attached Q&A's "Jieun's Claude Code". */
  owner: string;
  value: string;
  onChange: (text: string) => void;
  /** The called Agent. Without one, it's a message between people. */
  token?: ExecutorId;
  onToken: (executor?: ExecutorId) => void;
  /** The attached DM Q&A. If present, what you send is a note posted to the channel with that Q&A. */
  attached?: Qa;
  onDetach: () => void;
  onSubmit: () => void;
  gifs?: ComposerGifs;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useId();
  const title = useId();
  const connected = agents.filter((agent) => agent.state !== "offline");
  /** Where the typed `@` is, and what was typed after it. */
  const [trigger, setTrigger] = useState<{ at: number; query: string }>();
  /** Where the `@` closed with Esc is. That `@` doesn't open the menu again. */
  const [dismissed, setDismissed] = useState<number>();
  const [active, setActive] = useState(0);

  const query = trigger?.query.toLowerCase() ?? "";
  const options = connected.filter((agent) =>
    [EXECUTOR_NAMES[agent.executor].replaceAll(" ", ""), agent.executor].some((name) =>
      name.toLowerCase().startsWith(query),
    ),
  );
  const open =
    trigger !== undefined &&
    trigger.at !== dismissed &&
    (connected.length === 0 || options.length > 0);
  const current = options[Math.min(active, options.length - 1)];

  // When a Q&A is attached (even swapped), drop the token and any open menu and go to the text line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the attached Q&A changes
  useEffect(() => {
    if (!attached) return;
    onToken(undefined);
    setTrigger(undefined);
    area.current?.focus();
  }, [attached?.id]);

  /**
   * Look for `@` again when the text changes or the caret moves. Skip if an Agent is already called or a Q&A is attached (one call at a time, and never together with a Q&A).
   */
  const sync = (element: HTMLTextAreaElement) => {
    const before = element.value.slice(0, element.selectionStart);
    const match =
      token || attached || element.selectionStart !== element.selectionEnd
        ? null
        : TRIGGER.exec(before);
    const query = match?.[1] ?? "";
    const next = match ? { at: before.length - query.length - 1, query } : undefined;
    if (next?.at === trigger?.at && next?.query === trigger?.query) return;
    setTrigger(next);
    setActive(0);
  };

  const pick = (agent: Agent) => {
    if (!trigger) return;
    const { at } = trigger;
    onChange(value.slice(0, at) + value.slice(at + 1 + trigger.query.length));
    onToken(agent.executor);
    setTrigger(undefined);
    requestAnimationFrame(() => area.current?.setSelectionRange(at, at));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return; // composing text with an IME
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (
      (token || attached) &&
      event.key === "Backspace" &&
      selectionStart === 0 &&
      selectionEnd === 0
    ) {
      event.preventDefault();
      if (token) onToken(undefined);
      else onDetach();
      return;
    }
    if (!open || !trigger) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(trigger.at);
    } else if (current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((options.indexOf(current) + step + options.length) % options.length);
    } else if (current && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      pick(current);
    }
  };

  const called = agents.find((agent) => agent.executor === token);
  const name = token && EXECUTOR_NAMES[token];

  const menu =
    open &&
    (connected.length === 0 ? (
      <div className="menu call-menu" role="status">
        <p className="call-empty">
          <strong className="call-empty-title">{t.conversation.call.noAgentsTitle}</strong>
          <span className="call-empty-text">{t.conversation.call.noAgentsBody}</span>
        </p>
      </div>
    ) : (
      <div className="menu call-menu">
        <p className="call-menu-title" id={title}>
          {t.conversation.call.menuTitle}
        </p>
        <div id={list} role="listbox" aria-labelledby={title}>
          {options.map((agent, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the textarea takes the keys (combobox)
            <div
              key={agent.executor}
              id={`${list}-${agent.executor}`}
              role="option"
              aria-selected={agent === current}
              tabIndex={-1}
              className="menu-item"
              // pressing doesn't move focus out of the textarea
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(i)}
              onClick={() => pick(agent)}
            >
              <Mark agent={agent} aria-hidden />
              <span className="agent-name">{EXECUTOR_NAMES[agent.executor]}</span>
              <span className={agent.state === "answering" ? "agent-state busy" : "agent-state"}>
                {agent.state === "answering"
                  ? t.conversation.call.answering
                  : t.conversation.call.idle}
              </span>
            </div>
          ))}
        </div>
      </div>
    ));

  return (
    <Composer
      label={
        attached
          ? t.conversation.call.addNote
          : name
            ? t.conversation.call.askEveryone(name)
            : label
      }
      sendable={!!attached}
      value={value}
      onChange={(text) => {
        onChange(text);
        if (area.current) sync(area.current);
      }}
      onSubmit={onSubmit}
      area={area}
      emoji
      gifs={gifs}
      menu={menu}
      before={
        attached ? (
          <div className="qa-attachment">
            <Mark
              agent={
                agents.find((agent) => agent.executor === attached.executor) ?? {
                  executor: attached.executor,
                  state: "offline",
                }
              }
              aria-hidden
            />
            <strong className="qa-attachment-owner">
              {t.conversation.call.attachedOwner(owner, EXECUTOR_NAMES[attached.executor])}
            </strong>
            <span className="qa-attachment-question">{attached.question}</span>
            <button
              type="button"
              className="call-token-remove qa-attachment-remove"
              aria-label={t.conversation.call.removeAttached}
              onClick={() => {
                onDetach();
                area.current?.focus();
              }}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : (
          token && (
            <span className="call-token">
              <Mark agent={called ?? { executor: token, state: "offline" }} aria-hidden />
              {name}
              <button
                type="button"
                className="call-token-remove"
                aria-label={t.conversation.call.cancelCall(name ?? "")}
                onClick={() => {
                  onToken(undefined);
                  area.current?.focus();
                }}
              >
                <X size={14} aria-hidden />
              </button>
            </span>
          )
        )
      }
      textarea={{
        role: "combobox",
        "aria-expanded": open,
        "aria-controls": open && connected.length > 0 ? list : undefined,
        "aria-autocomplete": "list",
        "aria-activedescendant": open && current ? `${list}-${current.executor}` : undefined,
        onKeyDown,
        onSelect: (event) => sync(event.currentTarget),
        onBlur: () => setTrigger(undefined),
      }}
    />
  );
}
