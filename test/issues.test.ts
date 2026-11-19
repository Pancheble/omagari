import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);
const MONEY = `export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { refund } from "./money";
export const total = refund(2);
`;
type As = { url: string; session: string };
/** The post of that kind of alert. */
const postOf = async (as: As, kind: string) =>
  (await call(as, api.posts)).posts.find(
    (post) => post.message.kind === "alert" && post.message.alert.kind === kind,
  );

test("a post gets a kind label, and one Discuss post is one GitHub issue: messages go as comments, comments come in as messages, and it follows the title, labels and closing", async (t) => {
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    executor: fakeExecutor(() => "a partial refund is computed in refund()").executor,
  });
  t.after(world.stop);
  const fake = world.github;
  await writer(world.repo.folder)("src/pay.ts", text(BASE));
  await writer(world.repo.folder)("src/money.ts", MONEY);
  await writer(world.repo.folder)("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

  fake.grant("alice");
  fake.names.set("alice", "Alice Kim");
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
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
  await writer(world.repo.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "owner")));
  await writer(desk.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "alice")));

  // A direct-conflict post is FYI with a kind label, so no issue opens. The alert still goes to both works' inboxes.
  const direct = await eventually(async () => {
    const found = await postOf(world.owner, "direct");
    assert.ok(found, "no post yet");
    return found;
  });
  assert.deepEqual(direct.labels, ["Direct conflict"]);
  assert.equal(direct.importance, "reference");
  await eventually(async () =>
    assert.match(
      (await world.cliIn(desk.folder, "status")).stdout,
      /- Direct conflict: merging my Work and owner/,
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fake.issues.length, 0);
  assert.equal((await postOf(world.owner, "direct"))?.issue, null);

  // A contract-change alert is Discuss, so the post's issue opens when it stands. It is in the name of one of the alert's two members, with the post's labels, and the body has the post link.
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
  const post = await eventually(async () => {
    const found = await postOf(world.owner, "declared");
    assert.ok(found?.issue, "no issue yet");
    return found;
  });
  assert.deepEqual(post.labels, ["Contract change"]);
  assert.equal(post.importance, "discuss");
  assert.equal(fake.issues.length, 1);
  const [issue] = fake.issues;
  assert.ok(["owner", "alice"].includes(issue.author));
  assert.equal(issue.title, "refund Contract change");
  assert.deepEqual(issue.labels, ["Contract change"]);
  // The issue's link is that post in the first forum where the post is visible ("Discuss").
  assert.match(issue.body, new RegExp(`/#${post.forums[0]}/${post.alert}$`));
  assert.deepEqual(post.issue, {
    number: issue.number,
    url: `https://github.com/omagari-test/space/issues/${issue.number}`,
    title: "refund Contract change",
    labels: ["Contract change"],
    open: true,
  });

  // A message in the post becomes an issue comment in the author's name.
  await call(world.owner, api.send, {
    channel: post.channel,
    text: "I'll merge the pay side first",
  });
  const { message: agreed } = await call(alice, api.send, {
    channel: post.channel,
    text: "OK, refund after that",
  });
  await eventually(() =>
    assert.deepEqual(
      issue.comments.map(({ login, body }) => [login, body]),
      [
        ["owner", "I'll merge the pay side first"],
        ["alice", "OK, refund after that"],
      ],
    ),
  );

  // A reply in the post puts the original comment's link and first line at the head of the comment. There is no `@`, so GitHub doesn't send mail again (ADR-0047).
  await call(world.owner, api.send, {
    channel: post.channel,
    text: "thanks",
    replyTo: agreed.id,
  });
  await eventually(() =>
    assert.equal(
      issue.comments.at(-1)?.body,
      [
        `> **alice** · [original](${post.issue?.url}#issuecomment-${issue.comments[1]?.id})`,
        "> OK, refund after that",
        "",
        "thanks",
      ].join("\n"),
    ),
  );

  // A Q&A posted to the post goes in the poster's name, marked as an AI-written answer.
  const qa = await world.settled(
    world.owner,
    await world.ask(world.owner, post.channel, "what about a partial refund?"),
  );
  await call(world.owner, api.postQa, {
    qa: qa.id,
    text: "pasting for reference",
  });
  await eventually(() => {
    const last = issue.comments.at(-1);
    assert.equal(last?.login, "owner");
    assert.equal(
      last?.body,
      [
        "pasting for reference",
        "",
        "> [!NOTE]",
        "> 🤖 **AI-written answer** · owner's Claude Code",
        "> Question: what about a partial refund?",
        "",
        "a partial refund is computed in refund()",
      ].join("\n"),
    );
  });

  // A comment made on GitHub comes into the post as a message. The commenter needn't be a member. If a person changes the title and labels, it follows.
  fake.comment(issue.number, "carol", "QA looks at refunds too");
  issue.title = "reason field of refund";
  issue.labels.push("payment");
  await eventually(async () => {
    const { messages } = await call(world.owner, api.history, {
      channel: post.channel,
    });
    const last = messages.at(-1);
    assert.equal(last?.kind, "text");
    assert.deepEqual(last?.kind === "text" && [last.login, last.text, last.github], [
      "carol",
      "QA looks at refunds too",
      true,
    ]);
    const now = await postOf(world.owner, "declared");
    assert.equal(now?.issue?.title, "reason field of refund");
    assert.deepEqual(now?.issue?.labels, ["Contract change", "payment"]);
  });
  // A comment that came in isn't posted again, and a message that was posted isn't posted twice.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(issue.comments.length, 5);

  // When the alert resolves (the plan is withdrawn), Omagari closes the issue.
  assert.equal((await world.cli("release")).code, 0);
  await eventually(async () => {
    const now = await postOf(world.owner, "declared");
    assert.notEqual(now?.message.kind === "alert" && now.message.alert.resolved, null);
    assert.equal(now?.issue?.open, false);
  });
  assert.equal(issue.open, false);
});
