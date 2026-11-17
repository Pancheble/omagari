import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call, type Debate } from "@omagari/contract";
import type { Executor } from "@omagari/runner";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };

const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n");
const MONEY = `export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { refund } from "./money";
export const total = refund(2);
`;

/** 기준 커밋(pay, money, checkout)을 owner의 레포에 두고 owner는 `payment`를 시작한다. 그 커밋을 돌려준다. */
async function base(world: World) {
  const write = writer(world.repo.folder);
  await write("src/pay.ts", `${BASE}\n`);
  await write("src/money.ts", MONEY);
  await write("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await world.repo.git("switch", "--create", "payment");
  return world.repo.git("rev-parse", "HEAD");
}

/** 멤버 `login`의 기기: 같은 기준 커밋에서 `branch`를 시작한다. */
async function member(world: World, login: string, branch: string, executor: Executor) {
  world.github.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, undefined, { "claude-code": executor });
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  await desk.start();
  return { as, desk };
}

/** owner가 refund의 시그니처를 바꾸겠다고 선언한다. 그것을 쓰는 멤버와 계약 변경 알림이 선다. */
async function declare(world: World) {
  const claimed = await world.cli(
    "claim",
    "src/money.ts",
    "--symbol",
    "refund",
    "--plan",
    "signature",
    "--detail",
    "refund(amount, reason)",
  );
  assert.equal(claimed.code, 0, claimed.stderr);
}

/** 그 종류의 알림의 포스트. */
const postOf = async (as: As, kind: string) =>
  (await call(as, api.posts)).posts.find(
    (post) => post.message.kind === "alert" && post.message.alert.kind === kind,
  );

const seatOf = (debate: Debate, login: string) => {
  const seat = debate.seats.find((s) => s.login === login);
  assert.ok(seat, JSON.stringify(debate));
  return seat;
};

test("계약 변경 알림이 서면 토론이 열리고, 두 주인 에이전트가 가린 채 첫 입장을 내고, 다 모이면 근거 표시와 함께 공개된다", async (t) => {
  const owner = fakeExecutor(
    () => `\`\`\`json
${JSON.stringify({
  claim: "refund에 reason을 더하는 것이 맞다",
  evidence: [
    `${commit} 기준 커밋에 refund가 있다`,
    "src/money.ts:2 refund의 몸통",
    "src/money.ts:99 없는 줄",
    "0123456789abcdef 없는 커밋",
    "docs/decisions/0001-nope.md 없는 결정",
    "../outside.ts:1 레포 밖",
    "부분 환불 요구가 늘었다",
  ],
})}
\`\`\``,
  );
  owner.executor.recent = async (_folder, branch) => `work-${branch}`;
  const world = await startWorld({ observeMs: 50, followMs: 50, executor: owner.executor });
  t.after(world.stop);
  const commit = await base(world);

  // alice의 실행기는 갈라 띄울 세션을 모르고, 풀어 줄 때까지 답하지 않는다.
  const gate = Promise.withResolvers<void>();
  const alice = fakeExecutor(async () => {
    await gate.promise;
    return JSON.stringify({
      claim: "reason은 선택으로 두자",
      evidence: ["checkout은 고치지 않는다"],
    });
  });
  const { desk } = await member(world, "alice", "refund", alice.executor);
  t.after(desk.remove);
  const web = await world.live(world.owner);
  t.after(web.close);

  // 토론이 열리고 두 러너가 참여 요청을 받는다. owner는 냈고 alice는 아직이라 둘 다 가려진다.
  await declare(world);
  const hidden = await eventually(async () => {
    const debate = (await postOf(world.owner, "declared"))?.debate;
    assert.ok(debate);
    assert.equal(seatOf(debate, "owner").state, "submitted");
    assert.equal(alice.calls.length, 1);
    return debate;
  });
  assert.equal(hidden.round, 1);
  assert.equal(hidden.revealed, false);
  assert.equal(seatOf(hidden, "alice").state, "waiting");
  assert.ok(hidden.seats.every((seat) => seat.stance === undefined));
  // 상대의 입장은 서버 API에도, 웹에도, 러너에 간 요청에도 없다.
  const ownerClaim = "refund에 reason을 더하는 것이 맞다";
  assert.ok(!JSON.stringify(await call(world.owner, api.posts)).includes(ownerClaim));
  assert.ok(!JSON.stringify(web.received).includes(ownerClaim));
  assert.ok(!alice.calls[0]?.message.includes(ownerClaim));
  // 요청에는 포스트의 알림이 데이터로 실린다. 토론 세션은 읽기 도구만 받는다.
  assert.match(alice.calls[0]?.message ?? "", /<alert kind="선언된 계약 변경"/);
  assert.deepEqual(alice.calls[0]?.tools, ["Read", "Grep", "Glob"]);
  // owner는 주인이 그 브랜치에서 쓰던 작업 세션을 갈라 띄웠다. alice는 찾지 못해 맥락 없이(계획과 diff를 넣어) 참여한다.
  assert.equal(owner.calls[0]?.resume, "work-payment");
  assert.equal(owner.calls[0]?.fork, true);
  assert.equal(alice.calls[0]?.resume, undefined);
  assert.match(alice.calls[0]?.message ?? "", /맥락 없이 참여한다/);
  assert.equal(alice.calls[0]?.folder, desk.folder);

  // alice가 내면 둘 다 공개되고, 근거마다 각자 레포에서 본 표시가 붙는다.
  gate.resolve();
  const open = await eventually(async () => {
    const debate = (await postOf(world.owner, "declared"))?.debate;
    assert.ok(debate?.revealed);
    return debate;
  });
  const mine = seatOf(open, "owner").stance;
  assert.equal(mine?.claim, ownerClaim);
  assert.equal(mine?.context, "session");
  assert.deepEqual(
    mine?.evidence.map((e) => e.mark),
    ["verified", "verified", "missing", "missing", "missing", "missing", "unverified"],
  );
  const theirs = seatOf(open, "alice").stance;
  assert.deepEqual(theirs, {
    claim: "reason은 선택으로 두자",
    evidence: [{ text: "checkout은 고치지 않는다", mark: "unverified" }],
    context: "none",
  });
  // 한 포스트에 토론은 하나다.
  assert.equal(open.id, hidden.id);

  // 토론 세션이 실행 기록에 남는다.
  const post = (await postOf(world.owner, "declared"))?.channel ?? "";
  assert.match(
    (await world.cli("runner", "log")).stdout,
    new RegExp(`토론 ${post} 라운드 1 작업 세션 work-payment에서 갈라 띄움`),
  );
  assert.match(
    (await world.cliIn(desk.folder, "runner", "log")).stdout,
    new RegExp(`토론 ${post} 라운드 1 맥락 없이 참여`),
  );
});

