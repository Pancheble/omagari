// 답장(ADR-0047, #344): 같은 채널 안의 메시지만 가리키고, 원래 메시지의 지금 첫 줄과 함께 오며, `@호출`이면 원래 메시지가 질문에 함께 간다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld } from "./harness.ts";

const refused = (code: string) => (error: unknown) =>
  error instanceof ContractFailure && error.code === code;

test("답장은 원래 메시지의 쓴 사람과 첫 줄을 달고 오고, 다른 채널이나 없는 메시지를 가리키면 거절된다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "앨리스");
  const owner = world.owner;
  const alice = await world.login("alice");
  const channel = await world.channel(owner, "결제");
  const other = await world.channel(owner, "잡담");
  const live = await world.live(owner);

  const { message: original } = await call(owner, api.send, {
    channel,
    text: "> **alice**\n> 예전 말\n\n영수증이랑 안 맞아요\n둘째 줄",
  });
  const { message: reply } = await call(alice, api.send, {
    channel,
    text: "제가 볼게요",
    replyTo: original.id,
  });
  const expected = {
    id: original.id,
    notify: true,
    original: { login: "owner", name: "owner", line: "영수증이랑 안 맞아요" },
  };
  assert.deepEqual(reply.kind === "text" && reply.replyTo, expected);
  await eventually(() =>
    assert.ok(live.messages().some((m) => m.id === reply.id && m.kind === "text" && m.replyTo)),
  );
  const { messages } = await call(owner, api.history, { channel });
  const last = messages.at(-1);
  assert.deepEqual(last?.kind === "text" && last.replyTo, expected);
  assert.equal(messages[0]?.kind === "text" && messages[0].replyTo, undefined);

  // 부르지 않게 끈 답장
  const { message: quiet } = await call(alice, api.send, {
    channel,
    text: "조용히",
    replyTo: original.id,
    notify: false,
  });
  assert.equal(quiet.kind === "text" && quiet.replyTo?.notify, false);

  // 다른 채널의 메시지와 없는 메시지는 같은 거절이다.
  const { message: elsewhere } = await call(owner, api.send, { channel: other, text: "저쪽" });
  for (const replyTo of [elsewhere.id, 999_999])
    await assert.rejects(
      call(alice, api.send, { channel, text: "답", replyTo }),
      refused("invalid_request"),
    );
});

test("답장 안에서 `@호출`하면 원래 메시지가 질문과 함께 데이터로 에이전트에게 가고, 채널의 문답도 답장이다", async (t) => {
  const fake = fakeExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const owner = world.owner;
  const channel = await world.channel(owner, "결제");
  const { message: original } = await call(owner, api.send, {
    channel,
    text: "환불이 두 번 나갔어요",
  });
  const { message } = await call(owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel,
    message: "왜 그런지 봐 줘",
    visibility: "public",
    replyTo: original.id,
  });
  assert.equal(message?.kind === "qa" && message.replyTo?.id, original.id);
  await eventually(() => assert.equal(fake.calls.length, 1));
  const [{ message: prompt }] = fake.calls;
  assert.match(
    prompt,
    /<replying_to>\n<message from="owner \(owner\)"[^>]*>\n환불이 두 번 나갔어요\n<\/message>\n<\/replying_to>\n\n왜 그런지 봐 줘$/,
  );

  // DM에는 답장이 없다.
  await assert.rejects(
    call(owner, api.ask, {
      agent: "owner",
      executor: "claude-code",
      channel,
      message: "몰래",
      replyTo: original.id,
    }),
    refused("invalid_request"),
  );
});
