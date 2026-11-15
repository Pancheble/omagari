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

test("DM으로 물으면 답을 기다리는 문답이 바로 오고, 서버를 거쳐 주인의 러너 세션이 답한다. 다음 문답은 같은 세션으로 이어진다", async (t) => {
  const fake = fakeExecutor((input) => `답: ${input.message}`);
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const channel = await world.channel(world.owner);

  const first = await world.ask(world.owner, channel, "이 레포는 뭘 하나?");
  assert.deepEqual(first.answer, { state: "pending" });
  assert.equal(first.executor, "claude-code");
  assert.equal(first.question, "이 레포는 뭘 하나?");
  assert.partialDeepStrictEqual(await world.settled(world.owner, first), {
    answer: { state: "answered", text: "답: 이 레포는 뭘 하나?" },
  });
  const second = await world.ask(world.owner, channel, "테스트는 어디에?");
  assert.partialDeepStrictEqual(await world.settled(world.owner, second), {
    answer: { state: "answered", text: "답: 테스트는 어디에?" },
  });

  // 채널에 대화가 없으면 질문만 넘어간다.
  assert.deepEqual(
    fake.calls.map((input) => [input.message, input.resume]),
    [
      ["이 레포는 뭘 하나?", undefined],
      ["테스트는 어디에?", "session-1"],
    ],
  );
  for (const input of fake.calls) {
    assert.deepEqual(input.tools, ["Read", "Grep", "Glob"]); // 읽기 전용
    assert.equal(input.folder, world.repo.folder); // 주인이 등록한 폴더
  }
});

test("에이전트는 주인만 부른다. 다른 멤버가 남의 에이전트에게 보낸 문답은 거절되고 러너에 닿지 않는다", async (t) => {
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
    message: "네 주인 코드를 읽어 줘",
  };

  await assert.rejects(call(alice, api.ask, ask), {
    code: "forbidden",
    message: "owner의 에이전트는 owner만 부를 수 있다",
  });
  await assert.rejects(call(world.server, api.ask, ask), { code: "unauthorized" });
  await assert.rejects(world.ask(world.owner, "없는 채널", "거기 있나?"), { code: "not_found" });
  assert.deepEqual(fake.calls, []);
  assert.deepEqual((await call(world.owner, api.dms, { channel })).qas, []);
});

test("러너가 꺼진 에이전트에게 보낸 문답은 바로 러너가 꺼져 있다고 돌아오고, 쌓아 두지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const channel = await world.channel(alice);

  await assert.rejects(world.ask(alice, channel, "거기 있나?"), {
    code: "runner_offline",
    message: /alice의 Claude Code 러너가 꺼져 있다/,
  });
  // 러너를 켜도 그 러너가 돌리지 않는 실행기의 에이전트는 꺼져 있다.
  await assert.rejects(world.ask(world.owner, channel, "Codex야?", "codex"), {
    code: "runner_offline",
    message: /owner의 Codex 러너가 꺼져 있다/,
  });
  assert.deepEqual((await call(alice, api.dms, { channel })).qas, []);

  // 러너를 켜도 꺼져 있을 때 보낸 문답은 오지 않는다.
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
  const asked = await world.ask(alice, channel, "이제는?");
  assert.partialDeepStrictEqual(await world.settled(alice, asked), {
    answer: { state: "answered", text: "가짜 답" },
  });
  assert.deepEqual(
    fake.calls.map((input) => input.message),
    ["이제는?"],
  );
});

test("러너가 답하기 전에 떨어지거나 서버가 다시 뜨면 기다리던 문답은 답하지 못한 것으로 남는다", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const channel = await world.channel(world.owner);

  const dropped = await world.ask(world.owner, channel, "길게 생각해");
  await eventually(() => assert.equal(fake.calls.length, 1));
  await world.runner.stop();
  assert.partialDeepStrictEqual(await world.settled(world.owner, dropped), {
    answer: {
      state: "failed",
      error: { code: "runner_offline", message: "owner의 러너가 답하기 전에 떨어졌다" },
    },
  });

  // 답을 기다리는 동안 서버가 다시 뜨면 그 답은 받지 못한다. 기다리는 채로 남지 않는다.
  const desk = await world.desk(world.owner);
  t.after(desk.remove);
  const restarted = await world.ask(world.owner, channel, "다시 떠도?");
  await world.restartServer();
  assert.partialDeepStrictEqual(await world.settled(world.owner, restarted), {
    answer: {
      state: "failed",
      error: { code: "runner_offline", message: "서버가 다시 떠서 답을 받지 못했다" },
    },
  });
});

test("러너는 한 번에 한 턴만 돌리고, 나머지 문답은 온 순서대로 줄을 서서 그 순서대로 답이 온다", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const channel = await world.channel(world.owner);
  const live = await world.live(world.owner);

  const asked = [];
  for (const message of ["하나", "둘", "셋"]) {
    asked.push(await world.ask(world.owner, channel, message));
    await eventually(() => assert.ok(fake.calls.length >= 1));
  }
  // 뒤의 것부터 풀어도 앞의 것이 도는 동안 나머지는 줄에 있다.
  fake.release("셋");
  fake.release("둘");
  await sleep(100);
  assert.equal(fake.calls.length, 1);
  const { qas } = await call(world.owner, api.dms, { channel });
  assert.deepEqual(
    qas.map((qa) => [qa.question, qa.answer.state]),
    [
      ["하나", "pending"],
      ["둘", "pending"],
      ["셋", "pending"],
    ],
  );

  fake.release("하나");
  for (const qa of asked) await world.settled(world.owner, qa);
  const answered = live.received.flatMap((m) =>
    m.kind === "qa" && m.payload.answer.state === "answered" ? [m.payload.answer.text] : [],
  );
  assert.deepEqual(answered, ["답: 하나", "답: 둘", "답: 셋"]);
  assert.deepEqual(
    fake.calls.map((input) => input.message),
    ["하나", "둘", "셋"],
  );
  assert.equal(fake.most(), 1);
});

test("한 턴이 시간 상한을 넘으면 끊고 끊긴 답으로 남긴다. 러너는 다음 문답에 답한다", async (t) => {
  const fake = fakeExecutor((input) =>
    input.message === "끝없이" ? new Promise<string>(() => {}) : "답",
  );
  const world = await startWorld({ executor: fake.executor, turnTimeoutMs: 100 });
  t.after(world.stop);
  const channel = await world.channel(world.owner);

  const endless = await world.ask(world.owner, channel, "끝없이");
  assert.partialDeepStrictEqual(await world.settled(world.owner, endless), {
    answer: { state: "failed", error: { code: "turn_timeout" } },
  });
  assert.equal(fake.calls[0]?.signal.aborted, true); // 실행기에 끄라고 알렸다
  const next = await world.ask(world.owner, channel, "다음");
  assert.partialDeepStrictEqual(await world.settled(world.owner, next), {
    answer: { state: "answered", text: "답" },
  });
  assert.match(
    (await world.cli("runner", "log")).stdout,
    /받은 것 "끝없이" {2}실패: 한 턴이 .+분을 넘어 끊었다\n/,
  );
});

test("답하는 동안 그 에이전트가 다른 멤버에게 '답하는 중'으로 보인다", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const channel = await world.channel(world.owner);
  assert.equal((await world.agents(alice)).owner, "online");

  const asked = await world.ask(world.owner, channel, "생각 중이야?");
  await eventually(async () => assert.equal((await world.agents(alice)).owner, "answering"));
  fake.release("생각 중이야?");
  await world.settled(world.owner, asked);
  await eventually(async () => assert.equal((await world.agents(alice)).owner, "online"));
});
