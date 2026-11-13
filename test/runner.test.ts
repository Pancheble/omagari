import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeExecutor, startWorld } from "./harness.ts";

test("터미널에서 물으면 러너 세션이 답하고, 다음 질문이 같은 세션으로 이어진다", async (t) => {
  const fake = fakeExecutor((input) => `답: ${input.message}`);
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.deepEqual(await world.cli("runner", "ask", "이 레포는 뭘 하나?"), {
    code: 0,
    stdout: "답: 이 레포는 뭘 하나?\n",
    stderr: "",
  });
  assert.equal(
    (await world.cli("runner", "ask", "테스트는", "어디에?")).stdout,
    "답: 테스트는 어디에?\n",
  );

  assert.deepEqual(
    fake.calls.map((call) => call.resume),
    [undefined, "session-1"],
  );
  for (const call of fake.calls) {
    // 읽기 전용: 파일을 쓰거나 명령을 실행하는 도구가 없다.
    assert.deepEqual(call.tools, ["Read", "Grep", "Glob"]);
    assert.equal(call.folder, world.repo.folder);
  }
});

test("실행기가 실패하거나 답 없이 끝나면 오류가 돌아오고, 러너는 같은 세션으로 계속 답한다", async (t) => {
  const fake = fakeExecutor((input) => {
    if (input.message === "죽어") throw new Error("실행기가 죽었다");
    return input.message === "말하지 마" ? " \n" : "답";
  });
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.equal((await world.cli("runner", "ask", "처음")).code, 0);

  const died = await world.cli("runner", "ask", "죽어");
  assert.equal(died.code, 1);
  assert.match(died.stderr, /실행기가 죽었다/);

  const silent = await world.cli("runner", "ask", "말하지 마");
  assert.equal(silent.code, 1);
  assert.match(silent.stderr, /답 없이 끝났다/);

  assert.deepEqual(await world.cli("runner", "ask", "다시"), {
    code: 0,
    stdout: "답\n",
    stderr: "",
  });
  assert.equal(fake.calls.at(-1)?.resume, "session-1");
});

test("러너가 실행한 것(언제, 어느 세션으로, 무엇을 받아)이 주인 기기에 남고 주인이 본다", async (t) => {
  const fake = fakeExecutor((input) => {
    if (input.message === "죽어") throw new Error("실행기가 죽었다");
    return "답";
  });
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.match((await world.cli("runner", "log")).stdout, /아직 없다/);
  await world.cli("runner", "ask", "첫 질문");
  await world.cli("runner", "ask", "죽어");

  const { code, stdout } = await world.cli("runner", "log");
  assert.equal(code, 0);
  const [first, second, ...more] = stdout.trimEnd().split("\n");
  assert.deepEqual(more, []);
  assert.match(
    first,
    /^\d{4}-\d\d-\d\dT\S+ {2}세션 session-1 {2}도구 Read,Grep,Glob {2}받은 것 "첫 질문" {2}답함 "답"$/,
  );
  assert.match(second, /세션 session-1 .*받은 것 "죽어" {2}실패: 실행기가 죽었다$/);
});
