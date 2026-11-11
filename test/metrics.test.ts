import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld } from "./harness.ts";

/** 오늘(마지막 날)의 수와, 그 앞의 날들이 모두 0인지. */
const today = (days: { members: number; qas: number }[]) => {
  const last = days.at(-1);
  assert.ok(last);
  assert.deepEqual(
    days.slice(0, -1).filter((d) => d.members || d.qas),
    [],
  );
  return { members: last.members, qas: last.qas };
};

test("들어온 멤버는 그날 웹을 열었거나 채널에서 읽고 쓴 멤버다. 러너와 CLI만 쓴 멤버는 세지 않는다. 문답은 수만 센다", async (t) => {
  const world = await startWorld({ executor: fakeExecutor(() => "환불은 refund.ts").executor });
  t.after(world.stop);
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  const bob = await world.login("bob");
  const metrics = async () => (await call(world.owner, api.metrics, {})).days;

  // owner는 러너가 붙어 있고 CLI로 상황을 봤다. bob은 로그인만 하고 CLI가 부르는 API를 불렀다.
  await world.signInCli(world.owner);
  assert.equal((await world.cli("status")).code, 0);
  await call(bob, api.members);
  await call(bob, api.works);
  const empty = await metrics();
  assert.equal(empty.length, 14); // 기본은 지난 14일, 오래된 날부터
  assert.deepEqual(today(empty), { members: 0, qas: 0 });

  // 웹을 열면 들어온 것이다. 창을 둘 열어도 한 명이다.
  await world.live(alice);
  await world.live(alice);
  assert.deepEqual(today(await metrics()), { members: 1, qas: 0 });

  // 채널에서 쓰고 묻고 읽는 것도 들어온 것이다. 받아들인 문답만 센다: 러너가 없는 alice의 질문은 문답이 되지 않는다.
  const channel = await world.channel(world.owner, "결제");
  await world.settled(world.owner, await world.ask(world.owner, channel, "환불은 어디서 하나?"));
  await world.settled(world.owner, await world.ask(world.owner, channel, "누가 고치나?"));
  await assert.rejects(world.ask(alice, channel, "alice의 질문"), { code: "runner_offline" });
  await call(bob, api.history, { channel });
  const reply = await call(world.owner, api.metrics, {});
  assert.deepEqual(today(reply.days), { members: 3, qas: 2 });
  assert.equal(reply.timeZone, "Asia/Seoul");
  // 지표에는 수만 있다. 질문, 답, 누가 들어왔는지는 없다.
  assert.doesNotMatch(JSON.stringify(reply), /환불|누가 고치나|refund|alice|bob|owner/);

  // 서버가 다시 떠도 남는다. CLI 하나로 지난 날들을 본다.
  await world.restartServer();
  // 꺼진 서버와의 연결이 끊긴 채 남아 있어 첫 요청이 실패할 수 있다.
  await eventually(async () => assert.deepEqual(today(await metrics()), { members: 3, qas: 2 }));
  const shown = await world.cli("metrics", "--days", "3");
  assert.equal(shown.code, 0, shown.stderr);
  const lines = shown.stdout.trimEnd().split("\n");
  assert.equal(lines[0], "날짜(Asia/Seoul)  들어온 멤버  문답");
  assert.equal(lines.length, 4);
  assert.match(lines[1] ?? "", /^\d{4}-\d{2}-\d{2} {2}0 {2}0$/);
  assert.match(lines[3] ?? "", /^\d{4}-\d{2}-\d{2} {2}3 {2}2$/);
  await assert.rejects(call(world.owner, api.metrics, { days: 0 }), { code: "invalid_request" });
});

test("날은 서울의 자정으로 자른다. 지난날의 수는 그날 줄에 그대로 남는다", async (t) => {
  const world = await startWorld({ executor: fakeExecutor().executor });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  // 하루는 줄여 흉내 낼 수 없어 시계만 옮긴다. 조작과 확인은 그대로 API로 한다.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2030-01-01T14:59:59Z") }); // 서울 1월 1일 23:59:59
  const channel = await world.channel(world.owner, "일반");
  await world.settled(world.owner, await world.ask(world.owner, channel, "자정 전"));

  t.mock.timers.setTime(Date.parse("2030-01-01T15:00:00Z")); // 서울 1월 2일 0시, UTC로는 아직 1월 1일
  const metrics = async () => (await call(world.owner, api.metrics, { days: 2 })).days;
  assert.deepEqual(await metrics(), [
    { day: "2030-01-01", members: 1, qas: 1 },
    { day: "2030-01-02", members: 0, qas: 0 },
  ]);

  await world.live(alice);
  await world.settled(world.owner, await world.ask(world.owner, channel, "자정 뒤"));
  assert.deepEqual(await metrics(), [
    { day: "2030-01-01", members: 1, qas: 1 },
    { day: "2030-01-02", members: 2, qas: 1 },
  ]);
});
