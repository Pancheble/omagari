import { ALERT_LABELS, type Alert, ago, type ChannelMessage, type Post } from "@omagari/contract";
import {
  ArrowUpDown,
  ChevronDown,
  GitMerge,
  MessageCircle,
  MessagesSquare,
  Search,
} from "lucide-react";
import { useEffect, useId, useMemo, useReducer, useState } from "react";
import { fullTime, timeOf } from "./conversation.tsx";
import { useMenu } from "./dm.tsx";
import { Avatar } from "./workspace.tsx";

export type AlertMessage = Extract<ChannelMessage, { kind: "alert" }>;
/** 포럼의 포스트 하나: 요약과 첫 글인 알림. `edited`는 알림이 고쳐지는 것을 이 화면이 본 시각이다. */
// ponytail: 계약에 알림을 고친 시각이 없어, 연결된 동안 본 것만 "…에 고침"이 붙는다. 계약이 시각을 주면 그것을 쓴다.
export type PostItem = Post & { message: AlertMessage; edited?: string };

/** 알림 메시지에서 포스트를 만든다. 실시간 연결로 온 알림 줄이 곧 그 포스트의 바뀐 요약이다. */
export const postOf = (message: AlertMessage, edited?: string): PostItem => ({
  ...message.post,
  alert: message.id,
  message,
  edited,
});

/** `api.posts`의 줄들을 포스트로. 알림이 아닌 줄은 오지 않지만 타입을 좁힌다. */
export const postsOf = (list: (Post & { message: ChannelMessage })[]) =>
  list.flatMap(({ message }) => (message.kind === "alert" ? [postOf(message)] : []));

/** 고쳐졌는지: 풀린 시각만 달라진 것은 고친 것이 아니다. */
export const changed = (a: Alert, b: Alert) =>
  JSON.stringify({ ...a, resolved: null }) !== JSON.stringify({ ...b, resolved: null });

export const KINDS = ALERT_LABELS;

const base = (path: string) => path.split("/").at(-1) ?? path;

/** 부딪힌 파일이나 심볼. 알림에 적힌 첫 번째다. */
const subject = (alert: Alert) =>
  alert.kind === "direct" ? alert.files[0] && base(alert.files[0].path) : alert.symbols[0]?.name;

/**
 * 포스트의 제목: 이슈 제목(ADR-0032). 이슈를 아직 열지 못했으면 알림의 파일이나 심볼("refund.ts")에서 짓는다.
 * 번호("#44")는 따로 그린다(`IssueNumber`). 사람은 제목에 넣지 않고 카드의 사람 줄에 따로 보인다(DESIGN.md 시안 27-B).
 */
export const postTitle = ({ issue, message: { alert } }: PostItem) =>
  issue?.title ?? subject(alert) ?? alert.works[0].branch;

/** 포스트가 풀렸나: 알림이 풀렸거나, 사람이 GitHub에서 이슈를 닫았다(ADR-0032). */
export const settled = (post: PostItem) =>
  post.message.alert.resolved !== null || post.issue?.open === false;

/** 포스트의 거르기 태그: 이슈 라벨. 이슈를 아직 열지 못했으면 Omagari가 열 때 달 종류 라벨이다. */
const labelsOf = (post: PostItem) => post.issue?.labels ?? [KINDS[post.message.alert.kind]];

/** 이슈 번호 "#44". GitHub의 이슈로 가는 링크다. 이슈가 없으면 그리지 않는다. */
export const IssueNumber = ({ post, link = true }: { post: PostItem; link?: boolean }) =>
  post.issue &&
  (link ? (
    <a
      className="issue-number"
      href={post.issue.url}
      target="_blank"
      rel="noreferrer"
      title="GitHub에서 이슈 보기"
    >
      #{post.issue.number}
    </a>
  ) : (
    <span className="issue-number">#{post.issue.number}</span>
  ));

/** 찾기 칸이 훑는 글: 사람, 브랜치, 파일, 심볼. */
const haystack = (post: PostItem) => {
  const { alert } = post.message;
  const names = alert.works.flatMap((w) => [w.login, w.name, w.branch]);
  const things =
    alert.kind === "direct"
      ? alert.files.map((f) => f.path)
      : alert.symbols.flatMap((s) => [s.name, ...s.places.flat().map((p) => p.path)]);
  return [postTitle(post), ...labelsOf(post), ...names, ...things].join("\n").toLowerCase();
};

/** 종류 배지: 직접 충돌은 주황, 나머지는 테두리, 간접 충돌은 "· 추정"이 붙는다. */
export const KindBadge = ({ kind }: { kind: Alert["kind"] }) => (
  <span className={kind === "direct" ? "badge warning" : "badge outline"}>
    {KINDS[kind]}
    {kind === "indirect" && " · 추정"}
  </span>
);

