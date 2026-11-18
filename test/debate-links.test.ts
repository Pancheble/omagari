import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n");
const MONEY = `export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { refund } from "./money";
export const total = refund(2);
`;

/** 토론이 라운드 몇인지 지시문에서 읽는다(첫 입장은 1). */
const roundOf = (message: string) =>
  /토론의 (\d+)라운드\(반박\)/.exec(message)?.[1] ?? (/첫 입장을 낸다/.test(message) ? "1" : "0");

test("토론의 공개된 입장과 결론이 이슈 댓글로 가고(가린 라운드는 공개 뒤에), 소식이 두 작업의 편지함으로 가고, 지표에 센다", async (t) => {
  const stance = (who: string, gate?: Promise<void>) =>
    fakeExecutor(async ({ message }) => {
      await gate;
      return roundOf(message) === "0"
        ? JSON.stringify({ title: "t", context: "c", decision: "d", consequences: "q" })
        : JSON.stringify({
            claim: `${who}의 ${roundOf(message)}라운드 주장`,
            evidence: ["부분 환불 요구가 늘었다"],
          });
    });
  const owner = stance("owner");
  const world = await startWorld({ observeMs: 50, followMs: 50, executor: owner.executor });
  t.after(world.stop);
  const write = writer(world.repo.folder);
  await write("src/pay.ts", `${BASE}\n`);
  await write("src/money.ts", MONEY);
  await write("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await world.repo.git("switch", "--create", "payment");

  // alice는 풀어 줄 때까지 답하지 않는다.
  const gate = Promise.withResolvers<void>();
  const alice = stance("alice", gate.promise);
  world.github.grant("alice");
  const as = await world.login("alice");
  const desk = await world.desk(as, undefined, { "claude-code": alice.executor });
  t.after(desk.remove);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "refund");
  await desk.start();

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
  const [issue] = await eventually(async () => {
    assert.equal(world.github.issues.length, 1);
    return world.github.issues;
  });
  assert.ok(issue);

  // 토론이 열렸다는 소식이 두 작업의 편지함에 간다. 첫 라운드는 가려져 있어 입장이 댓글로 가지 않는다.
  const opened = /토론이 열렸다: 포스트 /;
  // 편지함은 한 번 넘기면 비워진다(CLI는 어느 명령이든 응답 끝에 밀린 소식을 싣는다). 먼저 받은 쪽을 다시 확인하면 빈 채로 보이고,
  // 위 claim의 응답에 이미 실려 갔을 수도 있다. 그래서 받은 것을 쌓아 두고, 쌓인 것에서 찾는다.
  const seen = new Map([[world.repo.folder, claimed.stdout]]);
  for (const cwd of [world.repo.folder, desk.folder])
    await eventually(async () => {
      const { code, stdout, stderr } = await world.cliIn(cwd, "status");
      const all = `${seen.get(cwd) ?? ""}${stdout}`;
      seen.set(cwd, all);
      assert.match(all, opened, `종료 코드 ${code}\nstdout: ${stdout}\nstderr: ${stderr}`);
    });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(issue.comments.filter((c) => c.body.includes("AI가 쓴 답")).length, 0);

  // 다 모여 공개되면 입장이 각자 그 주인의 이름으로, AI가 쓴 답 표시를 달고 간다. 그 뒤 반박 라운드의 입장도 공개될 때 간다.
  gate.resolve();
  const posted = await eventually(() => {
    const stances = issue.comments.filter((c) => c.body.includes("AI가 쓴 답"));
    assert.equal(stances.length, 6);
    return stances;
  });
  for (const who of ["owner", "alice"])
    for (const round of [1, 2, 3]) {
      const found = posted.find((c) => c.body.includes(`${who}의 ${round}라운드 주장`));
      assert.equal(found?.login, who);
      assert.match(found?.body ?? "", /^> \[!NOTE\]\n> 🤖 \*\*AI가 쓴 답\*\* · /);
      assert.match(found?.body ?? "", /근거\n- 부분 환불 요구가 늘었다 \(미검증\)/);
    }
  // 결론은 아직 없다: 검증된 근거가 없어 사람이 고를 차례다.
  assert.equal(issue.comments.filter((c) => c.body.includes("토론이 끝났어요")).length, 0);

  // 사람이 고르면 결론이 댓글 하나로 간다. 같은 것은 다시 가지 않는다.
  const post = (await call(world.owner, api.posts)).posts.find(
    (p) => p.message.kind === "alert" && p.message.alert.kind === "declared",
  );
  assert.ok(post);
  await call(as, api.chooseDebate, { post: post.channel, option: 0 });
  const ended = await eventually(() => {
    const found = issue.comments.filter((c) => c.body.includes("토론이 끝났어요"));
    assert.equal(found.length, 1);
    return found[0];
  });
  assert.equal(ended?.login, "alice");
  assert.match(ended?.body ?? "", /alice가 골라서/);
  // 결론 댓글은 서버가 지은 글만 싣는다. 이긴 주장은 그 사람의 입장 댓글에 있다.
  assert.doesNotMatch(ended?.body ?? "", /라운드 주장/);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(issue.comments.length, 7);
  // 우리가 단 댓글은 포스트의 글로 들어오지 않는다.
  const history = await call(world.owner, api.history, { channel: post.channel });
  assert.equal(history.messages.filter((m) => m.kind === "text").length, 0);

  // 내 차례와 결론 소식이 두 작업의 편지함에 갔다.
  for (const folder of [world.repo.folder, desk.folder]) {
    const seen = (await world.cliIn(folder, "status")).stdout;
    assert.match(seen, /토론에서 내 차례다: 포스트 .*의 2번째 라운드/);
    assert.match(seen, /토론에서 내 차례다: 포스트 .*의 3번째 라운드/);
    assert.match(seen, /토론의 결론이 났다: 포스트 .*에서 사람이 골라서/);
  }

  // 지표: 열린 토론 1, 사람이 골라 끝난 토론 1.
  const today = (await call(world.owner, api.metrics, {})).days.at(-1);
  assert.deepEqual(today?.debates, {
    opened: 1,
    ended: { experiment: 0, evidence: 0, human: 1, expired: 0 },
    decided: 0,
  });
  await world.signInCli(world.owner);
  const shown = await world.cli("metrics", "--days", "1");
  assert.match(
    shown.stdout,
    /토론 열림 {2}끝남\(실험\) {2}끝남\(근거\) {2}끝남\(사람\) {2}끝남\(만료\) {2}결정 PR/,
  );
  assert.match(shown.stdout, / {2}1 {2}0 {2}0 {2}1 {2}0 {2}0\n$/);
});

