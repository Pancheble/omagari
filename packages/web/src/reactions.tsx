import type { Reaction } from "@omagari/contract";
import { SmilePlus } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { EmojiPalette } from "./emoji.tsx";
import { josa } from "./words/ko.ts";

/** 넓은 화면에서 팔레트의 높이(찾기 줄, 목록, 분류 막대). 버튼 아래에 자리가 모자라면 위로 연다. */
const PALETTE_HEIGHT = 420;

/**
 * "반응 달기" 버튼과 그 팔레트(DESIGN.md "반응"). 팔레트는 버튼 아래에 오른쪽을 맞춰 열린다.
 * 대화 목록은 칸 안에서 스크롤하므로 팔레트는 화면에 고정해 잘리지 않게 한다. 좁은 화면에서는 아래에서 올라오는 시트다(CSS).
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
        aria-label="반응 달기"
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

/** 알약의 툴팁: "박민수, 이서연이 🎉로 반응". */
const tipOf = ({ emoji, members }: Reaction) =>
  `${josa(members.map((member) => member.name).join(", "), "이", "가")} ${emoji}로 반응`;

/**
 * 메시지 본문 아래의 반응 알약 줄(`app-reaction`). 내가 단 반응은 눌린 알약이고, 누르면 달거나 뗀다.
 * 줄 끝에 "반응 달기" 버튼을 둔다. 반응이 없으면 줄도 없다(그때는 메시지의 동작 띠로 단다).
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
