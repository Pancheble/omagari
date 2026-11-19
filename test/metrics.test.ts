import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld } from "./harness.ts";

/** Today's (the last day's) count, and whether the days before it are all 0. */
const today = (days: { members: number; qas: number }[]) => {
  const last = days.at(-1);
  assert.ok(last);
  assert.deepEqual(
    days.slice(0, -1).filter((d) => d.members || d.qas),
    [],
  );
  return { members: last.members, qas: last.qas };
};

test("a member who came in is one who opened the web that day or read and wrote in a channel. A member who used only the runner and the CLI isn't counted. Q&A only counts the number", async (t) => {
  const world = await startWorld({
    executor: fakeExecutor(() => "refund is in refund.ts").executor,
  });
  t.after(world.stop);
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  const bob = await world.login("bob");
  const metrics = async () => (await call(world.owner, api.metrics, {})).days;

  // owner has a runner attached and looked at the situation with the CLI. bob only logged in and called the API the CLI calls.
  await world.signInCli(world.owner);
  assert.equal((await world.cli("status")).code, 0);
  await call(bob, api.members);
  await call(bob, api.works);
  const empty = await metrics();
  assert.equal(empty.length, 14); // the default is the last 14 days, from the oldest day
  assert.deepEqual(today(empty), { members: 0, qas: 0 });

  // Opening the web counts as coming in. Opening two windows is still one person.
  await world.live(alice);
  await world.live(alice);
  assert.deepEqual(today(await metrics()), { members: 1, qas: 0 });

  // Writing, asking and reading in a channel count as coming in too. Only accepted Q&A counts: alice's question with no runner doesn't become Q&A.
  const channel = await world.channel(world.owner, "pay");
  await world.settled(world.owner, await world.ask(world.owner, channel, "where is refund done?"));
  await world.settled(world.owner, await world.ask(world.owner, channel, "who fixes it?"));
  await assert.rejects(world.ask(alice, channel, "alice's question"), {
    code: "runner_offline",
  });
  await call(bob, api.history, { channel });
  const reply = await call(world.owner, api.metrics, {});
  assert.deepEqual(today(reply.days), { members: 3, qas: 2 });
  assert.equal(reply.timeZone, "Asia/Seoul");
  // Metrics hold only counts. No questions, answers or who came in.
  assert.doesNotMatch(JSON.stringify(reply), /who fixes it|refund|alice|bob|owner/);

  // They stay after the server restarts. One CLI call shows the past days.
  await world.restartServer();
  // The connection to the stopped server may remain broken, so the first request can fail.
  await eventually(async () => assert.deepEqual(today(await metrics()), { members: 3, qas: 2 }));
  const shown = await world.cli("metrics", "--days", "3");
  assert.equal(shown.code, 0, shown.stderr);
  const lines = shown.stdout.trimEnd().split("\n");
  assert.equal(
    lines[0],
    "Date (Asia/Seoul)  Members joined  Q&As  Merge runs  Pass  Broken  Can't tell  Couldn't run  Debates opened  Ended (experiment)  Ended (evidence)  Ended (human)  Ended (expired)  Decision PRs",
  );
  assert.equal(lines.length, 4);
  assert.match(
    lines[1] ?? "",
    /^\d{4}-\d{2}-\d{2} {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0$/,
  );
  assert.match(
    lines[3] ?? "",
    /^\d{4}-\d{2}-\d{2} {2}3 {2}2 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0 {2}0$/,
  );
  await assert.rejects(call(world.owner, api.metrics, { days: 0 }), {
    code: "invalid_request",
  });
});

test("a day is cut at midnight in Seoul. The count of a past day stays on that day's row", async (t) => {
  const world = await startWorld({ executor: fakeExecutor().executor });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  // A day can't be imitated by shortening it, so only the clock moves. Operation and checks still go through the API.
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2030-01-01T14:59:59Z"),
  }); // Seoul Jan 1 23:59:59
  const channel = await world.channel(world.owner, "일반"); // the harness default channel name
  await world.settled(world.owner, await world.ask(world.owner, channel, "before midnight"));

  t.mock.timers.setTime(Date.parse("2030-01-01T15:00:00Z")); // Seoul Jan 2 00:00, still Jan 1 in UTC
  const metrics = async () =>
    (await call(world.owner, api.metrics, { days: 2 })).days.map(({ day, members, qas }) => ({
      day,
      members,
      qas,
    }));
  assert.deepEqual(await metrics(), [
    { day: "2030-01-01", members: 1, qas: 1 },
    { day: "2030-01-02", members: 0, qas: 0 },
  ]);

  await world.live(alice);
  await world.settled(world.owner, await world.ask(world.owner, channel, "after midnight"));
  assert.deepEqual(await metrics(), [
    { day: "2030-01-01", members: 1, qas: 1 },
    { day: "2030-01-02", members: 2, qas: 1 },
  ]);
});
