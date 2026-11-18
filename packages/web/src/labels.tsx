import {
  type Channel,
  ContractFailure,
  type ForumFilter,
  IMPORTANCE_LABELS,
  type Importance,
  type Label,
  MAX_CHANNEL_NAME_CHARS,
  shows,
} from "@omagari/contract";
import { Check, ChevronDown, Hash, Info, MessagesSquare, Search, Tag } from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useState,
} from "react";
import { repoName } from "./api.ts";
import { useMenu } from "./dm.tsx";

/** 레포의 라벨 전부(ADR-0039). 앱 틀이 읽고 실시간으로 갈아 끼운다. 배지가 색을 찾으려고 읽는다. */
export const LabelsContext = createContext<Label[]>([]);
export const useLabels = () => useContext(LabelsContext);

const IMPORTANCES: Importance[] = ["discuss", "reference"];

/** 라벨의 색 점(GitHub 라벨 색). 모르는 라벨은 회색이다. */
export const LabelDot = ({ color, size = 8 }: { color?: string; size?: 8 | 10 | 20 }) => (
  <span
    className="label-dot"
    style={{ width: size, height: size, background: `#${color ?? "c7c7cc"}` }}
    aria-hidden
  />
);

/** 라벨 배지(app-label-badge): 8px 색 점과 이름. */
export function LabelBadge({ name }: { name: string }) {
  const label = useLabels().find((other) => other.name === name);
  return (
    <span className="label-badge">
      <LabelDot color={label?.color} />
      {name}
    </span>
  );
}

/** 중요도 배지: 논의는 글자색 바탕(app-importance-discuss), 참고는 테두리. */
export const ImportanceBadge = ({ importance }: { importance: Importance }) => (
  <span className={importance === "discuss" ? "badge discuss" : "badge outline"}>
    {IMPORTANCE_LABELS[importance]}
  </span>
);

/** 찾는 말이 이름에 든 라벨. */
const matching = (labels: Label[], query: string) => {
  const needle = query.trim().toLowerCase();
  return labels.filter((label) => label.name.toLowerCase().includes(needle));
};

/** 체크 상자 모양(메뉴 줄 안). 실제 상태는 줄의 `aria-checked`가 말한다. */
const Box = ({ on }: { on: boolean }) => (
  <span className="check-box" data-on={on || undefined} aria-hidden>
    {on && <Check size={12} strokeWidth={3} />}
  </span>
);

const SearchField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="pop-search">
    <Search size={14} aria-hidden />
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="라벨 찾기"
      aria-label="라벨 찾기"
      autoComplete="off"
    />
  </div>
);

/**
 * 포스트 머리의 "라벨" 버튼과 창(시안 54-C). 체크하면 바로 붙고 떼진다(`onChange`가 서버에 보낸다).
 * 서버가 받지 않으면 창 아래에 알린다. 바뀐 라벨은 실시간 연결의 알림 줄로도 돌아온다.
 */
