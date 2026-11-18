import assert from "node:assert/strict";
import { test } from "node:test";
import { idleAgents } from "./idle-agents.ts";

const agent = (executor: "claude-code" | "codex", state = "online") => ({ executor, state });
const work = (executor: "claude-code" | "codex" | null) => ({ executor, branch: "b" });

test("작업 없는 에이전트만 고르고, 작업 줄에 보이는 에이전트는 뺀다", () => {
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
