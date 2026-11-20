import {
  ANSWERED_DAYS,
  Appearance,
  api,
  ContractFailure,
  call,
  EXECUTOR_NAMES,
  type Importance,
  type Label,
  Language,
  type MemberView,
  type Prefs,
} from "@omagari/contract";
import {
  Bell,
  Bot,
  CircleMinus,
  ExternalLink,
  GitMerge,
  Info,
  Languages,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Tag,
  UserPlus,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AccessRequestsPage } from "./access.tsx";
import { type Me, server } from "./api.ts";
import { type PostItem, settled } from "./forum.tsx";
import { LANGUAGE_NAMES, language, setLanguage, t } from "./i18n.ts";
import { ImportanceBadge, LabelDot, useLabels } from "./labels.tsx";
import { Mark } from "./members.tsx";
import { browserSwitch, setBrowserSwitch } from "./notify.ts";
import { appearance, setAppearance, systemLook, useLook } from "./theme.ts";
import { Avatar, personName } from "./workspace.tsx";

type Reply = Awaited<ReturnType<typeof call<typeof api.settings>>>;
type Page =
  | "agent"
  | "language"
  | "appearance"
  | "notifications"
  | "alerts"
  | "labels"
  | "info"
  | "access";

/** The docs page on the check command and the sandbox tools (site/merge-runs.md). */
const MERGE_RUN_DOCS = "https://omagari-dev.github.io/omagari/merge-runs";

/**
 * Settings window (DESIGN.md "Settings window"). Pick an item in the left list and see its content on the right.
 * Re-reads the server settings each time it opens. The agent and forum lists use the live member list and channels.
 * Closes on Esc, an overlay click, or the close button.
 */
