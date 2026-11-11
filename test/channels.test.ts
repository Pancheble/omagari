import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call, HISTORY_PAGE, MAX_MESSAGE_CHARS } from "@omagari/contract";
import { eventually, said, startWorld } from "./harness.ts";

/** owner와 alice가 들어온 워크스페이스. */
async function team(
  t: { after: (fn: () => Promise<void>) => void },
  options: Parameters<typeof startWorld>[0] = {},
) {
  const world = await startWorld(options);
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "앨리스");
  const alice = await world.login("alice");
  return { world, owner: world.owner, alice };
}

test("멤버가 채팅 채널을 만들면 다른 멤버의 목록에 보이고, 같은 이름은 또 만들지 못한다", async (t) => {
  const { owner, alice } = await team(t);

  const { channel } = await call(owner, api.createChannel, { name: "  결제\n 처리  " });
  assert.equal(channel.name, "결제 처리"); // 앞뒤 공백을 떼고 겹친 공백은 하나로 접는다
  const general = (await call(alice, api.createChannel, { name: "General" })).channel;

  assert.deepEqual((await call(alice, api.channels)).channels, [general, channel]);
  await assert.rejects(call(alice, api.createChannel, { name: "general" }), {
    code: "conflict",
  });
  await assert.rejects(call(alice, api.createChannel, { name: "   " }), {
    code: "invalid_request",
  });
});

test("채널에 쓴 메시지를 다른 멤버가 새로 고침 없이 받는다", async (t) => {
  const { world, owner, alice } = await team(t);
  const watching = await world.live(alice);

  const { channel } = await call(owner, api.createChannel, { name: "결제" });
  await eventually(() =>
    assert.deepEqual(
      watching.received.flatMap((m) => (m.kind === "channel" ? [m.payload] : [])),
      [channel],
    ),
  );

  const { message } = await call(owner, api.send, {
    channel: channel.id,
    text: "  환불은 어디서 해요?\n",
  });
  assert.deepEqual(message, {
    kind: "text",
    id: message.id,
    channel: channel.id,
    login: "owner",
    name: "owner",
    text: "환불은 어디서 해요?",
    at: message.at,
  });
  await eventually(() => assert.deepEqual(watching.messages(), [message]));

  // 쓴 사람의 다른 창도 받는다. 이름은 GitHub 프로필의 것이다.
  const mine = await world.live(alice);
  const reply = (await call(alice, api.send, { channel: channel.id, text: "payment.ts요" }))
    .message;
  assert.equal(reply.name, "앨리스");
  await eventually(() => assert.deepEqual(watching.messages(), [message, reply]));
  await eventually(() => assert.deepEqual(mine.messages(), [reply]));
});

test("지난 대화는 남아 있어 서버가 다시 떠도 오래된 것부터 이어서 읽는다", async (t) => {
  const { world, owner, alice } = await team(t);
  const { channel } = await call(owner, api.createChannel, { name: "결제" });
  const other = (await call(owner, api.createChannel, { name: "잡담" })).channel;
  const total = HISTORY_PAGE + 5;
  for (let i = 1; i <= total; i++) {
    await call(i % 2 ? owner : alice, api.send, { channel: channel.id, text: `메시지 ${i}` });
  }
  await call(owner, api.send, { channel: other.id, text: "다른 채널" });

  await world.restartServer();
  // 꺼진 서버와의 연결이 끊긴 채 남아 있어 첫 요청이 실패할 수 있다.
  await eventually(() => call(alice, api.channels));

  const latest = (await call(alice, api.history, { channel: channel.id })).messages;
  assert.deepEqual(
    latest.map(said),
    Array.from({ length: HISTORY_PAGE }, (_, i) => `메시지 ${i + 6}`),
  );
  const older = (await call(alice, api.history, { channel: channel.id, before: latest[0]?.id }))
    .messages;
  assert.deepEqual(
    older.map(said),
    ["메시지 1", "메시지 2", "메시지 3", "메시지 4", "메시지 5"],
  );
  assert.deepEqual(
    (await call(alice, api.history, { channel: other.id })).messages.map(said),
    ["다른 채널"],
  );
});

