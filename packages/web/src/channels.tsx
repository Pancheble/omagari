import type { api, Channel, call } from "@omagari/contract";
import {
  Book,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Ellipsis,
  ExternalLink,
  Hash,
  Inbox,
  MessagesSquare,
  Minus,
  Plus,
} from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import { repoName, type Workspace as Space } from "./api.ts";
import { useMenu } from "./dm.tsx";
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
 * 채널이 패널의 어느 층에 서나(ADR-0043, 시안 90-A): 레포 채팅 채널과 레포 하나만 보는 포럼은 그 레포 밑이고,
 * 워크스페이스 채널과 모든 레포나 레포 둘 이상을 보는 포럼은 위층(`undefined`)이다.
 */
export const layerOf = (channel: Channel) =>
  channel.kind === "chat"
    ? channel.repo
    : channel.filter?.repos?.length === 1
      ? channel.filter.repos[0]
      : undefined;

/** 레포 묶음을 펼쳤는지. 이 기기에 기억하고, 처음에는 지금 보는 채널의 레포만 펴 둔다. */
function useRepoOpen(current?: string) {
  const KEY = "omagari.repos-open";
  const [saved, set] = useState<Record<string, boolean>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  });
  const isOpen = (repo: string) => saved[repo] ?? repo === current;
  const toggle = (repo: string) => {
    const next = { ...saved, [repo]: !isOpen(repo) };
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  return [isOpen, toggle] as const;
}

/**
 * 채널 패널(시안 90-A): 위층은 "<워크스페이스> 전체"의 두 카테고리, 그 아래 "레포" 층은 레포마다 접는 묶음이다.
 * "채팅 채널": 접을 수 있는 머리(이름, 꺾쇠, 채널을 만드는 `+`)와 채널 줄.
 * "포럼 채널"(시안 55-D): 포럼 줄 밑에 내가 관련된(`mine`) 열린 포스트만 가지로 달린다. 같은 포스트가 여러 포럼에 맞으면 그 포럼마다 달린다.
 * 내 포스트가 있는 포럼은 줄 끝 꺾쇠로 접고, 접으면 수와 새 글 점이 남는다. 풀린 포스트는 빠지고, 새 글이 있으면 굵게와 점이 붙는다.
 * 포럼들 아래 구분선 뒤에 어느 포럼에도 맞지 않는 "다른 포스트" 줄이 있다(없으면 숨는다). `+`는 포럼을 만든다.
 * 레포 묶음 안은 그 레포의 채팅 채널 다음에 포럼이다. Admin인 레포(`admin`)만 머리에 ⋯ 메뉴가 있고, `onAddRepo`가 있으면 "레포" 머리에 `+`가 있다.
 * 채널 줄은 주소의 `#채널 id`를 바꾸는 링크라, 새 탭에서 열 수 있고 뒤로 가기로 앞 채널에 돌아간다. 가지는 `#포럼 id/알림 번호`다.
 * 접어도 지금 고른 줄은 남는다.
 */
