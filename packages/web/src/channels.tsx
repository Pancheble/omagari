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
  Layers,
  MessagesSquare,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useId, useState } from "react";
import { repoName, type Workspace as Space } from "./api.ts";
import { useMenu } from "./dm.tsx";
import { OTHER, type PostItem, postTitle, settled } from "./forum.tsx";
import { ALL } from "./places.ts";

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
 * 채널 패널(시안 101): 늘 한 곳(레포 하나나 "<계정> 전체")의 것이라 층 머리도 레포 묶음도 없이 두 카테고리만 있다.
 * `channels`는 그곳의 채널만 받는다(`placeOf`).
 * "채팅 채널": 접을 수 있는 머리(이름, 꺾쇠, 채널을 만드는 `+`)와 채널 줄.
 * "포럼 채널"(시안 55-D): 포럼 줄 밑에 내가 관련된(`mine`) 열린 포스트만 가지로 달린다. 같은 포스트가 여러 포럼에 맞으면 그 포럼마다 달린다.
 * 내 포스트가 있는 포럼은 줄 끝 꺾쇠로 접고, 접으면 수와 새 글 점이 남는다. 풀린 포스트는 빠지고, 새 글이 있으면 굵게와 점이 붙는다.
 * `other`면 포럼들 아래 구분선 뒤에 어느 포럼에도 맞지 않는 "다른 포스트" 줄이 있다. `+`는 포럼을 만든다.
 * 채널 줄은 주소의 `#채널 id`를 바꾸는 링크라, 새 탭에서 열 수 있고 뒤로 가기로 앞 채널에 돌아간다. 가지는 `#포럼 id/알림 번호`다.
 * 접어도 지금 고른 줄은 남는다.
 */
