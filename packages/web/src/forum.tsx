import {
  ALERT_LABELS,
  type Alert,
  type Channel,
  type ChannelMessage,
  type ForumFilter,
  type Post,
  shows,
} from "@omagari/contract";
import {
  ArrowUpDown,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleQuestionMark,
  CircleX,
  GitMerge,
  Inbox,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Search,
} from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useReducer, useState } from "react";
import { fullTime, timeOf } from "./conversation.tsx";
import { useMenu } from "./dm.tsx";
import { ago, t } from "./i18n.ts";
import { type Draft, FilterRow, ImportanceBadge, LabelBadge } from "./labels.tsx";
import { type ListVerdict, listVerdict } from "./list-verdict.ts";
import { Person } from "./profile-card.tsx";
import { Avatar } from "./workspace.tsx";

export type AlertMessage = Extract<ChannelMessage, { kind: "alert" }>;
/** One post in the forum: a summary plus its first message, the alert. `edited` is when this screen saw the alert being edited. */
// ponytail: the contract has no edited time for alerts, so only edits seen while connected get "edited …". Use the contract time once it has one.
export type PostItem = Post & { message: AlertMessage; edited?: string };

/** Builds a post from an alert message. The alert line that arrives over the live connection is the post's new summary. */
export const postOf = (message: AlertMessage, edited?: string): PostItem => ({
  ...message.post,
  alert: message.id,
  message,
  edited,
});

/** Turns `api.posts` rows into posts. Non-alert rows never arrive, but this narrows the type. */
export const postsOf = (list: (Post & { message: ChannelMessage })[]) =>
  list.flatMap(({ message }) => (message.kind === "alert" ? [postOf(message)] : []));

/** Whether it was edited: a changed resolved time alone does not count as an edit. */
export const changed = (a: Alert, b: Alert) =>
  JSON.stringify({ ...a, resolved: null }) !== JSON.stringify({ ...b, resolved: null });

/** The stored (GitHub) label names of the alert kinds. Not screen text: that is `t.alertKinds`. */
export const KINDS = ALERT_LABELS;

const base = (path: string) => path.split("/").at(-1) ?? path;

/** The conflicting file or symbol: the first one named in the alert. */
const subject = (alert: Alert) =>
  alert.kind === "direct" ? alert.files[0] && base(alert.files[0].path) : alert.symbols[0]?.name;

/**
 * Post title: the issue title (ADR-0032). If the issue is not open yet, build it from the alert's file or symbol ("refund.ts").
 * The number ("#44") is drawn separately (`IssueNumber`). People stay out of the title and show on the card's people line (DESIGN.md mockup 27-B).
 */
export const postTitle = ({ issue, message: { alert } }: PostItem) =>
  issue?.title ?? subject(alert) ?? alert.works[0].branch;

/** Whether the post is resolved: the alert is resolved, or someone closed the issue on GitHub (ADR-0032). */
export const settled = (post: PostItem) =>
  post.message.alert.resolved !== null || post.issue?.open === false;

/** "Other posts": where posts that fit no forum are shown (mockup 55-D). The channel panel makes it, not a channel. */
export const OTHER: Channel = {
  id: "other",
  get name() {
    return t.forum.other;
  },
  kind: "forum",
};

/** Issue number "#44". A link to the GitHub issue. Not drawn when there is no issue. */
export const IssueNumber = ({ post, link = true }: { post: PostItem; link?: boolean }) =>
  post.issue &&
  (link ? (
    <a
      className="issue-number"
      href={post.issue.url}
      target="_blank"
      rel="noreferrer"
      title={t.forum.viewIssue}
    >
      #{post.issue.number}
    </a>
  ) : (
    <span className="issue-number">#{post.issue.number}</span>
  ));

/** Text the search box scans: people, branches, files, symbols. */
const haystack = (post: PostItem) => {
  const { alert } = post.message;
  const names = alert.works.flatMap((w) => [w.login, w.name, w.branch]);
  const things =
    alert.kind === "direct"
      ? alert.files.map((f) => f.path)
      : alert.symbols.flatMap((s) => [s.name, ...s.places.flat().map((p) => p.path)]);
  return [postTitle(post), ...post.labels, ...names, ...things].join("\n").toLowerCase();
};

