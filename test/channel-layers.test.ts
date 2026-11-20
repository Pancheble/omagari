// Channels and forums on two layers, repo and workspace (ADR-0043). A chat channel belongs to a repo or the workspace, and a repo channel is seen only by members with push access to that repo.
// An `@mention` in a repo channel is answered by that repo's runner, and one in a workspace channel by the runner attached last, and the answer carries the repo and branch.
// A forum filters by repo, and a post in a repo the viewer has no push access to is not shown anywhere.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, REPO, REPO2, REPO3, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string; login?: string; repos?: string[] };
/** `as` calls as `repo`. */
const on = (as: As, repo: string) => ({ ...as, repos: [repo] });
const refused = (code: string) => (error: ContractFailure) => error.code === code;
const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

test("a repo channel is seen only by members who see the repo and answered by that repo's runner, and a workspace channel is answered by the runner attached last with the repo and branch on the answer", async (t) => {
  const core = fakeExecutor(() => "answer from the core runner");
  const pay = fakeExecutor(() => "answer from the pay runner");
  const world = await startWorld({
    accept: [REPO, REPO2],
    executor: core.executor,
  });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  // alice has push access to REPO2 only.
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");
  const live = await world.live(alice);

  // Only a member who sees the repo can make a repo channel, and the repo must belong to this workspace.
  await assert.rejects(
    call(alice, api.createChannel, { name: "core", repo: REPO }),
    refused("not_found"),
  );
  await assert.rejects(
    call(owner, api.createChannel, { name: "other", repo: REPO3 }),
    refused("not_found"),
  );
  const shared = (await call(owner, api.createChannel, { name: "shared" })).channel;
  const coreChat = (await call(owner, api.createChannel, { name: "core", repo: REPO })).channel;
  const payChat = (
    await call(on(owner, REPO2), api.createChannel, {
      name: "pay",
      repo: REPO2,
    })
  ).channel;
  assert.equal(shared.repo, undefined);
  assert.equal(coreChat.repo, REPO);
  assert.equal(payChat.repo, REPO2);
  // A name is unique per layer: only a clash within the same repo is a conflict, and the channel names of a repo without access stay hidden.
  await assert.rejects(
    call(owner, api.createChannel, { name: "core", repo: REPO }),
    refused("conflict"),
  );
  const sameName = (await call(alice, api.createChannel, { name: "core" })).channel;
  assert.equal(
    sameName.repo,
    undefined,
    "alice, who can't see core in REPO, still makes core in the workspace",
  );
  const samePay = (await call(owner, api.createChannel, { name: "core", repo: REPO2 })).channel;
  assert.equal(samePay.repo, REPO2);
  // Channel list: alice sees only workspace channels and the channels of REPO2.
  const names = async (as: As) =>
    (await call(as, api.channels)).channels
      .filter((c) => c.kind === "chat")
      .map((c) => `${c.name}:${c.repo ?? ""}`)
      .sort();
  assert.deepEqual(
    await names(owner),
    [`pay:${REPO2}`, `shared:`, `core:`, `core:${REPO}`, `core:${REPO2}`].sort(),
  );
  assert.deepEqual(
    await names(alice),
    [`pay:${REPO2}`, `shared:`, `core:`, `core:${REPO2}`].sort(),
  );
  // Live connections too: the channel made and its messages don't go to alice's connection, which can't see REPO.
  await eventually(() => {
    const seen = live.received.flatMap((m) => (m.kind === "channel" ? [m.payload.name] : []));
    assert.deepEqual(seen.sort(), ["core", "core", "pay", "shared"]);
  });
  await call(owner, api.send, { channel: coreChat.id, text: "about core" });
  await call(owner, api.send, { channel: payChat.id, text: "about pay" });
  await eventually(() =>
    assert.deepEqual(
      live.messages().map((m) => m.kind === "text" && m.text),
      ["about pay"],
    ),
  );
  // Reading, writing and asking are blocked too.
  await assert.rejects(call(alice, api.history, { channel: coreChat.id }), refused("not_found"));
  await assert.rejects(
    call(alice, api.send, { channel: coreChat.id, text: "secretly" }),
    refused("not_found"),
  );
  await assert.rejects(call(alice, api.dms, { channel: coreChat.id }), refused("not_found"));
  assert.equal((await call(alice, api.history, { channel: payChat.id })).messages.length, 1);

  // `@mention`: owner has one runner on REPO and one on REPO2 (the one attached later is REPO2).
  const desk = await world.desk(owner, undefined, { "claude-code": pay.executor }, { repo: REPO2 });
  t.after(desk.remove);
  const answered = async (channel: string, message: string, visibility?: "public") => {
    const { qa } = await call(owner, api.ask, {
      agent: "owner",
      executor: "claude-code",
      channel,
      message,
      ...(visibility && { visibility }),
    });
    const done = await world.settled(owner, qa);
    assert.equal(done.answer.state, "answered");
    return done.answer as Extract<typeof done.answer, { state: "answered" }>;
  };
  const coreAnswer = await answered(coreChat.id, "asking in core");
  assert.equal(
    coreAnswer.text,
    "answer from the core runner",
    "a repo channel is answered by that repo's runner",
  );
  assert.equal(coreAnswer.source.repo, REPO);
  const payAnswer = await answered(payChat.id, "asking in pay");
  assert.equal(payAnswer.text, "answer from the pay runner");
  assert.equal(payAnswer.source.repo, REPO2);
  // A workspace channel is answered by the runner attached last, with the repo and branch on the answer.
  const sharedAnswer = await answered(shared.id, "asking in shared", "public");
  assert.equal(sharedAnswer.text, "answer from the pay runner");
  assert.equal(sharedAnswer.source.repo, REPO2);
  assert.equal(typeof sharedAnswer.source.branch, "string");
  assert.equal(core.calls.length, 1);
  assert.equal(pay.calls.length, 2);
  // If a repo channel's runner is off, a runner of another repo doesn't answer in its place.
  await desk.stop();
  await eventually(() =>
    assert.rejects(
      call(owner, api.ask, {
        agent: "owner",
        executor: "claude-code",
        channel: payChat.id,
        message: "repo is off",
      }),
      refused("runner_offline"),
    ),
  );
  // A workspace channel is answered by the remaining runner.
  const rest = await answered(shared.id, "to the remaining runner");
  assert.equal(rest.text, "answer from the core runner");
  assert.equal(rest.source.repo, REPO);
});

