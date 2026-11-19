import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call, HISTORY_PAGE, MAX_MESSAGE_CHARS } from "@omagari/contract";
import { eventually, said, startWorld } from "./harness.ts";

/** A workspace that owner and alice have joined. */
async function team(
  t: { after: (fn: () => Promise<void>) => void },
  options: Parameters<typeof startWorld>[0] = {},
) {
  const world = await startWorld(options);
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "Alice Lee");
  const alice = await world.login("alice");
  return { world, owner: world.owner, alice };
}

test("when a member creates a chat channel, it shows in other members' lists, and the same name can't be created again", async (t) => {
  const { owner, alice } = await team(t);

  const { channel } = await call(owner, api.createChannel, {
    name: "  Payment\n processing  ",
  });
  assert.equal(channel.name, "Payment processing"); // trims the ends and folds repeated whitespace into one
  const general = (await call(alice, api.createChannel, { name: "General" })).channel;

  // Leave out the forums that exist from the start ("Discuss", "FYI").
  const chats = async () =>
    (await call(alice, api.channels)).channels.filter((c) => c.kind === "chat");
  assert.deepEqual(await chats(), [general, channel]);
  await assert.rejects(call(alice, api.createChannel, { name: "general" }), {
    code: "conflict",
  });
  await assert.rejects(call(alice, api.createChannel, { name: "   " }), {
    code: "invalid_request",
  });
});

test("another member receives a message written in a channel without refreshing", async (t) => {
  const { world, owner, alice } = await team(t);
  const watching = await world.live(alice);

  const { channel } = await call(owner, api.createChannel, {
    name: "Payments",
  });
  await eventually(() =>
    assert.deepEqual(
      watching.received.flatMap((m) => (m.kind === "channel" ? [m.payload] : [])),
      [channel],
    ),
  );

  const { message } = await call(owner, api.send, {
    channel: channel.id,
    text: "  Where do I issue refunds?\n",
  });
  assert.deepEqual(message, {
    kind: "text",
    id: message.id,
    channel: channel.id,
    login: "owner",
    name: "owner",
    text: "Where do I issue refunds?",
    at: message.at,
    reactions: [],
  });
  await eventually(() => assert.deepEqual(watching.messages(), [message]));

  // The writer's other windows get it too. The name is the one from the GitHub profile.
  const mine = await world.live(alice);
  const reply = (await call(alice, api.send, { channel: channel.id, text: "In payment.ts" }))
    .message;
  assert.equal(reply.kind === "text" && reply.name, "Alice Lee");
  await eventually(() => assert.deepEqual(watching.messages(), [message, reply]));
  await eventually(() => assert.deepEqual(mine.messages(), [reply]));
});

test("past conversation stays, and even after the server restarts it's read on from the oldest", async (t) => {
  const { world, owner, alice } = await team(t);
  const { channel } = await call(owner, api.createChannel, {
    name: "Payments",
  });
  const other = (await call(owner, api.createChannel, { name: "Random" })).channel;
  const total = HISTORY_PAGE + 5;
  for (let i = 1; i <= total; i++) {
    await call(i % 2 ? owner : alice, api.send, {
      channel: channel.id,
      text: `Message ${i}`,
    });
  }
  await call(owner, api.send, { channel: other.id, text: "Another channel" });

  await world.restartServer();
  // The connection to the stopped server stays broken, so the first request may fail.
  await eventually(() => call(alice, api.channels));

  const latest = (await call(alice, api.history, { channel: channel.id })).messages;
  assert.deepEqual(
    latest.map(said),
    Array.from({ length: HISTORY_PAGE }, (_, i) => `Message ${i + 6}`),
  );
  const older = (
    await call(alice, api.history, {
      channel: channel.id,
      before: latest[0]?.id,
    })
  ).messages;
  assert.deepEqual(older.map(said), [
    "Message 1",
    "Message 2",
    "Message 3",
    "Message 4",
    "Message 5",
  ]);
  assert.deepEqual((await call(alice, api.history, { channel: other.id })).messages.map(said), [
    "Another channel",
  ]);
});

