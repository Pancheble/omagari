import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, said, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string };

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);

/**
 * owner and alice edit the same line to raise a direct conflict notification, and open that notification's post.
 * Returns the post, the forum ("FYI") where that post shows, and alice. The decision PR is GitHub's side, so any notification kind will do.
 */
async function postOf(t: { after: (fn: () => Promise<void>) => void }, hourMs?: number) {
  const world = await startWorld({ observeMs: 50, followMs: 50, hourMs });
  t.after(world.stop);
  await writer(world.repo.folder)("src/pay.ts", text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

  world.github.grant("alice");
  world.github.names.set("alice", "Alice Kim");
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

  const room = await eventually(async () => {
    const found = (await call(world.owner, api.channels)).channels.find((c) => c.name === "FYI");
    assert.ok(found, "no FYI forum");
    return found.id;
  });
  const alert = await eventually(async () => {
    const { posts } = await call(world.owner, api.posts);
    const found = posts.find((p) => p.forums.includes(room))?.message;
    assert.ok(found, "no notification yet");
    return found.id;
  });
  const post = (await call(world.owner, api.openPost, { alert })).post.channel;
  return { world, alice, room, post };
}

/** The decision PR lines of a channel. */
const lines = async (as: As, channel: string) =>
  (await call(as, api.history, { channel })).messages
    .filter((m) => m.kind === "decision")
    .map(said);

const DECISION = {
  title: "Refunds go through the payment module",
  context: "Refunds and payments edit the same line.",
  decision: "Refunds call refund in the payment module.",
  consequences: "The refund branch is merged after the payment branch.",
};

test("when a decision is written up in a post, a decision PR opens under the writer's member name, and its state changes when a person merges or closes it", async (t) => {
  const { world, alice, room, post } = await postOf(t);
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "I'll merge the payment side first" });
  await call(world.owner, api.send, { channel: post, text: "Sure, refunds after that" });
  const web = await world.live(world.owner);

  // Any member writes it up. Here it is alice. If no window is picked it is one day, so it does not merge right away.
  const { decision } = await call(alice, api.proposeDecision, { post, ...DECISION });
  const path = "docs/decisions/0001-refunds-go-through-the-payment-module.md";
  assert.deepEqual(decision, {
    id: decision.id,
    post,
    login: "alice",
    name: "Alice Kim",
    title: DECISION.title,
    path,
    pull: { number: 1, url: `https://github.com/omagari-test/space/pull/1` },
    window: "day",
    state: "proposed",
    status: "proposed",
    closes: decision.closes,
    deciders: [
      { login: "alice", name: "Alice Kim", agreed: true },
      { login: "owner", name: "owner", agreed: false },
    ],
    objections: [],
    early: false,
    at: decision.at,
  });
  // The window is one day from when it was written up.
  assert.equal(Date.parse(decision.closes ?? "") - Date.parse(decision.at), 24 * 3_600_000);

  // With alice's token, one commit on a branch cut from main, and one PR to main.
  const [pull] = fake.pulls;
  assert.ok(pull);
  assert.equal(pull.author, "alice");
  assert.equal(pull.base, "main");
  assert.equal(pull.open, true);
  assert.equal(pull.draft, false);
  assert.equal(pull.title, `docs(decisions): ${DECISION.title}`);
  assert.match(pull.body ?? "", /Objection window: 1 day/);
  assert.deepEqual(fake.commits, [
    { branch: pull.branch, message: pull.title, author: "alice", paths: [path, "AGENTS.md"] },
  ]);
  // Decision file: number and title, deciders (members who spoke in the post, in order of speaking), source (post link), context, decision, consequences.
  const files = fake.files.get(pull.branch);
  assert.ok(files);
  assert.equal(
    files.get(path),
    [
      `# 0001. ${DECISION.title}`,
      "",
      "- Deciders: Alice Kim (@alice), owner (@owner)",
      `- Source: ${world.server.url}/#${post}`,
      "",
      "## Context",
      "",
      DECISION.context,
      "",
      "## Decision",
      "",
      DECISION.decision,
      "",
      "## Consequences",
      "",
      DECISION.consequences,
      "",
    ].join("\n"),
  );
  // The repo has no AGENTS.md, so make one with a line that points to the decisions folder. main stays as it is.
  assert.match(files.get("AGENTS.md") ?? "", /^Decision records are in `docs\/decisions\/`\./);
  assert.deepEqual([...(fake.files.get("main")?.keys() ?? [])], []);

  // One line in the post. It is not posted to the conflict forum (ADR-0027). It also goes out live. It does not count toward the post's message count.
  const opened = `Decision opened: ${DECISION.title}`;
  assert.deepEqual(await lines(world.owner, post), [opened]);
  assert.deepEqual(await lines(world.owner, room), []);
  await eventually(() =>
    assert.deepEqual(
      web
        .messages()
        .filter((m) => m.kind === "decision")
        .map((m) => [m.channel, said(m)]),
      [[post, opened]],
    ),
  );
  const [summary] = (await call(world.owner, api.posts)).posts;
  assert.equal(summary?.count, 2);
  assert.equal(summary?.last?.line, "Sure, refunds after that");

  // Writing up a second while the first decision PR is open gets the next number. owner wrote it up, so it is owner's name.
  const second = (
    await call(world.owner, api.proposeDecision, {
      post,
      ...DECISION,
      title: "Refund in the payment module takes an amount",
    })
  ).decision;
  assert.equal(second.path, "docs/decisions/0002-refund-in-the-payment-module-takes-an-amount.md");
  assert.equal(fake.pulls[1]?.author, "owner");

  // A person merges the first PR and closes the second on GitHub. Omagari reads it, changes the state, and posts one line each.
  fake.merge(pull);
  fake.close(fake.pulls[1] as (typeof fake.pulls)[number]);
  await eventually(async () =>
    assert.deepEqual(
      (await call(alice, api.decisions)).decisions.map((d) => [d.title, d.state]),
      [
        [DECISION.title, "accepted"],
        ["Refund in the payment module takes an amount", "closed"],
      ],
    ),
  );
  const after = [
    opened,
    "Decision opened: Refund in the payment module takes an amount",
    `Decision merged: ${DECISION.title}`,
    "Decision closed: Refund in the payment module takes an amount",
  ];
  await eventually(async () => {
    assert.deepEqual(await lines(world.owner, post), after);
    assert.deepEqual(await lines(world.owner, room), []);
  });

  // main now has an AGENTS.md pointing to the decisions folder, so the next decision PR does not touch AGENTS.md.
  // The closed decision's number is free, so it is reused. Picking "now" makes Omagari merge it as soon as it opens.
  const now = (
    await call(alice, api.proposeDecision, {
      post,
      ...DECISION,
      title: "Decision to merge now",
      window: "now",
    })
  ).decision;
  assert.equal(now.path, "docs/decisions/0002-decision-to-merge-now.md");
  assert.equal(now.state, "accepted");
  const third = fake.pulls[2];
  assert.ok(third);
  assert.equal(third.open, false);
  assert.ok(third.mergedAt);
  assert.deepEqual(fake.commits[2]?.paths, [now.path]);
  assert.deepEqual(
    [...(fake.files.get("main")?.keys() ?? [])].sort(),
    ["AGENTS.md", path, now.path].sort(),
  );
  assert.deepEqual((await lines(world.owner, post)).slice(-2), [
    "Decision opened: Decision to merge now",
    "Decision merged: Decision to merge now",
  ]);
});