test("a forum filters by repo, a label rename in a repo is followed by the forums filtering that repo, and posts of a repo without push access show in no forum", async (t) => {
  const world = await startWorld({
    accept: [REPO, REPO2],
    observeMs: 50,
    followMs: 50,
  });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");

  // Two branches editing the same line set up one direct-conflict post each in REPO and REPO2.
  const conflict = async (
    folder: string,
    git: (...a: string[]) => Promise<unknown>,
    tree: string,
  ) => {
    await writer(folder)("src/pay.ts", text(BASE));
    await git("add", ".");
    await git("commit", "--message=base");
    await git("update-ref", "refs/remotes/origin/main", "HEAD");
    await git("switch", "--create", "payment");
    await writer(folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "payment")));
    await writer(tree)("src/pay.ts", text(BASE.toSpliced(2, 1, "refund")));
  };
  const refund = await world.worktree("refund");
  await conflict(world.repo.folder, world.repo.git, refund);
  const desk = await world.desk(alice, undefined, undefined, { repo: REPO2 });
  t.after(desk.remove);
  const refund2 = join(desk.folder, "..", `${crypto.randomUUID()}-refund`);
  await desk.git("worktree", "add", "-b", "refund", refund2);
  t.after(() => rm(refund2, { recursive: true, force: true }));
  await writer(desk.folder)("src/pay.ts", text(BASE));
  await desk.git("add", ".");
  await desk.git("commit", "--message=base");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "payment");
  await writer(desk.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "payment")));
  await writer(refund2)("src/pay.ts", text(BASE.toSpliced(2, 1, "refund")));

  // If the runner is late seeing the work, it briefly raises a fake collision (main and refund) from an old base, and the alert is resolved but its post stays. Count only the posts of open alerts.
  const open = async (as: As, repo: string) =>
    (await call(on(as, repo), api.posts)).posts.filter(
      (p) => p.message?.kind === "alert" && !p.message.alert.resolved,
    );
  const postOf = (as: As, repo: string) =>
    eventually(async () => {
      const posts = await open(as, repo);
      assert.equal(posts.length, 1);
      return posts[0] as (typeof posts)[number];
    });
  const corePost = await postOf(owner, REPO);
  const payPost = await postOf(owner, REPO2);
  assert.equal(corePost.repo, REPO);
  assert.equal(payPost.repo, REPO2);

  // A forum's repo filter. Empty means all repos and isn't written. A repo outside this workspace is refused (case is matched).
  const forum = async (name: string, filter: object) =>
    (await call(owner, api.createForum, { name, filter: filter as never })).channel;
  const coreForum = await forum("core", {
    labels: ["Direct conflict"],
    repos: [REPO],
  });
  const payForum = await forum("pay", {
    labels: ["Direct conflict"],
    repos: [REPO2.toUpperCase()],
  });
  const allForum = await forum("all", {
    labels: ["Direct conflict"],
    repos: [],
  });
  assert.deepEqual(payForum.filter, {
    labels: ["Direct conflict"],
    repos: [REPO2],
  });
  assert.deepEqual(allForum.filter, { labels: ["Direct conflict"] });
  await assert.rejects(
    call(owner, api.createForum, {
      name: "other",
      filter: { labels: ["a"], repos: [REPO3] },
    }),
    refused("invalid_request"),
  );
  await assert.rejects(
    call(owner, api.updateForum, {
      id: coreForum.id,
      name: "core",
      filter: { importance: "discuss", repos: ["omagari-test/nowhere"] },
    }),
    refused("invalid_request"),
  );
  // The existing forum ("reference") has no repo filter, so posts of every repo match.
  const forumsOf = async (as: As, repo: string) =>
    (await open(as, repo)).map((p) => [...p.forums].sort());
  const ids = (...forums: { id: string }[]) => forums.map((f) => f.id).sort();
  const reference = (await call(owner, api.channels)).channels.find((c) => c.name === "FYI");
  assert.ok(reference);
  await eventually(async () => {
    assert.deepEqual(await forumsOf(owner, REPO), [ids(coreForum, allForum, reference)]);
    assert.deepEqual(await forumsOf(owner, REPO2), [ids(payForum, allForum, reference)]);
  });
  // The importance forum filters by repo too (fixed).
  const only = await call(owner, api.updateForum, {
    id: reference.id,
    name: "FYI",
    filter: { importance: "reference", repos: [REPO2] },
  });
  assert.deepEqual(only.channel.filter, {
    importance: "reference",
    repos: [REPO2],
  });
  await eventually(async () =>
    assert.deepEqual(await forumsOf(owner, REPO), [ids(coreForum, allForum)]),
  );

  // Posts of a repo without push access aren't shown. alice sees only the posts of REPO2.
  await assert.rejects(call(on(alice, REPO), api.posts), refused("not_found"));
  assert.deepEqual(
    (await call(alice, api.posts)).posts.map((p) => p.channel),
    [payPost.channel],
  );
  await assert.rejects(
    call(alice, api.history, { channel: corePost.channel }),
    refused("not_found"),
  );
  assert.deepEqual(
    (await call(alice, api.history, { channel: "alerts" })).messages.map((m) => m.channel),
    ["alerts"],
    "only REPO2's alerts are in the alert line's place",
  );
  const live = await world.live(alice, 0);
  await eventually(() =>
    assert.deepEqual(
      live.messages().flatMap((m) => (m.kind === "alert" ? [m.post.channel] : [])),
      [payPost.channel],
    ),
  );
  // A forum filtering only REPO doesn't exist for alice, who can't see REPO. A forum that also filters REPO2 shows only the visible repo filter.
  const aliceForums = (await call(alice, api.channels)).channels;
  assert.equal(
    aliceForums.some((c) => c.id === coreForum.id),
    false,
  );
  assert.equal(
    aliceForums.some((c) => JSON.stringify(c).includes(REPO)),
    false,
  );

  // Renaming a label in REPO2: a forum filtering only REPO2 renames it, a forum filtering all repos adds the new name,
  await call(on(owner, REPO2), api.editLabel, {
    name: "Direct conflict",
    next: { name: "conflict" },
  });
  const filterOf = async (id: string) =>
    (await call(owner, api.channels)).channels.find((c) => c.id === id)?.filter;
  assert.deepEqual(await filterOf(payForum.id), {
    labels: ["conflict"],
    repos: [REPO2],
  });
  // The fake GitHub doesn't split labels per repo, so REPO gets the same name on the next cycle. When no repo has the old name, it is dropped from
  // the forum, and whether that comes before or after this call depends on the cycle. So only the end state is checked (whether the forum filtering only REPO stays isn't asserted).
  await eventually(async () =>
    assert.deepEqual(await filterOf(allForum.id), { labels: ["conflict"] }),
  );
  await eventually(async () => {
    assert.deepEqual(await forumsOf(owner, REPO2), [ids(payForum, allForum, reference)]);
  });
});

