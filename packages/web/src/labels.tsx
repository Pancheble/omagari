import {
  type Channel,
  ContractFailure,
  type ForumFilter,
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
import { t } from "./i18n.ts";
import { onDark } from "./label-color.ts";
import { look, useLook } from "./theme.ts";

/** All labels in the repo (ADR-0039). The app shell reads and live-swaps them. Badges read them to find a color. */
export const LabelsContext = createContext<Label[]>([]);
export const useLabels = () => useContext(LabelsContext);

const IMPORTANCES: Importance[] = ["discuss", "reference"];

/**
 * A label's color dot (GitHub label color). Unknown labels are gray. On the dark screen it gets lighter until it
 * stands out (`onDark`), except with `asSet`: the label editor's color field shows the color the person set.
 */
export function LabelDot({
  color = "c7c7cc",
  size = 8,
  asSet = false,
}: {
  color?: string;
  size?: 8 | 10 | 20;
  asSet?: boolean;
}) {
  useLook();
  const shown = look() === "dark" && !asSet ? onDark(color) : color;
  return (
    <span
      className="label-dot"
      style={{ width: size, height: size, background: `#${shown}` }}
      aria-hidden
    />
  );
}

/** Label badge (app-label-badge): an 8px color dot and the name. */
export function LabelBadge({ name }: { name: string }) {
  const label = useLabels().find((other) => other.name === name);
  return (
    <span className="label-badge">
      <LabelDot color={label?.color} />
      {name}
    </span>
  );
}

/** Importance badge: Discuss is filled with the text color (app-importance-discuss), FYI is outlined. */
export const ImportanceBadge = ({ importance }: { importance: Importance }) => (
  <span className={importance === "discuss" ? "badge discuss" : "badge outline"}>
    {t.importance[importance]}
  </span>
);

/** Labels whose name contains the search text. */
const matching = (labels: Label[], query: string) => {
  const needle = query.trim().toLowerCase();
  return labels.filter((label) => label.name.toLowerCase().includes(needle));
};

/** Checkbox shape (inside a menu row). The real state comes from the row's `aria-checked`. */
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
      placeholder={t.forum.labelMenu.find}
      aria-label={t.forum.labelMenu.find}
      autoComplete="off"
    />
  </div>
);

/**
 * The "Label" button and popup in the post header (mockup 54-C). Checking applies it right away, unchecking removes it (`onChange` sends it to the server).
 * If the server rejects it, an alert shows under the popup. A changed label also comes back as an alert line over the live connection.
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
    // biome-ignore lint/a11y/noStaticElementInteractions: one place catches keys for the menu and buttons inside
    <div className="forum-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="header-button"
        aria-label={t.forum.labelMenu.button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <Tag size={18} aria-hidden />
      </button>
      {open && (
        <div
          className="forum-menu pop right"
          id={menu}
          role="menu"
          aria-label={t.forum.labelMenu.button}
        >
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
              <span className="pop-aside">{t.importance[label.importance]}</span>
            </button>
          ))}
          <p className={error ? "pop-note error" : "pop-note"} aria-live="polite">
            {error
              ? t.forum.labelMenu.failed
              : `${issue ? t.forum.labelMenu.issueToo(issue) : ""}${t.forum.labelMenu.note}`}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The filter being edited. A contract filter is either one importance (a bundle) or a label list. Turning every label off leaves it empty (`null`), which can't be saved.
 * Mockup 53-D can add labels to a bundle, but the contract doesn't accept that, so with a bundle on, labels can't be picked separately (reason in PR #194).
 */
export type Draft = ForumFilter | null;

/** Turns a bundle on or off. If another bundle is on, switches to this one. */
const bundle = (draft: Draft, importance: Importance): Draft =>
  draft && "importance" in draft && draft.importance === importance ? null : { importance };

/** Turns a label on or off. Leaves it as is if a bundle is on. */
const toggleLabel = (draft: Draft, name: string): Draft => {
  if (draft && "importance" in draft) return draft;
  const now = draft?.labels ?? [];
  const next = now.includes(name) ? now.filter((other) => other !== name) : [...now, name];
  return next.length ? { labels: next } : null;
};

/** Whether a label is on in the filter, or locked because of a bundle. */
const labelState = (draft: Draft, label: Label) =>
  draft && "importance" in draft
    ? { on: draft.importance === label.importance, locked: true }
    : { on: draft?.labels.includes(label.name) ?? false, locked: false };

/** Changes the repo condition. Empty means all repos (repos added later follow). Editing labels keeps the repo condition. */
export const withRepos = (draft: ForumFilter, repos: string[]): ForumFilter => {
  const { repos: _, ...rest } = draft;
  return (repos.length ? { ...rest, repos } : rest) as ForumFilter;
};