test("연결이 끊겼다 붙으면 그 사이에 쌓인 메시지를 빠짐없이 받는다", async (t) => {
  const { world, owner, alice } = await team(t);
  const general = (await call(owner, api.createChannel, { name: "general" })).channel;
  const payments = (await call(owner, api.createChannel, { name: "결제" })).channel;
  const old = (await call(owner, api.send, { channel: general.id, text: "붙기 전" })).message;

  // 처음 붙을 때는 지난 것을 다시 받지 않고, welcome이 지금의 끝 번호를 알려 준다(뒤따르는 멤버 목록은 members.test가 본다).
  const first = await world.live(alice);
  assert.deepEqual(
    first.received
      .filter(({ kind }) => kind !== "members")
      .map(({ kind, payload }) => ({ kind, payload })),
    [{ kind: "welcome", payload: { seq: old.id } }],
  );

  // 서버가 다시 뜨는 사이에 끊기고, 그사이 두 채널에 메시지가 쌓인다.
  await world.stopServer();
  assert.notEqual(await first.closed, 1008);
  await world.restartServer();
  // 꺼진 서버와의 연결이 끊긴 채 남아 있어 첫 요청이 실패할 수 있다.
  await eventually(() => call(owner, api.channels));
  const missed = [
    (await call(owner, api.send, { channel: payments.id, text: "끊긴 사이 1" })).message,
    (await call(owner, api.send, { channel: general.id, text: "끊긴 사이 2" })).message,
  ];

  // 받은 메시지가 없었으니 welcome의 번호로 다시 붙는다. 끊긴 사이의 것을 순서대로 받고 이어서 새것을 받는다.
  const again = await world.live(alice, old.id);
  await eventually(() => assert.deepEqual(again.messages(), missed));
  assert.equal(again.received[0]?.kind, "welcome");
  const live = (await call(owner, api.send, { channel: general.id, text: "다시 붙은 뒤" })).message;
  await eventually(() => assert.deepEqual(again.messages(), [...missed, live]));

  // 마지막으로 받은 번호로 다시 붙으면 이미 받은 것은 다시 오지 않는다.
  await again.close();
  const quiet = await world.live(alice, live.id);
  const next = (await call(owner, api.send, { channel: general.id, text: "그다음" })).message;
  await eventually(() => assert.deepEqual(quiet.messages(), [next]));
});

test("멤버가 아니면 채널과 메시지를 읽지도 쓰지도 받지도 못한다", async (t) => {
  const { world, owner, alice } = await team(t, { recheckMs: 50 });
  const { channel } = await call(owner, api.createChannel, { name: "결제" });
  await call(owner, api.send, { channel: channel.id, text: "멤버끼리만" });

  for (const stranger of [
    { url: world.server.url },
    { url: world.server.url, session: "made-up" },
  ]) {
    await assert.rejects(call(stranger, api.channels), { code: "unauthorized" });
    await assert.rejects(call(stranger, api.history, { channel: channel.id }), {
      code: "unauthorized",
    });
    await assert.rejects(call(stranger, api.send, { channel: channel.id, text: "끼어들기" }), {
      code: "unauthorized",
    });
    await assert.rejects(call(stranger, api.createChannel, { name: "몰래" }), {
      code: "unauthorized",
    });
  }
  const refused = await world.live({ session: "made-up" }, 0);
  assert.equal(await refused.closed, 1008);
  assert.deepEqual(
    refused.received.map((m) => m.kind === "error" && m.payload.code),
    ["unauthorized"],
  );

  // push 권한을 잃은 멤버는 다음 재확인에 실시간 연결도 끊기고, 다시 붙지도 읽지도 못한다.
  const watching = await world.live(alice);
  world.github.revoke("alice");
  assert.equal(await watching.closed, 1008);
  await call(owner, api.send, { channel: channel.id, text: "앨리스가 나간 뒤" });
  await assert.rejects(call(alice, api.history, { channel: channel.id }), {
    code: "unauthorized",
  });
  assert.equal(await (await world.live(alice, 0)).closed, 1008);
  assert.deepEqual(watching.messages(), []);

  // 로그아웃한 세션의 실시간 연결도 끊긴다.
  const owners = await world.live(owner);
  await call(owner, api.logout);
  assert.equal(await owners.closed, 1008);
});

test("메시지에 든 HTML은 서버가 바꾸지 않고 쓴 글자 그대로 돌려준다", async (t) => {
  const { owner, alice } = await team(t);
  const { channel } = await call(owner, api.createChannel, { name: "<b>굵게</b>" });
  const text = `<script>alert("x")</script><img src=x onerror="alert(1)"> & &amp;`;
  await call(owner, api.send, { channel: channel.id, text });

  assert.deepEqual((await call(alice, api.channels)).channels, [channel]);
  assert.equal(channel.name, "<b>굵게</b>");
  assert.deepEqual(
    (await call(alice, api.history, { channel: channel.id })).messages.map(said),
    [text],
  );
});

test("없는 채널, 빈 메시지, 너무 긴 메시지는 받지 않는다", async (t) => {
  const { owner } = await team(t);
  const { channel } = await call(owner, api.createChannel, { name: "결제" });

  await assert.rejects(call(owner, api.history, { channel: "nowhere" }), { code: "not_found" });
  await assert.rejects(call(owner, api.send, { channel: "nowhere", text: "여보세요" }), {
    code: "not_found",
  });
  await assert.rejects(call(owner, api.send, { channel: channel.id, text: " \n " }), {
    code: "invalid_request",
  });
  await assert.rejects(
    call(owner, api.send, { channel: channel.id, text: "가".repeat(MAX_MESSAGE_CHARS + 1) }),
    { code: "invalid_request" },
  );
  assert.deepEqual((await call(owner, api.history, { channel: channel.id })).messages, []);
});
