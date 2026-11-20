// Threads (ADR-0047, #345): a side conversation under one chat channel message. Not in posts or DMs, and never inside a thread.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ChannelMessage, ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld } from "./harness.ts";

const refused = (code: string) => (error: unknown) =>
  error instanceof ContractFailure && error.code === code;
const summary = (message: ChannelMessage | undefined) =>
  message && "thread" in message ? message.thread : undefined;

test("a thread reply updates the original's summary live and stays out of the channel unless also sent", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "Alice");
  const owner = world.owner;
  const alice = await world.login("alice");
  const channel = await world.channel(owner, "payments");
  const live = await world.live(owner);

  const { message: original } = await call(owner, api.send, {
    channel,
    text: "Refunds went out twice",
  });
  const { message: inThread } = await call(alice, api.send, {
    channel,
    text: "Looking",
    threadOf: original.id,
  });
  assert.deepEqual(inThread.kind === "text" && inThread.threadOf, {
    id: original.id,
    original: { login: "owner", name: "owner", line: "Refunds went out twice" },
    writers: ["alice"],
  });
  assert.equal(inThread.kind === "text" && inThread.alsoInChannel, undefined);
  // The original comes again with its summary.
  await eventually(() =>
    assert.equal(summary(live.messages().findLast((m) => m.id === original.id))?.count, 1),
  );

  const { message: copy } = await call(owner, api.send, {
    channel,
    text: "Found it",
    threadOf: original.id,
    alsoInChannel: true,
  });
  assert.equal(copy.kind === "text" && copy.alsoInChannel, true);
  // Everyone who wrote in the thread, not just the latest three, so the web knows who a reply calls (#370).
  assert.deepEqual(copy.kind === "text" && copy.threadOf?.writers.toSorted(), ["alice", "owner"]);
  await eventually(() => {
    const thread = summary(live.messages().findLast((m) => m.id === original.id));
    assert.equal(thread?.count, 2);
    assert.deepEqual(
      thread?.writers.map((w) => w.login),
      ["owner", "alice"],
    );
    assert.equal(thread?.last, copy.at);
  });

  // The channel shows the original and the copy sent to the channel, not the thread-only reply.
  const { messages } = await call(owner, api.history, { channel });
  assert.deepEqual(
    messages.map((m) => m.id),
    [original.id, copy.id],
  );
  assert.equal(summary(messages[0])?.count, 2);
  // The thread shows the original and both replies.
  const { messages: thread } = await call(alice, api.history, { channel, thread: original.id });
  assert.deepEqual(
    thread.map((m) => m.id),
    [original.id, inThread.id, copy.id],
  );
});

test("threads can't open in a post, a DM, inside a thread, on a reply, or on another channel's message", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const owner = world.owner;
  const channel = await world.channel(owner, "payments");
  const other = await world.channel(owner, "random");
  const { message: original } = await call(owner, api.send, { channel, text: "Original" });
  const { message: reply } = await call(owner, api.send, {
    channel,
    text: "In the thread",
    threadOf: original.id,
  });
  const { message: elsewhere } = await call(owner, api.send, { channel: other, text: "There" });

  for (const body of [
    { channel, text: "Nested", threadOf: reply.id },
    { channel, text: "Elsewhere", threadOf: elsewhere.id },
    { channel, text: "Missing", threadOf: 999_999 },
    { channel, text: "Both", threadOf: original.id, replyTo: original.id },
  ])
    await assert.rejects(call(owner, api.send, body), refused("invalid_request"));

  // A DM (a private ask) has no thread.
  await assert.rejects(
    call(owner, api.ask, {
      agent: "owner",
      executor: "claude-code",
      channel,
      message: "Quietly",
      threadOf: original.id,
    }),
    refused("invalid_request"),
  );

  // Posts are checked in conflicts.test.ts, where a post exists.
});

test("an `@call` in a thread gets the thread as data and answers in that thread", async (t) => {
  const fake = fakeExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const owner = world.owner;
  const channel = await world.channel(owner, "payments");
  const { message: original } = await call(owner, api.send, { channel, text: "Refunds doubled" });
  await call(owner, api.send, { channel, text: "Only on Fridays", threadOf: original.id });
  const { message } = await call(owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel,
    message: "Why?",
    visibility: "public",
    threadOf: original.id,
  });
  assert.equal(message?.kind === "qa" && message.threadOf?.id, original.id);
  await eventually(() => assert.equal(fake.calls.length, 1));
  const [{ message: prompt }] = fake.calls;
  assert.match(
    prompt,
    /<thread>\n<message from="owner \(owner\)"[^>]*>\nRefunds doubled\n<\/message>\n<message from="owner \(owner\)"[^>]*>\nOnly on Fridays\n<\/message>\n<\/thread>\n\nWhy\?$/,
  );
  // The answer stands in the thread, not in the channel.
  await eventually(async () => {
    const { messages } = await call(owner, api.history, { channel, thread: original.id });
    const answered = messages.find((m) => m.id === message?.id);
    assert.equal(answered?.kind === "qa" && answered.qa.answer.state, "answered");
  });
  const { messages } = await call(owner, api.history, { channel });
  assert.deepEqual(
    messages.map((m) => m.id),
    [original.id],
  );
  assert.equal(summary(messages[0])?.count, 2);
});