/** Whether the two are the same filter. Label and repo order don't matter. */
export const sameFilter = (a: Draft | undefined, b: Draft | undefined) => {
  const key = (f: Draft | undefined) =>
    !f
      ? ""
      : `${"importance" in f ? f.importance : f.labels.toSorted().join("\n")}|${(f.repos ?? []).toSorted().join(",")}`;
  return key(a) === key(b);
};

/** The repo chip's value: "All" or the repo names. */
const reposWord = (repos: string[]) =>
  repos.length ? repos.map(repoName).join(", ") : t.forum.filter.all;

/**
 * Where the repo condition shows in the panel (ADR-0043, mockup 101): the repo if it's one, otherwise "All of <account>".
 * An account with only one repo has no "All", so it shows under that repo.
 */
export const placeNote = (picked: string[], account: string, repos: string[]) =>
  repos.length < 2
    ? t.forum.filter.onlyRepo(repoName(repos[0] ?? account))
    : picked.length === 1
      ? t.forum.filter.oneRepo(repoName(picked[0] as string))
      : picked.length === 0
        ? t.forum.filter.everyRepo(account)
        : t.forum.filter.someRepos(picked.length, account);

/** The value for the filter chip: up to three color dots and "All Discuss labels" or the label name. */
function FilterValue({ draft }: { draft: Draft }) {
  const labels = useLabels();
  if (!draft) return <span>{t.forum.filter.none}</span>;
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
          ? t.forum.filter.allOfImportance(t.importance[draft.importance])
          : names.length > 2
            ? t.forum.filter.and(names.slice(0, 2).join(", "), names.length - 2)
            : names.join(", ")}
      </span>
    </>
  );
}

/**
 * The forum's filter row (mockup 53-D): the "Status" and "Label" chips. The label chip is the forum's filter, and editing it changes the list in place.
 * When it differs from the saved filter, "Revert" and "Save for everyone" appear. Status isn't a forum filter, it only exists on this screen (not in the contract).
 * Without `filter` ("Other posts") there is no label chip.
 */
export function FilterRow({
  states,
  counts,
  onStates,
  filter,
  draft,
  account,
  repos,
  onDraft,
  onSave,
}: {
  /** The workspace's account name */
  account: string;
  /** Repos in the workspace visible to me. The repo chip picks from them. */
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
  /** The repo condition being edited. If every label is off and the filter is empty, it's the forum's. */
  const picked = (draft ?? filter)?.repos ?? [];
  const reposChanged = reposWord(picked.toSorted()) !== reposWord((filter?.repos ?? []).toSorted());
  const pickRepos = (next: string[]) => draft && onDraft(withRepos(draft, next));
  const stateWords = (["open", "resolved"] as const)
    .filter((id) => states.has(id))
    .map((id) => stateWord(id));
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
      <legend className="sr-only">{t.forum.filter.legend}</legend>
      <Chip
        name={t.forum.filter.state}
        value={<span>{stateWords.join(", ") || t.forum.filter.all}</span>}
      >
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
            <span className="pop-name">{stateWord(id)}</span>
            <span className="pop-aside">{counts[id]}</span>
          </button>
        ))}
      </Chip>
      {filter && (
        <Chip
          name={t.forum.filter.repo}
          value={<span>{reposWord(picked)}</span>}
          changed={reposChanged}
        >
          <RepoOptions account={account} repos={repos} picked={picked} onPick={pickRepos} />
        </Chip>
      )}
      {filter && (
        <Chip
          name={t.forum.filter.label}
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
            {error ? t.forum.filter.saveFailed : t.forum.filter.differs}
          </span>
          <button type="button" className="button outline small" onClick={() => onDraft(undefined)}>
            {t.forum.filter.revert}
          </button>
          <button
            type="button"
            className="button primary small"
            disabled={busy || !draft}
            onClick={() => void save()}
          >
            {t.forum.filter.saveForAll}
          </button>
        </span>
      )}
    </fieldset>
  );
}

const stateWord = (id: "open" | "resolved") => t.forum.filter[id];

/** The repo chip's popup: "All repos" and one row per repo. Turning on "All repos" turns the repos off. */
function RepoOptions({
  account,
  repos,
  picked,
  onPick,
}: {
  account: string;
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
        <span className="pop-name">{t.forum.filter.allRepos}</span>
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
      <p className="pop-note">{placeNote(picked, account, repos)}</p>
    </>
  );
}

/** Filter chip: name (secondary text), value, chevron. Clicking opens a popup right below. */
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
    // biome-ignore lint/a11y/noStaticElementInteractions: one place catches keys for the menu and buttons inside
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

/** The label chip's popup: a search box, two bundle rows, and one row per label. */
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
              {t.forum.filter.allOfImportance(t.importance[importance])}
              {index === 0 && <small>{t.forum.filter.bundleNote}</small>}
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
            {locked && on && <span className="pop-aside">{t.importance[label.importance]}</span>}
          </button>
        );
      })}
      <p className="pop-note">{bundled ? t.forum.filter.bundledNote : t.forum.filter.anyLabel}</p>
    </>
  );
}