export function ChannelList({
  workspace,
  repos,
  admin,
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
  onAddRepo,
  onRemoveRepo,
}: {
  /** 워크스페이스 이름(계정) */
  workspace: string;
  /** 이 워크스페이스에서 내게 보이는 레포들 */
  repos: string[];
  /** 그 가운데 내가 Admin인 레포 */
  admin: Set<string>;
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
  onAddRepo?: () => void;
  onRemoveRepo: (repo: string) => Promise<void>;
}) {
  const [folded, toggleFolded] = useFolded();
  const currentChannel = channels?.find((channel) => channel.id === current);
  const [isOpen, toggleRepo] = useRepoOpen(currentChannel && layerOf(currentChannel));
  const layer = (repo?: string) => (channels ?? []).filter((c) => layerOf(c) === repo);

  const chatRows = (list: Channel[], shut = false) =>
    list
      .filter((channel) => channel.kind === "chat" && (!shut || channel.id === current))
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
      ));

  const forumRows = (list: Channel[], shutAll = false) =>
    list
      .filter((channel) => channel.kind === "forum" && (!shutAll || channel.id === current))
      .map((channel) => {
        const branches = (posts ?? [])
          .filter((item) => item.forums.includes(channel.id) && !settled(item) && mine(item))
          .sort((a, b) => Date.parse(b.activity) - Date.parse(a.activity));
        const shut = shutAll || folded.includes(channel.id);
        return (
          <li key={channel.id}>
            <div className="forum-row">
              <a
                className="nav-item"
                href={`#${channel.id}`}
                aria-current={channel.id === current && post === undefined ? "page" : undefined}
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
              {!shutAll && branches.length > 0 && (
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
      });

  const top = layer(undefined);
  return (
    <nav className="channels">
      <p className="layer-title">{workspace} 전체</p>
      <Category
        title="채팅 채널"
        collapsed={collapsed}
        onToggle={onToggle}
        add={{ label: "채팅 채널 만들기", onClick: onCreate }}
      >
        {chatRows(top, collapsed)}
      </Category>
      {channels && (
        <Category
          title="포럼 채널"
          collapsed={forumCollapsed}
          onToggle={onForumToggle}
          add={{ label: "포럼 만들기", onClick: onCreateForum }}
        >
          {forumRows(top, forumCollapsed)}
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
      <div className="layer-head">
        <p className="layer-title">레포</p>
        {onAddRepo && (
          <button
            type="button"
            className="category-add"
            aria-label="레포 넣기"
            data-tip="레포 넣기"
            onClick={onAddRepo}
          >
            <Plus size={18} aria-hidden />
          </button>
        )}
      </div>
      {repos.map((repo) => {
        const inside = layer(repo);
        const open = isOpen(repo);
        const chats = inside.filter((channel) => channel.kind === "chat").length;
        return (
          <RepoGroup
            key={repo}
            repo={repo}
            open={open}
            count={`채널 ${chats} · 포럼 ${inside.length - chats}`}
            admin={admin.has(repo)}
            onToggle={() => toggleRepo(repo)}
            onRemove={() => onRemoveRepo(repo)}
          >
            {chatRows(inside, !open)}
            {forumRows(inside, !open)}
          </RepoGroup>
        );
      })}
    </nav>
  );
}

/**
 * 레포 묶음(시안 90-A): 머리(16px `book`, 이름, 접으면 "채널 2 · 포럼 1", Admin이면 ⋯, 꺾쇠)와 14px 들여 쓴 줄들.
 * ⋯ 메뉴(시안 91-C)는 "GitHub에서 열기"와 "워크스페이스에서 빼기"이고, 빼기는 한 번 더 누르게 한다.
 */
function RepoGroup({
  repo,
  open,
  count,
  admin,
  onToggle,
  onRemove,
  children,
}: {
  repo: string;
  open: boolean;
  count: string;
  admin: boolean;
  onToggle: () => void;
  onRemove: () => Promise<void>;
  children: ReactNode;
}) {
  const list = useId();
  const menu = useId();
  const { open: menuOpen, setOpen, wrap, button, onKeyDown } = useMenu();
  const [removing, setRemoving] = useState<"ask" | "busy" | "error">();
  return (
    <section className="repo-group" aria-label={repo}>
      <div className="repo-head" data-menu={menuOpen || undefined}>
        <button
          type="button"
          className="repo-name"
          aria-expanded={open}
          aria-controls={list}
          title={repo}
          onClick={onToggle}
        >
          <Book size={16} aria-hidden />
          <span>{repoName(repo)}</span>
          {!open && <small>{count}</small>}
        </button>
        {admin && (
          // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다
          <div className="forum-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
            <button
              ref={button}
              type="button"
              className="repo-more"
              aria-label="레포 메뉴"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menu : undefined}
              onClick={() => {
                setRemoving(undefined);
                setOpen(!menuOpen);
              }}
            >
              <Ellipsis size={18} aria-hidden />
            </button>
            {menuOpen && (
              <div className="forum-menu repo-menu" id={menu} role="menu" aria-label="레포 메뉴">
                <a
                  role="menuitem"
                  className="menu-item pop-row"
                  href={`https://github.com/${repo}`}
                  target="_blank"
                  rel="noreferrer"
                  tabIndex={-1}
                >
                  <ExternalLink size={16} aria-hidden />
                  <span className="pop-name">GitHub에서 열기</span>
                </a>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item pop-row danger"
                  tabIndex={-1}
                  disabled={removing === "busy"}
                  onClick={async () => {
                    if (removing !== "ask") return setRemoving("ask");
                    setRemoving("busy");
                    try {
                      await onRemove();
                      setOpen(false);
                    } catch {
                      setRemoving("error");
                    }
                  }}
                >
                  <Minus size={16} aria-hidden />
                  <span className="pop-name">
                    {removing === "ask" || removing === "busy"
                      ? "한 번 더 누르면 빠져요"
                      : "워크스페이스에서 빼기"}
                  </span>
                </button>
                {removing === "error" && (
                  <p className="pop-note error" role="alert">
                    빼지 못했어요. 잠시 뒤 다시 시도해 주세요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <ChevronDown className="repo-chevron" size={14} aria-hidden onClick={onToggle} />
      </div>
      <ul className="nav-list repo-list" id={list}>
        {children}
      </ul>
    </section>
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

/** 계정 표시: 28px 둥근 네모에 계정 이름 첫 글자. 바탕색은 시안에서 정하지 않아(DESIGN.md Known Gaps) 글자색으로 둔다. */
const AccountMark = ({ name }: { name: string }) => (
  <span className="account-mark" aria-hidden>
    {Array.from(name)[0]?.toUpperCase()}
  </span>
);

/**
 * 채널 패널 맨 위의 워크스페이스 이름 줄(시안 89-A). 워크스페이스가 둘 이상이면 이름 줄이 버튼이 되고,
 * 누르면 바로 아래에 워크스페이스 목록이 열린다. `action`(채널 패널 접기)은 오른쪽 끝에 그대로 선다.
 */
export function WorkspacePicker({
  workspaces,
  current,
  action,
  onSwitch,
}: {
  workspaces: Space[];
  current: Space;
  action?: ReactNode;
  onSwitch: (id: string) => void;
}) {
  const { open, setOpen, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const count = (space: Space) => `레포 ${space.repos.length}개`;
  if (workspaces.length < 2)
    return (
      <div className="workspace">
        <h1>{current.name}</h1>
        {action}
        <p>{count(current)}</p>
      </div>
    );
  return (
    <div className="workspace picker">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다 */}
      <div className="forum-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
        <button
          ref={button}
          type="button"
          className="workspace-button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menu : undefined}
          onClick={() => setOpen(!open)}
        >
          <AccountMark name={current.name} />
          <h1>{current.name}</h1>
          <ChevronsUpDown size={14} aria-hidden />
        </button>
        {open && (
          <div
            className="forum-menu workspace-menu"
            id={menu}
            role="menu"
            aria-label="워크스페이스"
          >
            <p className="menu-title">워크스페이스</p>
            {workspaces.map((space) => (
              <button
                key={space.id}
                type="button"
                role="menuitemradio"
                aria-checked={space.id === current.id}
                className="menu-item pop-row workspace-row"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  if (space.id !== current.id) onSwitch(space.id);
                }}
              >
                <AccountMark name={space.name} />
                <span className="pop-name">
                  {space.name}
                  <small>{count(space)}</small>
                </span>
                {space.id === current.id && <Check size={16} aria-hidden />}
              </button>
            ))}
            <hr />
            <p className="pop-note">push 권한이 있는 레포가 들어 있는 워크스페이스만 보여요.</p>
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

export type AdminRepo = Awaited<ReturnType<typeof call<typeof api.adminRepos>>>["repos"][number];

/**
 * "레포 넣기" 대화 상자(시안 91-A): 이 계정의 레포 가운데 내가 Admin인 것만 보이고, 안 넣은 것에 "넣기"가 있다.
 * 빼기는 채널 패널의 레포 ⋯ 메뉴에서 한다(시안 91-C).
 */
export function RepoDialog({
  dialog,
  account,
  repos,
  onAdd,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  account: string;
  /** 없으면 읽는 중, `"error"`면 GitHub에서 읽지 못했다. */
  repos?: AdminRepo[] | "error";
  onAdd: (repo: string) => Promise<void>;
}) {
  const heading = useId();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState(false);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="dialog repo-dialog"
      aria-labelledby={heading}
      onClose={() => setError(false)}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <h2 id={heading}>레포 넣기</h2>
      <p className="dialog-lead">
        {account}의 레포 가운데 내가 Admin인 것만 보여요. 넣으면 그 레포에 push 권한이 있는 사람이
        멤버로 들어와요.
      </p>
      {repos === undefined ? (
        <p className="help" role="status" aria-busy="true">
          레포를 읽는 중…
        </p>
      ) : repos === "error" ? (
        <p className="help error" role="alert">
          GitHub에서 레포를 읽지 못했어요. 잠시 뒤 다시 열어 주세요.
        </p>
      ) : (
        <ul className="repo-pick">
          {repos.map((repo) => (
            <li key={repo.name}>
              <Book size={16} aria-hidden />
              <span className="repo-pick-name">
                <strong>{repoName(repo.name)}</strong>
                <small>
                  {repo.private ? "비공개" : "공개"} · push 권한 {repo.pushers}명
                </small>
              </span>
              {repo.added ? (
                <small className="repo-added">넣음</small>
              ) : (
                <button
                  type="button"
                  className="button outline small"
                  disabled={busy !== undefined}
                  onClick={async () => {
                    setBusy(repo.name);
                    setError(false);
                    try {
                      await onAdd(repo.name);
                    } catch {
                      setError(true);
                    } finally {
                      setBusy(undefined);
                    }
                  }}
                >
                  넣기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="help error" role="alert">
          레포를 넣지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
      <p className="help">빼려면 채널 패널에서 그 레포 이름의 ⋯를 눌러요.</p>
      <div className="dialog-actions">
        <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
          닫기
        </button>
      </div>
    </dialog>
  );
}
