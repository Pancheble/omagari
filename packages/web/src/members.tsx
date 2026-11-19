import { ago, EXECUTOR_NAMES, type ExecutorId, type MemberView } from "@omagari/contract";
import { Clock } from "lucide-react";
import { type ComponentProps, use, useEffect, useReducer } from "react";
import { StatusText } from "./profile.tsx";
import { PeopleContext } from "./profile-card.tsx";
import { Avatar, PRESENCE_WORDS, personName } from "./workspace.tsx";

/** 에이전트 표시에 쓰는 실행기 약자(DESIGN.md 에이전트 표시). */
const MARKS = { "claude-code": "CC", codex: "CX" } as const satisfies Record<ExecutorId, string>;
const STATES = { online: "온라인", answering: "답하는 중", offline: "오프라인" } as const;

type Member = MemberView;
type Agent = Member["agents"][number];
type Work = Member["works"][number];

/** 사람이 오프라인인가(접속 상태). 에이전트의 러너가 붙어 있는지와 따로 간다. 그룹과 흐린 아바타가 이것을 본다. */
const offline = (member: Member) => member.presence === "offline";

/**
 * 멤버 목록: "온라인 — N", "오프라인 — N"으로 묶은 사람 행. 자리 비움과 방해 금지는 온라인에 든다.
 * 행은 펼치지 않고 누르면 프로필 카드가 뜬다(DESIGN.md "멤버 목록").
 */
export function MemberList({
  me,
  members,
  cardOf,
}: {
  me: string;
  members: Member[];
  /** 프로필 카드가 열려 있는 사람(그 행이 칠해진다) */
  cardOf?: string;
}) {
  useMinuteTick();
  const groups = [
    ["온라인", members.filter((member) => !offline(member))],
    ["오프라인", members.filter(offline)],
  ] as const;
  return groups.map(
    ([title, group]) =>
      group.length > 0 && (
        <section key={title} className="member-group">
          <h3 className="section-title">
            {title} — {group.length}
          </h3>
          <ul>
            {group.map((member) => (
              <MemberRow
                key={member.login}
                member={member}
                me={member.login === me}
                selected={member.login === cardOf}
              />
            ))}
          </ul>
        </section>
      ),
  );
}

/** 불러오는 중: 아바타 자리 원과 두 줄을 사람 셋만큼. 메시지의 뼈대와 같은 부품이다. */
export const MemberSkeleton = () => (
  <div
    className="member-skeleton"
    role="status"
    aria-busy="true"
    aria-label="멤버 목록을 불러오는 중"
  >
    {[0, 1, 2].map((key) => (
      <div key={key} className="skeleton-row" aria-hidden>
        <span className="bone circle" />
        <span className="bones">
          <span className="bone" />
          <span className="bone" />
        </span>
      </div>
    ))}
  </div>
);

