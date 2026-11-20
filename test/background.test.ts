import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { callRunner } from "@omagari/runner";
import { eventually, startWorld, tempRepo } from "./harness.ts";

const sessionStart = (cwd: string) =>
  JSON.stringify({
    session_id: "11111111-2222-3333-4444-555555555555",
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    hook_event_name: "SessionStart",
    source: "startup",
  });

test("the background runner starts the runner of a workspace repo once a session starts there, and leaves repos outside the server's accounts alone", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  // A runner ran in this repo by hand before. It's off now.
  await world.runner.stop();
  await world.signInCli(world.owner);
  const background = world.launchCliIn(world.repo.folder, "runner", "background");
  t.after(() => background.stop("SIGTERM"));
  await background.output(/Background runner on/);
  assert.equal((await world.agents(world.owner))[world.owner.login], "offline");

  assert.equal((await world.hook(sessionStart(world.repo.folder))).code, 0);
  await background.output(/Watching /);
  await eventually(async () =>
    assert.equal((await world.agents(world.owner))[world.owner.login], "online"),
  );
  // A runner in a terminal doesn't start a second one.
  const terminal = await world.cli("runner");
  assert.deepEqual(
    { code: terminal.code, stdout: terminal.stdout },
    { code: 0, stdout: "The background runner already watches this folder\n" },
  );

  // A repo outside the server's accounts isn't started (repo-sharing.test checks nothing about it reaches the server).
  const outside = await tempRepo("someone-else/code");
  t.after(outside.remove);
  assert.equal((await world.hook(sessionStart(outside.folder), { cwd: outside.folder })).code, 0);
  await background.output(/Not watching .+: its remotes aren't under the server's accounts/);
  await assert.rejects(callRunner(outside.folder, "situation", { executor: "claude-code" }));

  // After a restart it comes back without waiting for a session.
  assert.equal((await background.stop("SIGTERM")).code, 0);
  await eventually(async () =>
    assert.equal((await world.agents(world.owner))[world.owner.login], "offline"),
  );
  const again = world.launchCliIn(world.repo.folder, "runner", "background");
  t.after(() => again.stop("SIGTERM"));
  await again.output(/Watching /);
  await eventually(async () =>
    assert.equal((await world.agents(world.owner))[world.owner.login], "online"),
  );
});
