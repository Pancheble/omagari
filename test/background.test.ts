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

test("the background runner starts the runner of a repo where one ran before once a session starts there, and leaves other repos alone", async (t) => {
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

  // A repo where no runner ever ran isn't started.
  const fresh = await tempRepo();
  t.after(fresh.remove);
  assert.equal((await world.hook(sessionStart(fresh.folder), { cwd: fresh.folder })).code, 0);
  await background.output(/Not watching .+: no runner has run in this repo yet/);
  await assert.rejects(callRunner(fresh.folder, "situation", { executor: "claude-code" }));

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