test("대행이 낸 입장은 부재자가 아니라 부른 사람의 계정으로, 대행 표시를 달고 이슈 댓글이 된다", async (t) => {
  const owner = fakeExecutor(() => JSON.stringify({ claim: "owner의 주장", evidence: [] }));
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    executor: owner.executor,
    debateRounds: 1,
  });
  t.after(world.stop);
  const write = writer(world.repo.folder);
  await write("src/pay.ts", `${BASE}\n`);
  await write("src/money.ts", MONEY);
  await write("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await world.repo.git("switch", "--create", "payment");

  const member = async (login: string, branch: string, answer: ReturnType<typeof fakeExecutor>) => {
    world.github.grant(login);
    const as = await world.login(login);
    const desk = await world.desk(as, undefined, { "claude-code": answer.executor });
    t.after(desk.remove);
    await desk.stop();
    await desk.git("fetch", "--quiet", world.repo.folder, "main");
    await desk.git("reset", "--hard", "FETCH_HEAD");
    await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
    await desk.git("switch", "--create", branch);
    await desk.start();
    return { as, desk };
  };
  // alice의 첫 턴은 러너가 꺼지며 실패한다. 그 자리는 부재자가 된다.
  const gone = Promise.withResolvers<void>();
  const alice = fakeExecutor(async () => {
    await gone.promise;
    throw new Error("러너가 꺼졌다");
  });
  const aliceDesk = await member("alice", "refund", alice);
  // alice는 refund를 쓰는 파일을 고쳐 두어 토론의 자리가 된다.
  await writer(aliceDesk.desk.folder)("src/checkout.ts", `${CHECKOUT}export const more = 1;\n`);
  await eventually(async () => {
    const works = (await call(world.owner, api.works)).works;
    assert.ok(works.some((w) => w.login === "alice" && w.files.length > 0));
  });

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
  const [issue] = await eventually(async () => {
    assert.equal(world.github.issues.length, 1);
    return world.github.issues;
  });
  assert.ok(issue);
  await eventually(() => assert.equal(alice.calls.length, 1));
  const stopping = aliceDesk.desk.stop();
  const found = await eventually(async () => {
    const post = (await call(world.owner, api.posts)).posts.find(
      (p) => p.message.kind === "alert" && p.message.alert.kind === "declared",
    );
    const seat = post?.debate?.seats.findIndex((s) => s.login === "alice") ?? -1;
    assert.equal(post?.debate?.seats[seat]?.away, true, JSON.stringify(post?.debate));
    return { post: post?.channel ?? "", seat };
  });
  gone.resolve();
  await stopping;

  // bob은 토론이 열린 뒤에 들어온다.
  const bob = fakeExecutor(() => JSON.stringify({ claim: "대행의 주장", evidence: [] }));
  const bobDesk = await member("bob", "elsewhere", bob);
  await eventually(() => call(bobDesk.as, api.proxyDebate, found));
  await eventually(() => {
    const stances = issue.comments.filter((c) => c.body.includes("AI가 쓴 답"));
    assert.equal(stances.length, 2);
    const mine = stances.find((c) => c.body.includes("owner의 주장"));
    assert.equal(mine?.login, "owner");
    assert.ok(!mine?.body.includes("대행"));
    const proxied = stances.find((c) => c.body.includes("대행의 주장"));
    assert.equal(proxied?.login, "bob");
    assert.match(
      proxied?.body ?? "",
      /> 🤖 \*\*AI가 쓴 답\*\* · alice의 에이전트 · 대행: bob이\(가\) 불렀어요/,
    );
  });
});
