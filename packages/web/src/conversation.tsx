import {
  type Channel,
  type ChannelMessage,
  ContractFailure,
  type Decision,
  EXECUTOR_NAMES,
  type ExecutorId,
  type Gif,
  MAX_MESSAGE_CHARS,
  type MemberView,
  type Qa,
  type ThreadSummary,
} from "@omagari/contract";
import { ArrowUp, Hash, MessagesSquare, Reply, TextQuote } from "lucide-react";
import {
  type ComponentProps,
  type Dispatch,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CallComposer } from "./call.tsx";
import { DecisionLine, DecisionStrip } from "./decision.tsx";
import { QaLine } from "./dm.tsx";
import { useEmojiInput } from "./emoji-input.tsx";
import { AlertLine } from "./forum.tsx";
import { GifButton, MessageGif } from "./gif.tsx";
import { giphyId, giphyUrl } from "./giphy.ts";
import { language, t } from "./i18n.ts";
import type { LiveState } from "./live.ts";
import { Person } from "./profile-card.tsx";
import { ReactButton, Reactions } from "./reactions.tsx";
import {
  MessageText,
  quoteLines,
  type Replying,
  ReplyLine,
  ReplyStrip,
  SelectionQuote,
  withQuote,
} from "./reply.tsx";
import { VerdictStrip } from "./verdict.tsx";
import { Avatar, personName } from "./workspace.tsx";

/** One channel's conversation. Live messages pile up even while loading, and older ones merge in by id. */
export type View = {
  status: "loading" | "ready" | "error";
  messages: ChannelMessage[];
  /** Older messages may still be on the server. */
  more: boolean;
  /** Older messages are loading. */
  older?: boolean;
};

/** What a send carries when it's a reply or sits in a thread (ADR-0047). */
export type ReplyBody =
  | { replyTo: number; notify: boolean }
  | { threadOf: number; alsoInChannel: boolean };

/** A message people wrote (text or Q&A), the kind that can be replied to, quoted, or opened as a thread. */
type Said = Exclude<ChannelMessage, { kind: "alert" | "decision" }>;
/** Whether a message shows in the channel: anything but a thread reply that wasn't also sent to the channel. */
const inChannel = (message: ChannelMessage) =>
  !("threadOf" in message && message.threadOf) || !!message.alsoInChannel;
/** How long a touch holds before the long-press menu opens on narrow screens. */
const LONG_PRESS_MS = 500;

/** Messages from the same person within this window group together, without a name and avatar. */
const GROUP_MS = 5 * 60_000;
/** Load older messages ahead of time when this many pixels of scroll are left. */
const OLDER_PX = 400;