/** 이 기기에 기억하는 고른 값. 저장소를 막아 둔 브라우저에서는 이 탭에서만 남는다. */
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

const SORTS = [
  ["activity", "최근 활동"],
  ["posted", "올라온 시각"],
] as const;
const VIEWS = [
  ["list", "목록"],
  ["card", "카드"],
] as const;
const STATES = [
  ["open", "열림"],
  ["resolved", "풀림"],
] as const;

/** 포럼 머리 띠의 왼쪽: 20px 포럼 아이콘, 이름, 보조 글. */
export const ForumTitle = ({ name }: { name: string }) => (
  <div className="channel-title">
    <h2>
      <MessagesSquare className="channel-mark" size={20} aria-hidden />
      <span>{name}</span>
    </h2>
    <span className="channel-members">Omagari가 알림을 포스트로 올려요</span>
  </div>
);

/**
 * 부딪힘 포럼(DESIGN.md "부딪힘 포럼"): 찾기 칸, "정렬과 보기" 메뉴와 태그, 포스트 목록이나 카드. 입력 칸은 없다.
 * 포스트 줄은 `#포럼/알림 번호`로 가는 링크라 옆 칸으로 열리고 뒤로 가기가 닫는다.
 * 찾기는 사람, 브랜치, 파일, 심볼, 라벨을 훑는다. 태그는 열림·풀림과 이슈 라벨(ADR-0032)이고, 켠 것이 없는 묶음은 거르지 않는다.
 * 라벨을 여럿 켜면 그 가운데 하나라도 단 포스트가 보인다.
 */
