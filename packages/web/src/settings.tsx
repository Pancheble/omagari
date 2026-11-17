import {
  ANSWERED_DAYS,
  api,
  ContractFailure,
  call,
  EXECUTOR_NAMES,
  IMPORTANCE_LABELS,
  type Importance,
  type Label,
  type MemberView,
} from "@omagari/contract";
import { Bot, MessagesSquare, Plus, RefreshCw, Search, Tag, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Me, server } from "./api.ts";
import { type PostItem, settled } from "./forum.tsx";
import { ImportanceBadge, LabelDot, useLabels } from "./labels.tsx";
import { Mark } from "./members.tsx";
import { Avatar } from "./workspace.tsx";

type Reply = Awaited<ReturnType<typeof call<typeof api.settings>>>;
type Page = "agent" | "alerts" | "labels";

/** 검사 명령을 정하는 법, 샌드박스 도구를 까는 법(README "검사 명령"). */
const CHECK_HELP = "https://github.com/Pancheble/omagari#검사-명령";

/**
 * 설정 창(DESIGN.md "설정 창"). 왼쪽 목록에서 항목을 고르고 오른쪽에 그 내용을 보인다.
 * 열릴 때마다 서버의 설정을 새로 읽는다. 에이전트와 포럼 목록은 실시간으로 받는 멤버 목록과 채널을 쓴다.
 * Esc, 덮개 누르기, 닫기 버튼으로 닫힌다.
 */
export function Settings({
  me,
  posts,
  mine,
  session,
  check,
  onClose,
}: {
  me: Me;
  posts?: PostItem[];
  mine?: MemberView;
  session: string;
  /** 세션이 끝났으면 로그인으로 돌린다. */
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열릴 때 한 번 읽는다
  useEffect(() => {
    dialog.current?.showModal();
    load();
  }, []);
  // 내 러너가 꺼지거나 켜지면(실시간 멤버 목록) 다시 읽는다. 합쳐 돌려 보기를 러너에서 끄고 다시 켠 것도 이렇게 보인다.
  const online = mine?.agents.some((agent) => agent.state !== "offline");
  const seen = useRef(online);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 러너가 켜지고 꺼질 때만 읽는다
  useEffect(() => {
    if (seen.current === online) return;
    seen.current = online;
    load();
  }, [online]);

  /** 먼저 화면을 바꾸고, 서버가 받지 않으면 되돌린다. */
  const save = async (next: Partial<Reply>, send: () => Promise<unknown>) => {
    const before = settings;
    setSettings((now) => now && { ...now, ...next });
    setSaveError(undefined);
    try {
      await send();
    } catch (error) {
      check(error);
      setSettings(before);
      setSaveError("바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
  };

  const items: [Page, string, ReactNode][] = [
    ["agent", "내 에이전트", <Bot key="agent" size={18} aria-hidden />],
    ["alerts", "부딪힘 알림", <MessagesSquare key="alerts" size={18} aria-hidden />],
    ["labels", "라벨", <Tag key="labels" size={18} aria-hidden />],
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
  if (page === "labels") {
    // 라벨은 설정 읽기와 따로 실시간으로 받는 목록을 쓴다.
    body = <LabelsPage posts={posts} session={session} check={check} />;
  } else if (failed) {
    body = (
      <div className="empty">
        <h2>설정을 읽지 못했어요</h2>
        <p>서버에 닿지 않았어요.</p>
        <button type="button" className="button outline" onClick={load}>
          다시 시도
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
  } else {
    body = <AlertsPage settings={settings} online={online} workspace={workspace} repo={me.repo} />;
  }

  return (
    // 덮개를 누르면 닫힌다. 키보드로는 Esc가 닫는다(dialog가 해 준다).
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="settings"
      aria-labelledby={title}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <nav className="settings-nav" aria-label="설정 항목">
        <div className="settings-me">
          <Avatar name={me.name} size={36} />
          <span className="names">
            <strong>{me.name}</strong>
            <span>{me.login}</span>
          </span>
        </div>
        <h3>나</h3>
        {item(items[0] as (typeof items)[number])}
        <h3>워크스페이스 · {workspace}</h3>
        {item(items[1] as (typeof items)[number])}
        {item(items[2] as (typeof items)[number])}
      </nav>
      <section className={page === "labels" ? "settings-page labels-page" : "settings-page"}>
        <h2 id={title}>{pageName}</h2>
        <button
          type="button"
          className="header-button settings-close"
          aria-label="설정 닫기"
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
  return (
    <>
      <Group
        title="남이 물을 때"
        note="답할 때는 내 기기의 러너가 내 폴더를 읽기만 하고, 내 사용량이 쓰여요."
      >
        <SwitchRow
          name="남의 질문에 답하기"
          on={settings.askSwitch}
          description={
            settings.askSwitch
              ? "다른 멤버의 에이전트가 물으면 내 에이전트가 내 폴더를 읽고 답해요."
              : "꺼 두었어요. 묻는 쪽은 바로 “받지 않는다”를 들어요."
          }
          onChange={onSwitch}
        />
        <Row
          name="내 에이전트가 답한 것"
          description={
            answered.last
              ? `지난 ${ANSWERED_DAYS}일 동안 ${answered.count}번 · 마지막은 ${answered.last.name}의 에이전트가 물은 “${answered.last.text}”`
              : `지난 ${ANSWERED_DAYS}일 동안 답한 질문이 없어요`
          }
        />
      </Group>
      <Group title="연결된 에이전트">
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
                    ? "러너가 꺼져 있어요"
                    : agent.state === "answering"
                      ? "러너 켜짐 · 답하는 중"
                      : "러너 켜짐"
                }
              >
                {off ? (
                  <span className="settings-off">꺼짐</span>
                ) : (
                  <span className="badge outline">연결됨</span>
                )}
              </Row>
            );
          })
        ) : (
          <Row name="연결된 에이전트가 없어요" description="이 기기에서 러너를 켜면 여기 보여요." />
        )}
      </Group>
    </>
  );
}