test("starting on a DB from when channels belonged only to the workspace (contract 47) makes the existing channels the first repo's, keeps the forums and the alert line's place, and doesn't move channels made later after a restart", async (t) => {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(Date.now());
  const seed = (await readFile(new URL("./contract47.sql", import.meta.url), "utf8"))
    .replace("'2026-11-18'", `'${today}'`)
    .replace("1790000000004", String(Date.now()))
    .replace("1790000000006", String(Date.now()));
  const world = await startWorld({ accept: [REPO, REPO3], seed });
  t.after(world.stop);
  world.github.grant("owner", REPO3);
  const owner = world.owner as As & { login: string };
  const alice = { url: world.server.url, session: "old-alice-session" };
  const channels = async (as: As) =>
    (await call(as, api.channels)).channels
      .map((c) => `${c.kind}:${c.name}:${c.repo ?? ""}`)
      .sort();

  // The existing chat channel is the first repo's. alice, who sees that repo, reads it as before, and the forums are unchanged with no repo filter.
  const expected = [`chat:일반:${REPO}`, "forum:논의:", "forum:참고:"];
  assert.deepEqual(await channels(owner), expected);
  assert.deepEqual(await channels(alice), expected);
  assert.deepEqual(
    (await call(alice, api.history, { channel: "c1" })).messages.map(
      (m) => m.kind === "text" && m.text,
    ),
    ["안녕하세요"],
  );
  assert.deepEqual(
    (await call(owner, api.channels)).channels
      .filter((c) => c.kind === "forum")
      .map((c) => c.filter),
    [{ importance: "discuss" }, { importance: "reference" }],
  );
  // Someone who is only in another workspace can't see that channel.
  world.github.grant("carol", REPO3);
  const carol = await world.login("carol");
  await assert.rejects(call(carol, api.history, { channel: "c1" }), refused("not_found"));
  assert.deepEqual(await channels(carol), ["forum:Discuss:", "forum:FYI:"]);
  assert.equal((await call(owner, api.history, { channel: "alerts" })).messages.length, 1);

  // A workspace channel made afterwards isn't moved to a repo after a restart.
  await call(owner, api.createChannel, { name: "shared" });
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(await channels(owner), [...expected, "chat:shared:"].sort()),
  );
});

