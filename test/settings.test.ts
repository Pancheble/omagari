import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, fakeSandbox, startWorld, tempRepo, writer } from "./harness.ts";

test("settings read my switch, how many my agent answered, and the last question", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("bob");
  const bob = await world.login("bob");
  const fake = fakeExecutor((input) => `bob's answer ${input.message.length}`);
  const desk = await world.desk(bob, undefined, {
    "claude-code": fake.executor,
  });
  t.after(desk.remove);

  // At first it's on, and nothing has been answered.
  const first = await call(bob, api.settings);
  assert.equal(first.askSwitch, true);
  assert.deepEqual(first.answered, { count: 0, last: null });

  // When owner asks twice and bob's agent answers, it's counted for bob and the last question shows. It isn't counted for the asker.
  for (const question of ["Should charge() add a retry?", "Who calls calcRefund()?"]) {
    const asked = await world.cli("ask", "bob", question);
    assert.equal(asked.code, 0, asked.stderr);
  }
  const answered = await eventually(async () => {
    const { answered } = await call(bob, api.settings);
    assert.equal(answered.count, 2);
    return answered;
  });
  assert.equal(answered.last?.login, "owner");
  assert.equal(answered.last?.name, "owner"); // the login if there's no profile name
  assert.equal(answered.last?.text, "Who calls calcRefund()?");
  assert.deepEqual((await call(world.owner, api.settings)).answered, {
    count: 0,
    last: null,
  });

  // Only my own switch changes, and it stays after reading again.
  await call(bob, api.setAskSwitch, { on: false });
  assert.equal((await call(bob, api.settings)).askSwitch, false);
  assert.equal((await call(world.owner, api.settings)).askSwitch, true);
});

test("settings read the repo's check command and my runner's merge run, follow turning the runner off and on or off at the runner, and can't be turned on or off from the web", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld({
    sandbox: fakeSandbox().sandbox,
    observeMs: 50,
  });
  t.after(world.stop);
  const mergeCheck = async (as: { url: string; session: string }) =>
    (await call(as, api.settings)).mergeCheck;

  // owner's runner, which has a sandbox, is on, and the default branch has no config file.
  await eventually(async () =>
    assert.deepEqual(await mergeCheck(world.owner), {
      runner: "on",
      check: { problem: "missing" },
    }),
  );

  // bob's runner, with no sandbox tool. Turning the runner off makes it off, and turning it on again brings it back.
  world.github.grant("bob");
  const bob = await world.login("bob");
  const desk = await world.desk(bob);
  t.after(desk.remove);
  assert.equal((await mergeCheck(bob)).runner, "no_sandbox");
  await desk.stop();
  assert.equal((await mergeCheck(bob)).runner, "offline");
  await desk.start();
  assert.equal((await mergeCheck(bob)).runner, "no_sandbox");
  assert.equal((await mergeCheck(world.owner)).runner, "on"); // only my own runner's is read

  // When alice turns it off at the runner (omagari runner --merge-check off), it's switched off.
  world.github.grant("alice");
  const aliceDesk = await tempRepo();
  t.after(aliceDesk.remove);
  const runner = world.launchCliIn(aliceDesk.folder, "runner", "--merge-check", "off");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/enter code (\S+) /);
  world.github.approve(code as string, "alice");
  await runner.output(/Runner started/);
  const alice = await world.login("alice");
  assert.equal((await mergeCheck(alice)).runner, "off");
  await runner.stop();
  assert.equal((await mergeCheck(alice)).runner, "offline");

  // When the config file merges into the default branch, the runner reads it at the next observation and reports it. If the shape is wrong, that's the reason.
  const merge = async (content: string) => {
    await writer(world.repo.folder)(".omagari.json", content);
    await world.repo.git("add", "--all");
    await world.repo.git("commit", "--message=merged");
    await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  };
  await merge('{"chek": "npm test"}');
  await eventually(async () =>
    assert.deepEqual((await mergeCheck(bob)).check, { problem: "invalid" }),
  );
  await merge('{"check": "npm test", "setup": "npm ci"}');
  await eventually(async () =>
    assert.deepEqual((await mergeCheck(bob)).check, {
      config: { check: "npm test", setup: "npm ci" },
    }),
  );

  // The web API has no way to turn the merge run on or off (ADR-0034).
  assert.deepEqual(
    Object.values(api).filter((route) => /merge|check/i.test(route.path)),
    [],
  );
});
