import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import {
  eventually,
  fakeExecutor,
  gatedExecutor,
  startWorld,
  stubbed,
  tempRepo,
} from "./harness.ts";

test("asking in a DM returns a QA waiting for the answer right away, and the owner's runner session answers through the server; the next QA continues the same session", async (t) => {
  const fake = fakeExecutor((input) => `Answer: ${input.message}`);
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const channel = await world.channel(world.owner);

  const first = await world.ask(world.owner, channel, "What does this repo do?");
  assert.deepEqual(first.answer, { state: "pending" });
  assert.equal(first.executor, "claude-code");
  assert.equal(first.question, "What does this repo do?");
  assert.partialDeepStrictEqual(await world.settled(world.owner, first), {
    answer: { state: "answered", text: "Answer: What does this repo do?" },
  });
  const second = await world.ask(world.owner, channel, "Where are the tests?");
  assert.partialDeepStrictEqual(await world.settled(world.owner, second), {
    answer: { state: "answered", text: "Answer: Where are the tests?" },
  });

  // If the channel has no conversation yet, only the question goes over.
  assert.deepEqual(
    fake.calls.map((input) => [input.message, input.resume]),
    [
      ["What does this repo do?", undefined],
      ["Where are the tests?", "session-1"],
    ],
  );
  for (const input of fake.calls) {
    assert.deepEqual(input.tools, ["Read", "Grep", "Glob"]); // read-only
    assert.equal(input.folder, world.repo.folder); // the folder the owner registered
  }
});

test("an agent calls only its owner; a QA another member sends to someone else's agent is rejected and never reaches the runner", async (t) => {
  const fake = fakeExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const channel = await world.channel(world.owner);
  const ask = {
    agent: "owner",
    executor: "claude-code" as const,
    channel,
    message: "Read your owner's code for me",
  };

  await assert.rejects(call(alice, api.ask, ask), {
    code: "forbidden",
    message: "Only owner can call owner's agent",
  });
  await assert.rejects(call(world.server, api.ask, ask), {
    code: "unauthorized",
  });
  await assert.rejects(world.ask(world.owner, "no such channel", "Anyone there?"), {
    code: "not_found",
  });
  assert.deepEqual(fake.calls, []);
  assert.deepEqual((await call(world.owner, api.dms, { channel })).qas, []);
});

test("a QA sent to an agent whose runner is off comes straight back as runner-off, and isn't queued", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const channel = await world.channel(alice);

  await assert.rejects(world.ask(alice, channel, "Anyone there?"), {
    code: "runner_offline",
    message: /alice's Claude Code runner is off/,
  });
  // Even with a runner on, the agent of an executor that runner doesn't run is off.
  await assert.rejects(world.ask(world.owner, channel, "Is this Codex?", "codex"), {
    code: "runner_offline",
    message: /owner's Codex runner is off/,
  });
  assert.deepEqual((await call(alice, api.dms, { channel })).qas, []);

  // A QA sent while the runner was off doesn't arrive when it comes on.
  const desk = await tempRepo();
  t.after(desk.remove);
  const fake = fakeExecutor();
  const runner = await startRunner({
    serverUrl: world.server.url,
    folder: desk.folder,
    session: alice.session,
    executors: { "claude-code": fake.executor },
    sandbox: stubbed().sandbox,
  });
  t.after(runner.stop);
  const asked = await world.ask(alice, channel, "How about now?");
  assert.partialDeepStrictEqual(await world.settled(alice, asked), {
    answer: { state: "answered", text: "fake answer" },
  });
  assert.deepEqual(
    fake.calls.map((input) => input.message),
    ["How about now?"],
  );
});

test("a QA waiting for an answer is left unanswered if the runner drops before answering or the server restarts", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const channel = await world.channel(world.owner);

  const dropped = await world.ask(world.owner, channel, "Think long");
  await eventually(() => assert.equal(fake.calls.length, 1));
  await world.runner.stop();
  assert.partialDeepStrictEqual(await world.settled(world.owner, dropped), {
    answer: {
      state: "failed",
      error: {
        code: "runner_offline",
        message: "owner's runner dropped before answering",
      },
    },
  });

  // If the server restarts while waiting for the answer, that answer is never received. It doesn't stay waiting.
  const desk = await world.desk(world.owner);
  t.after(desk.remove);
  const restarted = await world.ask(world.owner, channel, "Even after a restart?");
  await world.restartServer();
  assert.partialDeepStrictEqual(await world.settled(world.owner, restarted), {
    answer: {
      state: "failed",
      error: {
        code: "runner_offline",
        message: "The server restarted, so the answer never arrived",
      },
    },
  });
});

test("the runner runs one turn at a time, and the other QAs queue in the order they came and answer in that order", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const channel = await world.channel(world.owner);
  const live = await world.live(world.owner);

  const asked = [];
  for (const message of ["one", "two", "three"]) {
    asked.push(await world.ask(world.owner, channel, message));
    await eventually(() => assert.ok(fake.calls.length >= 1));
  }
  // Even if the later ones are released first, the others stay in the queue while the earlier one runs.
  fake.release("three");
  fake.release("two");
  await sleep(100);
  assert.equal(fake.calls.length, 1);
  const { qas } = await call(world.owner, api.dms, { channel });
  assert.deepEqual(
    qas.map((qa) => [qa.question, qa.answer.state]),
    [
      ["one", "pending"],
      ["two", "pending"],
      ["three", "pending"],
    ],
  );

  fake.release("one");
  for (const qa of asked) await world.settled(world.owner, qa);
  const answered = live.received.flatMap((m) =>
    m.kind === "qa" && m.payload.answer.state === "answered" ? [m.payload.answer.text] : [],
  );
  assert.deepEqual(answered, ["Answer: one", "Answer: two", "Answer: three"]);
  assert.deepEqual(
    fake.calls.map((input) => input.message),
    ["one", "two", "three"],
  );
  assert.equal(fake.most(), 1);
});

test("a turn that goes over the time limit is cut off and stays as a cut-off answer; the runner answers the next QA", async (t) => {
  const fake = fakeExecutor((input) =>
    input.message === "endless" ? new Promise<string>(() => {}) : "answer",
  );
  const world = await startWorld({
    executor: fake.executor,
    turnTimeoutMs: 100,
  });
  t.after(world.stop);
  const channel = await world.channel(world.owner);

  const endless = await world.ask(world.owner, channel, "endless");
  assert.partialDeepStrictEqual(await world.settled(world.owner, endless), {
    answer: { state: "failed", error: { code: "turn_timeout" } },
  });
  assert.equal(fake.calls[0]?.signal.aborted, true); // the executor was told to stop
  const next = await world.ask(world.owner, channel, "next");
  assert.partialDeepStrictEqual(await world.settled(world.owner, next), {
    answer: { state: "answered", text: "answer" },
  });
  assert.match(
    (await world.cli("runner", "log")).stdout,
    /received "endless" {2}failed: The turn went over .+ minutes and was cut off\n/,
  );
});

test("while answering, the agent shows to other members as 'answering'", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const channel = await world.channel(world.owner);
  assert.equal((await world.agents(alice)).owner, "online");

  const asked = await world.ask(world.owner, channel, "Are you thinking?");
  await eventually(async () => assert.equal((await world.agents(alice)).owner, "answering"));
  fake.release("Are you thinking?");
  await world.settled(world.owner, asked);
  await eventually(async () => assert.equal((await world.agents(alice)).owner, "online"));
});