/** Kind badge: direct conflict is orange, the rest are outlined, and indirect conflict gets "· estimated". */
export const KindBadge = ({
  kind,
  confirmed,
  plain,
}: {
  kind: Alert["kind"];
  confirmed?: boolean;
  plain?: boolean;
}) => (
  <span className={kind === "direct" || confirmed ? "badge warning" : "badge outline"}>
    {t.alertKinds[kind]}
    {kind === "indirect" && !plain && ` · ${confirmed ? t.forum.confirmed : t.forum.estimate}`}
  </span>
);

const VERDICT_ICONS = {
  estimate: CircleDashed,
  running: LoaderCircle,
  broken: CircleX,
  unclear: CircleQuestionMark,
  pass: CircleCheck,
  direct: CircleX,
} as const satisfies Record<ListVerdict, unknown>;

/** Verdict icon before the title (16px). Only broken and direct conflict use the warning color. */
const VerdictIcon = ({ verdict }: { verdict: ListVerdict }) => {
  const Icon = VERDICT_ICONS[verdict];
  return (
    <Icon
      className="verdict-icon"
      data-verdict={verdict}
      size={16}
      role="img"
      aria-label={t.verdict.list[verdict]}
    />
  );
};

/** The picked value remembered on this device. In a browser that blocks storage, it lasts only in this tab. */
function useSaved<T extends string>(key: string, options: readonly T[]) {
  const [value, set] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return options.find((option) => option === saved) ?? (options[0] as T);
    } catch {
      return options[0] as T;
    }
  });
  return [
    value,
    (next: T) => {
      set(next);
      try {
        localStorage.setItem(key, next);
      } catch {}
    },
  ] as const;
}

const SORTS = ["activity", "posted"] as const;
const VIEWS = ["list", "card"] as const;
/** Left side of the forum header: 20px forum icon, name, and helper text. "Other posts" uses an inbox icon. */
export const ForumTitle = ({ forum, solo = false }: { forum: Channel; solo?: boolean }) => {
  const Icon = forum.id === OTHER.id ? Inbox : MessagesSquare;
  return (
    <div className="channel-title">
      <h2>
        <Icon className="channel-mark" size={20} aria-hidden />
        <span>{forum.name}</span>
      </h2>
      <span className="channel-members forum-lead">
        {forum.id === OTHER.id ? t.forum.leadOther : solo ? t.forum.leadSolo : t.forum.lead}
      </span>
    </div>
  );
};

/**
 * Forum (DESIGN.md "Conflict forum"): search box, "Sort and view" menu and filter row, post list or cards. No input box.
 * A forum is a view filtered by labels (ADR-0039). A filter edited in the filter row is seen only by me until saved (mockup 53-D).
 * If `forum` is "Other posts", it shows posts that fit no forum and has no label filter.
 * A post row links to `#forum/alert number`, so it opens in a side panel and Back closes it.
 * Search scans people, branches, files, symbols, and labels. Status (open, resolved) lives only on this screen and starts as open.
 */
