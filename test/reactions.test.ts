// 메시지 반응(ADR-0044, #293): 서버에 저장하고 실시간으로 나누며, 볼 수 없는 메시지에는 달지 못한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ChannelMessage, ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;
/** 받은 것 가운데 그 메시지의 마지막 반응. */
const lastReactions = (messages: ChannelMessage[], id: number) =>
  messages.flatMap((m) => (m.id === id && m.kind === "text" ? [m.reactions] : [])).at(-1);

test("두 멤버가 같은 메시지에 반응을 달고 떼면 서로의 화면에 바로 보이고, 다시 붙은 창도 바뀐 것을 받는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "앨리스");
  const owner = world.owner;
  const alice = await world.login("alice");
  const { channel } = await call(owner, api.createChannel, { name: "결제" });
  const { message } = await call(owner, api.send, { channel: channel.id, text: "머지했어요" });
  assert.deepEqual(message.kind === "text" && message.reactions, []);
  const ownerLive = await world.live(owner);
  const aliceLive = await world.live(alice);

  await call(alice, api.react, { message: message.id, emoji: "🎉", on: true });
  await call(owner, api.react, { message: message.id, emoji: "👀", on: true });
  // 이미 단 것을 다시 달아도 하나다.
  const { message: both } = await call(owner, api.react, {
    message: message.id,
    emoji: "🎉",
    on: true,
  });
  await call(owner, api.react, { message: message.id, emoji: "🎉", on: true });
  const expected = [
    {
      emoji: "🎉",
      members: [
        { login: "alice", name: "앨리스" },
        { login: "owner", name: "owner" },
      ],
    },
    { emoji: "👀", members: [{ login: "owner", name: "owner" }] },
  ];
  assert.deepEqual(both.kind === "text" && both.reactions, expected);
  for (const live of [ownerLive, aliceLive])
    await eventually(() => assert.deepEqual(lastReactions(live.messages(), message.id), expected));
  // 지난 대화로 읽어도 같다.
  const { messages } = await call(alice, api.history, { channel: channel.id });
  assert.deepEqual(lastReactions(messages, message.id), expected);

  // alice가 끊긴 사이에 반응이 떼어지면, 다시 붙을 때 바뀐 메시지를 받는다.
  await aliceLive.close();
  await call(alice, api.react, { message: message.id, emoji: "🎉", on: false });
  await call(owner, api.react, { message: message.id, emoji: "👀", on: false });
  const after = [{ emoji: "🎉", members: [{ login: "owner", name: "owner" }] }];
  await eventually(() => assert.deepEqual(lastReactions(ownerLive.messages(), message.id), after));
  const resumed = await world.live(alice, message.id);
  await eventually(() => assert.deepEqual(lastReactions(resumed.messages(), message.id), after));
  resumed.close();

  // 반응은 이모지 하나다.
  await assert.rejects(
    call(alice, api.react, { message: message.id, emoji: "좋아요", on: true }),
    refused("invalid_request"),
  );
});

test("볼 수 없는 메시지에는 반응을 달 수 없고, 없는 메시지와 같게 거절된다", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3] });
  t.after(world.stop);
  // owner는 두 워크스페이스에, carol은 REPO3의 워크스페이스에만 들어 있다.
  world.github.grant("owner", REPO3);
  world.github.grant("carol", REPO3);
  const owner = world.owner;
  const carol = await world.login("carol");
  const { channel } = await call(owner, api.createChannel, { name: "결제" });
  const { message } = await call(owner, api.send, { channel: channel.id, text: "비밀" });
  const watching = await world.live(carol);

  const hidden = await call(carol, api.react, { message: message.id, emoji: "👍", on: true }).catch(
    (e: ContractFailure) => e,
  );
  const none = await call(carol, api.react, { message: 999_999, emoji: "👍", on: true }).catch(
    (e: ContractFailure) => e,
  );
  assert.ok(hidden instanceof ContractFailure && none instanceof ContractFailure);
  assert.equal(hidden.code, "not_found");
  assert.equal(
    hidden.message.replace(String(message.id), "<id>"),
    none.message.replace("999999", "<id>"),
  );
  // 반응은 달리지 않았고, carol의 창에도 그 메시지가 가지 않는다.
  const { messages } = await call(owner, api.history, { channel: channel.id });
  assert.deepEqual(lastReactions(messages, message.id), []);
  await call(owner, api.react, { message: message.id, emoji: "👍", on: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(watching.messages(), []);
});
