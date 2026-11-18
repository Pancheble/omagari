import type { MemberView } from "@omagari/contract";

/** 작업 줄에 이미 보이는 에이전트를 뺀, 작업 없는 에이전트. 멤버 행 오른쪽에 표시로 보인다. */
export const idleAgents = (member: Pick<MemberView, "agents" | "works">) =>
  member.agents.filter((agent) => !member.works.some((work) => work.executor === agent.executor));
