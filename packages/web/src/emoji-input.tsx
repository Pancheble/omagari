import { Smile } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { EmojiPalette, type Found, findEmoji, loadEmoji, loadedEmoji, remember } from "./emoji.tsx";
import { t } from "./i18n.ts";

/** A `:` at the start or after a space, before the caret, plus two or more characters. Not a `:` in the middle of a word like `10:30`. */
const TRIGGER = /(?:^|\s):([^\s:]{2,})$/;

/** Replaces the typed `:text` with `emoji` and puts the caret after it. */
function put(
  area: RefObject<HTMLTextAreaElement | null>,
  value: string,
  from: number,
  to: number,
  emoji: string,
  onChange: (text: string) => void,
) {
  onChange(value.slice(0, from) + emoji + value.slice(to));
  const caret = from + emoji.length;
  requestAnimationFrame(() => area.current?.setSelectionRange(caret, caret));
}

/**
 * Emoji in the composer (DESIGN.md "Emoji in chat"): the emoji button before Send and `:` autocomplete.
 * Autocomplete is a combobox like the `@call` menu: focus stays in the composer, up and down arrows choose, Enter or Tab inserts, and Esc closes.
 * Enter while composing text (an IME) doesn't choose.
 */
export function useEmojiInput(
  area: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (text: string) => void,
  enabled: boolean,
) {
  const list = useId();
  // Redraw once the data arrives. It is read per render, so a language change picks up that language's data.
  const [, setLoaded] = useState(0);
  const data = loadedEmoji();
  const [trigger, setTrigger] = useState<{ at: number; query: string }>();
  /** The spot of a `:` closed with Esc. It isn't reopened there. */
  const [dismissed, setDismissed] = useState<number>();
  const [active, setActive] = useState(0);
  const [palette, setPalette] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  const sync = () => {
    const element = area.current;
    if (!enabled || !element) return;
    const before = element.value.slice(0, element.selectionStart);
    const match = element.selectionStart === element.selectionEnd ? TRIGGER.exec(before) : null;
    const query = match?.[1] ?? "";
    const next = match ? { at: before.length - query.length - 1, query } : undefined;
    if (next?.at === trigger?.at && next?.query === trigger?.query) return;
    setTrigger(next);
    setActive(0);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the `:` is looked for again whenever the text changes
  useEffect(sync, [value]);
  useEffect(() => {
    if (trigger && !data) void loadEmoji().then(() => setLoaded((n) => n + 1));
  }, [trigger, data]);

  const found: Found[] = trigger && data ? findEmoji(data, trigger.query) : [];
  const open = trigger !== undefined && trigger.at !== dismissed && found.length > 0;
  const current = found[Math.min(active, found.length - 1)];
  const option = (emoji: string) => `${list}-${emoji}`;

  const pick = (item: Found) => {
    if (!trigger || !area.current) return;
    remember(item.emoji);
    put(area, value, trigger.at, area.current.selectionStart, item.emoji, onChange);
    setTrigger(undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || !current || !trigger) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(trigger.at);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((found.indexOf(current) + step + found.length) % found.length);
    } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      pick(current);
    }
  };

  // Pressing outside the palette closes it.
  useEffect(() => {
    if (!palette) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setPalette(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [palette]);

  const menu = open && trigger && (
    <div className="menu emoji-suggest">
      <p className="call-menu-title">:{trigger.query}</p>
      <div id={list} role="listbox" aria-label={t.profile.emoji.suggestions}>
        {found.map((item) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the composer (combobox)
          <div
            key={item.emoji}
            id={option(item.emoji)}
            role="option"
            aria-selected={item === current}
            tabIndex={-1}
            className="menu-item"
            // Pressing it doesn't take focus from the composer.
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => setActive(found.indexOf(item))}
            onClick={() => pick(item)}
          >
            <span className="suggest-emoji" aria-hidden>
              {item.emoji}
            </span>
            <span className="suggest-name">{item.label}</span>
            {item.tag && <span className="suggest-tag">{item.tag}</span>}
          </div>
        ))}
      </div>
    </div>
  );

  const button = enabled && (
    <span className="emoji-anchor" ref={wrap}>
      <button
        type="button"
        className="composer-icon"
        aria-label={t.profile.emoji.tip}
        aria-haspopup="dialog"
        aria-expanded={palette}
        data-tip={t.profile.emoji.tip}
        onClick={() => setPalette(!palette)}
      >
        <Smile size={20} aria-hidden />
      </button>
      {palette && (
        <EmojiPalette
          current={null}
          onPick={(emoji) => {
            const element = area.current;
            const at = element?.selectionStart ?? value.length;
            put(area, value, at, element?.selectionEnd ?? at, emoji, onChange);
            setPalette(false);
            element?.focus();
          }}
          onClear={() => setPalette(false)}
          onClose={() => {
            setPalette(false);
            area.current?.focus();
          }}
          hideClear
        />
      )}
    </span>
  );

  return {
    menu,
    button,
    open,
    activeId: open && current ? option(current.emoji) : undefined,
    list: open ? list : undefined,
    onKeyDown,
    sync,
    onBlur: () => setTrigger(undefined),
  };
}
