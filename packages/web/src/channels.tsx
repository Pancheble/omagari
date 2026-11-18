import type { Channel } from "@omagari/contract";
import { ChevronDown, ChevronRight, Hash, Inbox, MessagesSquare, Plus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { OTHER, type PostItem, postTitle, settled } from "./forum.tsx";

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

/** 내 포스트를 접은 포럼들의 id. 이 기기에 기억한다. */
function useFolded() {
  const KEY = "omagari.forums-folded";
  const [folded, set] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const toggle = (id: string) => {
    const next = folded.includes(id) ? folded.filter((other) => other !== id) : [...folded, id];
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  return [folded, toggle] as const;
}

/**
 * 채널 패널의 두 카테고리. "채팅 채널": 접을 수 있는 머리(이름, 꺾쇠, 채널을 만드는 `+`)와 채널 줄.
 * "포럼 채널"(시안 55-D): 포럼 줄 밑에 내가 관련된(`mine`) 열린 포스트만 가지로 달린다. 같은 포스트가 여러 포럼에 맞으면 그 포럼마다 달린다.
 * 내 포스트가 있는 포럼은 줄 끝 꺾쇠로 접고, 접으면 수와 새 글 점이 남는다. 풀린 포스트는 빠지고, 새 글이 있으면 굵게와 점이 붙는다.
 * 포럼들 아래 구분선 뒤에 어느 포럼에도 맞지 않는 "다른 포스트" 줄이 있다(없으면 숨는다). `+`는 포럼을 만든다.
 * 채널 줄은 주소의 `#채널 id`를 바꾸는 링크라, 새 탭에서 열 수 있고 뒤로 가기로 앞 채널에 돌아간다. 가지는 `#포럼 id/알림 번호`다.
 * 접어도 지금 고른 줄은 남는다.
 */
export function ChannelList({
  channels,
  current,
  post,
  posts,
  unread,
  mine,
  collapsed,
  forumCollapsed,
  onToggle,
  onForumToggle,
  onPick,
  onCreate,
  onCreateForum,
}: {
  channels?: Channel[];
  current?: string;
  /** 열려 있는 포스트의 알림 번호 */
  post?: number;
  posts?: PostItem[];
  unread: (post: PostItem) => boolean;
  /** 내가 관련된 포스트인가: 내 작업이 걸렸거나 내가 글을 썼다. */
  mine: (post: PostItem) => boolean;
  collapsed: boolean;
  forumCollapsed: boolean;
  onToggle: () => void;
  onForumToggle: () => void;
  onPick?: () => void;
  onCreate: () => void;
  onCreateForum: () => void;
}) {
  const [folded, toggleFolded] = useFolded();
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
      {forums && (
        <Category
          title="포럼 채널"
          collapsed={forumCollapsed}
          onToggle={onForumToggle}
          add={{ label: "포럼 만들기", onClick: onCreateForum }}
        >
          {forums
            .filter((channel) => !forumCollapsed || channel.id === current)
            .map((channel) => {
              const branches = (posts ?? [])
                .filter((item) => item.forums.includes(channel.id) && !settled(item) && mine(item))
                .sort((a, b) => Date.parse(b.activity) - Date.parse(a.activity));
              const shut = forumCollapsed || folded.includes(channel.id);
              return (
                <li key={channel.id}>
                  <div className="forum-row">
                    <a
                      className="nav-item"
                      href={`#${channel.id}`}
                      aria-current={
                        channel.id === current && post === undefined ? "page" : undefined
                      }
                      onClick={onPick}
                    >
                      <MessagesSquare size={18} aria-hidden />
                      <span>{channel.name}</span>
                      {shut && branches.length > 0 && (
                        <>
                          <small className="forum-count">{branches.length}</small>
                          {branches.some(unread) && (
                            <span className="unread-dot" role="img" aria-label="새 글" />
                          )}
                        </>
                      )}
                    </a>
                    {!forumCollapsed && branches.length > 0 && (
                      <button
                        type="button"
                        className="forum-fold"
                        aria-expanded={!shut}
                        aria-label={`${channel.name}의 내 포스트 ${shut ? "펼치기" : "접기"}`}
                        onClick={() => toggleFolded(channel.id)}
                      >
                        {shut ? (
                          <ChevronRight size={14} aria-hidden />
                        ) : (
                          <ChevronDown size={14} aria-hidden />
                        )}
                      </button>
                    )}
                  </div>
                  {!shut && branches.length > 0 && (
                    <ul className="branches" aria-label={`${channel.name}의 내 포스트`}>
                      {branches.map((item) => (
                        <li key={item.alert}>
                          <a
                            className="branch-item"
                            href={`#${channel.id}/${item.alert}`}
                            aria-current={
                              item.alert === post && channel.id === current ? "page" : undefined
                            }
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
              );
            })}
          {!forumCollapsed && posts?.some((item) => item.forums.length === 0) && (
            <li className="other-posts">
              <a
                className="nav-item"
                href={`#${OTHER.id}`}
                aria-current={current === OTHER.id && post === undefined ? "page" : undefined}
                onClick={onPick}
              >
                <Inbox size={18} aria-hidden />
                <span>{OTHER.name}</span>
              </a>
            </li>
          )}
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