test("증거 라벨이 없는 포스트에는 토론이 열리지 않고, 자동 참여 스위치를 끈 주인의 러너에는 요청이 가지 않는다", async (t) => {
  const owner = fakeExecutor(() => JSON.stringify({ claim: "바꾼다", evidence: [] }));
  const world = await startWorld({ observeMs: 50, followMs: 50, executor: owner.executor });
  t.after(world.stop);
  await base(world);
  const bob = fakeExecutor(() => JSON.stringify({ claim: "안 된다", evidence: [] }));
  const { as, desk } = await member(world, "bob", "refund", bob.executor);
  t.after(desk.remove);
  await call(as, api.setAskSwitch, { on: false });

  // 직접 충돌은 참고이고 증거 라벨이 없어 토론이 열리지 않는다.
  await writer(world.repo.folder)("src/pay.ts", `${BASE.replace("line 3", "owner")}\n`);
  await writer(desk.folder)("src/pay.ts", `${BASE.replace("line 3", "bob")}\n`);
  const direct = await eventually(async () => {
    const found = await postOf(world.owner, "direct");
    assert.ok(found);
    return found;
  });
  assert.equal(direct.debate, null);
  // 직접 충돌 라벨을 논의로 바꿔 포스트가 논의가 되어도 증거 라벨이 없으니 토론은 열리지 않는다.
  await call(world.owner, api.editLabel, { name: "직접 충돌", next: { importance: "discuss" } });
  await eventually(async () =>
    assert.equal((await postOf(world.owner, "direct"))?.importance, "discuss"),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await postOf(world.owner, "direct"))?.debate, null);

  // 계약 변경 알림에는 토론이 열리지만 bob은 스위치를 꺼 나오지 않는다. owner만 내고 공개된다.
  await declare(world);
  const debate = await eventually(async () => {
    const found = (await postOf(world.owner, "declared"))?.debate;
    assert.ok(found?.revealed);
    return found;
  });
  assert.equal(seatOf(debate, "bob").state, "off");
  assert.equal(seatOf(debate, "owner").stance?.claim, "바꾼다");
  assert.equal(seatOf(debate, "owner").stance?.context, "none");
  assert.equal((await postOf(world.owner, "direct"))?.debate, null);
  assert.equal(bob.calls.length, 0);

  // 사람이 포스트에 확인됨을 붙여도 토론이 열린다.
  await call(world.owner, api.setPostLabels, {
    post: direct.channel,
    labels: ["직접 충돌", "확인됨"],
  });
  const confirmed = (await postOf(world.owner, "direct"))?.debate;
  assert.equal(confirmed && seatOf(confirmed, "bob").state, "off");
});