function MemberRow({ member, me, selected }: { member: Member; me: boolean; selected: boolean }) {
  const { open } = use(PeopleContext);
  const count = member.works.length;
  const away = offline(member);
  // 둘째 줄: 상태 메시지 · 작업 N개. 상태 메시지가 없으면 그 자리에 접속 상태(온라인 말고)를 보조 글씨로 쓰고,
  // 둘 다 없으면 작업 수만 쓴다. 메시지가 길면 메시지만 잘린다.
  // 에이전트가 문답에 답하는 동안은 작업 수 앞에 "답하는 중"이 붙는다(PRD 17). 에이전트가 여럿이면 어느 것인지 쓴다.
  const answering = member.agents
    .filter((agent) => agent.state === "answering")
    .map((agent) =>
      member.agents.length > 1 ? `${EXECUTOR_NAMES[agent.executor]} 답하는 중` : "답하는 중",
    );
  const word = member.presence === "online" ? undefined : PRESENCE_WORDS[member.presence];
  const status = member.message !== null || member.emoji !== null;
  const rest = [!status && word, ...answering, count > 0 ? `작업 ${count}개` : "작업 없음"]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="member" data-open={selected || undefined} data-offline={away || undefined}>
      {/* 행은 펼치지 않고 프로필 카드를 행 왼쪽에 연다. 작업과 에이전트는 카드와 전체 보기에 있다. */}
      <button
        type="button"
        className="member-row"
        aria-haspopup="dialog"
        onClick={(event) =>
          open({ login: member.login, anchor: event.currentTarget, side: "left" })
        }
      >
        <Avatar name={member.name} login={member.login} size={40} presence={member.presence} />
        <span className="member-names">
          <strong>
            <span className="member-name">{personName(member.name, member.login)}</span>
            {me && <span className="me">나</span>}
          </strong>
          <span className="member-status">
            {status && (
              <span className="status-message">
                <StatusText {...member} />
              </span>
            )}
            <span className="status-rest">{status ? `\u00a0· ${rest}` : rest}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** 작업 하나: 에이전트 표시, 상태 한 줄(ADR-0010이 고른 것), 브랜치와 쓴 시각, 오프라인이면 "N시간 전 기준". */
export function WorkItem({
  member,
  work,
  conflict,
}: {
  member: Member;
  work: Work;
  conflict?: boolean;
}) {
  const agent = member.agents.find((candidate) => candidate.executor === work.executor);
  const { line } = work;
  return (
    <li className="work">
      {/* 에이전트를 모르는 작업은 사람 아래에 바로 둔다(ADR-0015). 줄은 표시 자리만큼 들여 맞춘다. */}
      {agent ? <AgentMark name={member.name} agent={agent} /> : <span className="agent-space" />}
      <div className="work-body">
        <p className={line ? "work-line" : "work-line none"}>{line?.text ?? "상태 한 줄 없음"}</p>
        <p className="work-meta">
          <span className="branch">{work.branch}</span>
          {conflict && <span className="badge warning">직접 충돌</span>}
          {work.broken && <span className="badge warning">합치면 깨짐</span>}
          {line?.source === "agent" && (
            <time dateTime={line.at} title={new Date(line.at).toLocaleString("ko-KR")}>
              · {ago(line.at)}
            </time>
          )}
          {line?.source === "pull" && <span>· 초안 PR</span>}
          {member.offlineSince && (
            <span className="badge outline">
              <Clock size={11} aria-hidden />
              {ago(member.offlineSince)} 기준
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/** 작업 없는 에이전트 한 줄: 표시, "지은의 Claude Code", 상태 글씨(DM 칸의 에이전트 메뉴와 같은 말). */
export function IdleAgent({ member, agent }: { member: Member; agent: Agent }) {
  const busy = agent.state === "answering";
  return (
    <li className="work idle-agent">
      <AgentMark name={member.name} agent={agent} />
      <span className="agent-name">
        {member.name}의 {EXECUTOR_NAMES[agent.executor]}
      </span>
      <span className={busy ? "agent-state busy" : "agent-state"}>
        {busy ? "답하는 중…" : agent.state === "offline" ? "러너가 꺼져 있어요" : "쉬는 중"}
      </span>
    </li>
  );
}

/** 에이전트 표시: 실행기 약자와, 러너가 붙어 있는지의 점(붙어 있으면 초록 원, 아니면 빈 고리). */
function AgentMark({ name, agent }: { name: string; agent: Agent }) {
  const label = `${name}의 ${EXECUTOR_NAMES[agent.executor]}, ${STATES[agent.state]}`;
  return <Mark agent={agent} role="img" aria-label={label} title={label} />;
}

/** 에이전트 표시의 모양만. 이름이 바로 옆에 보이는 곳에서는 `aria-hidden`으로 쓴다. */
export const Mark = ({
  agent,
  ...rest
}: { agent: Pick<Agent, "executor" | "state"> } & ComponentProps<"span">) => (
  <span className="agent-mark" data-state={agent.state} {...rest}>
    {MARKS[agent.executor]}
  </span>
);

/** "3분 전"이 흐르도록 1분마다 다시 그린다. */
function useMinuteTick() {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
}
