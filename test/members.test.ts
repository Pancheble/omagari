import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, place, startWorld, textOf, writer } from "./harness.ts";

/** That of an executor (fake) that doesn't report anything to choose from. What to choose from is checked by model.test. */
const none = { models: [], efforts: [] };

test("the member list shows each person's name, each executor's agent, and one status line per work; when the runner drops, the agent is offline and works stay based on the time it dropped", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.names.set("alice", "Zoe Kim");
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  await world.login("bob"); // a member who never turned a runner on

  // alice works on two works in worktrees linked to the registered folder.
  const desk = await world.desk(alice);
  t.after(desk.remove);
  const tree = await place(t);
  await desk.git("switch", "--create", "payment");
  await writer(desk.folder)("payment.ts", "pay\n");
  await desk.git("worktree", "add", "-b", "refund", tree("refund"));
  await writer(tree("refund"))("refund.ts", "refund\n");
  const { at } = await call(alice, api.setStatus, {
    branch: "payment",
    text: "wiring up payment",
    executor: "claude-code",
  });

  const members = async () => (await call(world.owner, api.members)).members;
  const aliceOf = async () => (await members()).find((member) => member.login === "alice");
  // If observation runs after the worktree is added and before the file is written, refund first arrives as a work with no changes (no lines).
  // Wait not for the number of works but until both works' lines have arrived.
  await eventually(async () =>
    assert.deepEqual(
      (await aliceOf())?.works.map(
        (work) => work.line && ("text" in work.line ? work.line.text : work.line.file),
      ),
      ["wiring up payment", "refund.ts"],
    ),
  );

  const all = await members();
  // In name order. A person with no name uses the id as the name.
  assert.deepEqual(
    all.map((member) => member.name),
    ["Zoe Kim", "bob", "owner"],
  );
  assert.deepEqual(
    all.find((member) => member.login === "bob"),
    {
      login: "bob",
      name: "bob",
      avatar: null,
      presence: "offline", // never opened a web window
      message: null,
      emoji: null,
      agents: [],
      offlineSince: null,
      works: [],
    },
  );
  assert.deepEqual(await aliceOf(), {
    login: "alice",
    name: "Zoe Kim",
    avatar: null,
    presence: "offline",
    message: null,
    emoji: null,
    agents: [{ executor: "claude-code", state: "online", choices: none }],
    offlineSince: null,
    works: [
      {
        branch: "payment",
        executor: "claude-code",
        line: { source: "agent", text: "wiring up payment", at },
        conflict: false,
        broken: false,
      },
      {
        branch: "refund",
        executor: null, // only observation, and never sent a hook or status set (ADR-0015)
        line: { source: "files", file: "refund.ts", more: 0 },
        conflict: false,
        broken: false,
      },
    ],
  });

  const stopped = Date.now();
  await desk.stop();
  const offline = await eventually(async () => {
    const view = await aliceOf();
    assert.notEqual(view?.offlineSince, null);
    return view;
  });
  assert.ok(Date.parse(offline?.offlineSince as string) >= stopped);
  assert.deepEqual(offline?.agents, [{ executor: "claude-code", state: "offline", choices: none }]);
  assert.deepEqual(
    offline?.works.map((work) => [
      work.branch,
      work.line && ("text" in work.line ? work.line.text : work.line.file),
    ]),
    [
      ["payment", "wiring up payment"],
      ["refund", "refund.ts"],
    ],
  );

  // Even if the server restarts, the agent stays offline.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual((await aliceOf())?.agents, [
      { executor: "claude-code", state: "offline", choices: none },
    ]),
  );
});

test("the web gets the member list right away over the live connection, and follows changes to works, status lines and agents without a refresh. When the session ends the connection closes", async (t) => {
  const answer = Promise.withResolvers<string>();
  const world = await startWorld({
    observeMs: 50,
    executor: fakeExecutor(() => answer.promise).executor,
  });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  const live = await world.live(alice);
  const owner = () => live.members().find((member) => member.login === "owner");
  await eventually(() =>
    assert.deepEqual(owner()?.agents, [
      { executor: "claude-code", state: "online", choices: none },
    ]),
  );

  // A work with no changes, no status line, and no claim isn't shown whatever the branch is (ADR-0006).
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
  assert.deepEqual(owner()?.works, []);
  await world.signInCli(world.owner);
  assert.match((await world.cli("status")).stdout, /owner · .*\n {2}no Work/);
  await writer(world.repo.folder)("payment.ts", "pay\n");
  await eventually(() =>
    assert.deepEqual(owner()?.works[0]?.line, { source: "files", file: "payment.ts", more: 0 }),
  );
  await call(world.owner, api.setStatus, { branch: "payment", text: "wiring up payment" });
  await eventually(() => assert.equal(textOf(owner()?.works[0]?.line), "wiring up payment"));

  // While answering a Q&A, it is answering.
  const channel = await world.channel(world.owner);
  const asked = await world.ask(world.owner, channel, "where is payment done?");
  await eventually(() => assert.equal(owner()?.agents[0]?.state, "answering"));
  answer.resolve("it's done in payment.ts");
  await world.settled(world.owner, asked);
  await eventually(() => assert.equal(owner()?.agents[0]?.state, "online"));

  await world.runner.stop();
  await eventually(() => {
    assert.equal(owner()?.agents[0]?.state, "offline");
    assert.notEqual(owner()?.offlineSince, null);
  });

  await call(alice, api.logout);
  assert.equal(await live.closed, 1008);
});
