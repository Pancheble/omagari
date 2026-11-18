// 공개 레포에서 멤버가 아닌 GitHub 계정이 이슈와 PR에 남긴 것(댓글, 변경 요청 리뷰)이 멤버만 하는 일에 끼지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);
const DECISION = { title: "t", context: "c", decision: "d", consequences: "q" };

test("멤버가 아닌 사람이 포스트의 이슈에 단 댓글과 결정 PR에 단 변경 요청은 결정자도 이의도 되지 않는다", async (t) => {
  const HOUR = 300;
  const world = await startWorld({ observeMs: 50, followMs: 50, hourMs: HOUR });
  t.after(world.stop);
  const fake = world.github;
  await writer(world.repo.folder)("src/pay.ts", text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  fake.grant("alice");
  const alice = await world.login("alice");
  const desk = await world.desk(alice);
  t.after(desk.remove);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "refund");
  await desk.start();
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "owner")));
  await writer(desk.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "alice")));
  const first = await eventually(async () => {
    const [found] = (await call(world.owner, api.posts)).posts;
    assert.ok(found);
    return found;
  });
  const post = first.channel;
  await call(world.owner, api.editLabel, {
    name: first.labels[0],
    next: { importance: "discuss" },
  });
  const number = await eventually(async () => {
    const issue = (await call(world.owner, api.posts)).posts[0]?.issue;
    assert.ok(issue);
    return issue.number;
  });

  // push 권한이 없는 mallory가 공개 이슈에 댓글을 단다. 포스트에는 GitHub 글로 보인다.
  fake.comment(number, "mallory", "바깥 사람의 댓글");
  await eventually(async () => {
    const { messages } = await call(world.owner, api.history, { channel: post });
    assert.ok(messages.some((m) => m.kind === "text" && m.login === "mallory" && m.github));
  });

  // 결정자는 멤버만이다. 결정 파일에도 없다.
  const { decision } = await call(world.owner, api.proposeDecision, {
    post,
    ...DECISION,
    window: "hour",
  });
  assert.deepEqual(
    decision.deciders.map((d) => d.login),
    ["owner"],
  );
  const file = fake.files.get(fake.pulls[0]?.branch ?? "")?.get(decision.path) ?? "";
  assert.doesNotMatch(file, /mallory/);

  // mallory의 변경 요청은 이의가 아니다. 창이 닫히면 머지된다.
  fake.review(decision.pull.number, "mallory", "CHANGES_REQUESTED");
  await sleep(150);
  assert.deepEqual((await call(world.owner, api.decisions)).decisions[0]?.objections, []);
  await eventually(
    async () =>
      assert.equal((await call(world.owner, api.decisions)).decisions[0]?.state, "accepted"),
    4 * HOUR + 5000,
  );
});

test("멤버가 아닌 사람의 이슈 댓글은 공개로 올라가는 토론 차례에 들어가지 않고, 다른 차례에는 GitHub 댓글로 따로 표시된다", async (t) => {
  const owner = fakeExecutor(() => JSON.stringify({ claim: "owner claim", evidence: [] }));
  owner.executor.recent = async (_folder, branch) => `work-${branch}`;
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    debateRounds: 2,
    executor: owner.executor,
  });
  t.after(world.stop);
  const write = writer(world.repo.folder);
  await write("src/money.ts", "export function refund(amount: number) {\n  return -amount;\n}\n");
  await write(
    "src/checkout.ts",
    'import { refund } from "./money";\nexport const total = refund(2);\n',
  );
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await world.repo.git("switch", "--create", "payment");

  const gate = Promise.withResolvers<void>();
  const alice = fakeExecutor(async () => {
    await gate.promise;
    return JSON.stringify({ claim: "alice claim", evidence: [] });
  });
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

  await world.signInCli(world.owner);
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
  // 첫 라운드: owner는 냈고 alice는 붙들려 있다. 포스트의 이슈가 있다.
  const post = await eventually(async () => {
    const found = (await call(world.owner, api.posts)).posts.find(
      (p) => p.message.kind === "alert" && p.message.alert.kind === "declared",
    );
    assert.ok(found?.issue && found.debate);
    assert.equal(owner.calls.length, 1);
    return found;
  });
  const [issue] = world.github.issues;
  world.github.comment(issue.number, "mallory", "OUTSIDER-TEXT");
  await eventually(async () => {
    const { messages } = await call(world.owner, api.history, { channel: post.channel });
    assert.ok(messages.some((m) => m.kind === "text" && m.login === "mallory"));
  });

  // 둘째 라운드의 토론 차례에는 mallory의 댓글이 없다.
  gate.resolve();
  const turn = await eventually(() => {
    assert.ok(owner.calls.length >= 2);
    return owner.calls[1];
  });
  assert.doesNotMatch(turn.message, /OUTSIDER-TEXT/);

  // 포스트에서 묻는 차례에는 GitHub 댓글로 따로 들어가고, 멤버가 아닌 사람이 썼을 수 있다고 알린다.
  await world.settled(world.owner, await world.ask(world.owner, post.channel, "정리해 줘"));
  const asked = owner.calls.at(-1)?.message ?? "";
  assert.match(
    asked,
    /<github_comment from="mallory \(mallory\)"[^>]*>\nOUTSIDER-TEXT\n<\/github_comment>/,
  );
  assert.match(asked, /워크스페이스 멤버가 아닌 사람이 썼을 수 있/);
  assert.doesNotMatch(asked, /<message from="mallory/);
});
