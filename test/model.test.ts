// Choosing a model and effort when asking in a DM (#55, ADR-0020). The executors are the runner's real `claudeCode` and `codex`;
// only the CLIs they call are fake (test/fake-claude.ts, test/fake-codex.ts). The flags passed are read from the args the fake CLI received.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { claudeCode, codex } from "@omagari/runner";
import { eventually, fakeClaude, fakeCodex, REPO, startWorld } from "./harness.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Only the model and effort flags */
const picked = (args: string[] = []) =>
  args.filter((arg) => /^--(model|effort)=/.test(arg) || arg === "-m" || /^model_/.test(arg));

test("Claude Code: announces the choices when the runner connects; the chosen model and effort go as --model and --effort, and the default sends nothing", async (t) => {
  const fake = await fakeClaude(t);
  const world = await startWorld({ executors: { "claude-code": claudeCode } });
  t.after(world.stop);
  const agents = async () =>
    (await call(world.owner, api.members)).members.find((m) => m.login === "owner")?.agents;
  // "default" is our "Default", so it is left out and its effort values become the "Default" ones. Names for the same model appear once.
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
  // With the default there are no flags, and the answering model is named from the choices using what the executor reported (system/init). The effort is unknown.
  assert.deepEqual(await ask("first"), {
    state: "answered",
    text: "Claude: first",
    source: {
      branch: "main",
      commit: await world.repo.git("rev-parse", "HEAD"),
      dirty: false,
      repo: REPO,
    },
    model: "Fable 5.2",
  });
  // A resumed channel session also passes a changed model.
  assert.partialDeepStrictEqual(await ask("deep", { model: "claude-opus-5-5", effort: "high" }), {
    state: "answered",
    model: "Opus 5.5",
    effort: "high",
  });
  assert.partialDeepStrictEqual(await ask("fast", { effort: "low" }), {
    model: "Fable 5.2",
    effort: "low",
  });
  // An `@` call is the same channel session and passes the chosen values as they are.
  const called = await call(world.owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel,
    message: "to everyone",
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
  // The rest resume the session the first turn started.
  const resumed = calls.map((c) => c.args.find((arg) => arg.startsWith("--resume=")));
  assert.equal(resumed[0], undefined);
  assert.equal(new Set(resumed.slice(1)).size, 1);
  assert.ok(resumed[1]);

  // If the runner drops, there are no choices either.
  await world.runner.stop();
  await eventually(async () =>
    assert.deepEqual(await agents(), [
      {
        executor: "claude-code",
        state: "offline",
        choices: { models: [], efforts: [] },
      },
    ]),
  );
});

test("Codex: the chosen model and effort go before resume as -m and -c model_reasoning_effort=; a hidden model isn't in the choices, and a default ask has no model in the answer", async (t) => {
  const fake = await fakeCodex(t);
  const world = await startWorld({ executors: { codex } });
  t.after(world.stop);
  const [agent] =
    (await call(world.owner, api.members)).members.find((m) => m.login === "owner")?.agents ?? [];
  // The "Default" effort values belong to the model Codex uses by default.
  assert.deepEqual(agent?.choices, {
    models: [
      { id: "gpt-6-luna", name: "GPT-6-Luna", efforts: EFFORTS },
      {
        id: "gpt-5.6-terra",
        name: "GPT-5.6-Terra",
        efforts: [...EFFORTS, "ultra"],
      },
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
  const plain = await ask("first");
  assert.equal(plain.state, "answered");
  assert.equal("model" in plain, false); // Codex doesn't say which model answered. If unknown, no badge is added.
  assert.partialDeepStrictEqual(await ask("deep", { model: "gpt-5.6-terra", effort: "ultra" }), {
    state: "answered",
    text: "Codex: deep",
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

test("the runner doesn't pass a question to the executor and answers with an error when the model isn't in the announced choices or the effort isn't on the chosen model", async (t) => {
  const fake = await fakeClaude(t);
  const world = await startWorld({ executors: { "claude-code": claudeCode } });
  t.after(world.stop);
  const channel = await world.channel(world.owner);
  const ask = async (pick: { model?: string; effort?: string }) =>
    (
      await world.settled(
        world.owner,
        await world.ask(world.owner, channel, "question", "claude-code", pick),
      )
    ).answer;

  assert.deepEqual(await ask({ model: "--dangerously-skip-permissions" }), {
    state: "failed",
    error: {
      code: "invalid_message",
      message: "Claude Code didn't report this model: --dangerously-skip-permissions",
    },
  });
  assert.deepEqual(await ask({ model: "claude-haiku-4-5-20251001", effort: "high" }), {
    state: "failed",
    error: {
      code: "invalid_message",
      message: "This effort can't be chosen for Haiku 4.5: high",
    },
  });
  assert.deepEqual(await ask({ effort: "ultra" }), {
    state: "failed",
    error: {
      code: "invalid_message",
      message: "This effort can't be chosen for the default model: ultra",
    },
  });
  assert.deepEqual(await fake.calls(), []);
});