export function ChannelList({
  channels,
  other,
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
  /** "다른 포스트" 줄을 둔다. */
  other: boolean;
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
  const list = channels ?? [];

  const chatRows = list
    .filter((channel) => channel.kind === "chat" && (!collapsed || channel.id === current))
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

  const forumRows = list
    .filter((channel) => channel.kind === "forum" && (!forumCollapsed || channel.id === current))
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
                    {unread(item) && <span className="unread-dot" role="img" aria-label="새 글" />}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    });

  return (
    <nav className="channels">
      <Category
        title="채팅 채널"
        collapsed={collapsed}
        onToggle={onToggle}
        add={{ label: "채팅 채널 만들기", onClick: onCreate }}
      >
        {chatRows}
      </Category>
      {channels && (
        <Category
          title="포럼 채널"
          collapsed={forumCollapsed}
          onToggle={onForumToggle}
          add={{ label: "포럼 만들기", onClick: onCreateForum }}
        >
          {forumRows}
          {!forumCollapsed && other && (
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

/**
 * 계정 아바타(시안 101): GitHub 아바타를 쓰고 조직은 둥근 네모, 개인 계정은 동그라미다(GitHub과 같다).
 * 아바타가 없거나 받지 못하면 계정 이름 첫 글자를 쓴다.
 */
export function AccountMark({ space, size = 28 }: { space: Space; size?: 22 | 28 }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`account-mark account-${size}`} data-kind={space.kind} aria-hidden>
      {space.avatar && !failed ? (
        <img src={space.avatar} alt="" onError={() => setFailed(true)} />
      ) : (
        Array.from(space.name)[0]?.toUpperCase()
      )}
    </span>
  );
}

/** 어느 계정 묶음을 펼쳤는지. 이 기기에 기억하고, 처음에는 지금 보는 계정만 펴 둔다. */
function useAccountOpen(current: string) {
  const KEY = "omagari.accounts-open";
  const [saved, set] = useState<Record<string, boolean>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  });
  const isOpen = (id: string) => saved[id] ?? id === current;
  const toggle = (id: string) => {
    const next = { ...saved, [id]: !isOpen(id) };
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  return [isOpen, toggle] as const;
}

const placeLabel = (space: Space, place: string) =>
  place === ALL ? `${space.name} 전체` : repoName(place);

/**
 * 채널 패널 맨 위의 이름 줄과 레포 고르기 메뉴(시안 101-1, 101-3). 이름 줄은 계정 아바타, 작은 계정 이름, 굵은 레포 이름이나 "전체"이고,
 * 다른 곳에 새 글이 있으면 점이 붙는다. 누르면 바로 아래에 메뉴가 열린다: 레포 찾기 칸, 계정마다 접히는 묶음
 * (레포가 둘 이상이면 "<계정> 전체", 레포마다 한 줄, 내가 Admin인 레포가 있으면 끝에 "레포 넣기"), Admin인 레포 줄의 ⋯ 메뉴.
 * `action`(채널 패널 접기)은 오른쪽 끝에 그대로 선다.
 */
export function PlacePicker({
  workspaces,
  current,
  place,
  fresh,
  admin,
  action,
  onAdmin,
  onPick,
  onAddRepo,
  onRemoveRepo,
}: {
  workspaces: Space[];
  current: Space;
  /** 지금 보는 곳: 레포 이름이나 `ALL` */
  place: string;
  /** 지금 계정의 그곳에 새 글이 있나. 다른 계정의 새 글은 아직 모른다. */
  fresh: (place: string) => boolean;
  /** 계정마다 내가 Admin인 레포. 없으면 아직 읽지 않았다. */
  admin: Record<string, AdminRepo[] | "error" | undefined>;
  action?: ReactNode;
  /** 계정 묶음이 펼쳐져 보이면 그 계정의 Admin 레포를 읽는다. */
  onAdmin: (workspace: string) => void;
  onPick: (workspace: string, place: string) => void;
  onAddRepo: (workspace: string) => void;
  onRemoveRepo: (workspace: string, repo: string) => Promise<void>;
}) {
  const { open, setOpen, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const [query, setQuery] = useState("");
  const [isOpen, toggle] = useAccountOpen(current.id);
  /** ⋯ 메뉴를 연 레포 */
  const [more, setMore] = useState<string>();
  const found = (repo: string) => repoName(repo).toLowerCase().includes(query.trim().toLowerCase());
  const places = (space: Space) => (space.repos.length > 1 ? [ALL, ...space.repos] : space.repos);
  const elsewhere = places(current).some((other) => other !== place && fresh(other));
  // 펼쳐 보이는 계정의 Admin 레포를 읽는다("레포 넣기"와 ⋯가 거기에 달렸다).
  const shown = open ? workspaces.filter((space) => query.trim() || isOpen(space.id)) : [];
  const missing = shown.filter((space) => admin[space.id] === undefined).map((space) => space.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 아직 읽지 않은 계정이 바뀔 때만 읽는다
  useEffect(() => {
    for (const id of missing) onAdmin(id);
  }, [missing.join()]);
  const adminOf = (space: Space) => {
    const list = admin[space.id];
    return Array.isArray(list) ? list : [];
  };
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
          onClick={() => {
            setMore(undefined);
            setQuery("");
            setOpen(!open);
          }}
        >
          <AccountMark space={current} />
          <span className="place-names">
            <small>{current.name}</small>
            <h1>{place === ALL ? "전체" : repoName(place)}</h1>
          </span>
          {elsewhere && <span className="unread-dot" role="img" aria-label="다른 곳에 새 글" />}
          <ChevronsUpDown size={14} aria-hidden />
        </button>
        {open && (
          <div className="forum-menu place-menu" id={menu} role="menu" aria-label="레포 고르기">
            <label className="place-search">
              <Search size={14} aria-hidden />
              <input
                type="search"
                placeholder="레포 찾기"
                aria-label="레포 찾기"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {workspaces.map((space) => {
              const searching = query.trim() !== "";
              const rows = places(space).filter((p) => !searching || (p !== ALL && found(p)));
              if (searching && rows.length === 0) return null;
              const expanded = searching || isOpen(space.id);
              const mine = new Set(
                adminOf(space)
                  .filter((r) => r.added)
                  .map((r) => r.name),
              );
              const news = space.id === current.id && places(space).some(fresh);
              return (
                <section key={space.id} className="place-group" aria-label={space.name}>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item place-account"
                    aria-expanded={expanded}
                    tabIndex={-1}
                    disabled={searching}
                    onClick={() => toggle(space.id)}
                  >
                    <ChevronDown className="place-chevron" size={14} aria-hidden />
                    <AccountMark space={space} size={22} />
                    <span className="pop-name">{space.name}</span>
                    {!expanded && (
                      <>
                        <small className="pop-aside">레포 {space.repos.length}</small>
                        {news && <span className="unread-dot" role="img" aria-label="새 글" />}
                      </>
                    )}
                  </button>
                  {expanded &&
                    rows.map((p) => {
                      const here = space.id === current.id && p === place;
                      return (
                        <div key={p} className="place-row" data-menu={more === p || undefined}>
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={here}
                            className="menu-item pop-row"
                            tabIndex={-1}
                            title={p === ALL ? undefined : p}
                            onClick={() => {
                              setOpen(false);
                              if (!here) onPick(space.id, p);
                            }}
                          >
                            {p === ALL ? (
                              <Layers size={16} aria-hidden />
                            ) : (
                              <Book size={16} aria-hidden />
                            )}
                            <span className="pop-name">{placeLabel(space, p)}</span>
                            {space.id === current.id && !here && fresh(p) && (
                              <span className="unread-dot" role="img" aria-label="새 글" />
                            )}
                            {here && <Check className="place-check" size={16} aria-hidden />}
                          </button>
                          {mine.has(p) && (
                            <RepoMore
                              repo={p}
                              open={more === p}
                              onOpen={(next) => setMore(next ? p : undefined)}
                              onRemove={() => onRemoveRepo(space.id, p)}
                            />
                          )}
                        </div>
                      );
                    })}
                  {expanded && !searching && adminOf(space).length > 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item pop-row place-add"
                      tabIndex={-1}
                      onClick={() => {
                        setOpen(false);
                        onAddRepo(space.id);
                      }}
                    >
                      <Plus size={16} aria-hidden />
                      <span className="pop-name">레포 넣기</span>
                    </button>
                  )}
                </section>
              );
            })}
            <hr />
            <p className="pop-note">넣은 레포 가운데 push 권한이 있는 것만 보여요.</p>
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * 레포 줄의 ⋯ 메뉴(시안 101-1, 91-C): "GitHub에서 열기"와 "워크스페이스에서 빼기". 빼기는 한 번 더 누르게 한다.
 * 그 레포의 Admin에게만 보인다.
 */
function RepoMore({
  repo,
  open,
  onOpen,
  onRemove,
}: {
  repo: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  onRemove: () => Promise<void>;
}) {
  const menu = useId();
  const [removing, setRemoving] = useState<"ask" | "busy" | "error">();
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="repo-more"
        aria-label="레포 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        tabIndex={-1}
        onClick={() => {
          setRemoving(undefined);
          onOpen(!open);
        }}
      >
        <Ellipsis size={18} aria-hidden />
      </button>
      {open && (
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
                onOpen(false);
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
    </>
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
  /** 메뉴에서 "레포 넣기"를 누른 계정 */
  account: Space;
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
        내가 Admin인 레포만 보여요. 개인 레포도 넣어야 Omagari가 봐요. 넣으면 그 레포에 push 권한이
        있는 사람이 멤버로 들어와요.
      </p>
      <p className="repo-account">
        <AccountMark space={account} size={22} />
        <strong>{account.name}</strong>
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
      <p className="help">다른 계정의 레포는 메뉴에서 그 계정 아래 "레포 넣기"로 넣어요.</p>
      <div className="dialog-actions">
        <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
          닫기
        </button>
      </div>
    </dialog>
  );
}
