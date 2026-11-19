// Replies (ADR-0047, #344): they point only at a message in the same channel, come with the original message's current first line, and with an `@call` the original message goes along with the question.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld } from "./harness.ts";

const refused = (code: string) => (error: unknown) =>
  error instanceof ContractFailure && error.code === code;

test("a reply carries the original message's author and first line, and pointing at another channel or a missing message is refused", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "Alice");
  const owner = world.owner;
  const alice = await world.login("alice");
  const channel = await world.channel(owner, "payments");
  const other = await world.channel(owner, "random");
  const live = await world.live(owner);

  const { message: original } = await call(owner, api.send, {
    channel,
    text: "> **alice**\n> old words\n\nThe receipt doesn't match\nsecond line",
  });
  const { message: reply } = await call(alice, api.send, {
    channel,
    text: "I'll look",
    replyTo: original.id,
  });
  const expected = {
    id: original.id,
    notify: true,
    original: {
      login: "owner",
      name: "owner",
      line: "The receipt doesn't match",
    },
  };
  assert.deepEqual(reply.kind === "text" && reply.replyTo, expected);
  await eventually(() =>
    assert.ok(live.messages().some((m) => m.id === reply.id && m.kind === "text" && m.replyTo)),
  );
  const { messages } = await call(owner, api.history, { channel });
  const last = messages.at(-1);
  assert.deepEqual(last?.kind === "text" && last.replyTo, expected);
  assert.equal(messages[0]?.kind === "text" && messages[0].replyTo, undefined);

  // A reply that is turned off so it doesn't call
  const { message: quiet } = await call(alice, api.send, {
    channel,
    text: "quietly",
    replyTo: original.id,
    notify: false,
  });
  assert.equal(quiet.kind === "text" && quiet.replyTo?.notify, false);

  // A message in another channel and a missing message are refused the same way.
  const { message: elsewhere } = await call(owner, api.send, {
    channel: other,
    text: "over there",
  });
  for (const replyTo of [elsewhere.id, 999_999])
    await assert.rejects(
      call(alice, api.send, { channel, text: "reply", replyTo }),
      refused("invalid_request"),
    );
});

test("an `@call` inside a reply sends the original message to the agent as data along with the question, and a channel Q&A is also a reply", async (t) => {
  const fake = fakeExecutor();
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);
  const owner = world.owner;
  const channel = await world.channel(owner, "payments");
  const { message: original } = await call(owner, api.send, {
    channel,
    text: "The refund went out twice",
  });
  const { message } = await call(owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel,
    message: "see why",
    visibility: "public",
    replyTo: original.id,
  });
  assert.equal(message?.kind === "qa" && message.replyTo?.id, original.id);
  await eventually(() => assert.equal(fake.calls.length, 1));
  const [{ message: prompt }] = fake.calls;
  assert.match(
    prompt,
    /<replying_to>\n<message from="owner \(owner\)"[^>]*>\nThe refund went out twice\n<\/message>\n<\/replying_to>\n\nsee why$/,
  );

  // A DM has no replies.
  await assert.rejects(
    call(owner, api.ask, {
      agent: "owner",
      executor: "claude-code",
      channel,
      message: "secretly",
      replyTo: original.id,
    }),
    refused("invalid_request"),
  );
});
