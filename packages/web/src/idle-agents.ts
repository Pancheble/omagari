import type { MemberView } from "@omagari/contract";

/** Agents with no work, leaving out Agents already shown on a work line. Shown one line each after the work in an expanded member row. */
export const idleAgents = (member: Pick<MemberView, "agents" | "works">) =>
  member.agents.filter((agent) => !member.works.some((work) => work.executor === agent.executor));
