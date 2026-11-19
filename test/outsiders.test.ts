// In a public repo, what a GitHub account that isn't a member leaves on issues and PRs (comments, change-request reviews) doesn't take part in things only members do.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);
const DECISION = { title: "t", context: "c", decision: "d", consequences: "q" };

test("a comment a non-member leaves on a post's issue and a change request on a decision PR count as neither a decider nor an objection", async (t) => {
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

  // mallory, who has no push access, comments on the public issue. In the post it shows as a GitHub comment.
  fake.comment(number, "mallory", "A comment from an outsider");
  await eventually(async () => {
    const { messages } = await call(world.owner, api.history, {
      channel: post,
    });
    assert.ok(messages.some((m) => m.kind === "text" && m.login === "mallory" && m.github));
  });

  // Deciders are members only. Not in the decision file either.
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

  // mallory's change request is not an objection. When the window closes it merges.
  fake.review(decision.pull.number, "mallory", "CHANGES_REQUESTED");
  await sleep(150);
  assert.deepEqual((await call(world.owner, api.decisions)).decisions[0]?.objections, []);
  await eventually(
    async () =>
      assert.equal((await call(world.owner, api.decisions)).decisions[0]?.state, "accepted"),
    4 * HOUR + 5000,
  );
});

test("a non-member's issue comment doesn't go into the public debate turn, and in other turns it is shown separately as a GitHub comment", async (t) => {
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
  const desk = await world.desk(as, undefined, {
    "claude-code": alice.executor,
  });
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
  // First round: owner submitted and alice is held back. The post's issue exists.
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
    const { messages } = await call(world.owner, api.history, {
      channel: post.channel,
    });
    assert.ok(messages.some((m) => m.kind === "text" && m.login === "mallory"));
  });

  // In the second round's debate turn there is no comment from mallory.
  gate.resolve();
  const turn = await eventually(() => {
    assert.ok(owner.calls.length >= 2);
    return owner.calls[1];
  });
  assert.doesNotMatch(turn.message, /OUTSIDER-TEXT/);

  // In the turn asked in the post, it goes in separately as a GitHub comment, and says it may have been written by a non-member.
  await world.settled(world.owner, await world.ask(world.owner, post.channel, "Sum it up"));
  const asked = owner.calls.at(-1)?.message ?? "";
  assert.match(
    asked,
    /<github_comment from="mallory \(mallory\)"[^>]*>\nOUTSIDER-TEXT\n<\/github_comment>/,
  );
  assert.match(asked, /may have been written by someone who isn't a workspace member/);
  assert.doesNotMatch(asked, /<message from="mallory/);
});
