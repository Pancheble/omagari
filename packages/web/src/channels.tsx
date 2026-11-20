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
import { language, t } from "./i18n.ts";
import { ALL } from "./places.ts";

/** Channel name order. The same order no matter where the channels came from (list, live, create). */
export const byName = (channels: Channel[]) =>
  channels.toSorted((a, b) => a.name.localeCompare(b.name, language));

/**
 * What is collapsed (`key`: the "Chat channels" category, the channel panel). Remembered on this device, expanded at first.
 * In browsers that block storage (private windows, etc.) it only lasts for this tab.
 * The channel panel exists both in front (side column) and in the drawer, so the app frame holds one state and hands it to both.
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

/** Ids of the forums whose "my posts" are folded. Remembered on this device. */
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
 * Channel panel (mock 101): it always shows one place (one repo, or "All of <account>"), so there are no floor headers or repo groups, just two categories.
 * `channels` only gets that place's channels (`placeOf`).
 * "Chat channels": a collapsible header (name, chevron, `+` to create a channel) and the channel rows.
 * "Forum channels" (mock 55-D): under each forum row hang only the open posts that involve me (`mine`) as branches. A post that fits several forums hangs under each of them.
 * A forum with my posts folds with the chevron at the end of its row; folded, it keeps the count and the new-post dot. Settled posts drop out, and a post with new activity gets bold text and a dot.
 * With `other`, an "Other posts" row for posts that fit no forum sits after a divider below the forums. `+` creates a forum.
 * Channel rows are links that change `#channel id` in the address, so they open in a new tab and Back returns to the previous channel. A branch is `#forum id/alert number`.
 * Even when folded, the currently selected row stays.
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
  /** Show the "Other posts" row. */
  other: boolean;
  current?: string;
  /** Alert number of the open post */
  post?: number;
  posts?: PostItem[];
  unread: (post: PostItem) => boolean;
  /** Does the post involve me: my Work is on it, or I wrote in it. */
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
                    <span className="unread-dot" role="img" aria-label={t.channels.panel.unread} />
                  )}
                </>
              )}
            </a>
            {!forumCollapsed && branches.length > 0 && (
              <button
                type="button"
                className="forum-fold"
                aria-expanded={!shut}
                aria-label={t.channels.panel.foldMyPosts(channel.name, shut)}
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
            <ul className="branches" aria-label={t.channels.panel.myPosts(channel.name)}>
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
                      <span
                        className="unread-dot"
                        role="img"
                        aria-label={t.channels.panel.unread}
                      />
                    )}
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
        title={t.channels.panel.chatTitle}
        collapsed={collapsed}
        onToggle={onToggle}
        add={{ label: t.channels.panel.createChat, onClick: onCreate }}
      >
        {chatRows}
      </Category>
      {channels && (
        <Category
          title={t.channels.panel.forumTitle}
          collapsed={forumCollapsed}
          onToggle={onForumToggle}
          add={{ label: t.channels.panel.createForum, onClick: onCreateForum }}
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

/** A collapsible category header and the rows under it. With `add`, a `+` sits at the right end. */
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
 * Account avatar (mock 101): uses the GitHub avatar, a rounded square for organizations and a circle for personal accounts (same as GitHub).
 * If there's no avatar or it fails to load, the first letter of the account name is used.
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

/** Which account groups are expanded. Remembered on this device; at first only the account being viewed is open. */
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
  place === ALL ? t.channels.place.allOf(space.name) : repoName(place);

/**
 * The name row at the top of the channel panel and the repo picker menu (mocks 101-1, 101-3). The name row has the account avatar, a small account name, and a bold repo name or "All",
 * with a dot if there are new posts elsewhere. Clicking it opens the menu right below: a repo search field, a group per account that folds
 * ("All of <account>" if there are two or more repos, one row per repo, and "Add a repo" at the end if I'm Admin of some repo), and a ⋯ menu on the rows of repos I'm Admin of.
 * `action` (fold the channel panel) stays at the right end.
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
  /** The place being viewed: a repo name or `ALL` */
  place: string;
  /** Is there anything new in that place of the current account. New posts on other accounts aren't known yet. */
  fresh: (place: string) => boolean;
  /** The repos I'm Admin of, per account. Missing means not loaded yet. */
  admin: Record<string, AdminRepo[] | "error" | undefined>;
  action?: ReactNode;
  /** When an account group is shown expanded, load that account's Admin repos. */
  onAdmin: (workspace: string) => void;
  onPick: (workspace: string, place: string) => void;
  onAddRepo: (workspace: string) => void;
  onRemoveRepo: (workspace: string, repo: string) => Promise<void>;
}) {
  const { open, setOpen, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const [query, setQuery] = useState("");
  const [isOpen, toggle] = useAccountOpen(current.id);
  /** The repo whose ⋯ menu is open */
  const [more, setMore] = useState<string>();
  const found = (repo: string) => repoName(repo).toLowerCase().includes(query.trim().toLowerCase());
  const places = (space: Space) => (space.repos.length > 1 ? [ALL, ...space.repos] : space.repos);
  const elsewhere = places(current).some((other) => other !== place && fresh(other));
  // Load the Admin repos of the accounts shown expanded ("Add a repo" and ⋯ hang on them).
  const shown = open ? workspaces.filter((space) => query.trim() || isOpen(space.id)) : [];
  const missing = shown.filter((space) => admin[space.id] === undefined).map((space) => space.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only load when the not-yet-loaded accounts change
  useEffect(() => {
    for (const id of missing) onAdmin(id);
  }, [missing.join()]);
  const adminOf = (space: Space) => {
    const list = admin[space.id];
    return Array.isArray(list) ? list : [];
  };
  return (
    <div className="workspace picker">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: one place takes the keys for the menu and buttons inside */}
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
            <h1>{place === ALL ? t.channels.place.all : repoName(place)}</h1>
          </span>
          {elsewhere && (
            <span className="unread-dot" role="img" aria-label={t.channels.place.elsewhere} />
          )}
          <ChevronsUpDown size={14} aria-hidden />
        </button>
        {open && (
          <div
            className="forum-menu place-menu"
            id={menu}
            role="menu"
            aria-label={t.channels.place.menu}
          >
            <label className="place-search">
              <Search size={14} aria-hidden />
              <input
                type="search"
                placeholder={t.channels.place.find}
                aria-label={t.channels.place.find}
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
                        <small className="pop-aside">
                          {t.channels.place.repoCount(space.repos.length)}
                        </small>
                        {news && (
                          <span
                            className="unread-dot"
                            role="img"
                            aria-label={t.channels.panel.unread}
                          />
                        )}
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
                              <span
                                className="unread-dot"
                                role="img"
                                aria-label={t.channels.panel.unread}
                              />
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
                      <span className="pop-name">{t.channels.place.add}</span>
                    </button>
                  )}
                </section>
              );
            })}
            <hr />
            <p className="pop-note">{t.channels.place.note}</p>
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * The ⋯ menu on a repo row (mocks 101-1, 91-C): "Open on GitHub" and "Remove from workspace". Removing takes one more click to confirm.
 * Only that repo's Admin sees it.
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
        aria-label={t.channels.repoMenu.label}
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
        <div
          className="forum-menu repo-menu"
          id={menu}
          role="menu"
          aria-label={t.channels.repoMenu.label}
        >
          <a
            role="menuitem"
            className="menu-item pop-row"
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
            tabIndex={-1}
          >
            <ExternalLink size={16} aria-hidden />
            <span className="pop-name">{t.channels.repoMenu.openGithub}</span>
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
                ? t.channels.repoMenu.confirmRemove
                : t.channels.repoMenu.remove}
            </span>
          </button>
          {removing === "error" && (
            <p className="pop-note error" role="alert">
              {t.channels.repoMenu.removeFailed}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export type AdminRepo = Awaited<ReturnType<typeof call<typeof api.adminRepos>>>["repos"][number];

/**
 * The "Add a repo" dialog (mock 91-A): only this account's repos where I'm Admin show, and the ones not added yet have an "Add" button.
 * Removing is done from the repo ⋯ menu in the channel panel (mock 91-C).
 */
export function RepoDialog({
  dialog,
  account,
  repos,
  install,
  onAdd,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  /** The account whose "Add a repo" was clicked in the menu */
  account: Space;
  /** Missing means loading; `"error"` means GitHub couldn't be read. */
  repos?: AdminRepo[] | "error";
  /** Where to install the server's GitHub App. A repo without the App isn't listed (ADR-0053). */
  install?: string;
  onAdd: (repo: string) => Promise<void>;
}) {
  const heading = useId();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState(false);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog handles Esc
    <dialog
      ref={dialog}
      className="dialog repo-dialog"
      aria-labelledby={heading}
      onClose={() => setError(false)}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <h2 id={heading}>{t.channels.addRepo.title}</h2>
      <p className="dialog-lead">{t.channels.addRepo.lead}</p>
      <p className="repo-account">
        <AccountMark space={account} size={22} />
        <strong>{account.name}</strong>
      </p>
      {repos === undefined ? (
        <p className="help" role="status" aria-busy="true">
          {t.channels.addRepo.loading}
        </p>
      ) : repos === "error" ? (
        <p className="help error" role="alert">
          {t.channels.addRepo.loadFailed}
        </p>
      ) : (
        <ul className="repo-pick">
          {repos.map((repo) => (
            <li key={repo.name}>
              <Book size={16} aria-hidden />
              <span className="repo-pick-name">
                <strong>{repoName(repo.name)}</strong>
                <small>{t.channels.addRepo.visibility(repo.private, repo.pushers)}</small>
              </span>
              {repo.added ? (
                <small className="repo-added">{t.channels.addRepo.added}</small>
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
                  {t.channels.addRepo.add}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="help error" role="alert">
          {t.channels.addRepo.addFailed}
        </p>
      )}
      {install && (
        <p className="help">
          {t.channels.addRepo.missing}{" "}
          <a className="settings-link" href={install} target="_blank" rel="noreferrer">
            {t.channels.addRepo.install} <ExternalLink size={12} aria-hidden />
          </a>
        </p>
      )}
      <p className="help">{t.channels.addRepo.other}</p>
      <div className="dialog-actions">
        <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
          {t.channels.addRepo.close}
        </button>
      </div>
    </dialog>
  );
}