const dayOf = (iso: string) => new Date(iso).toDateString();
const midnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Text of the day divider: "Today", "Yesterday", "Mon, Nov 9", with the year when it isn't this year. */
function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round((midnight(today) - midnight(date)) / 86_400_000);
  if (days === 0) return t.conversation.today;
  if (days === 1) return t.conversation.yesterday;
  return date.toLocaleDateString(language, {
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString(language, { dateStyle: "long", timeStyle: "short" });

/** Left side of the channel header: `# channel name` and the member count. A channel's members are everyone in the workspace. */
export function ChannelTitle({ channel, members }: { channel: Channel; members?: number }) {
  return (
    <div className="channel-title">
      <h2>
        <Hash className="channel-mark" size={20} aria-hidden />
        <span>{channel.name}</span>
      </h2>
      {members !== undefined && (
        <span className="channel-members">{t.conversation.members(members)}</span>
      )}
    </div>
  );
}

/**
 * Scrolls to that Q&A's message in the channel and briefly highlights it (app-message-highlight). Used by the DM's "View" and after posting.
 * Returns false if it isn't drawn yet.
 */
export function flash(qa: number) {
  const row = document.querySelector<HTMLElement>(`[data-qa="${qa}"]`);
  if (!row) return false;
  row.scrollIntoView({ block: "center" });
  row.classList.remove("highlight");
  void row.offsetWidth; // repaint so the highlight restarts
  row.classList.add("highlight");
  return true;
}

/**
 * Below the conversation header: notice banners, the message list, and the composer. If the channel isn't known yet (first connect), only the skeleton shows.
 * `@call`ing your Agent in the composer asks that Agent in front of everyone instead of sending a message.
 * If a DM Q&A is attached (`attached`), it is posted to the channel along with the note. The note can be empty.
 * A message or question that failed to send goes back into the composer (with the called Agent or attached Q&A), and the banner's "Try again" sends it again.
 */
export function Conversation({
  channel,
  view,
  live,
  members,
  me,
  label,
  edited,
  strip,
  verdict,
  debate,
  tail,
  attached,
  onAttach,
  onSend,
  onCall,
  onPost,
  onRetry,
  onOlder,
  searchGifs,
  onReact,
  onThread,
  thread,
}: {
  channel?: Channel;
  view?: View;
  live: LiveState;
  /** Member list. Your Agents (`@call`) and the current state of the Agent that answered a Q&A are read from here. */
  members?: MemberView[];
  me: string;
  /** Composer hint. Defaults to "Send a message to # channel". A post uses its title. */
  label?: string;
  /** When the alert that is the first message was edited (post). */
  edited?: string;
  /** A post's decision status strip. Always sits above the conversation while a decision PR is open. */
  strip?: {
    decision: Decision;
    onRespond: (response: "agree" | "object" | "withdraw") => Promise<void>;
    onRevise: () => void;
    onDiscard: () => Promise<void>;
  };
  /** Verdict strip of an indirect-conflict post. Absent if no Runner has posted a verdict. Sits above the decision strip. */
  verdict?: ComponentProps<typeof VerdictStrip>;
  /** A post's discussion strip. Sits above the verdict strip. */
  debate?: ReactNode;
  /** What piles up at the bottom of the conversation (a post's discussion card). */
  tail?: ReactNode;
  /** The DM Q&A attached to the composer. The workspace holds it because the DM pane is shown too. */
  attached?: Qa;
  onAttach: Dispatch<SetStateAction<Qa | undefined>>;
  onSend: (text: string, reply?: ReplyBody) => Promise<void>;
  onCall: (executor: ExecutorId, question: string, reply?: ReplyBody) => Promise<void>;
  /** Posts a Q&A to the channel. `text` is the accompanying note; if empty, it posts without one. */
  onPost: (qa: Qa, text: string) => Promise<void>;
  onRetry: () => void;
  onOlder: () => void;
  /** GIF search (goes through the server). Absent without a GIPHY key on the server, and the composer has no GIF button. */
  searchGifs?: (query: string) => Promise<Gif[]>;
  /** Adds (`on`) or removes a reaction on a message (`message`, its id). */
  onReact: (message: number, emoji: string, on: boolean) => Promise<void>;
  /** Opens the thread under a message (`id`). Only chat channels have threads; missing in posts and inside a thread. */
  onThread?: (id: number) => void;
  /**
   * This conversation is a thread in the right column (draft 114-A): `view` holds the original and its replies, sends go into the thread,
   * and the "Also send to # channel" checkbox sits under the composer.
   */
  thread?: { id: number; alsoSend: boolean; onAlsoSend: (on: boolean) => void };
}) {
  const [text, setText] = useState("");
  const [token, setToken] = useState<ExecutorId>();
  const [replying, setReplying] = useState<Replying>();
  const area = useRef<HTMLTextAreaElement>(null);
  /** What failed to send. For a GIF, "Try again" sends that GIF again. */
  const [failure, setFailure] = useState<{ text: string; gif?: string }>();
  const scroller = useRef<HTMLDivElement>(null);
  const agentsOf = (login: string) => members?.find((member) => member.login === login)?.agents;
  const nameOf = (login: string) =>
    members?.find((member) => member.login === login)?.name || login;

  /** Puts a quote at the start of the composer, a blank line, then the caret (draft 115-B). */
  const quote = (quoted: string, login?: string) => {
    const lines = quoteLines(quoted, login);
    const next = withQuote(text, lines);
    setText((now) => withQuote(now, lines).text);
    document.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const reply = (message: Said) => {
    setReplying({ id: message.id, login: message.login, name: message.name, notify: true });
    area.current?.focus();
  };
  /** The Q&A just posted. Scroll to it and highlight it once its message is drawn. */
  const [posted, setPosted] = useState<number>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: look again each time messages are redrawn
  useEffect(() => {
    if (posted !== undefined && flash(posted)) setPosted(undefined);
  }, [posted, view]);

  const send = async () => {
    const message = text.trim();
    const qa = attached;
    if (!message && !qa) return;
    const called = token;
    const replied = qa ? undefined : replying;
    const body: ReplyBody | undefined = thread
      ? { threadOf: thread.id, alsoInChannel: thread.alsoSend }
      : replied && { replyTo: replied.id, notify: replied.notify };
    setText("");
    setToken(undefined);
    setReplying(undefined);
    onAttach(undefined);
    setFailure(undefined);
    scroller.current?.scrollTo({ top: 0 }); // the list stacks in reverse, so 0 is the bottom
    try {
      if (qa) {
        await onPost(qa, message);
        setPosted(qa.id);
      } else await (called ? onCall(called, message, body) : onSend(message, body));
    } catch (error) {
      const offline = error instanceof ContractFailure && error.code === "runner_offline";
      const f = t.conversation.failed;
      setFailure({
        text: qa
          ? f.post
          : !called
            ? f.send
            : offline
              ? f.runnerOff(EXECUTOR_NAMES[called])
              : f.ask,
      });
      setText((now) => now || message);
      setToken((now) => now ?? called);
      setReplying((now) => now ?? replied);
      if (qa) onAttach((now) => now ?? qa);
    }
  };

  /** Sends the picked GIF straight away as a single GIPHY URL. Whatever was typed in the composer stays (DESIGN.md "GIF"). */
  const sendGif = async (url: string) => {
    setFailure(undefined);
    scroller.current?.scrollTo({ top: 0 });
    try {
      await onSend(url, thread && { threadOf: thread.id, alsoInChannel: thread.alsoSend });
    } catch {
      setFailure({ text: t.conversation.failed.gif, gif: url });
    }
  };

  /** What the list shows: the channel's messages, or the whole thread. */
  const messages = thread ? (view?.messages ?? []) : (view?.messages.filter(inChannel) ?? []);
  const react = (message: number, emoji: string, on: boolean) =>
    void onReact(message, emoji, on).catch(() =>
      setFailure({ text: on ? t.conversation.failed.react : t.conversation.failed.unreact }),
    );

  return (
    <>
      {live === "reconnecting" && (
        <div className="banner info" role="status">
          {t.conversation.reconnecting}
        </div>
      )}
      {failure && (
        <div className="banner error" role="alert">
          {failure.text}
          <button
            type="button"
            className="banner-action"
            onClick={() => void (failure.gif ? sendGif(failure.gif) : send())}
          >
            {t.conversation.retry}
          </button>
        </div>
      )}
      {debate}
      {verdict && <VerdictStrip {...verdict} />}
      {strip && <DecisionStrip {...strip} me={me} />}
      {!channel || !view || view.status === "loading" ? (
        <Skeleton />
      ) : view.status === "error" ? (
        <div className="empty">
          <h2>{t.conversation.loadFailedTitle}</h2>
          <p>{t.conversation.loadFailedBody}</p>
          <button type="button" className="button outline" onClick={onRetry}>
            {t.conversation.retry}
          </button>
        </div>
      ) : messages.length === 0 ? (
        <div className="empty">
          <h2>{t.conversation.emptyTitle(channel.name)}</h2>
          <p>{t.conversation.emptyBody}</p>
        </div>
      ) : (
        // The list sits in a reversed stack (column-reverse), so the bottom shows first and older messages added on top leave the view where it was.
        <div
          className="scroller"
          ref={scroller}
          onScroll={(event) => {
            const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;
            if (scrollHeight - clientHeight + scrollTop < OLDER_PX) onOlder();
          }}
        >
          <div className="log" role="log" aria-label={t.conversation.logLabel(channel.name)}>
            {view.older && <SkeletonRow />}
            {messages.map((message, i) => {
              const previous = messages[i - 1];
              const newDay = !previous || dayOf(previous.at) !== dayOf(message.at);
              // A Q&A never groups, and the message after a Q&A gets its header again.
              const grouped =
                !newDay &&
                !(message.kind === "text" && (message.replyTo || message.alsoInChannel)) &&
                !(thread && i === 1) &&
                message.kind === "text" &&
                previous?.kind === "text" &&
                previous.login === message.login &&
                Date.parse(message.at) - Date.parse(previous.at) < GROUP_MS;
              return (
                <Fragment key={message.id}>
                  {thread && i === 1 && (
                    <div className="day thread-divider">
                      {t.conversation.thread.replies(messages.length - 1)}
                    </div>
                  )}
                  {newDay && !thread && <div className="day">{dayLabel(message.at)}</div>}
                  {message.kind === "alert" ? (
                    <AlertLine message={message} edited={edited} />
                  ) : message.kind === "decision" ? (
                    <DecisionLine message={message} />
                  ) : (
                    <Message
                      message={message}
                      grouped={grouped}
                      me={me}
                      nameOf={nameOf}
                      onReact={(emoji, on) => react(message.id, emoji, on)}
                      onReply={thread ? undefined : () => reply(message)}
                      onQuote={() => quote(quotable(message), message.login)}
                      onThread={onThread && (() => onThread(message.threadOf?.id ?? message.id))}
                      compact={!!thread}
                      state={
                        message.kind === "qa"
                          ? agentsOf(message.login)?.find(
                              (agent) => agent.executor === message.qa.executor,
                            )?.state
                          : undefined
                      }
                    />
                  )}
                </Fragment>
              );
            })}
            {tail}
          </div>
        </div>
      )}
      <SelectionQuote
        within={thread ? ".thread .message[data-login]" : ".message[data-login]:not(.thread *)"}
        onQuote={quote}
      />
      {channel && (
        <CallComposer
          area={area}
          reply={replying && !attached && <ReplyStrip replying={replying} onChange={setReplying} />}
          onEscape={replying && (() => setReplying(undefined))}
          label={
            label ??
            (thread ? t.conversation.thread.placeholder : t.conversation.sendTo(channel.name))
          }
          agents={agentsOf(me) ?? []}
          owner={members?.find((member) => member.login === me)?.name ?? me}
          value={text}
          onChange={setText}
          token={token}
          onToken={setToken}
          attached={attached}
          onDetach={() => onAttach(undefined)}
          onSubmit={() => void send()}
          gifs={
            searchGifs && { search: searchGifs, onPick: (gif) => void sendGif(giphyUrl(gif.id)) }
          }
        />
      )}
      {channel && thread && (
        <label className="also-send">
          <input
            type="checkbox"
            checked={thread.alsoSend}
            onChange={(event) => thread.onAlsoSend(event.target.checked)}
          />
          {t.conversation.thread.alsoSend(channel.name)}
        </label>
      )}
    </>
  );
}

/**
 * The composer (app-composer). It grows with lines and scrolls inside past its max height (CSS). Enter sends, Shift+Enter breaks a line.
 * It takes focus on open so you can type right away. On touch screens focus doesn't move, so the keyboard doesn't pop up suddenly.
 */
export function Composer({
  label,
  value,
  onChange,
  onSubmit,
  area: given,
  before,
  menu,
  textarea,
  tools,
  sendable,
  emoji,
  gifs,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** Pass this when the caller also uses the textarea (focus, caret position). */
  area?: RefObject<HTMLTextAreaElement | null>;
  /** What goes before the textarea (the `@call` token). */
  before?: ReactNode;
  /** A menu floating above the textarea (the `@call` Agent menu). */
  menu?: ReactNode;
  /** Extra props for the textarea. `onKeyDown` runs first, and if it prevents default, neither send nor line break happens. */
  textarea?: ComponentProps<"textarea">;
  /** What goes at the left of the line under the text (the DM's model and effort chips). If present, the composer becomes two lines and the send button sits at the right end of the lower one. */
  tools?: ReactNode;
  /** Can be sent without text (an attached Q&A). */
  sendable?: boolean;
  /** Adds the emoji button and `:` autocomplete (channel and post composers, not the DM pane). */
  emoji?: boolean;
  /** GIF button (before the emoji button). Only in channel and post composers, when the server has a GIPHY key. */
  gifs?: ComposerGifs;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const area = given ?? own;
  const picker = useEmojiInput(area, value, onChange, !!emoji);

  // biome-ignore lint/correctness/useExhaustiveDependencies: measure the height again whenever the text changes
  useLayoutEffect(() => {
    if (area.current) fitHeight(area.current);
  }, [value]);

  // Measure again when the width changes too. If the box was narrow or hidden on first draw, the hint wrapped and the height was set for that.
  // Changing the height calls this again, so skip when the width is the same. Changing the height right inside the callback makes the browser
  // raise a "ResizeObserver loop" error, so measure on the next frame.
  // ponytail: once field-sizing: content is widely available in Baseline (and Vite's default build target supports it), replace this observer and fitHeight with one line of CSS.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attach once on open
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    let width = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitHeight(element));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once on open
  useEffect(() => {
    if (matchMedia("(pointer: fine)").matches) area.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    picker.onKeyDown(event);
    if (event.defaultPrevented) return;
    textarea?.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // Enter while composing text with an IME just finishes the character. Safari reports 229 without isComposing then.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      className={tools ? "composer stacked" : "composer"}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {menu}
      {picker.menu}
      {before}
      <textarea
        {...textarea}
        {...(emoji && {
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": !!(textarea?.["aria-expanded"] || picker.open),
          "aria-controls": picker.list ?? textarea?.["aria-controls"],
          "aria-activedescendant": picker.activeId ?? textarea?.["aria-activedescendant"],
          onSelect: (event) => {
            textarea?.onSelect?.(event);
            picker.sync();
          },
          onBlur: (event) => {
            textarea?.onBlur?.(event);
            picker.onBlur();
          },
        })}
        ref={area}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder={label}
        aria-label={label}
      />
      {tools && <div className="composer-tools">{tools}</div>}
      {gifs && (
        <GifButton
          search={gifs.search}
          onPick={gifs.onPick}
          onClosed={() => area.current?.focus()}
        />
      )}
      {picker.button}
      <button
        type="submit"
        className="send-button"
        aria-label={t.conversation.send}
        disabled={!sendable && !value.trim()}
      >
        <ArrowUp size={18} aria-hidden />
      </button>
    </form>
  );
}

export type ComposerGifs = {
  search: (query: string) => Promise<Gif[]>;
  onPick: (gif: Gif) => void;
};

/** Fits the textarea height to its text. CSS caps the max height. */
function fitHeight(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

/**
 * One message. React inserts the text as plain characters only, so any HTML or script in it doesn't run and shows as is.
 * A Q&A (posted or `@call`ed) is a message from whoever posted it: it always has a header, with a collapsed line under the accompanying note (if any) (DESIGN.md "Q&A").
 * `state` is the current state of the Agent that answered.
 */
function Message({
  message,
  grouped,
  state,
  me,
  nameOf,
  onReact,
  onReply,
  onQuote,
  onThread,
  compact,
}: {
  message: Said;
  grouped: boolean;
  state?: MemberView["agents"][number]["state"];
  me: string;
  nameOf: (login: string) => string;
  onReact: (emoji: string, on: boolean) => void;
  /** Missing inside a thread, where a reply can't be a reply (it can still quote). */
  onReply?: () => void;
  onQuote: () => void;
  /** Opens this message's thread (for a thread reply, the thread it sits in). Missing in posts and inside a thread. */
  onThread?: () => void;
  /** Drawn in the thread column: 28px avatar, 14px text, no thread line or summary. */
  compact?: boolean;
}) {
  // A message that is just one GIPHY URL shows as a picture. A note written with a Q&A stays as text.
  const gif = message.kind === "text" ? giphyId(message.text) : undefined;
  /** While the action bar's palette is open, keep the bar even if the mouse leaves. */
  const [picking, setPicking] = useState(false);
  /** The long-press menu on narrow screens. */
  const [menu, setMenu] = useState(false);
  const press = useRef<number>(undefined);
  const r = t.conversation.reply;
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  return (
    <article
      className={`message${grouped ? " grouped" : ""}${picking ? " picking" : ""}${message.replyTo ? " replying" : ""}${compact ? " compact" : ""}`}
      data-qa={message.kind === "qa" ? message.qa.id : undefined}
      data-message={message.id}
      data-login={message.login}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a message is reached by keyboard to reply (R) or quote (Q) (DESIGN.md "Reply, thread, and quote")
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey) return;
        // With text selected, Q belongs to the selection's "Quote" button.
        if (document.getSelection()?.toString().trim()) return;
        const run = { r: onReply, t: onThread, q: onQuote }[event.key.toLowerCase()];
        if (!run) return;
        event.preventDefault();
        run();
      }}
      onTouchStart={() => {
        press.current = window.setTimeout(() => setMenu(true), LONG_PRESS_MS);
      }}
      onTouchEnd={() => clearTimeout(press.current)}
      onTouchMove={() => clearTimeout(press.current)}
    >
      <div className="message-tools" role="toolbar" aria-label={t.conversation.messageActions}>
        <ReactButton
          className="message-tool"
          size={16}
          onPick={(emoji) => onReact(emoji, true)}
          onOpen={setPicking}
        />
        {onReply && (
          <button
            type="button"
            className="message-tool"
            aria-label={r.reply}
            title={r.reply}
            onClick={onReply}
          >
            <Reply size={16} aria-hidden />
          </button>
        )}
        {onThread && (
          <button
            type="button"
            className="message-tool"
            aria-label={t.conversation.thread.thread}
            title={t.conversation.thread.thread}
            onClick={onThread}
          >
            <MessagesSquare size={16} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="message-tool"
          aria-label={r.quote}
          title={r.quote}
          onClick={onQuote}
        >
          <TextQuote size={16} aria-hidden />
        </button>
      </div>
      {menu && (
        <div
          className="menu message-menu"
          role="menu"
          aria-label={t.conversation.messageActions}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {[
            { label: r.reply, icon: Reply, run: onReply },
            { label: t.conversation.thread.thread, icon: MessagesSquare, run: onThread },
            { label: r.quote, icon: TextQuote, run: onQuote },
          ].flatMap(({ label, icon: Icon, run }) =>
            run
              ? [
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setMenu(false);
                      run();
                    }}
                  >
                    <Icon size={18} aria-hidden />
                    {label}
                  </button>,
                ]
              : [],
          )}
        </div>
      )}
      {message.replyTo && <ReplyLine replyTo={message.replyTo} />}
      {grouped ? (
        <time className="side-time" dateTime={message.at} title={fullTime(message.at)}>
          {timeOf(message.at)}
        </time>
      ) : (
        <Person login={message.login} avatar>
          <Avatar name={message.name} login={message.login} size={compact ? 28 : 36} />
        </Person>
      )}
      <div className="message-body">
        {!grouped && (
          <p className="message-head">
            <strong>
              <Person login={message.login}>{personName(message.name, message.login)}</Person>
            </strong>
            <time dateTime={message.at} title={fullTime(message.at)}>
              {timeOf(message.at)}
            </time>
            {message.kind === "text" && message.github && (
              <span className="badge outline" title={t.conversation.fromGithub}>
                GitHub
              </span>
            )}
          </p>
        )}
        {message.alsoInChannel && message.threadOf && !compact && (
          <p className="thread-copy">
            {t.conversation.thread.repliedIn}
            <button type="button" className="thread-copy-link" onClick={onThread}>
              {message.threadOf.original?.line ?? t.conversation.reply.gone}
            </button>
          </p>
        )}
        {message.text &&
          (gif ? <MessageGif id={gif} /> : <MessageText text={message.text} nameOf={nameOf} />)}
        {message.kind === "qa" && <QaLine message={message} state={state ?? "offline"} />}
        <Reactions reactions={message.reactions} me={me} onReact={onReact} />
        {message.thread && onThread && (
          <ThreadSummaryRow thread={message.thread} onOpen={onThread} />
        )}
      </div>
    </article>
  );
}

/** The row under a thread's original (draft 114-A): up to three writers, the reply count, and the last reply's time. Pressing it opens the thread. */
function ThreadSummaryRow({ thread, onOpen }: { thread: ThreadSummary; onOpen: () => void }) {
  return (
    <button type="button" className="thread-summary" onClick={onOpen}>
      <span className="thread-writers">
        {thread.writers.map((writer) => (
          <Avatar key={writer.login} name={writer.name} login={writer.login} size={20} />
        ))}
      </span>
      <strong>{t.conversation.thread.replies(thread.count)}</strong>
      <span className="thread-last">{t.conversation.thread.last(timeOf(thread.last))}</span>
    </button>
  );
}

/** What quoting a whole message copies: its text, or for a Q&A its answer (its question while it has none). */
const quotable = (message: Said) =>
  message.kind === "text"
    ? message.text
    : message.qa.answer.state === "answered"
      ? message.qa.answer.text
      : message.qa.question;

export const SkeletonRow = () => (
  <div className="skeleton-row" aria-hidden>
    <span className="bone circle" />
    <span className="bones">
      <span className="bone" />
      <span className="bone" />
    </span>
  </div>
);

/** Loading: gray bones the size of three messages. */
const Skeleton = () => (
  <div className="skeleton" role="status" aria-busy="true" aria-label={t.conversation.loading}>
    <SkeletonRow />
    <SkeletonRow />
    <SkeletonRow />
  </div>
);