function AlertsPage({
  settings,
  online,
  workspace,
  repo,
}: {
  settings: Reply;
  /** 실시간 멤버 목록으로 본 내 러너. 모르면 없다. */
  online?: boolean;
  workspace: string;
  repo: string;
}) {
  return (
    <>
      <MergeCheckGroup
        {...settings.mergeCheck}
        runner={online === false ? "offline" : settings.mergeCheck.runner}
      />
      <Group title="워크스페이스">
        <Row name="이름">
          <span className="settings-value">{workspace}</span>
        </Row>
        <Row name="레포">
          <code className="settings-value">{repo}</code>
        </Row>
      </Group>
    </>
  );
}

const help = (text: string) => (
  <a className="settings-link" href={CHECK_HELP} target="_blank" rel="noreferrer">
    {text} ›
  </a>
);

/** 합쳐 돌려 보기(시안 30-C). 읽기만 한다. 켜고 끄는 것은 러너에서 한다(ADR-0034). */
function MergeCheckGroup({ runner, check }: Reply["mergeCheck"]) {
  const off = <span className="settings-off">꺼짐</span>;
  const rows: Record<typeof runner, [string, ReactNode]> = {
    on: [
      "켜져 있어요. 샌드박스 안에서만 돌아요.",
      <span key="on" className="badge outline">
        켜짐
      </span>,
    ],
    off: ["꺼 두었어요. 다른 멤버의 러너가 돌린 판정은 그대로 보여요.", off],
    no_sandbox: ["이 기기에 샌드박스 도구가 없어 돌리지 않아요.", help("까는 법")],
    offline: ["러너가 꺼져 있어요.", off],
  };
  const [description, control] = rows[runner];
  const problem = check && "problem" in check ? check.problem : undefined;
  return (
    <Group
      title="합쳐 돌려 보기"
      note="레포 기본 브랜치의 설정 파일에서 읽어요. 바꾸려면 그 파일을 고쳐 머지하세요. 모든 멤버에게 같아요. 켜고 끄는 것은 웹이 아니라 러너에서 해요. 서버가 내 기기에서 돌릴 것을 정하지 못하게 하려는 거예요."
    >
      <Row
        name="검사 명령"
        description={
          !check
            ? "러너가 붙으면 레포의 설정 파일을 읽어 와요."
            : "config" in check
              ? "합친 것에 돌리는 명령이에요."
              : {
                  missing: "레포에 설정 파일이 없어요. 머지하면 돌리기 시작해요.",
                  invalid: "레포의 설정 파일을 읽지 못했어요. JSON이 아니거나 꼴이 달라요.",
                  unknown_branch: "러너가 레포의 기본 브랜치를 몰라 설정 파일을 읽지 못했어요.",
                }[check.problem]
        }
      >
        {check && "config" in check && (
          <code className="settings-value settings-command">{check.config.check}</code>
        )}
        {problem && help("정하는 법")}
      </Row>
      <Row name="내 러너에서 돌리기" description={description}>
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
  title: string;
  note?: string;
  children: ReactNode;
}) => (
  <div className="settings-section">
    <h3>{title}</h3>
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
  onChange,
}: {
  name: string;
  description: string;
  on: boolean;
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
        onClick={() => onChange(!on)}
      />
    </Row>
  );
}

