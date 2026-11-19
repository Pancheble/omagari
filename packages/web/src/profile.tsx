import {
  type ChosenPresence,
  MAX_STATUS_MESSAGE_CHARS,
  type MemberView,
  type PresenceDuration,
} from "@omagari/contract";
import { ChevronRight, SmilePlus, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import type { Me } from "./api.ts";
import { EmojiPalette, loadEmoji } from "./emoji.tsx";
import { t } from "./i18n.ts";
import { Avatar, Dot, personName } from "./workspace.tsx";

type SetPresence = (presence: ChosenPresence, duration?: PresenceDuration) => Promise<void>;
type SetMessage = (message: string, emoji: string | null) => Promise<void>;

const chosenOf = (mine?: MemberView): ChosenPresence | undefined =>
  mine && (mine.presence === "offline" ? "invisible" : mine.presence);
const dotOf = (presence: ChosenPresence) => (presence === "invisible" ? "offline" : presence);

/** Presence you set for a set time. Each opens its duration menu with the right chevron. */
const TIMED = [
  { presence: "away", note: undefined },
  { presence: "dnd", note: "dndNote" },
  { presence: "invisible", note: "invisibleNote" },
] as const;
const DURATIONS = ["15m", "1h", "8h", "24h", "3d", undefined] as const satisfies (
  | PresenceDuration
  | undefined
)[];

/** Collapse it the way the server does: line breaks and repeated spaces become one space, and leading and trailing spaces go. */
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Status message: the one emoji goes before the text with a space between. With only an emoji, only the emoji shows. */
export const StatusText = ({ emoji, message }: Pick<MemberView, "emoji" | "message">) => (
  <>
    {emoji && <span className="emoji">{emoji}</span>}
    {emoji && message && " "}
    {message}
  </>
);
const hasStatus = (member?: MemberView): member is MemberView =>
  member !== undefined && (member.emoji !== null || member.message !== null);

/**
 * The profile panel at the bottom of the channel panel (DESIGN.md "Profile panel and status menu"). The whole panel is one button, and pressing it opens the status menu right above.
 * It shows the avatar's presence dot and name, and below that the status message (or the presence if there is none). `mine` is my row in the member list.
 */
export function ProfilePanel({
  me,
  mine,
  solo = false,
  onLogout,
  onSettings,
  onPresence,
  onMessage,
}: {
  me: Me;
  mine?: MemberView;
  /** I'm the only member (mockup 100-A). Leaves out the presence dot and presence text and shows the GitHub login. */
  solo?: boolean;
  onLogout: () => void;
  onSettings: () => void;
  onPresence: SetPresence;
  onMessage: SetMessage;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useId();
  const chosen = chosenOf(mine);

  // Pressing outside the menu closes it.
  useEffect(() => {
    if (!open) return;
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
  // Esc closes only the menu. Even if it was opened inside a drawer, the drawer stays. If something inside (the duration menu, emoji) handles it first, it doesn't reach here.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: catches Esc from the menu and buttons inside in one place
    <div className="profile" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="profile-button"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <Avatar
          name={me.name}
          login={me.login}
          size={36}
          presence={solo ? undefined : mine?.presence}
        />
        <span className="names">
          <strong>{personName(me.name, me.login)}</strong>
          <span>
            {hasStatus(mine) ? (
              <StatusText {...mine} />
            ) : chosen && !solo ? (
              t.profile.presence[chosen]
            ) : null}
          </span>
        </span>
      </button>
      {/* The menu goes after the button. Even though it floats above, Tab goes from the button to the menu. */}
      {open && (
        <StatusMenu
          id={menu}
          me={me}
          mine={mine}
          onPresence={onPresence}
          onMessage={onMessage}
          onLogout={onLogout}
          onSettings={() => {
            close();
            onSettings();
          }}
          onDone={close}
        />
      )}
    </div>
  );
}

/**
 * The status menu. From the top: me, the status message field, Online, the three set-for-a-time ones, then Settings and Log out.
 * The status message (text and one emoji) is saved on Enter, when you leave the field, and when the menu closes. Esc in the field throws away what you typed and closes.
 */
function StatusMenu({
  id,
  me,
  mine,
  onPresence,
  onMessage,
  onLogout,
  onSettings,
  onDone,
}: {
  id: string;
  me: Me;
  mine?: MemberView;
  onPresence: SetPresence;
  onMessage: SetMessage;
  onLogout: () => void;
  onSettings: () => void;
  onDone: () => void;
}) {
  const chosen = chosenOf(mine);
  const [draft, setDraft] = useState(mine?.message ?? "");
  const [emoji, setEmoji] = useState(mine?.emoji ?? null);
  const [palette, setPalette] = useState(false);
  const [flyout, setFlyout] = useState<ChosenPresence>();
  const [failure, setFailure] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  /** If the duration menu was opened by keyboard, focus goes to its first row. Opened by mouse, focus doesn't move (it doesn't steal the field you were typing in). */
  const focusFlyout = useRef(false);
  const help = useId();
  const over = Array.from(normalize(draft)).length > MAX_STATUS_MESSAGE_CHARS;

  /** The last status message saved (sent). The same one isn't sent again. */
  const saved = useRef({ message: mine?.message ?? "", emoji: mine?.emoji ?? null });
  const save = async (text: string, picked: string | null) => {
    const message = normalize(text);
    if (Array.from(message).length > MAX_STATUS_MESSAGE_CHARS) return;
    if (message === saved.current.message && picked === saved.current.emoji) return;
    saved.current = { message, emoji: picked };
    setFailure(undefined);
    try {
      await onMessage(message, picked);
    } catch {
      saved.current = { message: "", emoji: null };
      setFailure(t.profile.menu.saveFailed);
    }
  };
  // Even if pressing outside closes it, what you typed is saved. Closing with Esc in the field throws it away.
  const latest = useRef({ save, draft, emoji, cancelled: false });
  latest.current = { ...latest.current, save, draft, emoji };
  useEffect(() => {
    void loadEmoji(); // Fetch the data before the palette opens
    return () => {
      const { save, draft, emoji, cancelled } = latest.current;
      if (!cancelled) void save(draft, emoji).catch(() => {});
    };
  }, []);

  // Pressing outside the palette (other than the emoji button) closes only the palette.
  useEffect(() => {
    if (!palette) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!paletteRef.current?.contains(target) && !emojiButton.current?.contains(target))
        setPalette(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [palette]);

  useEffect(() => {
    if (!flyout || !focusFlyout.current) return;
    focusFlyout.current = false;
    flyoutRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [flyout]);

  const pick = async (presence: ChosenPresence, duration?: PresenceDuration) => {
    setFailure(undefined);
    try {
      await onPresence(presence, duration);
      onDone();
    } catch {
      setFailure(t.profile.menu.presenceFailed);
    }
  };

  /** Picking or clearing in the palette changes the emoji slot (it isn't appended to the text), closes the palette, and returns to the text field. */
  const choose = (picked: string | null) => {
    setEmoji(picked);
    setPalette(false);
    input.current?.focus();
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (over) return;
      void save(draft, emoji);
      onDone();
    } else if (event.key === "Escape") {
      latest.current.cancelled = true; // The profile panel closes the menu
    }
  };

  /** Duration menu (WAI-ARIA menu): up and down arrows move, Esc or the left arrow closes it and goes back to the row that opened it. */
  const onFlyoutKey = (event: KeyboardEvent, row: HTMLElement | null) => {
    const items = [
      ...(flyoutRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setFlyout(undefined);
      row?.focus();
    }
  };

  return (
    <div className="menu status-menu" id={id}>
      <div className="menu-head">
        <Avatar name={me.name} login={me.login} size={40} presence={mine?.presence} />
        <div className="names">
          <strong>{personName(me.name, me.login)}</strong>
        </div>
      </div>
      {/* The status message field. Moving between the field and the emoji picker doesn't save; going outside both does. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: catches blur from the field and buttons inside in one place */}
      <div
        className="status-editor"
        ref={editor}
        onBlur={(event) => {
          if (!editor.current?.contains(event.relatedTarget as Node)) void save(draft, emoji);
        }}
      >
        <div className="status-field" data-invalid={over || undefined}>
          <button
            ref={emojiButton}
            type="button"
            className="emoji-button"
            aria-label={emoji ? t.profile.menu.changeEmoji(emoji) : t.profile.menu.pickEmoji}
            aria-haspopup="dialog"
            aria-expanded={palette}
            onClick={() => setPalette(!palette)}
          >
            {emoji ? <span className="emoji">{emoji}</span> : <SmilePlus size={18} aria-hidden />}
          </button>
          <input
            ref={input}
            className="status-input"
            aria-label={t.profile.menu.status}
            aria-invalid={over || undefined}
            aria-describedby={over ? help : undefined}
            placeholder={t.profile.menu.status}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onFieldKey}
          />
          {(draft || emoji) && (
            <button
              type="button"
              className="clear-button"
              aria-label={t.profile.menu.clearStatus}
              onClick={() => {
                setDraft("");
                setEmoji(null);
                void save("", null);
                input.current?.focus();
              }}
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        {palette && (
          <div ref={paletteRef}>
            <EmojiPalette
              current={emoji}
              onPick={choose}
              onClear={() => choose(null)}
              onClose={() => {
                setPalette(false);
                emojiButton.current?.focus();
              }}
            />
          </div>
        )}
        {over && (
          <p id={help} className="help error">
            {t.profile.menu.tooLong(MAX_STATUS_MESSAGE_CHARS)}
          </p>
        )}
        {failure && (
          <p className="help error" role="alert">
            {failure}
          </p>
        )}
      </div>
      <hr />
      <button
        type="button"
        className="menu-item presence-item"
        data-current={chosen === "online" || undefined}
        onPointerEnter={() => setFlyout(undefined)}
        onClick={() => void pick("online")}
      >
        <Dot presence="online" aria-hidden />
        <span className="item-label">{t.profile.presence.online}</span>
        {chosen === "online" && <span className="sr-only">{t.profile.menu.current}</span>}
      </button>
      <hr />
      {TIMED.map(({ presence, note }) => (
        <TimedItem
          key={presence}
          presence={presence}
          note={note}
          current={chosen === presence}
          open={flyout === presence}
          onOpen={(byKey) => {
            focusFlyout.current = byKey;
            setFlyout(presence);
          }}
          flyoutRef={flyoutRef}
          onFlyoutKey={onFlyoutKey}
          onPick={(duration) => void pick(presence, duration)}
        />
      ))}
      <hr />
      <button
        type="button"
        className="menu-item"
        aria-haspopup="dialog"
        onPointerEnter={() => setFlyout(undefined)}
        onClick={onSettings}
      >
        {t.profile.menu.settings}
      </button>
      <button type="button" className="menu-item danger" onClick={onLogout}>
        {t.profile.menu.logout}
      </button>
    </div>
  );
}

/** One set-for-a-time presence row and its duration menu. Opens on hover, press, or the right arrow. */
function TimedItem({
  presence,
  note,
  current,
  open,
  onOpen,
  flyoutRef,
  onFlyoutKey,
  onPick,
}: {
  presence: Exclude<ChosenPresence, "online">;
  note?: "dndNote" | "invisibleNote";
  current: boolean;
  open: boolean;
  onOpen: (byKey: boolean) => void;
  flyoutRef: RefObject<HTMLDivElement | null>;
  onFlyoutKey: (event: KeyboardEvent, row: HTMLElement | null) => void;
  onPick: (duration?: PresenceDuration) => void;
}) {
  const row = useRef<HTMLButtonElement>(null);
  const flyout = useId();
  return (
    <div
      className="submenu"
      onPointerEnter={(event) => event.pointerType === "mouse" && onOpen(false)}
    >
      <button
        ref={row}
        type="button"
        className={note ? "menu-item presence-item with-note" : "menu-item presence-item"}
        data-current={current || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? flyout : undefined}
        onClick={(event) => onOpen(event.detail === 0)} // detail 0: pressed with Enter or Space
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          onOpen(true);
        }}
      >
        <Dot presence={dotOf(presence)} aria-hidden />
        <span className="item-label">
          {t.profile.presence[presence]}
          {note && <span className="menu-note">{t.profile.menu[note]}</span>}
        </span>
        {current && <span className="sr-only">{t.profile.menu.current}</span>}
        <ChevronRight size={16} className="item-chevron" aria-hidden />
      </button>
      {open && (
        <div
          ref={flyoutRef}
          id={flyout}
          className="menu flyout"
          role="menu"
          aria-label={t.profile.menu.durationMenu(t.profile.presence[presence])}
          onKeyDown={(event) => onFlyoutKey(event, row.current)}
        >
          {DURATIONS.map((duration) => (
            <button
              key={duration ?? "forever"}
              type="button"
              role="menuitem"
              className="menu-item"
              tabIndex={-1}
              onClick={() => onPick(duration)}
            >
              {t.profile.menu.durations[duration ?? "forever"]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
