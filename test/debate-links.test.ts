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

/** Read the debate's round number from the instruction (the first stance is 1). */
const roundOf = (message: string) =>
  /This is round (\d+) \(rebuttal\)/.exec(message)?.[1] ??
  (/give your first stance/.test(message) ? "1" : "0");

test("a debate's revealed stances and conclusion go to the issue as comments (hidden rounds after they're revealed), news goes to both works' mailboxes, and the metrics count it", async (t) => {
  const stance = (who: string, gate?: Promise<void>) =>
    fakeExecutor(async ({ message }) => {
      await gate;
      return roundOf(message) === "0"
        ? JSON.stringify({
            title: "t",
            context: "c",
            decision: "d",
            consequences: "q",
          })
        : JSON.stringify({
            claim: `${who}'s round ${roundOf(message)} claim`,
            evidence: ["Partial refund requests increased"],
          });
    });
  const owner = stance("owner");
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    executor: owner.executor,
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

  // alice doesn't answer until released.
  const gate = Promise.withResolvers<void>();
  const alice = stance("alice", gate.promise);
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

  // News that the debate opened goes to both works' mailboxes. The first round is hidden, so no stance goes as a comment.
  const opened = /A debate opened: post /;
  // A mailbox is emptied once handed over (the CLI attaches pending news to the end of any command's reply). Checking the one that received first again would show it empty,
  // and the reply to the claim above may already have carried it. So keep what was received and look in the pile.
  const seen = new Map([[world.repo.folder, claimed.stdout]]);
  for (const cwd of [world.repo.folder, desk.folder])
    await eventually(async () => {
      const { code, stdout, stderr } = await world.cliIn(cwd, "status");
      const all = `${seen.get(cwd) ?? ""}${stdout}`;
      seen.set(cwd, all);
      assert.match(all, opened, `exit code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`);
    });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(issue.comments.filter((c) => c.body.includes("AI-written answer")).length, 0);

  // Once everyone is in and revealed, each stance goes under its owner's name with the AI-written-answer mark. Stances of the later rebuttal rounds go when they're revealed.
  gate.resolve();
  const posted = await eventually(() => {
    const stances = issue.comments.filter((c) => c.body.includes("AI-written answer"));
    assert.equal(stances.length, 6);
    return stances;
  });
  for (const who of ["owner", "alice"])
    for (const round of [1, 2, 3]) {
      const found = posted.find((c) => c.body.includes(`${who}'s round ${round} claim`));
      assert.equal(found?.login, who);
      assert.match(found?.body ?? "", /^> \[!NOTE\]\n> 🤖 \*\*AI-written answer\*\* · /);
      assert.match(
        found?.body ?? "",
        /Evidence\n- Partial refund requests increased \(Unverified\)/,
      );
    }
  // No conclusion yet: there's no verified evidence, so it's a human's turn to choose.
  assert.equal(issue.comments.filter((c) => c.body.includes("The debate is over")).length, 0);

  // When a human chooses, the conclusion goes as one comment. The same one doesn't go again.
  const post = (await call(world.owner, api.posts)).posts.find(
    (p) => p.message.kind === "alert" && p.message.alert.kind === "declared",
  );
  assert.ok(post);
  await call(as, api.chooseDebate, { post: post.channel, option: 0 });
  const ended = await eventually(() => {
    const found = issue.comments.filter((c) => c.body.includes("The debate is over"));
    assert.equal(found.length, 1);
    return found[0];
  });
  assert.equal(ended?.login, "alice");
  assert.match(ended?.body ?? "", /alice picked it/);
  // The conclusion comment carries only text the server wrote. The winning claim is in that person's stance comment.
  assert.doesNotMatch(ended?.body ?? "", /round \d claim/);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(issue.comments.length, 7);
  // Comments we posted don't come in as the post's text.
  const history = await call(world.owner, api.history, {
    channel: post.channel,
  });
  assert.equal(history.messages.filter((m) => m.kind === "text").length, 0);

  // My-turn and conclusion news went to both works' mailboxes.
  for (const folder of [world.repo.folder, desk.folder]) {
    const seen = (await world.cliIn(folder, "status")).stdout;
    assert.match(seen, /Your turn in the debate: round 2 of post /);
    assert.match(seen, /Your turn in the debate: round 3 of post /);
    assert.match(seen, /A debate reached a conclusion: in post .*, a person picked/);
  }

  // Metrics: 1 open debate, 1 debate ended by a human's choice.
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
    /Debates opened {2}Ended \(experiment\) {2}Ended \(evidence\) {2}Ended \(human\) {2}Ended \(expired\) {2}Decision PRs/,
  );
  assert.match(shown.stdout, / {2}1 {2}0 {2}0 {2}1 {2}0 {2}0\n$/);
});

test("a stance made by a proxy becomes an issue comment under the account of the person who called, not the absentee, with a proxy mark", async (t) => {
  const owner = fakeExecutor(() => JSON.stringify({ claim: "owner's claim", evidence: [] }));
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
    const desk = await world.desk(as, undefined, {
      "claude-code": answer.executor,
    });
    t.after(desk.remove);
    await desk.stop();
    await desk.git("fetch", "--quiet", world.repo.folder, "main");
    await desk.git("reset", "--hard", "FETCH_HEAD");
    await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
    await desk.git("switch", "--create", branch);
    await desk.start();
    return { as, desk };
  };
  // alice's first turn fails as the runner shuts down. Her seat becomes the absentee.
  const gone = Promise.withResolvers<void>();
  const alice = fakeExecutor(async () => {
    await gone.promise;
    throw new Error("the runner shut down");
  });
  const aliceDesk = await member("alice", "refund", alice);
  // alice has edited a file that uses refund, so she gets a seat in the debate.
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

  // bob joins after the debate opened.
  const bob = fakeExecutor(() => JSON.stringify({ claim: "proxy's claim", evidence: [] }));
  const bobDesk = await member("bob", "elsewhere", bob);
  await eventually(() => call(bobDesk.as, api.proxyDebate, found));
  await eventually(() => {
    const stances = issue.comments.filter((c) => c.body.includes("AI-written answer"));
    assert.equal(stances.length, 2);
    const mine = stances.find((c) => c.body.includes("owner's claim"));
    assert.equal(mine?.login, "owner");
    assert.ok(!mine?.body.includes("proxy:"));
    const proxied = stances.find((c) => c.body.includes("proxy's claim"));
    assert.equal(proxied?.login, "bob");
    assert.match(
      proxied?.body ?? "",
      /> 🤖 \*\*AI-written answer\*\* · alice's agent · proxy: called by bob/,
    );
  });
});
