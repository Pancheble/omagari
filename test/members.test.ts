import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, place, startWorld, textOf, writer } from "./harness.ts";

/** 고를 거리를 알리지 않는 실행기(가짜)의 것. 고를 거리는 model.test가 본다. */
const none = { models: [], efforts: [] };

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
  const { at } = await call(alice, api.setStatus, {
    branch: "payment",
    text: "결제 붙이는 중",
    executor: "claude-code",
  });

  const members = async () => (await call(world.owner, api.members)).members;
  const aliceOf = async () => (await members()).find((member) => member.login === "alice");
  // 워크트리를 더한 뒤 파일을 쓰기 전에 관측이 돌면 refund는 바뀐 것 없는 작업(줄 없음)으로 먼저 온다.
  // 작업 수가 아니라 두 작업의 줄이 다 올 때까지 기다린다.
  await eventually(async () =>
    assert.deepEqual(
      (await aliceOf())?.works.map(
        (work) => work.line && ("text" in work.line ? work.line.text : work.line.file),
      ),
      ["결제 붙이는 중", "refund.ts"],
    ),
  );

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
      avatar: null,
      presence: "offline", // 웹 창을 연 적이 없다
      message: null,
      emoji: null,
      agents: [],
      offlineSince: null,
      works: [],
    },
  );
  assert.deepEqual(await aliceOf(), {
    login: "alice",
    name: "김지은",
    avatar: null,
    presence: "offline",
    message: null,
    emoji: null,
    agents: [{ executor: "claude-code", state: "online", choices: none }],
    offlineSince: null,
    works: [
      {
        branch: "payment",
        executor: "claude-code",
        line: { source: "agent", text: "결제 붙이는 중", at },
        conflict: false,
        broken: false,
      },
      {
        branch: "refund",
        executor: null, // 관측만 있고 훅도 status set도 보낸 적이 없다(ADR-0015)
        line: { source: "files", file: "refund.ts", more: 0 },
        conflict: false,
        broken: false,
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
  assert.deepEqual(offline?.agents, [{ executor: "claude-code", state: "offline", choices: none }]);
  assert.deepEqual(
    offline?.works.map((work) => [
      work.branch,
      work.line && ("text" in work.line ? work.line.text : work.line.file),
    ]),
    [
      ["payment", "결제 붙이는 중"],
      ["refund", "refund.ts"],
    ],
  );

  // 서버가 다시 떠도 에이전트는 오프라인으로 남는다.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual((await aliceOf())?.agents, [
      { executor: "claude-code", state: "offline", choices: none },
    ]),
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
    assert.deepEqual(owner()?.agents, [
      { executor: "claude-code", state: "online", choices: none },
    ]),
  );

  // 바꾼 것도 상태 한 줄도 선점도 없는 작업은 브랜치가 무엇이든 보이지 않는다(ADR-0006).
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
  assert.deepEqual(owner()?.works, []);
  await world.signInCli(world.owner);
  assert.match((await world.cli("status")).stdout, /owner · .*\n {2}no Work/);
  await writer(world.repo.folder)("payment.ts", "pay\n");
  await eventually(() =>
    assert.deepEqual(owner()?.works[0]?.line, { source: "files", file: "payment.ts", more: 0 }),
  );
  await call(world.owner, api.setStatus, { branch: "payment", text: "결제 붙이는 중" });
  await eventually(() => assert.equal(textOf(owner()?.works[0]?.line), "결제 붙이는 중"));

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
