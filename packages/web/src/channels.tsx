import { type Channel, ContractFailure, MAX_CHANNEL_NAME_CHARS } from "@omagari/contract";
import { ChevronDown, Hash, MessagesSquare, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, type RefObject, useId, useState } from "react";
import { type PostItem, postTitle } from "./forum.tsx";

/** 채널 이름 순서. 받은 곳(목록, 실시간, 만들기)과 상관없이 같은 순서로 둔다. */
export const byName = (channels: Channel[]) =>
  channels.toSorted((a, b) => a.name.localeCompare(b.name, "ko"));

/**
 * 무엇을 접었는지(`key`: "채팅 채널" 카테고리, 채널 패널). 이 기기에 기억하고, 처음에는 펼쳐 둔다.
 * 저장소를 막아 둔 브라우저(사생활 보호 창 등)에서는 이 탭에서만 남는다.
 * 채널 패널이 앞(옆 칸)과 서랍에 둘 다 있어서 앱 틀이 하나만 들고 둘에 나눠 준다.
 */
export function useCollapsed(key: string) {
  const [collapsed, set] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    set(!collapsed);
    try {
      if (collapsed) localStorage.removeItem(key);
      else localStorage.setItem(key, "1");
    } catch {}
  };
  return [collapsed, toggle] as const;
}

/**
 * 채널 패널의 두 카테고리. "채팅 채널": 접을 수 있는 머리(이름, 꺾쇠, 채널을 만드는 `+`)와 채널 줄.
 * "포럼 채널": 포럼 줄(부딪힘) 밑에 열린 포스트가 가지로 달린다(DESIGN.md "부딪힘 포럼"). 풀린 포스트는 빠지고, 새 글이 있으면 굵게와 점이 붙는다.
 * 채널 줄은 주소의 `#채널 id`를 바꾸는 링크라, 새 탭에서 열 수 있고 뒤로 가기로 앞 채널에 돌아간다. 가지는 `#포럼 id/알림 번호`다.
 * 접어도 지금 고른 줄은 남는다.
 */
export function ChannelList({
  channels,
  current,
  post,
  posts,
  unread,
  collapsed,
  forumCollapsed,
  onToggle,
  onForumToggle,
  onPick,
  onCreate,
}: {
  channels?: Channel[];
  current?: string;
  /** 열려 있는 포스트의 알림 번호 */
  post?: number;
  posts?: PostItem[];
  unread: (post: PostItem) => boolean;
  collapsed: boolean;
  forumCollapsed: boolean;
  onToggle: () => void;
  onForumToggle: () => void;
  onPick?: () => void;
  onCreate: () => void;
}) {
  const chat = channels?.filter((channel) => channel.kind === "chat");
  const forums = channels?.filter((channel) => channel.kind === "forum");
  return (
    <nav className="channels">
      <Category
        title="채팅 채널"
        collapsed={collapsed}
        onToggle={onToggle}
        add={{ label: "채팅 채널 만들기", onClick: onCreate }}
      >
        {chat
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
      </Category>
      {forums && forums.length > 0 && (
        <Category title="포럼 채널" collapsed={forumCollapsed} onToggle={onForumToggle}>
          {forums
            .filter((channel) => !forumCollapsed || channel.id === current)
            .map((channel) => (
              <li key={channel.id}>
                <a
                  className="nav-item"
                  href={`#${channel.id}`}
                  aria-current={channel.id === current && post === undefined ? "page" : undefined}
                  onClick={onPick}
                >
                  <MessagesSquare size={18} aria-hidden />
                  <span>{channel.name}</span>
                </a>
                {!forumCollapsed && (
                  <ul className="branches" aria-label={`${channel.name}의 열린 포스트`}>
                    {posts
                      ?.filter(
                        (item) =>
                          item.message.channel === channel.id && !item.message.alert.resolved,
                      )
                      .sort((a, b) => Date.parse(b.activity) - Date.parse(a.activity))
                      .map((item) => (
                        <li key={item.alert}>
                          <a
                            className="branch-item"
                            href={`#${channel.id}/${item.alert}`}
                            aria-current={item.alert === post ? "page" : undefined}
                            data-unread={unread(item) || undefined}
                            onClick={onPick}
                          >
                            <span>{postTitle(item)}</span>
                            {unread(item) && (
                              <span className="unread-dot" role="img" aria-label="새 글" />
                            )}
                          </a>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
        </Category>
      )}
    </nav>
  );
}

/** 접을 수 있는 카테고리 머리와 그 아래 줄들. `add`가 있으면 오른쪽 끝에 `+`가 선다. */
function Category({
  title,
  collapsed,
  onToggle,
  add,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  add?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  const heading = useId();
  const list = useId();
  return (
    <section className="category" aria-labelledby={heading}>
      <div className="category-head">
        <h2 className="section-title" id={heading}>
          <button
            type="button"
            className="category-name"
            aria-expanded={!collapsed}
            aria-controls={list}
            onClick={onToggle}
          >
            {title}
            <ChevronDown className="category-chevron" size={12} aria-hidden />
          </button>
        </h2>
        {add && (
          <button
            type="button"
            className="category-add"
            aria-label={add.label}
            onClick={add.onClick}
          >
            <Plus size={18} aria-hidden />
          </button>
        )}
      </div>
      <ul className="nav-list" id={list}>
        {children}
      </ul>
    </section>
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
