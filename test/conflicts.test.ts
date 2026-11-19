import assert from "node:assert/strict";
import { test } from "node:test";
import { type Alert, api, type ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, REPO, said, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };

const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;
/** The version with line `n` (from 1) replaced by `to`. */
const edit = (n: number, to: string, lines = BASE) => lines.toSpliced(n - 1, 1, to);

/** Puts `files` on the base commit and pushes origin/main. Two members start from the same version. */
async function base(world: World, files: string[]) {
  for (const path of files) await writer(world.repo.folder)(path, text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/**
 * Member `login`'s device. As if they cloned my repo, starts `branch` on my main. Two clones of the same repo.
 * The runner stays off while cloning, so work in a half-cloned repo isn't briefly observed and doesn't raise an alert.
 */
async function clone(world: World, login: string, branch: string, share?: "declared") {
  world.github.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, share);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  await desk.start();
  return { as, desk };
}

/**
 * owner moves to the payment branch and waits until the server sees it. If observation moved after reading the branch name,
 * that cycle's changed files could briefly look like the old branch's.
 */
async function payment(world: World) {
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
}

type Of<K extends Alert["kind"]> = (K extends "direct"
  ? Extract<Alert, { kind: "direct" }>
  : Exclude<Alert, { kind: "direct" }>) & { id: number };

/**
 * Alerts of `kind` (direct conflict by default). With a forum `name`, only those shown in that forum, and empty if there is no such forum.
 * Each alert has the post made when it was raised (ADR-0027).
 */
async function alerts<K extends Alert["kind"] = "direct">(
  as: As,
  name?: string,
  kind = "direct" as K,
): Promise<Of<K>[]> {
  const forum = (await call(as, api.channels)).channels.find((c) => c.name === name);
  if (name !== undefined && !forum) return [];
  const { posts } = await call(as, api.posts);
  return posts.flatMap(({ message: m, ...post }) => {
    if (m.kind !== "alert" || m.alert.kind !== kind) return [];
    if (forum && !post.forums.includes(forum.id)) return [];
    assert.equal(post.channel, m.post.channel);
    return [{ id: m.id, ...m.alert } as unknown as Of<K>];
  });
}

/** Waits until exactly one `kind` alert exists, and that alert once `check` passes. */
const theAlert = <K extends Alert["kind"] = "direct">(
  as: As,
  check: (alert: Of<K>) => void,
  name?: string,
  kind = "direct" as K,
) =>
  eventually(async () => {
    const found = await alerts(as, name, kind);
    assert.equal(found.length, 1, JSON.stringify(found));
    check(found[0] as Of<K>);
    return found[0] as Of<K>;
  });

/** Direct-conflict marks per work in the member list. */
async function marks(as: As) {
  const { members } = await call(as, api.members);
  return Object.fromEntries(
    members.flatMap((m) => m.works.map((w) => [`${m.login}/${w.branch}`, w.conflict])),
  );
}

const OWNER = { login: "owner", name: "owner", branch: "payment" };
const ALICE = { login: "alice", name: "alice", branch: "refund" };

test("editing the same place raises one alert, a change updates the same alert, and when all is resolved it is marked resolved once", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, ["src/pay.ts", "src/clean.ts"]);
  const { desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);
  const web = await world.live(world.owner);

  // Editing apart lines in the same file merges cleanly and doesn't collide.
  await writer(world.repo.folder)("src/clean.ts", text(edit(2, "owner")));
  await writer(desk.folder)("src/clean.ts", text(edit(8, "alice")));
  // Editing the same line collides.
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  assert.deepEqual(await alerts(world.owner), []);
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice")));

  // The alert has two people, two branches, the files, and the colliding lines (by each one's copy).
  const first = await theAlert(world.owner, () => {});
  assert.deepEqual(first, {
    id: first.id,
    kind: "direct",
    works: [ALICE, OWNER],
    files: [
      {
        path: "src/pay.ts",
        lines: [[{ from: 3, to: 3 }], [{ from: 3, to: 3 }]],
      },
    ],
    more: 0,
    resolved: null,
  });
  // Even if both runners raise the same pair, there is one alert. Other members see the same.
  await eventually(async () => assert.deepEqual(await alerts(world.owner), [first]));
  await eventually(async () =>
    assert.deepEqual(await marks(world.owner), {
      "alice/refund": true,
      "owner/payment": true,
    }),
  );

  // When the collision changes, the same alert is updated and arrives again over the live connection.
  await writer(desk.folder)("src/pay.ts", text(edit(4, "alice too", edit(3, "alice"))));
  const changed = await theAlert(world.owner, (alert) =>
    assert.deepEqual(alert.files, [
      {
        path: "src/pay.ts",
        lines: [[{ from: 3, to: 4 }], [{ from: 3, to: 3 }]],
      },
    ]),
  );
  assert.equal(changed.id, first.id);
  // The post's first message is that alert, so it changes along with it.
  const firstPost = async () =>
    (await call(world.owner, api.openPost, { alert: first.id })).message;
  const top = await firstPost();
  assert.ok(top.kind === "alert" && top.alert.kind === "direct");
  assert.deepEqual(top.alert.files, changed.files);
  await eventually(() =>
    assert.ok(
      web
        .messages()
        .some(
          (m) =>
            m.id === first.id &&
            m.kind === "alert" &&
            m.alert.kind === "direct" &&
            JSON.stringify(m.alert.files) === JSON.stringify(changed.files),
        ),
    ),
  );

  // When all is resolved, the resolved time is written once on the same alert, and no new alert is raised. The mark disappears too.
  await desk.git("checkout", "--", "src/pay.ts");
  const resolved = await theAlert(world.owner, (alert) => assert.notEqual(alert.resolved, null));
  assert.equal(resolved.id, first.id);
  await eventually(async () =>
    assert.deepEqual(await marks(world.owner), {
      "alice/refund": false,
      "owner/payment": false,
    }),
  );
  await eventually(() =>
    assert.ok(web.messages().some((m) => m.kind === "alert" && m.alert.resolved !== null)),
  );
  const closed = await firstPost();
  assert.ok(closed.kind === "alert" && closed.alert.resolved !== null);
  // A resolved post stays in the list and shows as resolved.
  const listedClosed = (await call(world.owner, api.posts)).posts.find((p) => p.alert === first.id);
  assert.ok(listedClosed?.message.kind === "alert" && listedClosed.message.alert.resolved !== null);
  // Colliding again after being resolved is a new alert.
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice again")));
  const again = await eventually(async () => {
    const [old, next, ...rest] = await alerts(world.owner);
    assert.deepEqual([old, rest], [resolved, []]);
    assert.equal(next?.resolved, null);
    return next;
  });
  assert.notEqual(again?.id, first.id);
  await web.close();
});

