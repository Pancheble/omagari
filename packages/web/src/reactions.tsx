import type { Reaction } from "@omagari/contract";
import { SmilePlus } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { EmojiPalette } from "./emoji.tsx";
import { t } from "./i18n.ts";

/** The palette height on wide screens (search row, list, category bar). If there isn't room below the button, it opens upward. */
const PALETTE_HEIGHT = 420;

/**
 * The "Add reaction" button and its palette (DESIGN.md "Reactions"). The palette opens below the button, right-aligned.
 * The conversation list scrolls inside its pane, so the palette is fixed to the screen to avoid being clipped. On narrow screens it's a sheet that slides up from the bottom (CSS).
 */
export function ReactButton({
  className,
  size,
  onPick,
  onOpen,
}: {
  className: string;
  size: number;
  onPick: (emoji: string) => void;
  onOpen?: (open: boolean) => void;
}) {
  const [at, setAt] = useState<CSSProperties>();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const toggle = (next?: CSSProperties) => {
    setAt(next);
    onOpen?.(!!next);
  };

  useEffect(() => {
    if (!at) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) toggle(undefined);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.bottom + 4 + PALETTE_HEIGHT <= innerHeight;
    toggle({
      right: innerWidth - rect.right,
      ...(below ? { top: rect.bottom + 4 } : { bottom: innerHeight - rect.top + 4 }),
    });
  };

  return (
    <span className="reaction-anchor" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={t.profile.reactions.add}
        aria-haspopup="dialog"
        aria-expanded={!!at}
        onClick={() => (at ? toggle(undefined) : open())}
      >
        <SmilePlus size={size} aria-hidden />
      </button>
      {at && (
        <div className="reaction-pop" style={at}>
          <EmojiPalette
            current={null}
            onPick={(emoji) => {
              toggle(undefined);
              onPick(emoji);
            }}
            onClear={() => toggle(undefined)}
            onClose={() => {
              toggle(undefined);
              button.current?.focus();
            }}
            hideClear
          />
        </div>
      )}
    </span>
  );
}

/** The pill's tooltip: "Minsu Park, Seoyeon Lee reacted with 🎉". */
const tipOf = ({ emoji, members }: Reaction) =>
  t.profile.reactions.tip(members.map((member) => member.name).join(", "), emoji);

/**
 * The row of reaction pills under a message body (`app-reaction`). A reaction I added is a pressed pill, and pressing toggles it.
 * An "Add reaction" button sits at the end of the row. With no reactions there's no row (then you add one from the message's action strip).
 */
export function Reactions({
  reactions,
  me,
  onReact,
}: {
  reactions: Reaction[];
  me: string;
  onReact: (emoji: string, on: boolean) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="reactions">
      {reactions.map((reaction) => {
        const mine = reaction.members.some((member) => member.login === me);
        const tip = tipOf(reaction);
        return (
          <button
            key={reaction.emoji}
            type="button"
            className="reaction"
            aria-pressed={mine}
            aria-label={`${reaction.emoji} ${reaction.members.length}: ${tip}`}
            data-tip={tip}
            onClick={() => onReact(reaction.emoji, !mine)}
          >
            <span className="reaction-emoji" aria-hidden>
              {reaction.emoji}
            </span>
            <span aria-hidden>{reaction.members.length}</span>
          </button>
        );
      })}
      <ReactButton
        className="reaction reaction-add"
        size={14}
        onPick={(emoji) => onReact(emoji, true)}
      />
    </div>
  );
}