export function Forum({
  posts,
  selected,
  unread,
}: {
  posts?: PostItem[];
  selected?: number;
  unread: (post: PostItem) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useSaved(
    "omagari.forum-sort",
    SORTS.map(([id]) => id),
  );
  const [view, setView] = useSaved(
    "omagari.forum-view",
    VIEWS.map(([id]) => id),
  );
  const [states, setStates] = useState<Set<string>>(new Set(["open"]));
  const [labels, setLabels] = useState<Set<string>>(new Set());
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 60_000); // "3분 전"이 흐르게
    return () => clearInterval(timer);
  }, []);
  const search = useId();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const time = (post: PostItem) =>
      Date.parse(sort === "activity" ? post.activity : post.message.at);
    return (posts ?? [])
      .filter(
        (post) =>
          (states.size === 0 || states.has(settled(post) ? "resolved" : "open")) &&
          (labels.size === 0 || labelsOf(post).some((label) => labels.has(label))) &&
          (!needle || haystack(post).includes(needle)),
      )
      .sort((a, b) => time(b) - time(a));
  }, [posts, query, sort, states, labels]);

  const toggle = (set: Set<string>, put: (next: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    put(next);
  };
  const open = posts?.filter((post) => !settled(post)).length ?? 0;
  const count = { open, resolved: (posts?.length ?? 0) - open };
  /** 포스트들의 라벨, 처음 나온 순서. 켜 둔 라벨은 단 포스트가 없어져도 남겨 끌 수 있게 한다. */
  const allLabels = [...new Set([...(posts ?? []).flatMap(labelsOf), ...labels])];

  return (
    <div className="forum">
      <div className="forum-search">
        <Search size={18} aria-hidden />
        <input
          id={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="포스트 찾기 (사람, 파일, 함수)"
          aria-label="포스트 찾기"
          autoComplete="off"
        />
      </div>
      <div className="forum-tools">
        <ViewMenu sort={sort} view={view} onSort={setSort} onView={setView} />
        <span className="forum-rule" aria-hidden />
        <fieldset className="forum-tags">
          <legend className="sr-only">포스트 거르기</legend>
          {STATES.map(([id, name]) => (
            <Tag key={id} on={states.has(id)} onClick={() => toggle(states, setStates, id)}>
              {name} {count[id]}
            </Tag>
          ))}
          {allLabels.map((label) => (
            <Tag
              key={label}
              on={labels.has(label)}
              onClick={() => toggle(labels, setLabels, label)}
            >
              {label}
            </Tag>
          ))}
        </fieldset>
      </div>
      {posts === undefined ? (
        <div className="empty" role="status" aria-busy="true">
          <p>포스트를 불러오는 중…</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <h2>{posts.length === 0 ? "아직 부딪힘이 없어요" : "맞는 포스트가 없어요"}</h2>
          <p>
            {posts.length === 0
              ? "작업이 부딪히면 Omagari가 여기에 포스트로 올려요."
              : "찾는 말이나 태그를 바꿔 보세요."}
          </p>
        </div>
      ) : (
        <ul className={view === "card" ? "forum-list cards" : "forum-list"}>
          {shown.map((post) => (
            <li key={post.alert}>
              <PostRow post={post} selected={post.alert === selected} unread={unread(post)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Tag = ({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button type="button" className="tag-chip" aria-pressed={on} onClick={onClick}>
    {children}
  </button>
);

/** "정렬과 보기" 메뉴: 정렬(최근 활동, 올라온 시각)과 보기(목록, 카드). 고른 것은 이 기기에 남는다. */
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
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다
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
        정렬과 보기
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="forum-menu" id={menu} role="menu" aria-label="정렬과 보기">
          {group("정렬", SORTS, sort, onSort as (id: never) => void)}
          <hr />
          {group("보기", VIEWS, view, onView as (id: never) => void)}
        </div>
      )}
    </div>
  );
}

/**
 * 포스트 한 장(목록 보기와 카드 보기의 네 줄): 제목, 종류 배지, 마지막 글 한 줄, 사람 줄과 글 수와 시각.
 * 새 글이 있으면 제목이 굵고 점이 붙는다. 풀린 포스트는 흐리고 "풀렸어요" 배지가 앞선다.
 */
function PostRow({
  post,
  selected,
  unread,
}: {
  post: PostItem;
  selected: boolean;
  unread: boolean;
}) {
  const { alert } = post.message;
  const resolved = settled(post);
  const kind = KINDS[alert.kind];
  return (
    <a
      className="forum-post"
      href={`#${post.message.channel}/${post.alert}`}
      aria-current={selected ? "true" : undefined}
      data-resolved={resolved || undefined}
    >
      <span className="forum-post-title">
        {resolved && <span className="badge outline">풀렸어요</span>}
        <strong className="forum-post-name">{postTitle(post)}</strong>
        <IssueNumber post={post} link={false} />
        {unread && <span className="unread-dot" role="img" aria-label="새 글" />}
      </span>
      <span className="forum-post-tags">
        <KindBadge kind={alert.kind} />
        {labelsOf(post)
          .filter((label) => label !== kind)
          .map((label) => (
            <span key={label} className="badge outline">
              {label}
            </span>
          ))}
      </span>
      <span className="forum-post-last">
        {post.last ? (
          <>
            <strong className="forum-post-who">{post.last.name}:</strong> {post.last.line}
          </>
        ) : (
          "아직 글이 없어요"
        )}
      </span>
      <span className="forum-post-meta">
        <span className="forum-post-people">
          {alert.works.map((work) => (
            <Avatar key={work.login} name={work.name} size={22} />
          ))}
          <span className="forum-post-names">
            {alert.works.map((work) => work.name).join(" · ")}
          </span>
        </span>
        <span aria-hidden>·</span>
        <MessageCircle size={16} aria-hidden />
        <span className="sr-only">글 </span>
        {post.count}
        <time dateTime={post.activity} title={fullTime(post.activity)}>
          · {ago(post.activity)}
        </time>
      </span>
    </a>
  );
}

/** 줄 범위: 12–18. 한 줄이면 그 줄만. */
const ranges = (lines: { from: number; to: number }[]) =>
  lines.map(({ from, to }) => (from === to ? `${from}` : `${from}–${to}`)).join(", ");

/** 알림이 가리키는 곳 한 줄씩: 직접 충돌은 파일과 부딪힌 줄, 나머지는 심볼과 그 곳. */
function where(alert: Alert) {
  const rows =
    alert.kind === "direct"
      ? alert.files.map((file) =>
          "lines" in file
            ? `${file.path}${file.lines[0].length ? ` · 줄 ${ranges(file.lines[0])}` : ""}`
            : `${file.path} · 부딪힐 수 있음`,
        )
      : alert.symbols.map((symbol) => {
          const place = symbol.places[0][0] ?? symbol.places[1][0];
          return place ? `${symbol.name} · ${place.path}:${place.line}` : symbol.name;
        });
  return alert.more > 0 ? [...rows, `…외 ${alert.more}곳`] : rows;
}

/**
 * 포스트의 첫 글: Omagari의 알림(DESIGN.md "포스트"). 메시지 모양에 아바타 대신 Omagari 표시를 달고,
 * 본문은 알림 카드다: 종류 배지, 두 사람과 브랜치, 파일과 줄 범위. 고쳐졌으면 시각 옆에 "…에 고침"이 붙는다.
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
              {timeOf(edited)}에 고침
            </time>
          )}
        </p>
        <div className="alert-card">
          <p className="alert-kind">
            <KindBadge kind={alert.kind} />
            {alert.resolved && <span className="badge outline">풀렸어요</span>}
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
