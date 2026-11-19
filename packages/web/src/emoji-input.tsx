import { Smile } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { EmojiPalette, type Found, findEmoji, loadEmoji, loadedEmoji, remember } from "./emoji.tsx";

/** 글쇠 앞에서 맨 앞이나 공백 뒤의 `:`와 두 글자 이상. `10:30`처럼 낱말 중간의 `:`는 아니다. */
const TRIGGER = /(?:^|\s):([^\s:]{2,})$/;

/** 글쇠 자리의 글자를 `emoji`로 바꾸고 글쇠를 그 뒤에 둔다. */
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
 * 입력 칸의 이모지(DESIGN.md "채팅의 이모지"): 보내기 앞 이모지 버튼과 `:` 자동 완성.
 * 자동 완성은 `@호출` 메뉴와 같은 콤보박스다: 초점은 입력 칸에 두고, 위아래 화살표로 고르고, Enter나 Tab으로 넣고, Esc로 닫는다.
 * 한글을 조합하는 중의 Enter는 고르지 않는다.
 */
export function useEmojiInput(
  area: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (text: string) => void,
  enabled: boolean,
) {
  const list = useId();
  const [data, setData] = useState(loadedEmoji);
  const [trigger, setTrigger] = useState<{ at: number; query: string }>();
  /** Esc로 닫은 `:`의 자리. 그 자리에서는 다시 열지 않는다. */
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: 글이 바뀔 때마다 `:`를 다시 찾는다
  useEffect(sync, [value]);
  useEffect(() => {
    if (trigger && !data) void loadEmoji().then(setData);
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

  // 팔레트 바깥을 누르면 닫는다.
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
      <div id={list} role="listbox" aria-label="이모지 후보">
        {found.map((item) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: 글쇠는 입력 칸이 받는다(콤보박스)
          <div
            key={item.emoji}
            id={option(item.emoji)}
            role="option"
            aria-selected={item === current}
            tabIndex={-1}
            className="menu-item"
            // 눌러도 입력 칸의 초점이 떠나지 않는다.
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
        aria-label="이모지"
        aria-haspopup="dialog"
        aria-expanded={palette}
        data-tip="이모지"
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