test("if the repo's AGENTS.md does not point to the decisions folder, one line is added, and if it does, it is left alone", async (t) => {
  const { world, post } = await postOf(t);
  const fake = world.github;
  const main = fake.files.get("main") as Map<string, string>;
  main.set("AGENTS.md", "# Rules\n\nRun the tests.\n");
  main.set("docs/decisions/0007-old.md", "# 0007. Old decision\n");

  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  assert.equal(decision.path, "docs/decisions/0008-refunds-go-through-the-payment-module.md");
  const branch = fake.files.get(fake.pulls[0]?.branch ?? "");
  assert.equal(
    branch?.get("AGENTS.md"),
    "# Rules\n\nRun the tests.\n\nDecision records are in `docs/decisions/`. Read the related decisions before you start work.\n",
  );

  main.set("AGENTS.md", "Decisions are in docs/decisions.\n");
  await call(world.owner, api.proposeDecision, { post, ...DECISION, title: "Second" });
  assert.equal(
    fake.files.get(fake.pulls[1]?.branch ?? "")?.get("AGENTS.md"),
    "Decisions are in docs/decisions.\n",
  );
});

test("if GitHub blocks merging right away, the reason is posted, and if the token is invalid, it returns that the PR could not be opened", async (t) => {
  const { world, room, post } = await postOf(t);
  const fake = world.github;

  // If a rule such as required review blocks it, the decision stays proposed, and the reason it was blocked stands as one line in the post. Even retrying every cycle, there is one line.
  const reason = "HTTP 405 At least 1 approving review is required by reviewers with write access.";
  fake.block(reason);
  const { decision } = await call(world.owner, api.proposeDecision, {
    post,
    ...DECISION,
    window: "now",
  });
  assert.equal(decision.state, "proposed");
  assert.equal(decision.status, "blocked");
  assert.equal(decision.reason, reason);
  assert.equal(fake.pulls[0]?.open, true);
  const blocked = [
    `Decision opened: ${DECISION.title}`,
    `Decision blocked: ${DECISION.title} (${reason})`,
  ];
  assert.deepEqual(await lines(world.owner, post), blocked);
  assert.deepEqual(await lines(world.owner, room), []);
  await sleep(200);
  assert.deepEqual(await lines(world.owner, post), blocked);

  // When the block is lifted, Omagari merges on the next cycle.
  fake.block();
  await eventually(async () =>
    assert.equal((await call(world.owner, api.decisions)).decisions[0]?.state, "accepted"),
  );
  assert.ok(fake.pulls[0]?.mergedAt);

  // In a channel that is not a post, there is none.
  await assert.rejects(call(world.owner, api.proposeDecision, { post: room, ...DECISION }), {
    code: "not_found",
  } satisfies Partial<ContractFailure>);

  // If the writer's GitHub token is invalid (the session stays), it returns that the PR could not be opened and nothing is left.
  for (const [token, login] of fake.tokens) if (login === "owner") fake.tokens.delete(token);
  await assert.rejects(
    call(world.owner, api.proposeDecision, {
      post,
      ...DECISION,
      title: "Decision that will not open",
    }),
    (error: ContractFailure) => {
      assert.equal(error.code, "github_failed");
      assert.match(
        error.message,
        /Couldn't open the decision PR with owner's GitHub token: HTTP 401/,
      );
      return true;
    },
  );
  assert.equal(fake.pulls.length, 1);
  assert.equal((await call(world.owner, api.decisions)).decisions.length, 1);
});