export function Forum({
  forum,
  posts,
  selected,
  unread,
  me,
  solo,
  account,
  repos,
  onSaveFilter,
}: {
  forum: Channel;
  /** I am the only member (mockup 100-A). The people line shows my two conflicting branches instead of people. */
  solo: boolean;
  /** The workspace account name */
  account: string;
  /** The repos in the workspace that I can see. The repo chips in the filter row pick them. */
  repos: string[];
  /** My GitHub ID. The people line shows "me" instead of my name. */
  me: string;
  /** All posts. This screen does the filtering. */
  posts?: PostItem[];
  selected?: number;
  unread: (post: PostItem) => boolean;
  onSaveFilter: (filter: ForumFilter) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useSaved("omagari.forum-sort", SORTS);
  const [view, setView] = useSaved("omagari.forum-view", VIEWS);
  const [states, setStates] = useState<Set<"open" | "resolved">>(new Set(["open"]));
  /** The filter being edited. If none, the one saved on the forum. */
  const [draft, setDraft] = useState<Draft>();
  const filter = forum.id === OTHER.id ? undefined : forum.filter;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 60_000); // lets "3m ago" tick
    return () => clearInterval(timer);
  }, []);
  const search = useId();

  const current = draft === undefined ? filter : draft;
  /** Posts that match the forum's filter, before filtering by status and search text. */
  const inForum = useMemo(
    () =>
      posts?.filter((post) =>
        forum.id === OTHER.id ? post.forums.length === 0 : !!current && shows(current, post),
      ),
    [posts, forum.id, current],
  );
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const time = (post: PostItem) =>
      Date.parse(sort === "activity" ? post.activity : post.message.at);
    return (inForum ?? [])
      .filter(
        (post) =>
          (states.size === 0 || states.has(settled(post) ? "resolved" : "open")) &&
          (!needle || haystack(post).includes(needle)),
      )
      .sort((a, b) => time(b) - time(a));
  }, [inForum, query, sort, states]);

  const open = inForum?.filter((post) => !settled(post)).length ?? 0;
  const counts = { open, resolved: (inForum?.length ?? 0) - open };

  return (
    <div className="forum">
      <div className="forum-search">
        <Search size={18} aria-hidden />
        <input
          id={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.forum.searchHint}
          aria-label={t.forum.search}
          autoComplete="off"
        />
      </div>
      <div className="forum-tools">
        <ViewMenu sort={sort} view={view} onSort={setSort} onView={setView} />
        <span className="forum-rule" aria-hidden />
        <FilterRow
          account={account}
          repos={repos}
          states={states}
          counts={counts}
          onStates={setStates}
          filter={filter}
          draft={current ?? null}
          onDraft={setDraft}
          onSave={onSaveFilter}
        />
      </div>
      {inForum === undefined ? (
        <div className="empty" role="status" aria-busy="true">
          <p>{t.forum.loading}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <h2>{inForum.length === 0 ? t.forum.emptyForum : t.forum.emptySearch}</h2>
          <p>{inForum.length === 0 ? t.forum.emptyForumHint : t.forum.emptySearchHint}</p>
        </div>
      ) : (
        <ul className={view === "card" ? "forum-list cards" : "forum-list"}>
          {shown.map((post) => (
            <li key={post.alert}>
              <PostRow
                forum={forum.id}
                post={post}
                selected={post.alert === selected}
                unread={unread(post)}
                me={me}
                solo={solo}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Sort and view" menu: sort (recent activity, posted time) and view (list, cards). The choice stays on this device. */
function ViewMenu<S extends string, V extends string>({
  sort,
  view,
  onSort,
  onView,
}: {
  sort: S;
  view: V;
  onSort: (sort: S) => void;
  onView: (view: V) => void;
}) {
  const { open, setOpen, close, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const group = (
    title: string,
    options: readonly (readonly [string, string])[],
    value: string,
    pick: (id: never) => void,
  ) => (
    <>
      <p className="menu-title">{title}</p>
      {options.map(([id, name]) => (
        <button
          key={id}
          type="button"
          role="menuitemradio"
          aria-checked={id === value}
          className="menu-item"
          tabIndex={-1}
          onClick={() => {
            pick(id as never);
            close();
          }}
        >
          {name}
        </button>
      ))}
    </>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: one place handles keys for the menu and buttons inside
    <div className="forum-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="tag-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <ArrowUpDown size={14} aria-hidden />
        {t.forum.sortAndView}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="forum-menu" id={menu} role="menu" aria-label={t.forum.sortAndView}>
          {group(
            t.forum.sort,
            SORTS.map((id) => [id, t.forum.sorts[id]] as const),
            sort,
            onSort as (id: never) => void,
          )}
          <hr />
          {group(
            t.forum.view,
            VIEWS.map((id) => [id, t.forum.views[id]] as const),
            view,
            onView as (id: never) => void,
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One post card (four lines in list and card views): title, kind badge, last message line, people line with message count and time.
 * With new messages the title is bold and has a dot. Resolved posts are dimmed and lead with a "Resolved" badge.
 */
function PostRow({
  forum,
  post,
  selected,
  unread,
  me,
  solo,
}: {
  /** The forum being viewed. Even if a post shows in several forums, it opens in this one. */
  forum: string;
  post: PostItem;
  selected: boolean;
  unread: boolean;
  me: string;
  solo: boolean;
}) {
  const { alert } = post.message;
  const resolved = settled(post);
  const kind = KINDS[alert.kind];
  const verdict = listVerdict(alert);
  return (
    <a
      className="forum-post"
      href={`#${forum}/${post.alert}`}
      aria-current={selected ? "true" : undefined}
      data-resolved={resolved || undefined}
    >
      <span className="forum-post-title">
        {resolved && <span className="badge outline">{t.forum.resolved}</span>}
        {verdict && <VerdictIcon verdict={verdict} />}
        <strong className="forum-post-name">{postTitle(post)}</strong>
        <IssueNumber post={post} link={false} />
        {unread && <span className="unread-dot" role="img" aria-label={t.forum.newPost} />}
      </span>
      <span className="forum-post-tags">
        <KindBadge kind={alert.kind} plain />
        {verdict && verdict !== "direct" && (
          <span className={verdict === "broken" ? "badge warning" : "badge outline"}>
            {t.verdict.list[verdict]}
          </span>
        )}
        {post.labels
          .filter((label) => label !== kind)
          .map((label) => (
            <LabelBadge key={label} name={label} />
          ))}
      </span>
      <span className="forum-post-last">
        {post.last ? (
          <>
            <strong className="forum-post-who">
              <Person login={post.last.login} inLink>
                {post.last.name}
              </Person>
              :
            </strong>{" "}
            {post.last.line}
          </>
        ) : (
          t.forum.noMessages
        )}
      </span>
      <span className="forum-post-meta">
        {solo ? (
          // Alone, the conflict is between my own branches (mockup 100-A).
          <span className="forum-post-branches">
            {alert.works.map((work) => work.branch).join(" ↔ ")}
          </span>
        ) : (
          <span className="forum-post-people">
            {alert.works.map((work) => (
              <Person key={work.login} login={work.login} inLink>
                <Avatar name={work.name} login={work.login} size={22} />
              </Person>
            ))}
            <span className="forum-post-names">
              {alert.works.map((work, i) => (
                <Fragment key={work.login}>
                  {i > 0 && " · "}
                  <Person login={work.login} inLink>
                    {work.login === me ? t.forum.me : work.name}
                  </Person>
                </Fragment>
              ))}
            </span>
          </span>
        )}
        <span aria-hidden>·</span>
        <MessageCircle size={16} aria-hidden />
        <span className="sr-only">{t.forum.messages} </span>
        {post.count}
        <time dateTime={post.activity} title={fullTime(post.activity)}>
          · {ago(post.activity)}
        </time>
      </span>
    </a>
  );
}

/** Line range: 12–18. A single line shows just that line. */
const ranges = (lines: { from: number; to: number }[]) =>
  lines.map(({ from, to }) => (from === to ? `${from}` : `${from}–${to}`)).join(", ");

/** One line per place the alert points to: direct conflict shows the file and conflicting lines, the rest show the symbol and where. */
function where(alert: Alert) {
  const rows =
    alert.kind === "direct"
      ? alert.files.map((file) =>
          "lines" in file
            ? `${file.path}${file.lines[0].length ? (/[–,]/.test(ranges(file.lines[0])) ? t.forum.lines : t.forum.line)(ranges(file.lines[0])) : ""}`
            : `${file.path} · ${t.forum.mayCollide}`,
        )
      : alert.symbols.map((symbol) => {
          const place = symbol.places[0][0] ?? symbol.places[1][0];
          return place ? `${symbol.name} · ${place.path}:${place.line}` : symbol.name;
        });
  return alert.more > 0 ? [...rows, t.forum.moreSpots(alert.more)] : rows;
}

/**
 * First message of a post: the Omagari alert (DESIGN.md "Post"). A message shape with an Omagari mark instead of an avatar,
 * and the body is an alert card: kind badge, two people and branches, file and line range. If edited, "edited …" follows the time.
 */
export function AlertLine({ message, edited }: { message: AlertMessage; edited?: string }) {
  const { alert } = message;
  const [a, b] = alert.works;
  return (
    <article className="message">
      <span className="omagari-mark" aria-hidden>
        <GitMerge size={18} />
      </span>
      <div className="message-body">
        <p className="message-head">
          <strong>Omagari</strong>
          <time dateTime={message.at} title={fullTime(message.at)}>
            {timeOf(message.at)}
          </time>
          {edited && (
            <time dateTime={edited} title={fullTime(edited)}>
              {t.forum.editedAt(timeOf(edited))}
            </time>
          )}
        </p>
        <div className="alert-card">
          <p className="alert-kind">
            <KindBadge kind={alert.kind} confirmed={alert.kind === "indirect" && alert.confirmed} />
            {alert.resolved && <span className="badge outline">{t.forum.resolved}</span>}
            {message.post.labels
              .filter((label) => label !== KINDS[alert.kind])
              .map((label) => (
                <LabelBadge key={label} name={label} />
              ))}
            {message.post.importance === "discuss" && <ImportanceBadge importance="discuss" />}
          </p>
          <p className="alert-mono">
            {a.name} · {a.branch} ↔ {b.name} · {b.branch}
          </p>
          {where(alert).map((row) => (
            <p key={row} className="alert-mono">
              {row}
            </p>
          ))}
        </div>
      </div>
    </article>
  );
}