/** The kind of thing to create. The category's `+` opens with its own kind preselected (mockup 88-A). */
export type CreateKind = "chat" | "forum";

/**
 * The "Create" dialog (mockup 88-A, 52). At the top you pick the kind (chat channel, forum). A chat channel needs only a name,
 * a forum needs a name and a filter (two bundle rows and the label chip), and previews the matching posts.
 * With `forum`, it edits that forum: no kind picker, edit the name and filter, and delete the forum (not in the mockup, reason in PR #194).
 */
export function ForumDialog({
  dialog,
  forum,
  posts,
  account,
  repos,
  start = [],
  kind = "forum",
  onKind,
  onCreateChat,
  onSave,
  onDelete,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  forum?: Channel;
  /** Posts used for the preview, and their titles */
  posts: { labels: string[]; importance: Importance; repo: string; title: string }[];
  /** The workspace's account name */
  account: string;
  /** Repos in the workspace visible to me. The repo chip picks from them (mockup 92-A). */
  repos: string[];
  /** The repo chip preselected when creating: where you are now (mockup 101). If empty, "All repos". */
  start?: string[];
  /** The kind picked when creating. If `onKind` is given, the kind picker shows. */
  kind?: CreateKind;
  onKind?: (kind: CreateKind) => void;
  onCreateChat?: (name: string) => Promise<void>;
  onSave: (name: string, filter: ForumFilter) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const labels = useLabels();
  const [name, setName] = useState(forum?.name ?? "");
  const [draft, setDraft] = useState<Draft>(forum?.filter ?? null);
  /** Repo condition. Empty means "All repos". When creating, it's where you are now. */
  const [picked, setPicked] = useState<string[]>(forum?.filter?.repos ?? start);
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
          ? t.forum.create.taken
          : chat
            ? t.forum.create.chatFailed
            : t.forum.create.forumFailed,
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is handled by the dialog
    <dialog
      ref={dialog}
      className="dialog forum-dialog"
      aria-labelledby={heading}
      onClose={() => {
        setName(forum?.name ?? "");
        setDraft(forum?.filter ?? null);
        setPicked(forum?.filter?.repos ?? start);
        setError(undefined);
        setDeleting(false);
      }}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={heading}>
          {forum
            ? t.forum.create.edit
            : onKind
              ? t.forum.create.create
              : t.forum.create.createForum}
        </h2>
        {onKind && (
          <fieldset className="kind-pick">
            <legend>{t.forum.create.kind}</legend>
            {KINDS.map(({ value, Icon, key }) => (
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
                <strong>{t.forum.create[`${key}Name`]}</strong>
                <small>{t.forum.create[`${key}Note`]}</small>
              </label>
            ))}
          </fieldset>
        )}
        {!chat && <p className="dialog-lead">{t.forum.create.lead}</p>}
        <div className="field">
          <label htmlFor={input}>{t.forum.create.name}</label>
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
              {error ?? t.forum.create.chatHelp}
            </p>
          )}
        </div>
        {!chat && (
          <fieldset className="field forum-dialog-repos">
            <legend>{t.forum.create.repo}</legend>
            <div className="dialog-chips">
              <button
                type="button"
                className="tag-chip"
                aria-pressed={picked.length === 0}
                onClick={() => setPicked([])}
              >
                {picked.length === 0 && <Check size={14} aria-hidden />}
                {t.forum.filter.allRepos}
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
              {placeNote(picked, account, repos)}
            </p>
          </fieldset>
        )}
        {!chat && (
          <>
            <fieldset className="field forum-dialog-filter">
              <legend>{t.forum.create.filter}</legend>
              {IMPORTANCES.map((importance, index) => (
                <label key={importance} className="bundle-check">
                  <input
                    type="checkbox"
                    checked={bundled && draft.importance === importance}
                    onChange={() => setDraft(bundle(draft, importance))}
                  />
                  <span>
                    {t.forum.filter.allOfImportance(t.importance[importance])}
                    {index === 0 && <small>{t.forum.filter.bundleNote}</small>}
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
                {draft ? t.forum.create.shows(matched.length) : t.forum.create.pickOne}
              </p>
            </fieldset>
            {matched.length > 0 && (
              <div className="forum-preview">
                <p>{t.forum.create.preview}</p>
                <ul>
                  {matched.slice(0, 3).map((post, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: titles can repeat
                    <li key={index}>{post.title}</li>
                  ))}
                </ul>
                {matched.length > 3 && <p>{t.forum.create.more(matched.length - 3)}</p>}
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
              {deleting ? t.forum.create.deleteAgain : t.forum.create.delete}
            </button>
          )}
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            {t.forum.create.cancel}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !name.trim() || (!chat && !draft)}
          >
            {forum ? t.forum.create.save : t.forum.create.create}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const KINDS = [
  { value: "chat", Icon: Hash, key: "chat" },
  { value: "forum", Icon: MessagesSquare, key: "forum" },
] as const;
