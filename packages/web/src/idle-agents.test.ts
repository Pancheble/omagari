import assert from "node:assert/strict";
import { test } from "node:test";
import { idleAgents } from "./idle-agents.ts";

const agent = (executor: "claude-code" | "codex", state = "online") => ({ executor, state });
const work = (executor: "claude-code" | "codex" | null) => ({ executor, branch: "b" });

test("picks only Agents with no work and leaves out Agents already shown on a work line", () => {
  const member = {
    agents: [agent("claude-code"), agent("codex", "offline")],
    works: [work("claude-code")],
  };
  assert.deepEqual(
    idleAgents(member as never).map((a) => a.executor),
    ["codex"],
  );
  assert.deepEqual(idleAgents({ agents: member.agents, works: [] } as never), member.agents);
  assert.deepEqual(idleAgents({ agents: [], works: [work(null)] } as never), []);
});