/** The decision PR lines of a post, as what happened and one person. */
const events = async (as: As, channel: string) =>
  (await call(as, api.history, { channel })).messages.flatMap((m) =>
    m.kind === "decision" ? [`${m.decision.title} ${m.event}${m.by ? ` ${m.by.login}` : ""}`] : [],
  );

/** Member bob, who did not speak in the post. Not a decider. */
async function bobOf(world: Awaited<ReturnType<typeof postOf>>["world"]) {
  world.github.grant("bob");
  return world.login("bob");
}

const decisionNamed = async (as: As, title: string) => {
  const found = (await call(as, api.decisions)).decisions.find((d) => d.title === title);
  assert.ok(found, `no decision: ${title}`);
  return found;
};

test("the window closes by the chosen length, and Omagari merges if there is no objection", async (t) => {
  // One hour is shortened to 50ms: 1 hour is 50ms, 3 hours straight is 150ms, a day is 1.2 seconds, 3 days is 3.6 seconds.
  const HOUR = 50;
  const { world, alice, post } = await postOf(t, HOUR);
  await call(alice, api.send, { channel: post, text: "I'll merge the payment side first" });
  const windows = [
    ["1 hour", "hour", 1],
    ["Custom 3 hours", { amount: 3, unit: "hour" }, 3],
    ["1 day", "day", 24],
    ["3 days", "three_days", 72],
  ] as const;
  for (const [title, window, hours] of windows) {
    const { decision } = await call(world.owner, api.proposeDecision, {
      post,
      ...DECISION,
      title,
      window,
    });
    assert.deepEqual(decision.window, window);
    // The 1-hour window (50ms) closes before the response arrives, so `closes` may be null. The window's length is also checked by the merge time below.
    if (decision.closes !== null)
      assert.equal(Date.parse(decision.closes) - Date.parse(decision.at), hours * HOUR);
    assert.match(
      world.github.pulls.at(-1)?.body ?? "",
      new RegExp(`Objection window: ${title.replace("Custom ", "")}`),
    );
  }
  for (const [title, , hours] of windows) {
    const decision = await eventually(async () => {
      const found = await decisionNamed(world.owner, title);
      assert.equal(found.status, "accepted");
      return found;
    }, 20_000);
    assert.equal(decision.early, false);
    assert.equal(decision.closes, null);
    // It did not merge before the window closed.
    const pull = world.github.pulls.find((p) => p.number === decision.pull.number);
    assert.ok(Date.parse(pull?.mergedAt ?? "") >= Date.parse(decision.at) + hours * HOUR);
    assert.ok((await events(world.owner, post)).includes(`${title} merged`));
  }
});