export function PostLabels({
  labels: on,
  issue,
  onChange,
}: {
  labels: string[];
  issue?: number;
  onChange: (labels: string[]) => Promise<void>;
}) {
  const labels = useLabels();
  const { open, setOpen, wrap, button, onKeyDown } = useMenu();
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const menu = useId();
  const toggle = async (name: string) => {
    setError(false);
    try {
      await onChange(on.includes(name) ? on.filter((other) => other !== name) : [...on, name]);
    } catch {
      setError(true);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다
    <div className="forum-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="header-button"
        aria-label="라벨"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <Tag size={18} aria-hidden />
      </button>
      {open && (
        <div className="forum-menu pop right" id={menu} role="menu" aria-label="라벨">
          <SearchField value={query} onChange={setQuery} />
          {matching(labels, query).map((label) => (
            <button
              key={label.name}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on.includes(label.name)}
              className="menu-item pop-row"
              tabIndex={-1}
              onClick={() => void toggle(label.name)}
            >
              <Box on={on.includes(label.name)} />
              <LabelDot color={label.color} size={10} />
              <span className="pop-name">{label.name}</span>
              <span className="pop-aside">{IMPORTANCE_LABELS[label.importance]}</span>
            </button>
          ))}
          <p className={error ? "pop-note error" : "pop-note"} aria-live="polite">
            {error
              ? "라벨을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요."
              : `${issue ? `이슈 #${issue}의 라벨도 같이 바뀌어요. ` : ""}논의 라벨이 하나라도 있으면 이 포스트는 논의예요.`}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 고치는 중인 필터. 계약의 필터는 중요도 하나(묶음)이거나 라벨 목록이다. 라벨을 다 끄면 비어(`null`) 저장할 수 없다.
 * 시안 53-D는 묶음에 라벨을 더할 수 있지만 계약이 받지 않아, 묶음을 켜면 라벨은 따로 고르지 못한다(PR #194에 까닭).
 */
export type Draft = ForumFilter | null;

/** 묶음을 켜고 끈다. 다른 묶음이 켜 있으면 바꾼다. */
const bundle = (draft: Draft, importance: Importance): Draft =>
  draft && "importance" in draft && draft.importance === importance ? null : { importance };

/** 라벨을 켜고 끈다. 묶음이 켜 있으면 그대로 둔다. */
const toggleLabel = (draft: Draft, name: string): Draft => {
  if (draft && "importance" in draft) return draft;
  const now = draft?.labels ?? [];
  const next = now.includes(name) ? now.filter((other) => other !== name) : [...now, name];
  return next.length ? { labels: next } : null;
};

/** 라벨이 필터에서 켜졌나, 묶음 때문에 잠겼나. */
const labelState = (draft: Draft, label: Label) =>
  draft && "importance" in draft
    ? { on: draft.importance === label.importance, locked: true }
    : { on: draft?.labels.includes(label.name) ?? false, locked: false };

/** 레포 조건을 바꾼다. 비면 모든 레포다(나중에 넣는 레포도 따라온다). 라벨을 고쳐도 레포 조건은 남는다. */
export const withRepos = (draft: ForumFilter, repos: string[]): ForumFilter => {
  const { repos: _, ...rest } = draft;
  return (repos.length ? { ...rest, repos } : rest) as ForumFilter;
};

/** 둘이 같은 필터인가. 라벨과 레포 순서는 따지지 않는다. */
export const sameFilter = (a: Draft | undefined, b: Draft | undefined) => {
  const key = (f: Draft | undefined) =>
    !f
      ? ""
      : `${"importance" in f ? f.importance : f.labels.toSorted().join("\n")}|${(f.repos ?? []).toSorted().join(",")}`;
  return key(a) === key(b);
};

/** 레포 칩의 값: "모두"나 레포 이름들. */
const reposWord = (repos: string[]) => (repos.length ? repos.map(repoName).join(", ") : "모두");

/** 레포 조건이 패널 어디에 보일지(ADR-0043): 레포 하나면 그 레포 밑, 아니면 워크스페이스 전체 밑이다. */
const placeNote = (repos: string[]) =>
  repos.length === 1
    ? `레포가 하나라 ${repoName(repos[0] as string)} 밑에 보여요.`
    : repos.length === 0
      ? "모든 레포라 워크스페이스 전체 밑에 보여요."
      : `레포가 ${["", "", "둘", "셋", "넷"][repos.length] ?? `${repos.length}개`}라 워크스페이스 전체 밑에 보여요.`;

/** 필터 칩에 쓰는 값: 색 점 셋까지와 "논의인 라벨 모두"나 라벨 이름. */
function FilterValue({ draft }: { draft: Draft }) {
  const labels = useLabels();
  if (!draft) return <span>없음</span>;
  const picked =
    "importance" in draft
      ? labels.filter((label) => label.importance === draft.importance)
      : draft.labels.map(
          (name) =>
            labels.find((label) => label.name === name) ?? {
              name,
              color: "c7c7cc",
              description: "",
              importance: "reference" as const,
            },
        );
  const names = picked.map((label) => label.name);
  return (
    <>
      <span className="dots">
        {picked.slice(0, 3).map((label) => (
          <LabelDot key={label.name} color={label.color} />
        ))}
      </span>
      <span>
        {"importance" in draft
          ? `${IMPORTANCE_LABELS[draft.importance]}인 라벨 모두`
          : names.length > 2
            ? `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}`
            : names.join(", ")}
      </span>
    </>
  );
}

/**
 * 포럼의 필터 줄(시안 53-D): "상태"와 "라벨" 칩. 라벨 칩이 곧 포럼의 필터이고, 고치면 그 자리에서 목록이 바뀐다.
 * 저장된 필터와 달라지면 "되돌리기"와 "모두에게 저장"이 뜬다. 상태는 포럼의 필터가 아니라 이 화면에만 있다(계약에 없다).
 * `filter`가 없으면("다른 포스트") 라벨 칩이 없다.
 */
export function FilterRow({
  states,
  counts,
  onStates,
  filter,
  draft,
  repos,
  onDraft,
  onSave,
}: {
  /** 워크스페이스에서 내게 보이는 레포들. 레포 칩이 고른다. */
  repos: string[];
  states: Set<"open" | "resolved">;
  counts: Record<"open" | "resolved", number>;
  onStates: (states: Set<"open" | "resolved">) => void;
  filter?: ForumFilter;
  draft: Draft;
  onDraft: (draft: Draft | undefined) => void;
  onSave: (filter: ForumFilter) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const dirty = filter !== undefined && !sameFilter(draft, filter);
  /** 고치는 중인 레포 조건. 라벨을 다 꺼 필터가 비었으면 포럼의 것이다. */
  const picked = (draft ?? filter)?.repos ?? [];
  const reposChanged = reposWord(picked.toSorted()) !== reposWord((filter?.repos ?? []).toSorted());
  const pickRepos = (next: string[]) => draft && onDraft(withRepos(draft, next));
  const stateWords = (["open", "resolved"] as const)
    .filter((id) => states.has(id))
    .map((id) => STATE_WORDS[id]);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(false);
    try {
      await onSave(draft);
      onDraft(undefined);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="forum-tags filter-row">
      <legend className="sr-only">필터</legend>
      <Chip name="상태" value={<span>{stateWords.join(", ") || "모두"}</span>}>
        {(["open", "resolved"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={states.has(id)}
            className="menu-item pop-row"
            tabIndex={-1}
            onClick={() => {
              const next = new Set(states);
              if (!next.delete(id)) next.add(id);
              onStates(next);
            }}
          >
            <Box on={states.has(id)} />
            <span className="pop-name">{STATE_WORDS[id]}</span>
            <span className="pop-aside">{counts[id]}</span>
          </button>
        ))}
      </Chip>
      {filter && (
        <Chip name="레포" value={<span>{reposWord(picked)}</span>} changed={reposChanged}>
          <RepoOptions repos={repos} picked={picked} onPick={pickRepos} />
        </Chip>
      )}
      {filter && (
        <Chip
          name="라벨"
          value={<FilterValue draft={draft} />}
          changed={dirty && !reposChanged}
          wide
        >
          <FilterPicker
            draft={draft}
            onDraft={(next) => onDraft(next && withRepos(next, picked))}
          />
        </Chip>
      )}
      {dirty && (
        <span className="filter-dirty">
          <span className="filter-note" aria-live="polite">
            {error ? "저장하지 못했어요" : "포럼의 필터와 달라요"}
          </span>
          <button type="button" className="button outline small" onClick={() => onDraft(undefined)}>
            되돌리기
          </button>
          <button
            type="button"
            className="button primary small"
            disabled={busy || !draft}
            onClick={() => void save()}
          >
            모두에게 저장
          </button>
        </span>
      )}
    </fieldset>
  );
}

const STATE_WORDS = { open: "열림", resolved: "풀림" } as const;

/** 레포 칩의 창: "모든 레포"와 레포마다 한 줄. "모든 레포"를 켜면 레포는 꺼진다. */
function RepoOptions({
  repos,
  picked,
  onPick,
}: {
  repos: string[];
  picked: string[];
  onPick: (repos: string[]) => void;
}) {
  return (
    <>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={picked.length === 0}
        className="menu-item pop-row"
        tabIndex={-1}
        onClick={() => onPick([])}
      >
        <Box on={picked.length === 0} />
        <span className="pop-name">모든 레포</span>
      </button>
      {repos.map((repo) => (
        <button
          key={repo}
          type="button"
          role="menuitemcheckbox"
          aria-checked={picked.includes(repo)}
          className="menu-item pop-row"
          tabIndex={-1}
          onClick={() =>
            onPick(
              picked.includes(repo) ? picked.filter((other) => other !== repo) : [...picked, repo],
            )
          }
        >
          <Box on={picked.includes(repo)} />
          <span className="pop-name">{repoName(repo)}</span>
        </button>
      ))}
      <p className="pop-note">{placeNote(picked)}</p>
    </>
  );
}

/** 필터 칩: 이름(보조 글씨), 값, 꺾쇠. 누르면 바로 아래에 창이 열린다. */
function Chip({
  name,
  value,
  changed,
  wide,
  children,
}: {
  name: string;
  value: ReactNode;
  changed?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const { open, setOpen, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다
    <div className="forum-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="tag-chip filter-chip"
        data-changed={changed || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="filter-name">{name}</span>
        {value}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          className={wide ? "forum-menu pop wide" : "forum-menu pop"}
          id={menu}
          role="menu"
          aria-label={name}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** 라벨 칩의 창: 찾기 칸, 묶음 두 줄, 라벨마다 한 줄. */
function FilterPicker({ draft, onDraft }: { draft: Draft; onDraft: (draft: Draft) => void }) {
  const labels = useLabels();
  const [query, setQuery] = useState("");
  const bundled = draft !== null && "importance" in draft;
  return (
    <>
      <SearchField value={query} onChange={setQuery} />
      {IMPORTANCES.map((importance, index) => {
        const on = bundled && draft.importance === importance;
        return (
          <button
            key={importance}
            type="button"
            role="menuitemcheckbox"
            aria-checked={on}
            className="menu-item pop-row bundle"
            tabIndex={-1}
            onClick={() => onDraft(bundle(draft, importance))}
          >
            <Box on={on} />
            <span className="pop-name">
              중요도가 {IMPORTANCE_LABELS[importance]}인 라벨 모두
              {index === 0 && <small>라벨이 새로 생기거나 중요도가 바뀌면 따라와요</small>}
            </span>
          </button>
        );
      })}
      <hr />
      {matching(labels, query).map((label) => {
        const { on, locked } = labelState(draft, label);
        return (
          <button
            key={label.name}
            type="button"
            role="menuitemcheckbox"
            aria-checked={on}
            aria-disabled={locked || undefined}
            className="menu-item pop-row"
            data-locked={locked || undefined}
            tabIndex={-1}
            onClick={() => !locked && onDraft(toggleLabel(draft, label.name))}
          >
            <Box on={on} />
            <LabelDot color={label.color} size={10} />
            <span className="pop-name">{label.name}</span>
            {locked && on && (
              <span className="pop-aside">{IMPORTANCE_LABELS[label.importance]}</span>
            )}
          </button>
        );
      })}
      <p className="pop-note">
        {bundled
          ? "묶음을 켜면 라벨을 따로 고를 수 없어요. 묶음을 끄고 라벨을 골라 주세요."
          : "켠 라벨이 하나라도 붙은 포스트가 보여요"}
      </p>
    </>
  );
}

/** 만들 것의 종류. 카테고리의 `+`가 제 종류를 골라 둔 채로 연다(시안 88-A). */
export type CreateKind = "chat" | "forum";

/**
 * "만들기" 대화 상자(시안 88-A, 52). 맨 위에서 종류(채팅 채널, 포럼)를 고른다. 채팅 채널은 이름만,
 * 포럼은 이름과 필터(묶음 두 줄과 라벨 칩)를 정하고 맞는 포스트를 미리 보인다.
 * `forum`을 주면 그 포럼을 고친다: 종류 고르기 없이 이름과 필터를 고치고 포럼을 지운다(시안에 없는 자리, PR #194에 까닭).
 */
export function ForumDialog({
  dialog,
  forum,
  posts,
  repos,
  kind = "forum",
  onKind,
  onCreateChat,
  onSave,
  onDelete,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  forum?: Channel;
  /** 미리 보기에 쓰는 포스트들과 그 제목 */
  posts: { labels: string[]; importance: Importance; repo: string; title: string }[];
  /** 워크스페이스에서 내게 보이는 레포들. 레포 칩이 고른다(시안 92-A). */
  repos: string[];
  /** 만들 때 고른 종류. `onKind`가 있으면 종류 고르기가 선다. */
  kind?: CreateKind;
  onKind?: (kind: CreateKind) => void;
  onCreateChat?: (name: string) => Promise<void>;
  onSave: (name: string, filter: ForumFilter) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const labels = useLabels();
  const [name, setName] = useState(forum?.name ?? "");
  const [draft, setDraft] = useState<Draft>(forum?.filter ?? null);
  /** 레포 조건. 비면 "모든 레포"다. 처음에는 모든 레포다. */
  const [picked, setPicked] = useState<string[]>(forum?.filter?.repos ?? []);
  const full = draft && withRepos(draft, picked);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const heading = useId();
  const input = useId();
  const help = useId();
  const chat = kind === "chat";
  const matched = full ? posts.filter((post) => shows(full, post)) : [];

  const run = async (act: () => Promise<void>) => {
    setBusy(true);
    try {
      await act();
      dialog.current?.close();
    } catch (failure) {
      setError(
        failure instanceof ContractFailure && failure.code === "conflict"
          ? "같은 이름의 채널이나 포럼이 이미 있어요. 다른 이름을 써 주세요."
          : `${chat ? "채널을 만들지" : "포럼을 저장하지"} 못했어요. 잠시 뒤 다시 시도해 주세요.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chat) void run(() => onCreateChat?.(name.trim()) ?? Promise.resolve());
    else if (full) void run(() => onSave(name, full));
  };
  const bundled = draft !== null && "importance" in draft;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="dialog forum-dialog"
      aria-labelledby={heading}
      onClose={() => {
        setName(forum?.name ?? "");
        setDraft(forum?.filter ?? null);
        setPicked(forum?.filter?.repos ?? []);
        setError(undefined);
        setDeleting(false);
      }}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={heading}>{forum ? "포럼 고치기" : onKind ? "만들기" : "포럼 만들기"}</h2>
        {onKind && (
          <fieldset className="kind-pick">
            <legend>종류</legend>
            {KINDS.map(({ value, Icon, name: title, note }) => (
              <label key={value} className="kind-card">
                <input
                  type="radio"
                  name="create-kind"
                  checked={kind === value}
                  onChange={() => {
                    onKind(value);
                    setError(undefined);
                  }}
                />
                <Icon size={18} aria-hidden />
                <strong>{title}</strong>
                <small>{note}</small>
              </label>
            ))}
          </fieldset>
        )}
        {!chat && (
          <p className="dialog-lead">
            포럼은 라벨로 거른 보기예요. 필터는 만든 뒤에도 포럼의 필터 줄에서 고쳐요.
          </p>
        )}
        <div className="field">
          <label htmlFor={input}>이름</label>
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
            aria-describedby={chat ? help : undefined}
          />
          {chat && (
            <p id={help} className={error ? "help error" : "help"} aria-live="polite">
              {error ?? "멤버 모두가 읽고 쓰는 채팅 채널이에요."}
            </p>
          )}
        </div>
        {!chat && (
          <fieldset className="field forum-dialog-repos">
            <legend>레포</legend>
            <div className="dialog-chips">
              <button
                type="button"
                className="tag-chip"
                aria-pressed={picked.length === 0}
                onClick={() => setPicked([])}
              >
                {picked.length === 0 && <Check size={14} aria-hidden />}
                모든 레포
              </button>
              {repos.map((repo) => {
                const on = picked.includes(repo);
                return (
                  <button
                    key={repo}
                    type="button"
                    className="tag-chip"
                    aria-pressed={on}
                    title={repo}
                    onClick={() =>
                      setPicked(on ? picked.filter((other) => other !== repo) : [...picked, repo])
                    }
                  >
                    {on && <Check size={14} aria-hidden />}
                    {repoName(repo)}
                  </button>
                );
              })}
            </div>
            <p className="place-note">
              <Info size={14} aria-hidden />
              {placeNote(picked)}
            </p>
          </fieldset>
        )}
        {!chat && (
          <>
            <fieldset className="field forum-dialog-filter">
              <legend>필터</legend>
              {IMPORTANCES.map((importance, index) => (
                <label key={importance} className="bundle-check">
                  <input
                    type="checkbox"
                    checked={bundled && draft.importance === importance}
                    onChange={() => setDraft(bundle(draft, importance))}
                  />
                  <span>
                    중요도가 {IMPORTANCE_LABELS[importance]}인 라벨 모두
                    {index === 0 && <small>라벨이 새로 생기거나 중요도가 바뀌면 따라와요</small>}
                  </span>
                </label>
              ))}
              <div className="dialog-chips">
                {labels.map((label) => {
                  const { on, locked } = labelState(draft, label);
                  return (
                    <button
                      key={label.name}
                      type="button"
                      className="tag-chip"
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => setDraft(toggleLabel(draft, label.name))}
                    >
                      <LabelDot color={label.color} />
                      {label.name}
                    </button>
                  );
                })}
              </div>
              <p className="help">
                {draft
                  ? `켠 라벨이 하나라도 붙은 포스트가 보여요. 지금 ${matched.length}개가 보여요.`
                  : "묶음이나 라벨을 하나 이상 켜 주세요."}
              </p>
            </fieldset>
            {matched.length > 0 && (
              <div className="forum-preview">
                <p>이렇게 보여요</p>
                <ul>
                  {matched.slice(0, 3).map((post, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 제목이 겹칠 수 있다
                    <li key={index}>{post.title}</li>
                  ))}
                </ul>
                {matched.length > 3 && <p>외 {matched.length - 3}개</p>}
              </div>
            )}
          </>
        )}
        {error && !chat && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {onDelete && (
            <button
              type="button"
              className="button quiet danger"
              disabled={busy}
              onClick={() => (deleting ? void run(onDelete) : setDeleting(true))}
            >
              {deleting ? "한 번 더 누르면 지워요" : "포럼 지우기"}
            </button>
          )}
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !name.trim() || (!chat && !draft)}
          >
            {forum ? "저장" : "만들기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const KINDS = [
  { value: "chat", Icon: Hash, name: "채팅 채널", note: "멤버가 메시지를 주고받아요" },
  { value: "forum", Icon: MessagesSquare, name: "포럼", note: "라벨로 거른 포스트를 모아 봐요" },
] as const;