test("when several files of a pair collide, they are grouped into one alert, with names up to eight and the rest as a count", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const paths = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
  await base(world, paths);
  const { desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);
  for (const path of paths) {
    await writer(world.repo.folder)(path, text(edit(1, "owner")));
    await writer(desk.folder)(path, text(edit(1, "alice")));
  }
  const alert = await theAlert(world.owner, (alert) => assert.equal(alert.more, 2));
  assert.deepEqual(
    alert.files.map((file) => file.path),
    paths.slice(0, 8),
  );
});

test("an alert comes even when only one runner is on", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, ["src/pay.ts"]);
  const { desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice")));
  await eventually(async () =>
    assert.ok(
      (await world.works(world.owner)).some((w) => w.branch === "refund" && w.files.length === 1),
    ),
  );
  // Even if alice's runner is off, her work stays on the server, and owner's runner computes alone.
  await desk.stop();
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  await theAlert(world.owner, (alert) =>
    assert.deepEqual(alert.files, [
      {
        path: "src/pay.ts",
        lines: [[{ from: 3, to: 3 }], [{ from: 3, to: 3 }]],
      },
    ]),
  );
  await eventually(async () =>
    assert.deepEqual(await marks(world.owner), {
      "alice/refund": true,
      "owner/payment": true,
    }),
  );
});

