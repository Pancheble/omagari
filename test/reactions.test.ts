// Message reactions (ADR-0044, #293): stored on the server and shared live, and can't be added to a message you can't see.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ChannelMessage, ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;
/** The last reaction of that message among those received. */
const lastReactions = (messages: ChannelMessage[], id: number) =>
  messages.flatMap((m) => (m.id === id && m.kind === "text" ? [m.reactions] : [])).at(-1);

test("when two members add and remove reactions on the same message, each sees it right away, and a window that reconnects receives the change", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "Alice Lee");
  const owner = world.owner;
  const alice = await world.login("alice");
  const { channel } = await call(owner, api.createChannel, { name: "pay" });
  const { message } = await call(owner, api.send, {
    channel: channel.id,
    text: "I merged it",
  });
  assert.deepEqual(message.kind === "text" && message.reactions, []);
  const ownerLive = await world.live(owner);
  const aliceLive = await world.live(alice);

  await call(alice, api.react, { message: message.id, emoji: "🎉", on: true });
  await call(owner, api.react, { message: message.id, emoji: "👀", on: true });
  // Adding one that's already added is still one.
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
        { login: "alice", name: "Alice Lee" },
        { login: "owner", name: "owner" },
      ],
    },
    { emoji: "👀", members: [{ login: "owner", name: "owner" }] },
  ];
  assert.deepEqual(both.kind === "text" && both.reactions, expected);
  for (const live of [ownerLive, aliceLive])
    await eventually(() => assert.deepEqual(lastReactions(live.messages(), message.id), expected));
  // Reading it as past conversation gives the same.
  const { messages } = await call(alice, api.history, { channel: channel.id });
  assert.deepEqual(lastReactions(messages, message.id), expected);

  // If a reaction is removed while alice is disconnected, she receives the changed message when she reconnects.
  await aliceLive.close();
  await call(alice, api.react, { message: message.id, emoji: "🎉", on: false });
  await call(owner, api.react, { message: message.id, emoji: "👀", on: false });
  const after = [{ emoji: "🎉", members: [{ login: "owner", name: "owner" }] }];
  await eventually(() => assert.deepEqual(lastReactions(ownerLive.messages(), message.id), after));
  const resumed = await world.live(alice, message.id);
  await eventually(() => assert.deepEqual(lastReactions(resumed.messages(), message.id), after));
  resumed.close();

  // A reaction is one emoji.
  await assert.rejects(
    call(alice, api.react, { message: message.id, emoji: "like", on: true }),
    refused("invalid_request"),
  );
});

test("a message you can't see can't be reacted to, and is refused the same as a message that doesn't exist", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3] });
  t.after(world.stop);
  // owner is in two workspaces, and carol is only in REPO3's workspace.
  world.github.grant("owner", REPO3);
  world.github.grant("carol", REPO3);
  const owner = world.owner;
  const carol = await world.login("carol");
  const { channel } = await call(owner, api.createChannel, { name: "pay" });
  const { message } = await call(owner, api.send, {
    channel: channel.id,
    text: "secret",
  });
  const watching = await world.live(carol);

  const hidden = await call(carol, api.react, {
    message: message.id,
    emoji: "👍",
    on: true,
  }).catch((e: ContractFailure) => e);
  const none = await call(carol, api.react, {
    message: 999_999,
    emoji: "👍",
    on: true,
  }).catch((e: ContractFailure) => e);
  assert.ok(hidden instanceof ContractFailure && none instanceof ContractFailure);
  assert.equal(hidden.code, "not_found");
  assert.equal(
    hidden.message.replace(String(message.id), "<id>"),
    none.message.replace("999999", "<id>"),
  );
  // The reaction isn't added, and that message doesn't go to carol's window either.
  const { messages } = await call(owner, api.history, { channel: channel.id });
  assert.deepEqual(lastReactions(messages, message.id), []);
  await call(owner, api.react, { message: message.id, emoji: "👍", on: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(watching.messages(), []);
});