test("the name of a private repo leaks to a member without push access through none of forum filtering, live sends, responses or refusals", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2] });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  world.github.grant("alice", REPO2); // alice sees only REPO2 and doesn't know REPO
  const alice = await world.login("alice");
  const live = await world.live(alice);
  const forum = async (as: As, name: string, repos: string[]) =>
    (
      await call(as, api.createForum, {
        name,
        filter: { labels: ["a"], repos },
      })
    ).channel;
  const coreOnly = await forum(owner, "core only", [REPO]);
  const both = await forum(owner, "both", [REPO, REPO2]);
  await forum(owner, "pay only", [REPO2]);

  // List and live sends: REPO isn't in alice's view, and a forum filtering only REPO is absent entirely.
  const leaked = (value: unknown) => JSON.stringify(value).includes(REPO);
  const listed = (await call(alice, api.channels)).channels;
  assert.equal(leaked(listed), false);
  assert.deepEqual(
    listed
      .filter((c) => c.kind === "forum" && c.filter && "labels" in c.filter)
      .map((c) => [c.name, c.filter]),
    [
      ["both", { labels: ["a"], repos: [REPO2] }],
      ["pay only", { labels: ["a"], repos: [REPO2] }],
    ],
  );
  await eventually(() =>
    assert.ok(live.received.some((m) => m.kind === "channel" && m.payload.id === both.id)),
  );
  const frames = live.received.filter((m) => m.kind === "channel" || m.kind === "forumDeleted");
  assert.equal(leaked(frames), false);
  assert.equal(
    frames.some((m) => m.kind === "channel" && m.payload.id === coreOnly.id),
    false,
  );
  // owner sees everything.
  const mine = (await call(owner, api.channels)).channels.find((c) => c.id === both.id);
  assert.deepEqual(mine?.filter, { labels: ["a"], repos: [REPO, REPO2] });

  // Creating: REPO isn't in the response, and a repo that isn't visible is refused the same as a repo that doesn't exist.
  const made = await forum(alice, "mine", [REPO2]);
  assert.equal(leaked(made), false);
  const hidden = await call(alice, api.createForum, {
    name: "x",
    filter: { labels: ["a"], repos: [REPO] },
  }).catch((e) => e);
  const absent = await call(alice, api.createForum, {
    name: "y",
    filter: { labels: ["a"], repos: ["omagari-test/nowhere"] },
  }).catch((e) => e);
  assert.equal(hidden.code, "invalid_request");
  assert.equal(hidden.code, absent.code);
  assert.equal(
    hidden.message.replace(REPO, "R"),
    absent.message.replace("omagari-test/nowhere", "R"),
  );

  // A forum that isn't visible can't be edited or deleted, and editing a visible forum keeps the repo filter that isn't visible.
  await assert.rejects(call(alice, api.deleteForum, { id: coreOnly.id }), refused("not_found"));
  await assert.rejects(
    call(alice, api.updateForum, {
      id: coreOnly.id,
      name: "core only",
      filter: { labels: ["a"] },
    }),
    refused("not_found"),
  );
  const edited = (
    await call(alice, api.updateForum, {
      id: both.id,
      name: "both edited",
      filter: { labels: ["b"], repos: [REPO2] },
    })
  ).channel;
  assert.deepEqual(edited.filter, { labels: ["b"], repos: [REPO2] });
  const after = (await call(owner, api.channels)).channels.find((c) => c.id === both.id);
  assert.deepEqual(
    after?.filter && "repos" in after.filter ? [...(after.filter.repos ?? [])].sort() : [],
    [REPO, REPO2].sort(),
  );

  // If owner makes that forum filter only REPO, it disappears for alice.
  await call(owner, api.updateForum, {
    id: both.id,
    name: "both edited",
    filter: { labels: ["b"], repos: [REPO] },
  });
  await eventually(() =>
    assert.ok(live.received.some((m) => m.kind === "forumDeleted" && m.payload.id === both.id)),
  );
  assert.equal(
    leaked(live.received.filter((m) => m.kind === "channel" || m.kind === "forumDeleted")),
    false,
  );
  assert.equal(
    (await call(alice, api.channels)).channels.some((c) => c.id === both.id),
    false,
  );
  // alice, who wants to clear a repo she can't see, can't edit a forum she can't see, but clearing the filter of a forum she can see makes it all repos.
  const cleared = (
    await call(alice, api.updateForum, {
      id: made.id,
      name: "mine",
      filter: { labels: ["a"] },
    })
  ).channel;
  assert.deepEqual(cleared.filter, { labels: ["a"] });
});

