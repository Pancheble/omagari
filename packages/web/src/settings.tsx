import {
  ANSWERED_DAYS,
  api,
  type Channel,
  call,
  EXECUTOR_NAMES,
  type MemberView,
} from "@omagari/contract";
import { Bot, ChevronDown, MessagesSquare, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Me, server } from "./api.ts";
import { Mark } from "./members.tsx";
import { Avatar } from "./workspace.tsx";

type Reply = Awaited<ReturnType<typeof call<typeof api.settings>>>;
type Page = "agent" | "alerts";

/** 검사 명령을 정하는 법, 샌드박스 도구를 까는 법(README "검사 명령"). */
const CHECK_HELP = "https://github.com/Pancheble/omagari#검사-명령";

/**
 * 설정 창(DESIGN.md "설정 창"). 왼쪽 목록에서 항목을 고르고 오른쪽에 그 내용을 보인다.
 * 열릴 때마다 서버의 설정을 새로 읽는다. 에이전트와 포럼 목록은 실시간으로 받는 멤버 목록과 채널을 쓴다.
 * Esc, 덮개 누르기, 닫기 버튼으로 닫힌다.
 */
export function Settings({
  me,
  mine,
  channels,
  session,
  check,
  onClose,
}: {
  me: Me;
  mine?: MemberView;
  channels?: Channel[];
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
  if (failed) {
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
    body = (
      <AlertsPage
        settings={settings}
        online={online}
        forums={channels?.filter((channel) => channel.kind === "forum") ?? []}
        workspace={workspace}
        repo={me.repo}
        save={(channel) =>
          save({ alertChannel: channel }, () =>
            call(server(session), api.setAlertChannel, { channel }),
          )
        }
      />
    );
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
      </nav>
      <section className="settings-page">
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
  forums,
  workspace,
  repo,
  save,
}: {
  settings: Reply;
  /** 실시간 멤버 목록으로 본 내 러너. 모르면 없다. */
  online?: boolean;
  forums: Channel[];
  workspace: string;
  repo: string;
  save: (channel: string) => Promise<void>;
}) {
  const name = useId();
  return (
    <>
      <Group
        title="부딪힘 알림"
        note="바꾸면 새 알림부터 그 포럼에 올라가고, 지난 포스트는 그대로 있어요. 모든 멤버에게 같아요."
      >
        <Row name="알림을 올릴 포럼" nameId={name}>
          <span className="settings-select">
            <MessagesSquare size={14} aria-hidden />
            <select
              aria-labelledby={name}
              value={settings.alertChannel}
              onChange={(event) => void save(event.target.value)}
            >
              {forums.map((forum) => (
                <option key={forum.id} value={forum.id}>
                  {forum.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden />
          </span>
        </Row>
      </Group>
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