export function Settings({
  me,
  posts,
  mine,
  session,
  check,
  prefs,
  onPrefs,
  onDndOff,
  onClose,
}: {
  me: Me;
  posts?: PostItem[];
  mine?: MemberView;
  session: string;
  prefs: Prefs;
  /** Saves some of my personal settings (the screen shows them right away). */
  onPrefs: (next: Partial<Prefs>) => Promise<void>;
  /** Turns Do not disturb off from the notifications item. */
  onDndOff: () => void;
  /** If the session ended, send the user back to login. */
  check: (error: unknown) => unknown;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [page, setPage] = useState<Page>("agent");
  const [settings, setSettings] = useState<Reply>();
  const [failed, setFailed] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const workspace = me.repo.split("/")[1];

  const load = () => {
    setFailed(false);
    call(server(session), api.settings).then(setSettings, (error) => {
      check(error);
      setFailed(true);
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once when opened
  useEffect(() => {
    dialog.current?.showModal();
    load();
  }, []);
  // Re-read when my runner turns off or on (live member list). This also shows when Merge run is turned off and on again in the runner.
  const online = mine?.agents.some((agent) => agent.state !== "offline");
  const seen = useRef(online);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read only when the runner turns on or off
  useEffect(() => {
    if (seen.current === online) return;
    seen.current = online;
    load();
  }, [online]);

  /** Update the screen first, and revert if the server rejects it. */
  const save = async (next: Partial<Reply>, send: () => Promise<unknown>) => {
    const before = settings;
    setSettings((now) => now && { ...now, ...next });
    setSaveError(undefined);
    try {
      await send();
    } catch (error) {
      check(error);
      setSettings(before);
      setSaveError(t.settings.saveFailed);
    }
  };

  /** Switches the screen first, and goes back if the server doesn't take it. */
  const pickLanguage = async (next: Language) => {
    const before = language;
    setLanguage(next);
    setSaveError(undefined);
    try {
      await call(server(session), api.setPrefs, { language: next });
    } catch (error) {
      check(error);
      setLanguage(before);
      setSaveError(t.settings.saveFailed);
    }
  };

  /** Same as the language: switch first, go back if the server doesn't take it. */
  const pickAppearance = async (next: Appearance) => {
    const before = appearance;
    setAppearance(next);
    setSaveError(undefined);
    try {
      await call(server(session), api.setPrefs, { appearance: next });
    } catch (error) {
      check(error);
      setAppearance(before);
      setSaveError(t.settings.saveFailed);
    }
  };

  const items: [Page, string, ReactNode][] = [
    ["agent", t.settings.pages.agent, <Bot key="agent" size={18} aria-hidden />],
    ["language", t.settings.pages.language, <Languages key="language" size={18} aria-hidden />],
    ["appearance", t.settings.pages.appearance, <Palette key="appearance" size={18} aria-hidden />],
    [
      "notifications",
      t.settings.pages.notifications,
      <Bell key="notifications" size={18} aria-hidden />,
    ],
    ["alerts", t.settings.pages.alerts, <GitMerge key="alerts" size={18} aria-hidden />],
    ["labels", t.settings.pages.labels, <Tag key="labels" size={18} aria-hidden />],
    ["info", t.settings.pages.info, <Info key="info" size={18} aria-hidden />],
    ["access", t.settings.pages.access, <UserPlus key="access" size={18} aria-hidden />],
  ];
  const item = ([id, name, icon]: (typeof items)[number]) => (
    <button
      key={id}
      type="button"
      className="settings-item"
      aria-current={page === id ? "page" : undefined}
      onClick={() => setPage(id)}
    >
      {icon}
      {name}
    </button>
  );
  const pageName = items.find(([id]) => id === page)?.[1];

  let body: ReactNode;
  if (page === "access") {
    // Server-wide, not part of the workspace's settings read.
    body = <AccessRequestsPage session={session} check={check} />;
  } else if (page === "labels") {
    // Labels use a live list, separate from the settings read.
    body = <LabelsPage posts={posts} session={session} check={check} />;
  } else if (page === "language") {
    // Comes with `api.me`, not the settings read, so it works even when that fails.
    body = <LanguagePage onPick={pickLanguage} />;
  } else if (page === "appearance") {
    // Comes with `api.me` too, like the language.
    body = <AppearancePage onPick={pickAppearance} />;
  } else if (page === "notifications") {
    body = (
      <NotificationsPage
        prefs={prefs}
        dnd={mine?.presence === "dnd"}
        onDndOff={onDndOff}
        onChange={(next) =>
          onPrefs(next).catch((error) => {
            check(error);
            setSaveError(t.settings.saveFailed);
          })
        }
      />
    );
  } else if (failed) {
    body = (
      <div className="empty">
        <h2>{t.settings.loadFailedTitle}</h2>
        <p>{t.settings.loadFailedBody}</p>
        <button type="button" className="button outline" onClick={load}>
          {t.tryAgain}
        </button>
      </div>
    );
  } else if (!settings) {
    body = <div className="settings-group settings-loading" aria-busy />;
  } else if (page === "agent") {
    body = (
      <AgentPage
        settings={settings}
        mine={mine}
        onSwitch={(on) =>
          save({ askSwitch: on }, () => call(server(session), api.setAskSwitch, { on }))
        }
      />
    );
  } else if (page === "info") {
    body = (
      <InfoPage
        workspace={workspace ?? ""}
        repo={me.repo}
        version={settings.version}
        sourceUrl={settings.sourceUrl}
      />
    );
  } else {
    body = (
      <MergeCheckGroup
        {...settings.mergeCheck}
        runner={online === false ? "offline" : settings.mergeCheck.runner}
      />
    );
  }

  return (
    // Clicking the overlay closes it. With the keyboard, Esc closes it (the dialog handles that).
    // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog handles Esc
    <dialog
      ref={dialog}
      className="settings"
      aria-labelledby={title}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <nav className="settings-nav" aria-label={t.settings.nav}>
        <div className="settings-me">
          <Avatar name={me.name} login={me.login} size={36} />
          <span className="names">
            <strong>{personName(me.name, me.login)}</strong>
          </span>
        </div>
        <h3>{t.settings.me}</h3>
        {items.slice(0, 4).map(item)}
        <h3>{t.settings.workspace(workspace ?? "")}</h3>
        {items.slice(4, 7).map(item)}
        {me.operator && (
          <>
            <h3>{t.settings.server}</h3>
            {items.slice(7).map(item)}
          </>
        )}
      </nav>
      <section className={page === "labels" ? "settings-page labels-page" : "settings-page"}>
        <h2 id={title}>{pageName}</h2>
        <button
          type="button"
          className="header-button settings-close"
          aria-label={t.settings.close}
          onClick={() => dialog.current?.close()}
        >
          <X size={18} aria-hidden />
        </button>
        {saveError && (
          <p className="banner error" role="alert">
            {saveError}
          </p>
        )}
        {body}
      </section>
    </dialog>
  );
}

function AgentPage({
  settings,
  mine,
  onSwitch,
}: {
  settings: Reply;
  mine?: MemberView;
  onSwitch: (on: boolean) => void;
}) {
  const { answered } = settings;
  const words = t.settings.agent;
  return (
    <>
      <Group title={words.whenAsked} note={words.whenAskedNote}>
        <SwitchRow
          name={words.answerSwitch}
          on={settings.askSwitch}
          description={settings.askSwitch ? words.answerOn : words.answerOff}
          onChange={onSwitch}
        />
        <Row
          name={words.answered}
          description={
            answered.last
              ? words.answeredSome(
                  answered.count,
                  ANSWERED_DAYS,
                  answered.last.name,
                  answered.last.text,
                )
              : words.answeredNone(ANSWERED_DAYS)
          }
        />
      </Group>
      <Group title={words.connected}>
        {mine?.agents.length ? (
          mine.agents.map((agent) => {
            const off = agent.state === "offline";
            return (
              <Row
                key={agent.executor}
                lead={<Mark agent={agent} aria-hidden data-off={off || undefined} />}
                name={EXECUTOR_NAMES[agent.executor]}
                description={
                  off
                    ? words.runnerOff
                    : agent.state === "answering"
                      ? words.runnerAnswering
                      : words.runnerOn
                }
              >
                {off ? (
                  <span className="settings-off">{t.settings.off}</span>
                ) : (
                  <span className="badge outline">{words.connectedBadge}</span>
                )}
              </Row>
            );
          })
        ) : (
          <Row name={words.none} description={words.noneHint} />
        )}
      </Group>
    </>
  );
}

/** The member's own language (ADR-0045). Saved on the server, so it follows them to other tabs and devices. */
function LanguagePage({ onPick }: { onPick: (language: Language) => void }) {
  const nameId = useId();
  const descriptionId = useId();
  return (
    <Group title={t.settings.language.title} note={t.settings.language.note}>
      <Row
        name={t.settings.language.name}
        nameId={nameId}
        description={t.settings.language.description}
        descriptionId={descriptionId}
      >
        <select
          className="text-input"
          aria-labelledby={nameId}
          aria-describedby={descriptionId}
          value={language}
          onChange={(event) => onPick(Language.parse(event.target.value))}
        >
          {Language.options.map((id) => (
            <option key={id} value={id} lang={id}>
              {LANGUAGE_NAMES[id]}
            </option>
          ))}
        </select>
      </Row>
    </Group>
  );
}

/** A small picture of the app in one look: a list panel and a conversation panel drawn with bars. */
const LookApp = ({ look }: { look: "light" | "dark" }) => (
  <span className="look-app" data-look={look}>
    <span className="look-list">
      <i />
      <i />
      <i />
    </span>
    <span className="look-talk">
      <i />
      <i />
      <i />
    </span>
  </span>
);

/** Appearance (draft 107-A): three picture cards. "Match system" is cut diagonally, light top left and dark bottom right. */
function AppearancePage({ onPick }: { onPick: (next: Appearance) => void }) {
  useLook();
  const words = t.settings.appearance;
  return (
    <div className="settings-section">
      <h3>{words.title}</h3>
      <div className="radio-cards look-cards" role="radiogroup" aria-label={words.title}>
        {Appearance.options.map((id) => (
          <label key={id} className="radio-card look-card">
            <span className="look-pic" aria-hidden>
              {id === "system" ? (
                <>
                  <LookApp look="light" />
                  <LookApp look="dark" />
                </>
              ) : (
                <LookApp look={id} />
              )}
            </span>
            <input
              type="radio"
              name="appearance"
              checked={appearance === id}
              onChange={() => onPick(id)}
            />
            <strong>{words.looks[id]}</strong>
          </label>
        ))}
      </div>
      <p>{words.note(systemLook())}</p>
    </div>
  );
}

/** Read-only facts about this workspace and server. */
function InfoPage({
  workspace,
  repo,
  version,
  sourceUrl,
}: {
  workspace: string;
  repo: string;
  version: string;
  sourceUrl: string;
}) {
  const words = t.settings.info;
  return (
    <>
      <Group title={words.workspace}>
        <Row name={words.name}>
          <code className="settings-value">{workspace}</code>
        </Row>
        <Row name={words.repo}>
          <code className="settings-value">{repo}</code>
        </Row>
      </Group>
      <Group title={words.server}>
        <Row name={words.version}>
          <code className="settings-value">{version}</code>
        </Row>
        <Row name={words.source}>
          <a className="settings-link" href={sourceUrl} target="_blank" rel="noreferrer">
            <code className="settings-value">{sourceUrl}</code>{" "}
            <ExternalLink size={14} aria-hidden />
          </a>
        </Row>
      </Group>
    </>
  );
}

const help = (text: string, section: "check-command" | "sandbox") => (
  <a
    className="settings-link"
    href={`${MERGE_RUN_DOCS}#${section}`}
    target="_blank"
    rel="noreferrer"
  >
    {text} ›
  </a>
);

/** Merge run (mockup 30-C). Read-only. Turning it on or off is done in the runner (ADR-0034). */
function MergeCheckGroup({ runner, check }: Reply["mergeCheck"]) {
  const words = t.settings.alerts;
  const off = <span className="settings-off">{t.settings.off}</span>;
  const rows: Record<typeof runner, [string, ReactNode]> = {
    on: [
      words.runOn,
      <span key="on" className="badge outline">
        {t.settings.on}
      </span>,
    ],
    off: [words.runOff, off],
    no_sandbox: [words.noSandbox, help(words.howToInstall, "sandbox")],
    offline: [words.runnerOff, off],
  };
  const [description, control] = rows[runner];
  const problem = check && "problem" in check ? check.problem : undefined;
  return (
    <Group title={words.mergeRun} note={words.mergeRunNote}>
      <Row
        name={words.checkCommand}
        description={
          !check
            ? words.checkWaiting
            : "config" in check
              ? words.checkConfig
              : words.checkProblems[check.problem]
        }
      >
        {check && "config" in check && (
          <code className="settings-value settings-command">{check.config.check}</code>
        )}
        {problem && help(words.howToSet, "check-command")}
      </Row>
      <Row name={words.runOnMine} description={description}>
        {control}
      </Row>
    </Group>
  );
}

const Group = ({
  title,
  note,
  children,
}: {
  title?: string;
  note?: string;
  children: ReactNode;
}) => (
  <div className="settings-section">
    {title && <h3>{title}</h3>}
    <div className="settings-group">{children}</div>
    {note && <p>{note}</p>}
  </div>
);

function Row({
  name,
  nameId,
  description,
  descriptionId,
  lead,
  children,
}: {
  name: string;
  nameId?: string;
  description?: string;
  descriptionId?: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      {lead}
      <span className="settings-text">
        <span id={nameId}>{name}</span>
        {description && <small id={descriptionId}>{description}</small>}
      </span>
      {children}
    </div>
  );
}

function SwitchRow({
  name,
  description,
  on,
  disabled,
  onChange,
}: {
  name: string;
  description: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const nameId = useId();
  const descriptionId = useId();
  return (
    <Row name={name} nameId={nameId} description={description} descriptionId={descriptionId}>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-labelledby={nameId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onChange(!on)}
      />
    </Row>
  );
}

/**
 * Notifications (DESIGN.md "Notifications", drafts 110-C and 111). The first switch is per browser and is the only place we ask the browser for permission.
 * The kinds are personal settings on the server. A browser without notifications (or one that blocked them) leaves the kinds as they are.
 */
function NotificationsPage({
  prefs,
  dnd,
  onDndOff,
  onChange,
}: {
  prefs: Prefs;
  dnd: boolean;
  onDndOff: () => void;
  onChange: (next: Partial<Prefs>) => void;
}) {
  const words = t.notify;
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : "denied",
  );
  const [on, setOn] = useState(browserSwitch);
  const blocked = supported && permission === "denied";
  const toggle = async (next: boolean) => {
    const allowed = !next || permission === "granted" || (await Notification.requestPermission());
    if (allowed !== true && allowed !== "granted") return setPermission(allowed);
    setBrowserSwitch(next);
    setOn(next);
    setPermission(supported ? Notification.permission : "denied");
  };
  const kind = (
    name: string,
    help: string,
    key: "notifyConflicts" | "notifyAnswers" | "notifyDecisions" | "notifyReplies",
    title: string,
    body: string,
    extra?: ReactNode,
  ) => (
    <KindCard
      name={name}
      help={help}
      on={prefs[key]}
      onChange={(next) => onChange({ [key]: next })}
    >
      {extra}
      <div className="notify-preview" aria-hidden>
        <span className="omagari-mark">
          <GitMerge size={12} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>{body}</small>
        </span>
      </div>
    </KindCard>
  );
  return (
    <>
      {dnd && (
        <p className="banner info notify-dnd">
          <CircleMinus size={16} aria-hidden />
          <span>{words.dnd}</span>
          <button type="button" className="banner-action" onClick={onDndOff}>
            {words.dndOff}
          </button>
        </p>
      )}
      <Group title={words.browser}>
        <SwitchRow
          name={words.thisBrowser}
          description={!supported ? words.unsupported : blocked ? words.blocked : words.asksOnce}
          on={on && permission === "granted"}
          disabled={!supported || blocked}
          onChange={toggle}
        />
      </Group>
      {blocked && (
        <p className="banner warning notify-blocked">
          <Lock size={16} aria-hidden />
          {words.blockedNote}
        </p>
      )}
      <div className="settings-section">
        <h3>{words.what}</h3>
        <div className="notify-kinds">
          {kind(
            words.conflicts,
            words.conflictsHelp,
            "notifyConflicts",
            words.conflictTitle,
            words.previewConflict,
            <div className="segments" role="radiogroup" aria-label={words.conflicts}>
              {([false, true] as const).map((fyi) => (
                <label key={String(fyi)} className="segment">
                  <input
                    type="radio"
                    name="notify-fyi"
                    checked={prefs.notifyFyi === fyi}
                    disabled={!prefs.notifyConflicts}
                    onChange={() => onChange({ notifyFyi: fyi })}
                  />
                  <span>{fyi ? words.fyiToo : words.discussOnly}</span>
                </label>
              ))}
            </div>,
          )}
          {kind(
            words.answers,
            words.answersHelp,
            "notifyAnswers",
            words.answerTitle,
            words.previewAnswer,
          )}
          {kind(
            words.decisions,
            words.decisionsHelp,
            "notifyDecisions",
            words.decisionTitle,
            words.previewDecision,
          )}
          {kind(
            words.replies,
            words.repliesHelp,
            "notifyReplies",
            words.replyTitle,
            words.previewReply,
          )}
        </div>
        <p>{words.quietNote}</p>
      </div>
    </>
  );
}

function KindCard({
  name,
  help,
  on,
  onChange,
  children,
}: {
  name: string;
  help: string;
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  const nameId = useId();
  const helpId = useId();
  return (
    <div className="notify-kind">
      <div className="notify-kind-head">
        <span className="settings-text">
          <span id={nameId}>{name}</span>
          <small id={helpId}>{help}</small>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={on}
          aria-labelledby={nameId}
          aria-describedby={helpId}
          onClick={() => onChange(!on)}
        />
      </div>
      {children}
    </div>
  );
}

/** Label colors you pick like on GitHub: choose one of the saturated colors. */
const randomColor = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(3)), (n) =>
    (64 + (n % 160)).toString(16).padStart(2, "0"),
  ).join("");

type Fields = { name: string; color: string; description: string; importance: Importance };
const fieldsOf = (label: Label): Fields => ({ ...label });
const EMPTY = (): Fields => ({
  name: "",
  color: randomColor(),
  description: "",
  importance: "reference",
});

/**
 * Labels (mockup 51-D4): left label list (search box, `+`), and on the right edit name, color, description, importance.
 * Name, color, and description also change the GitHub label, while importance is the same for everyone (ADR-0039). `+` creates a new label.
 */
function LabelsPage({
  posts,
  session,
  check,
}: {
  posts?: PostItem[];
  session: string;
  check: (error: unknown) => unknown;
}) {
  const labels = useLabels();
  const words = t.settings.labels;
  const [query, setQuery] = useState("");
  /** Name of the selected label. If none, it is a new label. */
  const [picked, setPicked] = useState<string | undefined>(labels[0]?.name);
  const label = labels.find((other) => other.name === picked);
  const [fields, setFields] = useState<Fields>(() => (label ? fieldsOf(label) : EMPTY()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ids = { name: useId(), color: useId(), description: useId() };

  const pick = (next?: Label) => {
    setPicked(next?.name);
    setFields(next ? fieldsOf(next) : EMPTY());
    setError(undefined);
  };
  const needle = query.trim().toLowerCase();
  const shown = labels.filter((other) => other.name.toLowerCase().includes(needle));
  const set = (next: Partial<Fields>) => {
    setFields((now) => ({ ...now, ...next }));
    setError(undefined);
  };
  const colorOk = /^[0-9a-fA-F]{6}$/.test(fields.color);
  const dirty = label
    ? JSON.stringify(fieldsOf(label)) !== JSON.stringify(fields)
    : fields.name.trim() !== "";
  /** Number of open posts that would become issues when switched to Discuss. */
  const opening =
    label && label.importance === "reference" && fields.importance === "discuss"
      ? (posts ?? []).filter(
          (post) =>
            !settled(post) && post.labels.includes(label.name) && post.importance === "reference",
        ).length
      : 0;

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const color = fields.color.toLowerCase();
      if (label) {
        const next: Partial<Fields> = {};
        if (fields.name.trim() !== label.name) next.name = fields.name.trim();
        if (color !== label.color.toLowerCase()) next.color = color;
        if (fields.description !== label.description) next.description = fields.description;
        if (fields.importance !== label.importance) next.importance = fields.importance;
        const { label: saved } = await call(server(session), api.editLabel, {
          name: label.name,
          next,
        });
        pick(saved);
      } else {
        let { label: saved } = await call(server(session), api.createLabel, {
          name: fields.name.trim(),
          color,
          description: fields.description,
        });
        // A new label starts as FYI. If Discuss was picked, switch to it afterward.
        if (fields.importance === "discuss")
          ({ label: saved } = await call(server(session), api.editLabel, {
            name: saved.name,
            next: { importance: "discuss" },
          }));
        pick(saved);
      }
    } catch (failure) {
      check(failure);
      const code = failure instanceof ContractFailure ? failure.code : undefined;
      setError(
        code === "conflict"
          ? words.taken
          : code === "github_failed"
            ? words.githubRefused
            : words.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="labels">
      <div className="labels-list">
        <div className="labels-tools">
          <div className="labels-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={words.find}
              aria-label={words.find}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="header-button"
            aria-label={words.new}
            aria-pressed={picked === undefined}
            onClick={() => pick(undefined)}
          >
            <Plus size={18} aria-hidden />
          </button>
        </div>
        <ul>
          {shown.map((other) => (
            <li key={other.name}>
              <button
                type="button"
                className="settings-item"
                aria-current={other.name === picked ? "true" : undefined}
                onClick={() => pick(other)}
              >
                <LabelDot color={other.color} size={10} />
                <span className="labels-name">{other.name}</span>
                <ImportanceBadge importance={other.importance} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <form
        className="labels-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="labels-preview">
          <p>{words.preview}</p>
          <strong>{words.previewTitle}</strong> <span className="issue-number">#44</span>
          <span className="labels-preview-badges">
            <span className="badge warning">{words.directConflict}</span>
            <span className="label-badge">
              <LabelDot color={colorOk ? fields.color : undefined} />
              {fields.name.trim() || words.new}
            </span>
            {fields.importance === "discuss" && <ImportanceBadge importance="discuss" />}
          </span>
        </div>
        <div className="labels-row">
          <div className="field">
            <label htmlFor={ids.name}>{words.name}</label>
            <input
              id={ids.name}
              className="text-input"
              value={fields.name}
              maxLength={50}
              autoComplete="off"
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.color}>{words.color}</label>
            <div className="labels-color">
              <LabelDot color={colorOk ? fields.color : undefined} size={20} asSet />
              <span className="labels-hex">
                #
                <input
                  id={ids.color}
                  className="text-input"
                  value={fields.color}
                  maxLength={6}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!colorOk}
                  onChange={(event) => set({ color: event.target.value.replace(/^#/, "") })}
                />
              </span>
              <button
                type="button"
                className="header-button"
                aria-label={words.reroll}
                onClick={() => set({ color: randomColor() })}
              >
                <RefreshCw size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.description}>{words.description}</label>
          <input
            id={ids.description}
            className="text-input"
            value={fields.description}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => set({ description: event.target.value })}
          />
        </div>
        <fieldset className="field labels-importance">
          <legend>{words.importance}</legend>
          <div className="radio-cards">
            {(["reference", "discuss"] as const).map((id) => (
              <label key={id} className="radio-card">
                <input
                  type="radio"
                  name="importance"
                  checked={fields.importance === id}
                  onChange={() => set({ importance: id })}
                />
                <strong>{t.importance[id]}</strong>
                <small>{words.importanceHelp[id]}</small>
              </label>
            ))}
          </div>
          {opening > 0 && <p className="help">{words.opening(opening)}</p>}
        </fieldset>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="labels-actions">
          <p className="help">{words.help}</p>
          <button
            type="button"
            className="button outline"
            disabled={!dirty}
            onClick={() => pick(label)}
          >
            {words.revert}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !dirty || !colorOk || !fields.name.trim()}
          >
            {label ? words.save : words.create}
          </button>
        </div>
      </form>
    </div>
  );
}
