// DM에서 모델과 effort를 골라 묻기(#55, ADR-0020). 실행기는 러너의 실제 `claudeCode`, `codex`를 쓰고,
// 그것이 부르는 CLI만 가짜(test/fake-claude.ts, test/fake-codex.ts)다. 넘긴 플래그는 가짜 CLI가 받은 인자로 본다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { claudeCode, codex } from "@omagari/runner";
import { eventually, fakeClaude, fakeCodex, startWorld } from "./harness.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** 모델과 effort 플래그만 */
const picked = (args: string[] = []) =>
  args.filter((arg) => /^--(model|effort)=/.test(arg) || arg === "-m" || /^model_/.test(arg));

test("Claude Code: 러너가 붙을 때 고를 거리를 알리고, 고른 모델과 effort는 --model과 --effort로 넘긴다. 기본이면 넘기지 않는다", async (t) => {
  const fake = await fakeClaude(t);
  const world = await startWorld({ executors: { "claude-code": claudeCode } });
  t.after(world.stop);
  const agents = async () =>
    (await call(world.owner, api.members)).members.find((m) => m.login === "owner")?.agents;
  // "default"는 우리의 "기본"이라 빠지고 그 effort가 "기본"의 것이 된다. 같은 모델을 가리키는 이름은 하나만 남는다.
  assert.deepEqual(await agents(), [
    {
      executor: "claude-code",
      state: "online",
      choices: {
        models: [
          { id: "claude-opus-5-5", name: "Opus 5.5", efforts: EFFORTS },
          { id: "claude-fable-5-2", name: "Fable 5.2", efforts: EFFORTS },
          { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", efforts: [] },
        ],
        efforts: EFFORTS,
      },
    },
  ]);

  const channel = await world.channel(world.owner);
  const ask = async (message: string, pick?: { model?: string; effort?: string }) =>
    (
      await world.settled(
        world.owner,
        await world.ask(world.owner, channel, message, "claude-code", pick),
      )
    ).answer;
  // 기본이면 플래그가 없고, 답한 모델은 실행기가 알린 것(system/init)을 고를 거리의 이름으로 쓴다. effort는 모른다.
  assert.deepEqual(await ask("처음"), {
    state: "answered",
    text: "Claude: 처음",
    source: { branch: "main", commit: await world.repo.git("rev-parse", "HEAD"), dirty: false },
    model: "Fable 5.2",
  });
  // 이어 가는 채널 세션에서도 모델을 바꿔 넘긴다.
  assert.partialDeepStrictEqual(await ask("깊게", { model: "claude-opus-5-5", effort: "high" }), {
    state: "answered",
    model: "Opus 5.5",
    effort: "high",
  });
  assert.partialDeepStrictEqual(await ask("빠르게", { effort: "low" }), {
    model: "Fable 5.2",
    effort: "low",
  });
  // `@호출`도 같은 채널 세션이고 고른 값을 그대로 넘긴다.
  const called = await call(world.owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel,
    message: "모두에게",
    visibility: "public",
    model: "claude-haiku-4-5-20251001",
  });
  assert.partialDeepStrictEqual((await world.settled(world.owner, called.qa)).answer, {
    model: "Haiku 4.5",
  });

  const calls = await fake.calls();
  assert.deepEqual(
    calls.map((c) => picked(c.args)),
    [
      [],
      ["--model=claude-opus-5-5", "--effort=high"],
      ["--effort=low"],
      ["--model=claude-haiku-4-5-20251001"],
    ],
  );
  // 첫 턴이 띄운 세션을 나머지가 잇는다.
  const resumed = calls.map((c) => c.args.find((arg) => arg.startsWith("--resume=")));
  assert.equal(resumed[0], undefined);
  assert.equal(new Set(resumed.slice(1)).size, 1);
  assert.ok(resumed[1]);

  // 러너가 떨어지면 고를 거리도 없다.
  await world.runner.stop();
  await eventually(async () =>
    assert.deepEqual(await agents(), [
      { executor: "claude-code", state: "offline", choices: { models: [], efforts: [] } },
    ]),
  );
});

test("Codex: 고른 모델과 effort는 -m과 -c model_reasoning_effort=로 resume 앞에 넘긴다. 숨긴 모델은 고를 거리에 없고, 기본으로 물은 답에는 모델이 없다", async (t) => {
  const fake = await fakeCodex(t);
  const world = await startWorld({ executors: { codex } });
  t.after(world.stop);
  const [agent] =
    (await call(world.owner, api.members)).members.find((m) => m.login === "owner")?.agents ?? [];
  // "기본"의 effort는 Codex가 기본으로 둔 모델의 것이다.
  assert.deepEqual(agent?.choices, {
    models: [
      { id: "gpt-6-luna", name: "GPT-6-Luna", efforts: EFFORTS },
      { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", efforts: [...EFFORTS, "ultra"] },
    ],
    efforts: EFFORTS,
  });

  const channel = await world.channel(world.owner);
  const ask = async (message: string, pick?: { model?: string; effort?: string }) =>
    (
      await world.settled(
        world.owner,
        await world.ask(world.owner, channel, message, "codex", pick),
      )
    ).answer;
  const plain = await ask("처음");
  assert.equal(plain.state, "answered");
  assert.equal("model" in plain, false); // Codex는 답한 모델을 알려 주지 않는다. 모르면 배지를 달지 않는다.
  assert.partialDeepStrictEqual(await ask("깊게", { model: "gpt-5.6-terra", effort: "ultra" }), {
    state: "answered",
    text: "Codex: 깊게",
    model: "GPT-5.6-Terra",
    effort: "ultra",
  });

  const [first, second] = await fake.calls();
  assert.deepEqual(picked(first?.args), []);
  const thread = second?.args.at(-2) ?? "";
  assert.deepEqual(second?.args.slice(-7), [
    "-m",
    "gpt-5.6-terra",
    "-c",
    "model_reasoning_effort=ultra",
    "resume",
    thread,
    "-",
  ]);
});

test("러너는 알린 고를 거리에 없는 모델이나, 고른 모델에 없는 effort로 온 질문을 실행기에 넘기지 않고 오류로 답한다", async (t) => {
  const fake = await fakeClaude(t);
  const world = await startWorld({ executors: { "claude-code": claudeCode } });
  t.after(world.stop);
  const channel = await world.channel(world.owner);
  const ask = async (pick: { model?: string; effort?: string }) =>
    (
      await world.settled(
        world.owner,
        await world.ask(world.owner, channel, "질문", "claude-code", pick),
      )
    ).answer;

  assert.deepEqual(await ask({ model: "--dangerously-skip-permissions" }), {
    state: "failed",
    error: {
      code: "invalid_message",
      message: "Claude Code가 알리지 않은 모델이다: --dangerously-skip-permissions",
    },
  });
  assert.deepEqual(await ask({ model: "claude-haiku-4-5-20251001", effort: "high" }), {
    state: "failed",
    error: { code: "invalid_message", message: "Haiku 4.5에 고를 수 없는 effort다: high" },
  });
  assert.deepEqual(await ask({ effort: "ultra" }), {
    state: "failed",
    error: { code: "invalid_message", message: "기본 모델에 고를 수 없는 effort다: ultra" },
  });
  assert.deepEqual(await fake.calls(), []);
});