test("when the connection drops and reattaches, it receives every message that piled up in between", async (t) => {
  const { world, owner, alice } = await team(t);
  const general = (await call(owner, api.createChannel, { name: "general" })).channel;
  const payments = (await call(owner, api.createChannel, { name: "Payments" })).channel;
  const old = (
    await call(owner, api.send, {
      channel: general.id,
      text: "Before attaching",
    })
  ).message;

  // On the first attach it doesn't receive the past again, and welcome gives the current end number (the member list that follows is checked in members.test).
  const first = await world.live(alice);
  assert.deepEqual(
    first.received
      .filter(({ kind }) => kind !== "members")
      .map(({ kind, payload }) => ({ kind, payload })),
    [{ kind: "welcome", payload: { seq: old.id } }],
  );

  // The connection drops while the server restarts, and meanwhile messages pile up in two channels.
  await world.stopServer();
  assert.notEqual(await first.closed, 1008);
  await world.restartServer();
  // The connection to the stopped server stays broken, so the first request may fail.
  await eventually(() => call(owner, api.channels));
  const missed = [
    (
      await call(owner, api.send, {
        channel: payments.id,
        text: "While disconnected 1",
      })
    ).message,
    (
      await call(owner, api.send, {
        channel: general.id,
        text: "While disconnected 2",
      })
    ).message,
  ];

  // No message had been received, so it reattaches with welcome's number. It receives what came in between in order, then new ones after that.
  const again = await world.live(alice, old.id);
  await eventually(() => assert.deepEqual(again.messages(), missed));
  assert.equal(again.received[0]?.kind, "welcome");
  const live = (
    await call(owner, api.send, {
      channel: general.id,
      text: "After reattaching",
    })
  ).message;
  await eventually(() => assert.deepEqual(again.messages(), [...missed, live]));

  // Reattaching with the last received number doesn't resend what was already received.
  await again.close();
  const quiet = await world.live(alice, live.id);
  const next = (await call(owner, api.send, { channel: general.id, text: "Next" })).message;
  await eventually(() => assert.deepEqual(quiet.messages(), [next]));
});

test("a non-member can't read, write, or receive channels and messages", async (t) => {
  const { world, owner, alice } = await team(t, { recheckMs: 50 });
  const { channel } = await call(owner, api.createChannel, {
    name: "Payments",
  });
  await call(owner, api.send, { channel: channel.id, text: "Members only" });

  for (const stranger of [
    { url: world.server.url },
    { url: world.server.url, session: "made-up" },
  ]) {
    await assert.rejects(call(stranger, api.channels), {
      code: "unauthorized",
    });
    await assert.rejects(call(stranger, api.history, { channel: channel.id }), {
      code: "unauthorized",
    });
    await assert.rejects(call(stranger, api.send, { channel: channel.id, text: "Butting in" }), {
      code: "unauthorized",
    });
    await assert.rejects(call(stranger, api.createChannel, { name: "Sneaky" }), {
      code: "unauthorized",
    });
  }
  const refused = await world.live({ session: "made-up" }, 0);
  assert.equal(await refused.closed, 1008);
  assert.deepEqual(
    refused.received.map((m) => m.kind === "error" && m.payload.code),
    ["unauthorized"],
  );

  // A member who loses push access has their live connection cut at the next recheck, and can't reattach or read.
  const watching = await world.live(alice);
  world.github.revoke("alice");
  assert.equal(await watching.closed, 1008);
  await call(owner, api.send, {
    channel: channel.id,
    text: "After Alice left",
  });
  await assert.rejects(call(alice, api.history, { channel: channel.id }), {
    code: "unauthorized",
  });
  assert.equal(await (await world.live(alice, 0)).closed, 1008);
  assert.deepEqual(watching.messages(), []);

  // The live connection of a logged-out session is cut too.
  const owners = await world.live(owner);
  await call(owner, api.logout);
  assert.equal(await owners.closed, 1008);
});

test("HTML in a message isn't changed by the server and is returned exactly as written", async (t) => {
  const { owner, alice } = await team(t);
  const { channel } = await call(owner, api.createChannel, {
    name: "<b>bold</b>",
  });
  const text = `<script>alert("x")</script><img src=x onerror="alert(1)"> & &amp;`;
  await call(owner, api.send, { channel: channel.id, text });

  assert.deepEqual(
    (await call(alice, api.channels)).channels.filter((c) => c.kind === "chat"),
    [channel],
  );
  assert.equal(channel.name, "<b>bold</b>");
  assert.deepEqual((await call(alice, api.history, { channel: channel.id })).messages.map(said), [
    text,
  ]);
});

test("a missing channel, an empty message, and a too-long message are not accepted", async (t) => {
  const { owner } = await team(t);
  const { channel } = await call(owner, api.createChannel, {
    name: "Payments",
  });

  await assert.rejects(call(owner, api.history, { channel: "nowhere" }), {
    code: "not_found",
  });
  await assert.rejects(call(owner, api.send, { channel: "nowhere", text: "Hello?" }), {
    code: "not_found",
  });
  await assert.rejects(call(owner, api.send, { channel: channel.id, text: " \n " }), {
    code: "invalid_request",
  });
  await assert.rejects(
    call(owner, api.send, {
      channel: channel.id,
      text: "a".repeat(MAX_MESSAGE_CHARS + 1),
    }),
    { code: "invalid_request" },
  );
  assert.deepEqual((await call(owner, api.history, { channel: channel.id })).messages, []);
});
