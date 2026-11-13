import { ago, EXECUTOR_NAMES, type ExecutorId, type MemberView } from "@omagari/contract";
import { ChevronRight, Clock } from "lucide-react";
import { type ComponentProps, useEffect, useId, useReducer, useState } from "react";
import { StatusText } from "./profile.tsx";
import { Avatar, PRESENCE_WORDS } from "./workspace.tsx";

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
 * 행은 접힌 것이 기본이고, 펼치면 작업마다 한 덩어리다.
 */
export function MemberList({
  me,
  members,
  direct,
}: {
  me: string;
  members: Member[];
  /** 직접 충돌이 걸린 작업("로그인/브랜치"). 작업 줄에 배지가 붙는다. */
  direct?: Set<string>;
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
                direct={direct}
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

function MemberRow({ member, me, direct }: { member: Member; me: boolean; direct?: Set<string> }) {
  const [open, setOpen] = useState(false);
  const works = useId();
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
  const head = (
    <>
      <Avatar name={member.name} size={40} presence={member.presence} />
      <span className="member-names">
        <strong>
          <span className="member-name">{member.name}</span>
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
      {count > 0 && <ChevronRight size={14} className="chevron" aria-hidden />}
    </>
  );
  return (
    <li className="member" data-open={open || undefined} data-offline={away || undefined}>
      {count > 0 ? (
        <button
          type="button"
          className="member-row"
          aria-expanded={open}
          aria-controls={open ? works : undefined}
          onClick={() => setOpen(!open)}
        >
          {head}
        </button>
      ) : (
        <div className="member-row">{head}</div>
      )}
      {open && (
        <ul className="works" id={works}>
          {member.works.map((work) => (
            <WorkItem
              key={work.branch}
              member={member}
              work={work}
              conflict={direct?.has(`${member.login}/${work.branch}`)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 작업 하나: 에이전트 표시, 상태 한 줄(ADR-0010이 고른 것), 브랜치와 쓴 시각, 오프라인이면 "N시간 전 기준". */
function WorkItem({ member, work, conflict }: { member: Member; work: Work; conflict?: boolean }) {
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
