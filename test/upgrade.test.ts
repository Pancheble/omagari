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