test("when an objection (a post and a GitHub change request) is raised, it does not merge even after the window closes, and when all are withdrawn it reopens with the same length", async (t) => {
  const HOUR = 50; // a day is 1.2 seconds
  const { world, alice, post } = await postOf(t, HOUR);
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "I'll merge the payment side first" });
  const bob = await bobOf(world);
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });

  // bob, who is not a decider, also raises an objection. While it stands there is no window.
  const objected = (await call(bob, api.respondToDecision, { id: decision.id, response: "object" }))
    .decision;
  assert.equal(objected.status, "objected");
  assert.equal(objected.closes, null);
  assert.deepEqual(
    objected.objections.map((o) => [o.login, o.via]),
    [["bob", "post"]],
  );
  // Raising the same objection again changes nothing.
  await call(bob, api.respondToDecision, { id: decision.id, response: "object" });

  // You cannot withdraw someone else's objection.
  await assert.rejects(
    call(alice, api.respondToDecision, { id: decision.id, response: "withdraw" }),
    { code: "not_found" } satisfies Partial<ContractFailure>,
  );

  // On GitHub member carol requests changes. It is read every cycle and counted as an objection.
  fake.grant("carol");
  await world.login("carol");
  fake.review(decision.pull.number, "carol", "CHANGES_REQUESTED");
  await eventually(async () =>
    assert.deepEqual(
      (await decisionNamed(world.owner, DECISION.title)).objections.map((o) => [o.login, o.via]),
      [
        ["bob", "post"],
        ["carol", "github"],
      ],
    ),
  );

  // It does not merge even after a day (1.2 seconds) passes.
  await sleep(24 * HOUR + 300);
  assert.equal((await decisionNamed(world.owner, DECISION.title)).state, "proposed");
  assert.equal(fake.pulls[0]?.open, true);

  // Even if bob withdraws, carol's remains, so it is still raised.
  const one = (await call(bob, api.respondToDecision, { id: decision.id, response: "withdraw" }))
    .decision;
  assert.equal(one.status, "objected");

  // If carol changes the change request to an approval, all are withdrawn and the window reopens from the start with the same length (a day).
  const before = Date.now();
  fake.review(decision.pull.number, "carol", "APPROVED");
  const reopened = await eventually(async () => {
    const found = await decisionNamed(world.owner, DECISION.title);
    assert.equal(found.status, "reopened");
    return found;
  });
  assert.ok(Date.parse(reopened.closes ?? "") >= before + 24 * HOUR);
  assert.deepEqual(reopened.objections, []);
  const merged = await eventually(async () => {
    const found = await decisionNamed(world.owner, DECISION.title);
    assert.equal(found.status, "accepted");
    return found;
  }, 10_000);
  assert.equal(merged.early, false);
  assert.ok(Date.parse(fake.pulls[0]?.mergedAt ?? "") >= Date.parse(reopened.closes ?? ""));
  assert.deepEqual(await events(world.owner, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} objected bob`,
    `${DECISION.title} objected carol`,
    `${DECISION.title} withdrawn bob`,
    `${DECISION.title} withdrawn carol`,
    `${DECISION.title} merged`,
  ]);
});

test("if all deciders agree it merges right away even with the window left, but it does not merge if an objection stands or GitHub blocks it", async (t) => {
  const { world, alice, post } = await postOf(t); // the window is really a day
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "I'll merge the payment side first" });
  const bob = await bobOf(world);
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  assert.deepEqual(
    decision.deciders.map((d) => [d.login, d.agreed]),
    [
      ["alice", false],
      ["owner", true],
    ],
  );

  // bob's agreement, who is not a decider, is rejected.
  await assert.rejects(call(bob, api.respondToDecision, { id: decision.id, response: "agree" }), {
    code: "forbidden",
  } satisfies Partial<ContractFailure>);

  // If bob's objection stands, it does not merge even if alice agrees and all agree.
  await call(bob, api.respondToDecision, { id: decision.id, response: "object" });
  const agreed = (await call(alice, api.respondToDecision, { id: decision.id, response: "agree" }))
    .decision;
  assert.equal(agreed.state, "proposed");
  assert.equal(agreed.status, "objected");
  assert.equal(
    agreed.deciders.every((d) => d.agreed),
    true,
  );
  assert.equal(fake.pulls[0]?.open, true);

  // If withdrawn, the window reopens, and since all agreed, it merges right away. It shows as closed early.
  const merged = (await call(bob, api.respondToDecision, { id: decision.id, response: "withdraw" }))
    .decision;
  assert.equal(merged.status, "accepted");
  assert.equal(merged.early, true);
  assert.ok(fake.pulls[0]?.mergedAt);
  assert.deepEqual(await events(world.owner, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} objected bob`,
    `${DECISION.title} agreed alice`,
    `${DECISION.title} withdrawn bob`,
    `${DECISION.title} merged`,
  ]);
  // A finished decision can no longer be responded to.
  await assert.rejects(call(bob, api.respondToDecision, { id: decision.id, response: "object" }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);

  // If GitHub blocks it even when all agree, it is "merge blocked". When unblocked, it merges.
  const reason = "HTTP 405 At least 1 approving review is required by reviewers with write access.";
  fake.block(reason);
  const second = (
    await call(world.owner, api.proposeDecision, { post, ...DECISION, title: "Second decision" })
  ).decision;
  const blocked = (await call(alice, api.respondToDecision, { id: second.id, response: "agree" }))
    .decision;
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason, reason);
  assert.ok(blocked.closes);
  fake.block();
  const done = await eventually(async () => {
    const found = await decisionNamed(world.owner, "Second decision");
    assert.equal(found.status, "accepted");
    return found;
  });
  assert.equal(done.early, true);
  assert.deepEqual((await events(world.owner, post)).slice(-4), [
    "Second decision opened",
    "Second decision agreed alice",
    "Second decision blocked",
    "Second decision merged",
  ]);
});

