import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, place, startWorld, writer } from "./harness.ts";

test("멤버 목록에 사람마다 이름과 실행기마다의 에이전트, 작업마다 상태 한 줄이 보이고, 러너가 떨어지면 에이전트는 오프라인, 작업은 떨어진 시각 기준으로 남는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.names.set("alice", "김지은");
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  await world.login("bob"); // 러너를 켠 적이 없는 멤버

  // alice는 등록한 폴더와 연결된 워크트리에서 두 작업을 한다.
  const desk = await world.desk(alice);
  t.after(desk.remove);
  const tree = await place(t);
  await desk.git("switch", "--create", "payment");
  await writer(desk.folder)("payment.ts", "pay\n");
  await desk.git("worktree", "add", "-b", "refund", tree("refund"));
  await writer(tree("refund"))("refund.ts", "refund\n");
  const { at } = await call(alice, api.setStatus, { branch: "payment", text: "결제 붙이는 중" });

  const members = async () => (await call(world.owner, api.members)).members;
  const aliceOf = async () => (await members()).find((member) => member.login === "alice");
  await eventually(async () => assert.equal((await aliceOf())?.works.length, 2));

  const all = await members();
  // 이름 순이다. 이름이 없는 사람은 아이디가 이름이다.
  assert.deepEqual(
    all.map((member) => member.name),
    ["bob", "owner", "김지은"],
  );
  assert.deepEqual(
    all.find((member) => member.login === "bob"),
    {
      login: "bob",
      name: "bob",
      presence: "offline", // 웹 창을 연 적이 없다
      message: null,
      agents: [],
      offlineSince: null,
      works: [],
    },
  );
  assert.deepEqual(await aliceOf(), {
    login: "alice",
    name: "김지은",
    presence: "offline",
    message: null,
    agents: [{ executor: "claude-code", state: "online" }],
    offlineSince: null,
    works: [
      {
        branch: "payment",
        executor: "claude-code",
        line: { source: "agent", text: "결제 붙이는 중", at },
      },
      {
        branch: "refund",
        executor: "claude-code",
        line: { source: "files", text: "refund.ts 수정 중" },
      },
    ],
  });

  const stopped = Date.now();
  await desk.stop();
  const offline = await eventually(async () => {
    const view = await aliceOf();
    assert.notEqual(view?.offlineSince, null);
    return view;
  });
  assert.ok(Date.parse(offline?.offlineSince as string) >= stopped);
  assert.deepEqual(offline?.agents, [{ executor: "claude-code", state: "offline" }]);
  assert.deepEqual(
    offline?.works.map((work) => [work.branch, work.line?.text]),
    [
      ["payment", "결제 붙이는 중"],
      ["refund", "refund.ts 수정 중"],
    ],
  );

  // 서버가 다시 떠도 에이전트는 오프라인으로 남는다.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual((await aliceOf())?.agents, [{ executor: "claude-code", state: "offline" }]),
  );
});

test("웹은 실시간 연결에서 멤버 목록을 바로 받고, 작업과 상태 한 줄과 에이전트가 바뀌면 새로 고치지 않아도 따라온다. 세션이 끝나면 연결이 닫힌다", async (t) => {
  const answer = Promise.withResolvers<string>();
  const world = await startWorld({
    observeMs: 50,
    executor: fakeExecutor(() => answer.promise).executor,
  });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  const live = await world.live(alice);
  const owner = () => live.members().find((member) => member.login === "owner");
  await eventually(() =>
    assert.deepEqual(owner()?.agents, [{ executor: "claude-code", state: "online" }]),
  );

  await world.repo.git("switch", "--create", "payment");
  await eventually(() =>
    assert.deepEqual(owner()?.works, [{ branch: "payment", executor: "claude-code", line: null }]),
  );
  await writer(world.repo.folder)("payment.ts", "pay\n");
  await eventually(() => assert.equal(owner()?.works[0]?.line?.text, "payment.ts 수정 중"));
  await call(world.owner, api.setStatus, { branch: "payment", text: "결제 붙이는 중" });
  await eventually(() => assert.equal(owner()?.works[0]?.line?.text, "결제 붙이는 중"));

  // 문답에 답하는 동안 답하는 중이다.
  const channel = await world.channel(world.owner);
  const asked = await world.ask(world.owner, channel, "결제는 어디서 하나?");
  await eventually(() => assert.equal(owner()?.agents[0]?.state, "answering"));
  answer.resolve("payment.ts에서 한다");
  await world.settled(world.owner, asked);
  await eventually(() => assert.equal(owner()?.agents[0]?.state, "online"));

  await world.runner.stop();
  await eventually(() => {
    assert.equal(owner()?.agents[0]?.state, "offline");
    assert.notEqual(owner()?.offlineSince, null);
  });

  await call(alice, api.logout);
  assert.equal(await live.closed, 1008);
});