test("a forum's label filter doesn't show the label names of a repo without push access either, and a label rename doesn't leak", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2] });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  world.github.grant("alice", REPO2); // alice sees only REPO2 and doesn't know REPO
  const alice = await world.login("alice");
  const live = await world.live(alice);
  const all = { ...owner, repos: [REPO, REPO2] };

  await call(on(owner, REPO), api.createLabel, {
    name: "secret",
    color: "ff0000",
    description: "",
  });
  const forum = (
    await call(all, api.createForum, {
      name: "label",
      filter: { labels: ["secret"] },
    })
  ).channel;
  const labelsOf = async (as: As) =>
    (await call(as, api.channels)).channels.find((c) => c.id === forum.id)?.filter;
  assert.deepEqual(await labelsOf(owner), { labels: ["secret"] });
  // If only labels of a repo that isn't visible are there, the forum doesn't exist for alice.
  assert.equal(await labelsOf(alice), undefined);

  // Adding a label of a visible repo shows only that, and a rename doesn't leak the new name that isn't visible.
  await call(on(owner, REPO2), api.createLabel, {
    name: "public",
    color: "00ff00",
    description: "",
  });
  await call(all, api.updateForum, {
    id: forum.id,
    name: "label",
    filter: { labels: ["secret", "public"] },
  });
  await call(on(owner, REPO), api.editLabel, {
    name: "secret",
    next: { name: "moresecret" },
  });
  assert.deepEqual(
    new Set(((await labelsOf(owner)) as { labels: string[] }).labels),
    new Set(["public", "moresecret"]),
  );
  assert.deepEqual(await labelsOf(alice), { labels: ["public"] });
  await eventually(() => assert.ok(live.received.some((m) => m.kind === "channel")));
  const frames = live.received.filter((m) => m.kind === "channel");
  assert.equal(JSON.stringify(frames).includes("secret"), false);
});