test("when the other side's content can't be read, it is reported as might collide", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, ["src/pay.ts", "src/bob.ts"]);

  // alice doesn't send out her content (share level declared). alice's runner computes with owner's content,
  // but what owner's runner can't check is "might collide". The results of the two runners are merged into one.
  const alice = await clone(world, "alice", "refund", "declared");
  t.after(alice.desk.remove);
  // bob works on a commit this device hasn't received. bob's runner doesn't know my base commit.
  world.github.grant("bob");
  const bob = await world.desk(await world.login("bob"));
  t.after(bob.remove);
  await bob.git("commit", "--allow-empty", "--message=bob");
  await bob.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await bob.git("switch", "--create", "bob");
  await writer(bob.folder)("src/bob.ts", "bob\n");

  await payment(world);
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  await writer(world.repo.folder)("src/bob.ts", text(edit(3, "owner")));
  await writer(alice.desk.folder)("src/pay.ts", text(edit(9, "alice")));

  // Even apart lines are reported because they couldn't be checked. alice's runner sees it clean with owner's content, but owner's runner can't check.
  // The results of the two runners are merged per pair. The mark goes only on confirmed direct conflicts.
  await eventually(async () => {
    // An alert raised briefly while moving branches is already resolved. Look only at open ones.
    const found = (await alerts(world.owner))
      .filter((alert) => alert.resolved === null)
      .map(({ works, files }) => ({ works, files }));
    assert.deepEqual(
      found.sort((x, y) => (x.works[0].login < y.works[0].login ? -1 : 1)),
      [
        {
          works: [ALICE, OWNER],
          files: [{ path: "src/pay.ts", unknown: "share" }],
        },
        {
          works: [{ login: "bob", name: "bob", branch: "bob" }, OWNER],
          files: [{ path: "src/bob.ts", unknown: "base" }],
        },
      ],
    );
  });
  assert.deepEqual(await marks(world.owner), {
    "alice/refund": false,
    "bob/bob": false,
    "owner/payment": false,
  });
});