test("only the person who wrote it up edits a decision to add a commit to the same PR, or discards it to close the PR", async (t) => {
  const { world, alice, post } = await postOf(t);
  const fake = world.github;
  const bob = await bobOf(world);
  await call(alice, api.send, { channel: post, text: "I'll merge the payment side first" });
  await call(bob, api.send, { channel: post, text: "I saw it too" });
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  await call(alice, api.respondToDecision, { id: decision.id, response: "agree" });

  // Someone other than the writer can neither edit nor discard it.
  const revision = { ...DECISION, decision: "Refunds call refund(amount) in the payment module." };
  await assert.rejects(call(alice, api.reviseDecision, { id: decision.id, ...revision }), {
    code: "forbidden",
  } satisfies Partial<ContractFailure>);
  await assert.rejects(call(alice, api.discardDecision, { id: decision.id }), {
    code: "forbidden",
  } satisfies Partial<ContractFailure>);

  // Editing adds a commit to the same branch. Other deciders' agreement is cleared and the window is a day again.
  const pull = fake.pulls[0];
  assert.ok(pull);
  const before = Date.now();
  const revised = (await call(world.owner, api.reviseDecision, { id: decision.id, ...revision }))
    .decision;
  assert.equal(fake.pulls.length, 1);
  assert.deepEqual(
    fake.commits.map((c) => [c.branch, c.author]),
    [
      [pull.branch, "owner"],
      [pull.branch, "owner"],
    ],
  );
  assert.deepEqual(fake.commits[1]?.paths, [decision.path]);
  assert.match(fake.files.get(pull.branch)?.get(decision.path) ?? "", /refund\(amount\)/);
  assert.deepEqual(
    revised.deciders.map((d) => [d.login, d.agreed]),
    [
      ["alice", false],
      ["bob", false],
      ["owner", true],
    ],
  );
  assert.ok(Date.parse(revised.closes ?? "") >= before + 24 * 3_600_000);

  // Discarding closes the PR and the decision does not stay on the default branch.
  const closed = (await call(world.owner, api.discardDecision, { id: decision.id })).decision;
  assert.equal(closed.status, "closed");
  assert.equal(closed.closes, null);
  assert.equal(pull.open, false);
  assert.equal(pull.mergedAt, undefined);
  assert.equal(fake.files.get("main")?.has(decision.path), false);
  assert.deepEqual(await events(world.owner, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} agreed alice`,
    `${DECISION.title} revised owner`,
    `${DECISION.title} closed owner`,
  ]);
  await assert.rejects(call(world.owner, api.discardDecision, { id: decision.id }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);
});

test("if the writer's token is invalid, merging stops and tells, and when they log in again it continues", async (t) => {
  const HOUR = 20; // a day is 480ms
  const { world, alice, post } = await postOf(t, HOUR);
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "I'll merge the payment side first" });
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  // Leave owner's session as is and make only the GitHub token invalid.
  for (const [token, login] of fake.tokens) if (login === "owner") fake.tokens.delete(token);

  const stalled = await eventually(async () => {
    const found = await decisionNamed(alice, DECISION.title);
    assert.equal(found.status, "stalled");
    return found;
  });
  assert.match(stalled.reason ?? "", /^HTTP 401/);
  assert.equal(fake.pulls[0]?.open, true);
  // Even retrying every cycle, there is one line.
  await sleep(300);
  assert.deepEqual(await events(alice, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} stalled`,
  ]);

  // If the owner logs in again, it merges with the new token.
  await world.login("owner");
  const merged = await eventually(async () => {
    const found = await decisionNamed(alice, DECISION.title);
    assert.equal(found.status, "accepted");
    return found;
  });
  assert.equal(merged.id, decision.id);
  assert.equal(merged.early, false);
  assert.ok(fake.pulls[0]?.mergedAt);
});
