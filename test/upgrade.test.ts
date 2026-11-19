import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, said, startWorld } from "./harness.ts";

test("v0.1.0이 만든 DB로도 뜨고, 예전 메시지는 그대로 읽히며, 문답을 글과 함께 올린다", async (t) => {
  const world = await startWorld({
    executor: fakeExecutor().executor,
    seed: await readFile(new URL("./v0.1.0.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // 예전 글과, 글 없이 올라간 예전 문답이 그대로다.
  const before = (await call(alice, api.history, { channel: "c0" })).messages;
  assert.deepEqual(before.map(said), ["예전 글", "문답: 예전에 올린 질문"]);
  assert.equal("text" in (before[1] ?? {}), false);

  const qa = await world.settled(world.owner, await world.ask(world.owner, "c0", "새 질문"));
  const { message } = await call(world.owner, api.postQa, { qa: qa.id, text: "같이 봐 주세요" });
  assert.equal(message.kind === "qa" && message.text, "같이 봐 주세요");
  assert.deepEqual((await call(alice, api.history, { channel: "c0" })).messages, [
    ...before,
    message,
  ]);
  // 그 판 뒤에 더한 상태 메시지의 이모지도 쓴다.
  assert.deepEqual(await call(alice, api.setStatusMessage, { message: "회의 중", emoji: "📅" }), {
    message: "회의 중",
    emoji: "📅",
  });

  // 다시 떠도(이미 고친 DB) 그대로다. 꺼진 서버와의 연결이 끊긴 채 남아 있어 첫 요청이 실패할 수 있다.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual((await call(alice, api.history, { channel: "c0" })).messages.at(-1), message),
  );
});

test("라벨이 없던 판의 포스트에 종류 라벨과 확인됨이 붙고, 이미 열린 이슈는 참고가 되어도 닫히지 않는다. 부딪힘 포럼은 논의 포럼이 된다", async (t) => {
  const world = await startWorld({
    followMs: 50,
    seed: await readFile(new URL("./contract32.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  for (const [number, title, labels] of [
    [101, "pay.ts 직접 충돌", ["직접 충돌"]],
    [102, "pay 간접 충돌", ["간접 충돌", "확인됨"]],
  ] as const)
    world.github.issues.push({
      number,
      title,
      body: "",
      labels: [...labels],
      open: true,
      author: "alice",
      comments: [],
    });

  const { posts } = await call(world.owner, api.posts);
  assert.deepEqual(
    posts.map((post) => [post.labels, post.importance]),
    [
      [["Direct conflict"], "reference"],
      [["Indirect conflict", "Confirmed"], "discuss"],
    ],
  );
  // 이슈 맞추기가 여러 번 돌아도 참고 포스트의 이슈는 열린 채다.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(
    world.github.issues.map((issue) => [issue.number, issue.open, issue.labels]),
    [
      [101, true, ["Direct conflict"]],
      [102, true, ["Indirect conflict", "Confirmed"]],
    ],
  );
  assert.deepEqual(
    (await call(world.owner, api.posts)).posts.map((post) => post.issue?.open),
    [true, true],
  );
  // 예전 "부딪힘" 포럼(f0)은 "논의"로 거르는 "논의" 포럼이 되고, "참고" 포럼이 생긴다(ADR-0039). 포스트는 중요도대로 보인다.
  const { channels } = await call(world.owner, api.channels);
  const reference = channels.find((c) => c.name === "FYI");
  assert.deepEqual(channels, [
    { id: "f0", name: "Discuss", kind: "forum", filter: { importance: "discuss" } },
    { id: reference?.id, name: "FYI", kind: "forum", filter: { importance: "reference" } },
  ]);
  assert.deepEqual(
    (await call(world.owner, api.posts)).posts.map((post) => post.forums),
    [[reference?.id], ["f0"]],
  );
  assert.equal("alertChannel" in (await call(world.owner, api.settings)), false);
});