test("an alert creates a post and its first message is the alert. You can't write in the forum, and in the post messages, DMs and @mentions work like a channel", async (t) => {
  const fake = fakeExecutor(() => "answer");
  const world = await startWorld({ observeMs: 50, executor: fake.executor });
  t.after(world.stop);
  await base(world, ["src/pay.ts"]);
  const { as: alice, desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);
  const web = await world.live(alice);
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice")));
  const alert = await theAlert(world.owner, () => {});
  /** The post of the alert line last received over the live connection. */
  const postOf = () =>
    web
      .messages()
      .flatMap((m) => (m.kind === "alert" && m.id === alert.id ? [m.post] : []))
      .at(-1);

  // Even if nobody opens it, the post exists the moment the alert is raised. It is already attached to the first alert line received.
  const arrived = await eventually(() => {
    const first = web.messages().find((m) => m.id === alert.id);
    assert.ok(first?.kind === "alert");
    return first;
  });
  const post = arrived.post.channel;
  // A direct conflict is FYI, so it shows in the "FYI" forum (ADR-0039).
  const channels = (await call(alice, api.channels)).channels;
  const reference = channels.find((c) => c.name === "FYI")?.id;
  // The issue (ADR-0032) opens separately after the alert, so it's left out here. issues.test.ts looks at issues.
  const noIssue = <T extends { issue: unknown }>({ issue, ...rest }: T) => rest;
  assert.deepEqual(noIssue(arrived.post), {
    channel: post,
    repo: REPO,
    count: 0,
    last: null,
    activity: arrived.at,
    labels: ["Direct conflict"],
    importance: "reference",
    forums: [reference],
  });
  // One list call is enough to draw the forum screen: the alert, the last message (none yet), the message count, the last activity, the time raised.
  const listed = (await call(alice, api.posts)).posts;
  assert.deepEqual(
    listed.map(({ message, ...p }) => noIssue(p)),
    [
      {
        channel: post,
        repo: REPO,
        alert: alert.id,
        count: 0,
        last: null,
        activity: arrived.at,
        labels: ["Direct conflict"],
        importance: "reference",
        forums: [reference],
        debate: null,
        request: null,
      },
    ],
  );
  const [first] = listed;
  assert.ok(first?.message.kind === "alert");
  assert.equal(first.message.at, arrived.at);
  assert.equal(first.message.alert.kind, "direct");
  assert.equal(first.message.alert.resolved, null);
  const opened = await call(world.owner, api.openPost, { alert: alert.id });
  assert.deepEqual(noIssue(opened.post), {
    channel: post,
    repo: REPO,
    alert: alert.id,
    count: 0,
    last: null,
    activity: arrived.at,
    labels: ["Direct conflict"],
    importance: "reference",
    forums: [reference],
  });
  assert.equal(opened.message.id, alert.id);
  await assert.rejects(call(alice, api.openPost, { alert: alert.id + 1 }), {
    code: "not_found",
  } satisfies Partial<ContractFailure>);

  // The channel list has the forums with kind and filter and no posts. People can't make a channel with a forum's name.
  const general = await world.channel(world.owner, "일반"); // the harness default channel name
  const forum = channels.find((c) => c.name === "Discuss");
  assert.deepEqual((await call(alice, api.channels)).channels, [
    {
      id: forum?.id,
      name: "Discuss",
      kind: "forum",
      filter: { importance: "discuss" },
    },
    {
      id: reference,
      name: "FYI",
      kind: "forum",
      filter: { importance: "reference" },
    },
    { id: general, name: "일반", kind: "chat" },
  ]);
  assert.ok(forum);
  await assert.rejects(call(alice, api.createChannel, { name: "FYI" }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);

  // The forum itself takes no messages, DMs or `@mention`s.
  await assert.rejects(
    call(world.owner, api.send, {
      channel: forum.id,
      text: "words in the forum",
    }),
    {
      code: "invalid_request",
    } satisfies Partial<ContractFailure>,
  );
  for (const visibility of ["private", "public"] as const) {
    await assert.rejects(
      call(world.owner, api.ask, {
        agent: "owner",
        executor: "claude-code",
        channel: forum.id,
        message: "asking in the forum",
        visibility,
      }),
      { code: "invalid_request" } satisfies Partial<ContractFailure>,
    );
  }
  assert.equal(fake.calls.length, 0);

  // A message written in the post goes live to other members and is read again as past conversation. The alert line's message count follows.
  const { message: postText } = await call(world.owner, api.send, {
    channel: post,
    text: "I'll fix this line",
  });
  // A post has no threads (ADR-0047).
  await assert.rejects(
    call(alice, api.send, { channel: post, text: "Thread", threadOf: postText.id }),
    { code: "invalid_request" } satisfies Partial<ContractFailure>,
  );
  await eventually(() =>
    assert.ok(web.messages().some((m) => m.channel === post && said(m) === "I'll fix this line")),
  );
  assert.deepEqual((await call(alice, api.history, { channel: post })).messages.map(said), [
    "I'll fix this line",
  ]);
  // The summary of that post arriving over the live connection changes: the last message (author and one line) and the last activity time.
  await eventually(() => {
    const p = postOf();
    assert.equal(p?.count, 1);
    assert.equal(p?.last?.login, "owner");
    assert.equal(p?.last?.line, "I'll fix this line");
    assert.ok(p && p.activity > arrived.at);
  });

  // A chat channel's channel session and a post's channel session continue separately.
  await world.settled(world.owner, await world.ask(world.owner, general, "ask in channel"));
  const dm = await world.ask(world.owner, post, "ask in post");
  await world.settled(world.owner, dm);
  await world.settled(world.owner, await world.ask(world.owner, post, "ask in post again"));
  const [inRoom, inPost, again] = fake.calls;
  assert.equal(inRoom?.resume, undefined);
  assert.equal(inPost?.resume, undefined, "a post doesn't continue another channel's session");
  assert.equal(again?.resume, "session-2", "it continues the post's session");
  // The conversation handed to the runner is the post's, with the alert at the top.
  const given = inPost?.message ?? "";
  assert.match(given, /<channel_messages channel="Post for alert \d+">/);
  assert.match(given, /<alert kind="Direct conflict"[^>]*>\n[^<]*src\/pay\.ts: 3 \/ 3/);
  assert.match(given, /I'll fix this line/);
  assert.ok(given.indexOf("<alert") < given.indexOf("I'll fix this line"));

  // Post the DM to the post, and the `@mention` stands in the post too. Both count in the message count.
  const shared = await call(world.owner, api.postQa, {
    qa: dm.id,
    text: "reason",
  });
  assert.equal(shared.message.channel, post);
  const called = await call(world.owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel: post,
    message: "ask so everyone sees",
    visibility: "public",
  });
  assert.equal(called.message?.channel, post);
  await world.settled(world.owner, called.qa);
  assert.deepEqual(
    (await call(alice, api.history, { channel: post })).messages.map((m) => m.kind),
    ["text", "qa", "qa"],
  );
  await eventually(() => assert.equal(postOf()?.count, 3));
  const atForum = (await call(alice, api.openPost, { alert: alert.id })).message;
  assert.equal(atForum.kind === "alert" && atForum.post.count, 3);
  // The list API gives the same summary. The last message is the question of whoever made the `@mention`.
  const [now] = (await call(alice, api.posts)).posts;
  assert.equal(now?.count, 3);
  assert.equal(now?.last?.line, "ask so everyone sees");
});

/** The base version to compare definition lines against: two functions and the file that uses them. */
const PAY = `export function pay(amount: number) {
  return amount;
}
export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { pay, refund } from "./pay";
export const total = pay(1) + refund(2);
`;

/** Puts src/pay.ts and src/checkout.ts on the base commit. */
async function symbolBase(world: World) {
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** Only the inbox's news lines from the submitted message (the CLI's reply). */
const inboxLines = (output: string) =>
  output.split("<omagari-inbox>\n")[1]?.split("\n</omagari-inbox>")[0]?.split("\n") ?? [];

/** Runs `omagari status` repeatedly in `cwd` until `line` is delivered to the inbox. What was delivered doesn't come again, so it collects what it saw. */
async function receives(world: World, cwd: string, line: string) {
  const seen: string[] = [];
  await eventually(async () => {
    seen.push(...inboxLines((await world.cliIn(cwd, "status")).stdout));
    assert.ok(seen.includes(line), JSON.stringify(seen));
  });
}

test("changing a function's definition line sends a presumed indirect conflict to other work that uses it, a body-only change is left out, and it resolves on revert or when the usage disappears", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await symbolBase(world);
  const alice = await clone(world, "alice", "refund");
  t.after(alice.desk.remove);
  await payment(world);

  // owner changes pay's body and refund's definition line at once. alice uses both. Only refund is in the alert.
  const changed = PAY.replace("return amount;", "return amount + 0;").replace(
    "refund(amount: number)",
    "refund(amount: number, reason: string)",
  );
  await writer(world.repo.folder)("src/pay.ts", changed);
  const REFUND = {
    name: "refund",
    places: [
      [
        { path: "src/checkout.ts", line: 1, role: "uses" },
        { path: "src/checkout.ts", line: 2, role: "uses" },
      ],
      [{ path: "src/pay.ts", line: 4, role: "changed" }],
    ],
  };
  // If owner is observed mid-write (an empty file), an alert with all definitions gone is briefly raised and fixed in the next report. Wait until it is fixed.
  const first = await theAlert(
    world.owner,
    (alert) => assert.deepEqual(alert.symbols, [REFUND]),
    undefined,
    "indirect",
  );
  assert.deepEqual(first, {
    id: first.id,
    kind: "indirect",
    works: [ALICE, OWNER],
    symbols: [REFUND],
    more: 0,
    resolved: null,
  });
  // No direct conflict (no file was changed together). It goes into the user's inbox with "presumed".
  assert.deepEqual(await alerts(world.owner), []);
  await receives(
    world,
    alice.desk.folder,
    `- Indirect conflict (estimated): my Work and owner's branch "payment". One side changed or removed a definition line of a symbol the other side uses. It's linked by name only, so it may be a different symbol. "refund" (me: Uses "src/checkout.ts":1, "src/checkout.ts":2 / them: Definition line changed "src/pay.ts":4)`,
  );

  // Reverting the changed definition line resolves it.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("return amount;", "return amount + 0;"),
  );
  const resolved = await theAlert(
    world.owner,
    (alert) => assert.notEqual(alert.resolved, null),
    undefined,
    "indirect",
  );
  assert.equal(resolved.id, first.id);
  await receives(
    world,
    alice.desk.folder,
    `- Resolved: my Work and owner's branch "payment"'s Indirect conflict (guessed)`,
  );

  // Changing it again is a new alert. If the user's runner is off, the changer's runner alone doesn't count it as resolved.
  await writer(world.repo.folder)("src/pay.ts", changed);
  const again = await eventually(async () => {
    const open = (await alerts(world.owner, undefined, "indirect")).filter((a) => !a.resolved);
    assert.equal(open.length, 1);
    // As above, wait until the mid-write alert is fixed.
    assert.deepEqual(open[0]?.symbols, [REFUND]);
    return open[0] as Of<"indirect">;
  });
  await alice.desk.stop();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "alice" && w.offlineSince)),
  );
  assert.deepEqual(
    (await alerts(world.owner, undefined, "indirect")).find((a) => a.id === again.id)?.resolved,
    null,
  );

  // It resolves when the usage disappears.
  await alice.desk.start();
  await writer(alice.desk.folder)("src/checkout.ts", "export const total = 1;\n");
  await eventually(async () =>
    assert.notEqual(
      (await alerts(world.owner, undefined, "indirect")).find((a) => a.id === again.id)?.resolved,
      null,
    ),
  );
});

