import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { startWorld } from "./harness.ts";

// A runner that reports no executors (the member's device has neither Claude Code nor Codex) can't answer.
// Even with such a runner attached, the server that sends questions must not drop.

test("a question to a member whose runner has no executor is not sent, and the server keeps answering", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  // bob's runner reports no executors at all.
  world.github.grant("bob");
  const bobAs = await world.login("bob");
  const bob = await world.desk(bobAs, undefined, {});
  t.after(bob.remove);

  const asked = await world.cli("ask", "bob", "Should charge() get a retry?");
  assert.equal(asked.code, 0, asked.stderr);
  // With no executor there is no runner to answer: it is not sent, and stays offline.
  assert.match(asked.stdout, /^bob's runner is offline, so question #\d+ is waiting\./);

  // The server is alive: another member's request still gets an answer.
  const members = await call(world.owner, api.members);
  assert.ok(members.members.some((m) => m.login === "bob"));
});
