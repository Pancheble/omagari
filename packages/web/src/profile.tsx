import {
  type ChosenPresence,
  MAX_STATUS_MESSAGE_CHARS,
  type MemberView,
  type PresenceDuration,
} from "@omagari/contract";
import { ChevronRight, Smile, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import type { Me } from "./api.ts";
import { Avatar, Dot } from "./workspace.tsx";

type SetPresence = (presence: ChosenPresence, duration?: PresenceDuration) => Promise<void>;
type SetMessage = (message: string) => Promise<void>;

/** 나에게 보이는 내 접속 상태의 이름. 창을 연 채 오프라인이면 "오프라인으로 보이기"를 고른 것이다. */
const MINE = {
  online: "온라인",
  away: "자리 비움",
  dnd: "방해 금지",
  invisible: "오프라인으로 보이기",
} as const satisfies Record<ChosenPresence, string>;
const chosenOf = (mine?: MemberView): ChosenPresence | undefined =>
  mine && (mine.presence === "offline" ? "invisible" : mine.presence);
const dotOf = (presence: ChosenPresence) => (presence === "invisible" ? "offline" : presence);

/** 시간을 정해 거는 접속 상태. 각자 오른쪽 꺾쇠로 시간 메뉴를 연다. */
const TIMED = [
  { presence: "away", note: undefined },
  { presence: "dnd", note: "알림을 받지 않아요" },
  { presence: "invisible", note: "다른 사람에게 오프라인으로 보여요" },
] as const;
const DURATIONS: [PresenceDuration | undefined, string][] = [
  ["15m", "15분 동안"],
  ["1h", "1시간 동안"],
  ["8h", "8시간 동안"],
  ["24h", "24시간 동안"],
  ["3d", "3일 동안"],
  [undefined, "직접 바꿀 때까지"],
];

/** 이모지 고르기에 놓는 것. 상태 메시지에 자주 쓰는 것만 둔다. 그 밖의 것은 운영체제의 이모지 입력으로 쓴다. */
// ponytail: 고정된 24개다. 찾아 고르는 전체 목록이 필요해지면 frimousse 같은 작은 고르기를 데이터와 함께 직접 호스팅해 붙인다.
const EMOJI = [
  "💬",
  "🎯",
  "🚀",
  "🔥",
  "✅",
  "🐛",
  "🔧",
  "🧪",
  "📦",
  "📝",
  "👀",
  "🤔",
  "☕",
  "🍽️",
  "🏠",
  "🚗",
  "✈️",
  "🤒",
  "🌴",
  "🎧",
  "📅",
  "🎉",
  "😴",
  "🙏",
];

/** 서버가 접는 대로 접는다: 줄바꿈과 겹친 공백은 공백 하나, 앞뒤 공백은 뗀다. */
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * 채널 패널 맨 아래의 프로필 패널(DESIGN.md "프로필 패널과 상태 메뉴"). 패널 전체가 버튼 하나이고, 누르면 바로 위에 상태 메뉴가 열린다.
 * 아바타의 접속 점과 이름, 그 아래 상태 메시지(없으면 접속 상태)를 보인다. `mine`은 멤버 목록의 내 행이다.
 */
export function ProfilePanel({
  me,
  mine,
  onLogout,
  onPresence,
  onMessage,
}: {
  me: Me;
  mine?: MemberView;
  onLogout: () => void;
  onPresence: SetPresence;
  onMessage: SetMessage;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useId();
  const chosen = chosenOf(mine);

  // 메뉴 바깥을 누르면 닫힌다.
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
  // Esc는 메뉴만 닫는다. 서랍 안에서 열었어도 서랍은 그대로 둔다. 안쪽(시간 메뉴, 이모지)이 먼저 받아 닫으면 여기까지 오지 않는다.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 Esc를 한곳에서 받는다
    <div className="profile" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="profile-button"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <Avatar name={me.name} size={36} presence={mine?.presence} />
        <span className="names">
          <strong>{me.name}</strong>
          <span>{mine?.message ?? (chosen ? MINE[chosen] : me.login)}</span>
        </span>
      </button>
      {/* 메뉴는 버튼 뒤에 둔다. 위에 떠 보여도 Tab은 버튼에서 메뉴로 간다. */}
      {open && (
        <StatusMenu
          id={menu}
          me={me}
          mine={mine}
          onPresence={onPresence}
          onMessage={onMessage}
          onLogout={onLogout}
          onDone={close}
        />
      )}
    </div>
  );
}

/**
 * 상태 메뉴. 위에서부터 나, 상태 메시지 칸, 온라인, 시간을 정해 거는 셋, 설정과 로그아웃이다.
 * 상태 메시지는 Enter, 칸을 떠날 때, 메뉴가 닫힐 때 저장한다. 칸에서 Esc를 누르면 쓰던 것을 버리고 닫는다.
 */
function StatusMenu({
  id,
  me,
  mine,
  onPresence,
  onMessage,
  onLogout,
  onDone,
}: {
  id: string;
  me: Me;
  mine?: MemberView;
  onPresence: SetPresence;
  onMessage: SetMessage;
  onLogout: () => void;
  onDone: () => void;
}) {
  const chosen = chosenOf(mine);
  const [draft, setDraft] = useState(mine?.message ?? "");
  const [emoji, setEmoji] = useState(false);
  const [flyout, setFlyout] = useState<ChosenPresence>();
  const [failure, setFailure] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  /** 키보드로 시간 메뉴를 열었으면 그 첫 줄로 간다. 마우스로 열면 초점을 옮기지 않는다(쓰던 칸을 빼앗지 않는다). */
  const focusFlyout = useRef(false);
  const help = useId();
  const over = Array.from(normalize(draft)).length > MAX_STATUS_MESSAGE_CHARS;

  /** 마지막으로 저장한(보낸) 상태 메시지. 같은 것은 다시 보내지 않는다. */
  const saved = useRef(mine?.message ?? "");
  const save = async (text: string) => {
    const message = normalize(text);
    if (message === saved.current || Array.from(message).length > MAX_STATUS_MESSAGE_CHARS) return;
    saved.current = message;
    setFailure(undefined);
    try {
      await onMessage(message);
    } catch {
      saved.current = "";
      setFailure("상태 메시지를 저장하지 못했어요");
    }
  };
  // 바깥을 눌러 닫혀도 쓰던 것을 저장한다. 칸에서 Esc로 닫으면 버린다.
  const latest = useRef({ save, draft, cancelled: false });
  latest.current = { ...latest.current, save, draft };
  useEffect(
    () => () => {
      const { save, draft, cancelled } = latest.current;
      if (!cancelled) void save(draft).catch(() => {});
    },
    [],
  );

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
      setFailure("접속 상태를 바꾸지 못했어요");
    }
  };

  const insert = (picked: string) => {
    const field = input.current;
    const start = field?.selectionStart ?? draft.length;
    const end = field?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + picked + draft.slice(end));
    setEmoji(false);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + picked.length, start + picked.length);
    });
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (over) return;
      void save(draft);
      onDone();
    } else if (event.key === "Escape") {
      latest.current.cancelled = true; // 메뉴를 닫는 것은 프로필 패널이 한다
    }
  };

  /** 시간 메뉴(WAI-ARIA menu): 위아래 화살표로 옮기고, Esc나 왼쪽 화살표로 닫고 연 줄로 돌아간다. */
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
        <Avatar name={me.name} size={40} presence={mine?.presence} />
        <div className="names">
          <strong>{me.name}</strong>
          <span>{me.login}</span>
        </div>
      </div>
      {/* 상태 메시지 칸. 칸과 이모지 고르기 사이를 오갈 때는 저장하지 않고, 그 바깥으로 나가면 저장한다. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 칸과 버튼의 blur를 한곳에서 받는다 */}
      <div
        className="status-editor"
        ref={editor}
        onBlur={(event) => {
          if (!editor.current?.contains(event.relatedTarget as Node)) void save(draft);
        }}
      >
        <div className="status-field" data-invalid={over || undefined}>
          <button
            type="button"
            className="emoji-button"
            aria-label="이모지 넣기"
            aria-expanded={emoji}
            onClick={() => setEmoji(!emoji)}
          >
            <Smile size={18} aria-hidden />
          </button>
          <input
            ref={input}
            className="status-input"
            aria-label="상태 메시지"
            aria-invalid={over || undefined}
            aria-describedby={over ? help : undefined}
            placeholder="상태 메시지"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onFieldKey}
          />
          {draft && (
            <button
              type="button"
              className="clear-button"
              aria-label="상태 메시지 지우기"
              onClick={() => {
                setDraft("");
                void save("");
                input.current?.focus();
              }}
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        {emoji && (
          <fieldset
            className="emoji-grid"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              setEmoji(false);
              input.current?.focus();
            }}
          >
            <legend className="sr-only">이모지</legend>
            {EMOJI.map((picked) => (
              <button key={picked} type="button" onClick={() => insert(picked)}>
                {picked}
              </button>
            ))}
          </fieldset>
        )}
        {over && (
          <p id={help} className="help error">
            상태 메시지는 {MAX_STATUS_MESSAGE_CHARS}자까지 쓸 수 있어요
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
        <span className="item-label">{MINE.online}</span>
        {chosen === "online" && <span className="sr-only">(지금 상태)</span>}
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
        disabled
        onPointerEnter={() => setFlyout(undefined)}
      >
        설정
        <span className="menu-note">준비 중</span>
      </button>
      <button type="button" className="menu-item danger" onClick={onLogout}>
        로그아웃
      </button>
    </div>
  );
}

/** 시간을 정해 거는 접속 상태 한 줄과 그 시간 메뉴. 마우스를 올리거나, 누르거나, 오른쪽 화살표로 연다. */
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
  note?: string;
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
        onClick={(event) => onOpen(event.detail === 0)} // detail 0: Enter나 Space로 눌렀다
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          onOpen(true);
        }}
      >
        <Dot presence={dotOf(presence)} aria-hidden />
        <span className="item-label">
          {MINE[presence]}
          {note && <span className="menu-note">{note}</span>}
        </span>
        {current && <span className="sr-only">(지금 상태)</span>}
        <ChevronRight size={16} className="item-chevron" aria-hidden />
      </button>
      {open && (
        <div
          ref={flyoutRef}
          id={flyout}
          className="menu flyout"
          role="menu"
          aria-label={`${MINE[presence]} 시간`}
          onKeyDown={(event) => onFlyoutKey(event, row.current)}
        >
          {DURATIONS.map(([duration, label]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="menu-item"
              tabIndex={-1}
              onClick={() => onPick(duration)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