test("a new definition with the same name in two works puts a duplicate implementation in both inboxes, and a pair with both a direct and an indirect conflict has a separate alert per kind", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await symbolBase(world);
  const alice = await clone(world, "alice", "refund");
  t.after(alice.desk.remove);
  await payment(world);

  // Each makes a new function with the same name in a different file.
  await writer(alice.desk.folder)(
    "src/split.ts",
    "export function split(n: number) {\n  return [n];\n}\n",
  );
  await writer(world.repo.folder)(
    "src/money.ts",
    "export const split = (total: number) => [total];\n",
  );
  const duplicate = await theAlert(world.owner, () => {}, undefined, "duplicate");
  assert.deepEqual(duplicate, {
    id: duplicate.id,
    kind: "duplicate",
    works: [ALICE, OWNER],
    symbols: [
      {
        name: "split",
        places: [
          [{ path: "src/split.ts", line: 1, role: "added" }],
          [{ path: "src/money.ts", line: 1, role: "added" }],
        ],
      },
    ],
    more: 0,
    resolved: null,
  });
  await receives(
    world,
    world.repo.folder,
    `- Duplicate work: my Work and alice's branch "refund" each made a new definition with the same name. "split" (me: Added "src/money.ts":1 / them: Added "src/split.ts":1)`,
  );
  await receives(
    world,
    alice.desk.folder,
    `- Duplicate work: my Work and owner's branch "payment" each made a new definition with the same name. "split" (me: Added "src/split.ts":1 / them: Added "src/money.ts":1)`,
  );

  // Both edit the same line (pay's body), and owner also changes refund's definition line. Three kinds stand separately for one pair.
  await writer(alice.desk.folder)(
    "src/pay.ts",
    PAY.replace("return amount;", "return amount * 1;"),
  );
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("return amount;", "return amount + 0;").replace(
      "refund(amount: number)",
      "refund(amount: number, reason: string)",
    ),
  );
  await theAlert(world.owner, (alert) => assert.equal(alert.files[0]?.path, "src/pay.ts"));
  await theAlert(
    world.owner,
    (alert) =>
      assert.deepEqual(
        alert.symbols.map((s) => s.name),
        ["refund"],
      ),
    undefined,
    "indirect",
  );
  const kinds = (await call(world.owner, api.feed)).news;
  assert.deepEqual(kinds, []); // both works have owner's, so it isn't in the feed
  const all = await alerts(world.owner, undefined, "duplicate");
  assert.deepEqual(
    all.map((a) => a.id),
    [duplicate.id],
  );
});