test("a forum name only has to be unique among the forums you can see, so creating or renaming never shows that a hidden forum exists", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2] });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  // alice sees REPO2 only, so a forum filtering REPO is hidden from her.
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");
  const forum = (as: As, name: string, repo: string) =>
    call(as, api.createForum, { name, filter: { importance: "discuss", repos: [repo] } }).then(
      (r) => r.channel,
    );
  const hidden = await forum(owner, "Secret", REPO);
  await forum(owner, "Plan", REPO);
  await forum(owner, "Roadmap", REPO);

  // She can create and rename to the hidden name, and a chat channel can take it too, with no "already exists".
  const mine = await forum(alice, "secret", REPO2);
  const other = await forum(alice, "Other", REPO2);
  await call(alice, api.updateForum, {
    id: other.id,
    name: "PLAN",
    filter: { importance: "discuss", repos: [REPO2] },
  });
  await call(alice, api.createChannel, { name: "roadmap" });
  // She sees only her own forums, and the hidden one keeps its name.
  const names = async (as: As) =>
    (await call(as, api.channels)).channels.filter((c) => c.kind === "forum").map((c) => c.id);
  assert.ok(!(await names(alice)).includes(hidden.id));
  assert.ok((await names(alice)).includes(mine.id));
  assert.equal(
    (await call(owner, api.channels)).channels.find((c) => c.id === hidden.id)?.name,
    "Secret",
  );

  // Among the forums she can see, a name is still unique.
  await assert.rejects(forum(alice, "secret", REPO2), refused("conflict"));
  await assert.rejects(
    call(alice, api.updateForum, {
      id: other.id,
      name: "Other2",
      filter: { importance: "discuss", repos: [REPO2] },
    }).then(() => forum(alice, "other2", REPO2)),
    refused("conflict"),
  );
  // The owner sees both forums named "Plan", so the name is taken for them.
  await assert.rejects(forum(owner, "plan", REPO), refused("conflict"));
});
