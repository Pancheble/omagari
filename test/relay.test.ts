import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { eventually, fakeExecutor, startWorld, tempRepo } from "./harness.ts";

type Member = { url: string; session: string; login: string };

/** `as`가 `agent`(기본은 자기)의 에이전트에게 API로 묻는다. */
const ask = (as: Member, message: string, agent = as.login) =>
  call(as, api.ask, { agent, message });

/** 문답마다 `release(message)`로 풀어 줄 때까지 답하지 않는 가짜 실행기. 동시에 돈 턴의 최대 수를 센다. */
function gatedExecutor() {
  const gates = new Map<string, PromiseWithResolvers<string>>();
  const gate = (message: string) => {
    if (!gates.has(message)) gates.set(message, Promise.withResolvers());
    return gates.get(message) as PromiseWithResolvers<string>;
  };
  let running = 0;
  let most = 0;
  const fake = fakeExecutor(async ({ message }) => {
    most = Math.max(most, ++running);
    try {
      return await gate(message).promise;
    } finally {
      running--;
    }
  });
  return {
    ...fake,
    release: (message: string) => gate(message).resolve(`답: ${message}`),
    most: () => most,
  };
}

test("API로 물으면 서버를 거쳐 주인의 러너 세션이 답하고, 다음 문답이 같은 세션으로 이어진다", async (t) => {
  const fake = fakeExecutor((input) => `답: ${input.message}`);
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.deepEqual(await ask(world.owner, "이 레포는 뭘 하나?"), {
    answer: "답: 이 레포는 뭘 하나?",
  });
  assert.deepEqual(await ask(world.owner, "테스트는 어디에?"), { answer: "답: 테스트는 어디에?" });

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

  await assert.rejects(ask(alice, "네 주인 코드를 읽어 줘", "owner"), {
    code: "forbidden",
    message: "owner의 에이전트는 owner만 부를 수 있다",
  });
  await assert.rejects(call(world.server, api.ask, { agent: "owner", message: "로그인 없이" }), {
    code: "unauthorized",
  });
  assert.deepEqual(fake.calls, []);
});

test("러너가 꺼진 에이전트에게 보낸 문답은 바로 러너가 꺼져 있다고 돌아오고, 쌓아 두지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  await assert.rejects(ask(alice, "거기 있나?"), {
    code: "runner_offline",
    message: /alice의 러너가 꺼져 있다/,
  });

  // 러너를 켜도 꺼져 있을 때 보낸 문답은 오지 않는다.
  const desk = await tempRepo();
  t.after(desk.remove);
  const fake = fakeExecutor();
  const runner = await startRunner({
    serverUrl: world.server.url,
    folder: desk.folder,
    session: alice.session,
    executor: fake.executor,
  });
  t.after(runner.stop);
  assert.deepEqual(await ask(alice, "이제는?"), { answer: "가짜 답" });
  assert.deepEqual(
    fake.calls.map((input) => input.message),
    ["이제는?"],
  );
});

test("러너가 답하기 전에 떨어지면 기다리던 문답은 러너가 꺼졌다고 돌아온다", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  const asked = ask(world.owner, "길게 생각해");
  await eventually(() => assert.equal(fake.calls.length, 1));
  await world.runner.stop();
  await assert.rejects(asked, { code: "runner_offline", message: /답하기 전에 떨어졌다/ });
});

test("러너는 한 번에 한 턴만 돌리고, 나머지 문답은 온 순서대로 줄을 선다", async (t) => {
  const fake = gatedExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  const answers: string[] = [];
  const asked: Promise<unknown>[] = [];
  for (const message of ["하나", "둘", "셋"]) {
    asked.push(ask(world.owner, message).then(({ answer }) => answers.push(answer)));
    await eventually(() => assert.ok(fake.calls.length >= 1));
    await sleep(50); // 다음 문답이 이것보다 늦게 오게 한다
  }
  assert.equal(fake.calls.length, 1); // "하나"가 도는 동안 나머지는 줄에 있다

  // 뒤의 것부터 풀어도 줄의 순서대로 답한다.
  for (const message of ["셋", "둘", "하나"]) fake.release(message);
  await Promise.all(asked);
  assert.deepEqual(answers, ["답: 하나", "답: 둘", "답: 셋"]);
  assert.deepEqual(
    fake.calls.map((input) => input.message),
    ["하나", "둘", "셋"],
  );
  assert.equal(fake.most(), 1);
});

test("한 턴이 시간 상한을 넘으면 끊고 끊겼다고 돌려준다. 러너는 다음 문답에 답한다", async (t) => {
  const fake = fakeExecutor((input) =>
    input.message === "끝없이" ? new Promise<string>(() => {}) : "답",
  );
  const world = await startWorld({ executor: fake.executor, turnTimeoutMs: 100 });
  t.after(world.stop);

  await assert.rejects(ask(world.owner, "끝없이"), {
    code: "turn_timeout",
    message: /한 턴이 .+분을 넘어 끊었다/,
  });
  assert.equal(fake.calls[0]?.signal.aborted, true); // 실행기에 끄라고 알렸다
  assert.deepEqual(await ask(world.owner, "다음"), { answer: "답" });
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
  assert.equal((await world.agents(alice)).owner, "online");

  const asked = ask(world.owner, "생각 중이야?");
  await eventually(async () => assert.equal((await world.agents(alice)).owner, "answering"));
  fake.release("생각 중이야?");
  await asked;
  assert.equal((await world.agents(alice)).owner, "online");
});
