import { type Channel, ContractFailure, MAX_CHANNEL_NAME_CHARS } from "@omagari/contract";
import { ChevronDown, Hash, Plus } from "lucide-react";
import { type FormEvent, type RefObject, useId, useState } from "react";

/** 채널 이름 순서. 받은 곳(목록, 실시간, 만들기)과 상관없이 같은 순서로 둔다. */
export const byName = (channels: Channel[]) =>
  channels.toSorted((a, b) => a.name.localeCompare(b.name, "ko"));

const COLLAPSED = "omagari.channels-collapsed";

/**
 * "채팅 채널" 카테고리를 접었는지. 이 기기에 기억한다. 저장소를 막아 둔 브라우저(사생활 보호 창 등)에서는
 * 이 탭에서만 남는다. 채널 패널이 앞(옆 칸)과 서랍에 둘 다 있어서 앱 틀이 하나만 들고 둘에 나눠 준다.
 */
export function useCollapsed() {
  const [collapsed, set] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    set(!collapsed);
    try {
      if (collapsed) localStorage.removeItem(COLLAPSED);
      else localStorage.setItem(COLLAPSED, "1");
    } catch {}
  };
  return [collapsed, toggle] as const;
}

/**
 * 채널 패널의 "채팅 채널" 카테고리: 접을 수 있는 머리(이름, 꺾쇠, 채널을 만드는 `+`)와 채널 줄.
 * 채널 줄은 주소의 `#채널 id`를 바꾸는 링크라, 새 탭에서 열 수 있고 뒤로 가기로 앞 채널에 돌아간다.
 * 접어도 지금 고른 채널 줄은 남는다.
 */
export function ChannelList({
  channels,
  current,
  collapsed,
  onToggle,
  onPick,
  onCreate,
}: {
  channels?: Channel[];
  current?: string;
  collapsed: boolean;
  onToggle: () => void;
  onPick?: () => void;
  onCreate: () => void;
}) {
  const title = useId();
  const list = useId();
  return (
    <nav className="channels" aria-labelledby={title}>
      <div className="category-head">
        <h2 className="section-title" id={title}>
          <button
            type="button"
            className="category-name"
            aria-expanded={!collapsed}
            aria-controls={list}
            onClick={onToggle}
          >
            채팅 채널
            <ChevronDown className="category-chevron" size={12} aria-hidden />
          </button>
        </h2>
        <button
          type="button"
          className="category-add"
          aria-label="채팅 채널 만들기"
          onClick={onCreate}
        >
          <Plus size={18} aria-hidden />
        </button>
      </div>
      <ul className="nav-list" id={list}>
        {channels
          ?.filter((channel) => !collapsed || channel.id === current)
          .map((channel) => (
            <li key={channel.id}>
              <a
                className="nav-item"
                href={`#${channel.id}`}
                aria-current={channel.id === current ? "page" : undefined}
                onClick={onPick}
              >
                <Hash size={18} aria-hidden />
                <span>{channel.name}</span>
              </a>
            </li>
          ))}
      </ul>
    </nav>
  );
}

/** "채널 만들기" 대화 상자. 같은 이름이 있으면 입력 칸이 오류 상태가 된다. 닫히면 비운다. */
export function CreateChannel({
  dialog,
  onCreate,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const title = useId();
  const input = useId();
  const help = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onCreate(name);
      dialog.current?.close();
    } catch (failure) {
      setError(
        failure instanceof ContractFailure && failure.code === "conflict"
          ? "같은 이름의 채널이 이미 있어요. 다른 이름을 써 주세요."
          : "채널을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    // 덮개를 누르면 닫힌다. 키보드로는 Esc가 닫는다(dialog가 해 준다).
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={title}
      onClose={() => {
        setName("");
        setError(undefined);
      }}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={title}>채널 만들기</h2>
        <div className="field">
          <label htmlFor={input}>이름</label>
          {/* 대화 상자가 열리면 첫 입력 칸인 이것에 초점이 간다(dialog가 해 준다). */}
          <input
            id={input}
            className="text-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
            maxLength={MAX_CHANNEL_NAME_CHARS}
            autoComplete="off"
            aria-invalid={error !== undefined}
            aria-describedby={help}
          />
          <p id={help} className={error ? "help error" : "help"} aria-live="polite">
            {error ?? "멤버 모두가 읽고 쓰는 채팅 채널이에요."}
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            만들기
          </button>
        </div>
      </form>
    </dialog>
  );
}
