import type { MemberView } from "@omagari/contract";

/** 작업 줄에 이미 보이는 에이전트를 뺀, 작업 없는 에이전트. 펼친 멤버 행에서 작업 뒤에 한 줄씩 보인다. */
export const idleAgents = (member: Pick<MemberView, "agents" | "works">) =>
  member.agents.filter((agent) => !member.works.some((work) => work.executor === agent.executor));