/** GitHub처럼 고르는 라벨 색: 채도가 있는 색 가운데 하나를 뽑는다. */
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
 * 라벨(시안 51-D4): 왼쪽 라벨 목록(찾기 칸, `+`), 오른쪽에서 이름, 색, 설명, 중요도를 고친다.
 * 이름, 색, 설명은 GitHub 라벨도 같이 고쳐지고 중요도는 모두에게 같다(ADR-0039). `+`는 새 라벨을 만든다.
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
  const [query, setQuery] = useState("");
  /** 고른 라벨의 이름. 없으면 새 라벨이다. */
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
  /** 논의로 바꾸면 이슈가 열릴 열린 포스트 수. */
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
        // 새 라벨은 참고로 생긴다. 논의로 골랐으면 이어서 바꾼다.
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
          ? "같은 이름의 라벨이 이미 있어요."
          : code === "github_failed"
            ? "GitHub이 라벨을 받지 않았어요. 토큰의 권한을 확인해 주세요."
            : "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
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
              placeholder="라벨 찾기"
              aria-label="라벨 찾기"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="header-button"
            aria-label="새 라벨"
            title="새 라벨"
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
          <p>포스트에서 이렇게 보여요</p>
          <strong>refund의 reason 필드</strong> <span className="issue-number">#44</span>
          <span className="labels-preview-badges">
            <span className="badge warning">직접 충돌</span>
            <span className="label-badge">
              <LabelDot color={colorOk ? fields.color : undefined} />
              {fields.name.trim() || "새 라벨"}
            </span>
            {fields.importance === "discuss" && <ImportanceBadge importance="discuss" />}
          </span>
        </div>
        <div className="labels-row">
          <div className="field">
            <label htmlFor={ids.name}>이름</label>
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
            <label htmlFor={ids.color}>색</label>
            <div className="labels-color">
              <LabelDot color={colorOk ? fields.color : undefined} size={20} />
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
                aria-label="다른 색 뽑기"
                title="다른 색 뽑기"
                onClick={() => set({ color: randomColor() })}
              >
                <RefreshCw size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.description}>설명</label>
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
          <legend>중요도</legend>
          <div className="radio-cards">
            {(
              [
                ["reference", "알림으로 쌓여요. 이슈를 열지 않아요."],
                ["discuss", "사람이 보고 이야기해요. 붙으면 GitHub 이슈를 열어요."],
              ] as const
            ).map(([id, text]) => (
              <label key={id} className="radio-card">
                <input
                  type="radio"
                  name="importance"
                  checked={fields.importance === id}
                  onChange={() => set({ importance: id })}
                />
                <strong>{IMPORTANCE_LABELS[id]}</strong>
                <small>{text}</small>
              </label>
            ))}
          </div>
          {opening > 0 && (
            <p className="help">
              논의로 바꾸면 이 라벨이 붙은 열린 포스트 {opening}개에 이슈가 열려요.
            </p>
          )}
        </fieldset>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="labels-actions">
          <p className="help">
            이름, 색, 설명은 GitHub 라벨도 같이 고쳐져요. 중요도는 모든 멤버에게 같아요.
          </p>
          <button
            type="button"
            className="button outline"
            disabled={!dirty}
            onClick={() => pick(label)}
          >
            되돌리기
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !dirty || !colorOk || !fields.name.trim()}
          >
            {label ? "저장" : "만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}
