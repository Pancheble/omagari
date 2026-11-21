// Several repos of the same account in one workspace (ADR-0043). Only a repo's Admin adds and removes it, a runner connects to a repo by the folder's remote,
// and a member sees only repos they have push access to. Works, notifications, posts, labels, and decisions are split per repo.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, type ContractFailure, call, DEFAULT_PREFS } from "@omagari/contract";
import { eventually, REPO, REPO2, startWorld, textOf, writer } from "./harness.ts";

type As = { url: string; session: string };
/** Calls as `as` using `repo`. */
const on = (as: As, repo: string) => ({ ...as, repos: [repo] });
const refused = (code: string) => (error: ContractFailure) => error.code === code;

const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

test("only an Admin adds and removes a repo of the same account, a runner connects to that repo by its remote, and works, notifications, and labels are split per repo", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const { owner } = world;

  // Having push access only to a repo not in the workspace does not let you in.
  world.github.grant("alice", REPO2);
  await assert.rejects(world.login("alice"), refused("forbidden"));

  // A repo outside the accepted account, and a repo that is not Admin, cannot be added.
  await assert.rejects(call(owner, api.addRepo, { repo: "stranger/code" }), refused("forbidden"));
  await assert.rejects(call(owner, api.addRepo, { repo: REPO2 }), refused("forbidden"));
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  assert.deepEqual(await call(owner, api.addRepo, { repo: REPO2 }), { repos: [REPO, REPO2] });

  // alice sees only REPO2, where she has push access. She is not an Admin, so she cannot add or remove.
  const alice = await world.login("alice");
  assert.deepEqual(await call(alice, api.me), {
    login: "alice",
    name: "alice",
    avatar: null,
    repo: REPO2,
    repos: [REPO2],
    giphy: null,
    prefs: DEFAULT_PREFS,
    connected: false,
    shared: [],
    operator: false,
  });
  await assert.rejects(call(alice, api.removeRepo, { repo: REPO2 }), refused("forbidden"));
  // The add-repo list shows only repos I am Admin of. If not an Admin it is empty, so not even the names of other repos or their count show (draft 93-C).
  assert.deepEqual(await call(alice, api.adminRepos), { repos: [] });
  world.github.admin("owner", "omagari-test/later");
  assert.deepEqual(
    (await call(owner, api.adminRepos)).repos.filter((repo) => repo.name !== REPO),
    [
      { name: "omagari-test/later", private: true, pushers: 0, added: false },
      { name: REPO2, private: true, pushers: 2, added: true },
    ],
  );
  await assert.rejects(call(on(alice, REPO), api.works), refused("not_found"));

  // A runner of a repo not in the workspace is rejected.
  await assert.rejects(world.desk(alice, undefined, undefined, { repo: "omagari-test/nowhere" }));
  // alice's runner connects to REPO2 by its remote. Two branches edit the same line, so a direct conflict stands in REPO2 (ADR-0041).
  const desk = await world.desk(alice, undefined, undefined, { repo: REPO2 });
  t.after(desk.remove);
  await writer(desk.folder)("src/pay.ts", text(BASE));
  await desk.git("add", ".");
  await desk.git("commit", "--message=base");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "payment");
  const refund = join(desk.folder, "..", `${crypto.randomUUID()}-refund`);
  await desk.git("worktree", "add", "-b", "refund", refund);
  t.after(() => rm(refund, { recursive: true, force: true }));
  await writer(desk.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "payment")));
  await writer(refund)("src/pay.ts", text(BASE.toSpliced(2, 1, "refund")));

  const posts = await eventually(async () => {
    const { posts } = await call(alice, api.posts);
    assert.equal(posts.length, 1);
    return posts;
  });
  // What belongs to REPO2 is seen only in REPO2.
  assert.deepEqual(
    (await call(on(owner, REPO2), api.posts)).posts.map((p) => p.channel),
    posts.map((p) => p.channel),
  );
  assert.deepEqual((await call(owner, api.posts)).posts, []);
  assert.deepEqual(
    (await call(owner, api.works)).works.map((w) => w.login),
    ["owner"],
    "REPO2's works do not mix into REPO's works",
  );
  assert.deepEqual(
    (await call(on(owner, REPO2), api.works)).works.map((w) => `${w.login}/${w.branch}`),
    ["alice/payment", "alice/refund"],
  );
  // alice, who is only in REPO2, is not in REPO's member list.
  assert.deepEqual(
    (await call(owner, api.members)).members.map((m) => m.login),
    ["owner"],
  );
  // REPO2's posts do not exist for someone who cannot see REPO2.
  const post = posts[0]?.channel as string;
  world.github.grant("bob");
  const bob = await world.login("bob");
  await assert.rejects(call(bob, api.history, { channel: post }), refused("not_found"));
  await assert.rejects(call(bob, api.setPostLabels, { post, labels: [] }), refused("not_found"));
  assert.deepEqual(
    (await call(bob, api.history, { channel: "alerts" })).messages,
    [],
    "REPO2's notifications are not in the notification lines either",
  );

  // A label's importance is per repo.
  await call(on(owner, REPO2), api.editLabel, {
    name: "Duplicate work",
    next: { importance: "discuss" },
  });
  const importance = async (as: As) =>
    (await call(as, api.labels)).labels.find((l) => l.name === "Duplicate work")?.importance;
  assert.equal(await importance(on(owner, REPO2)), "discuss");
  assert.equal(await importance(owner), "reference");
  assert.equal(await importance(alice), "discuss");

  // Removing a repo disconnects that repo's runner, hides it from everyone, and deletes its data (ADR-0054). Adding it back starts empty.
  assert.deepEqual(await call(owner, api.removeRepo, { repo: REPO2 }), { repos: [REPO] });
  await assert.rejects(call(alice, api.posts), refused("not_found"));
  assert.deepEqual(await call(owner, api.addRepo, { repo: REPO2 }), { repos: [REPO, REPO2] });
  assert.ok(!(await call(alice, api.posts)).posts.some((p) => p.channel === post));
});

test("only repos with push access are visible, and after losing access on GitHub and checking again, that repo is not visible", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2], recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("owner", REPO2);
  world.github.grant("alice", REPO);
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");
  assert.deepEqual((await call(alice, api.me)).repos, [REPO, REPO2]);
  const live = await world.live(alice);

  // Losing access to REPO2 leaves only REPO.
  world.github.revoke("alice", REPO2);
  await eventually(async () => assert.deepEqual((await call(alice, api.me)).repos, [REPO]));
  await assert.rejects(call(on(alice, REPO2), api.members), refused("not_found"));
  await eventually(async () =>
    assert.deepEqual(
      (await call(on(world.owner, REPO2), api.members)).members.map((m) => m.login),
      ["owner"],
    ),
  );
  assert.equal(
    live.received.at(-1)?.kind !== "error",
    true,
    "the web that picked REPO stays as it was",
  );

  // Losing access to every repo ends the session.
  world.github.revoke("alice", REPO);
  await eventually(() => assert.rejects(call(alice, api.me), refused("unauthorized")));
  assert.equal(await live.closed, 1008);
});

test("even when started with a DB from the single-repo version, what was there stays in that repo and does not mix into a newly added repo", async (t) => {
  const world = await startWorld({
    accept: [REPO, REPO2],
    seed: await readFile(new URL("./contract45.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  world.github.grant("owner", REPO2);
  // Alice's session from that version is a member of the old repo even without logging in again.
  const alice = { url: world.server.url, session: "old-alice-session" };
  assert.deepEqual(await call(alice, api.me), {
    login: "alice",
    name: "앨리스",
    avatar: null,
    repo: REPO,
    repos: [REPO],
    giphy: null,
    prefs: DEFAULT_PREFS,
    connected: true,
    shared: [REPO],
    operator: false,
  });

  // owner comes back in after getting access to the new repo.
  const owner = await world.login("owner");
  const [work] = (await call(owner, api.works)).works;
  assert.deepEqual(
    [work?.login, work?.branch, textOf(work?.line)],
    ["alice", "payment", "결제 고치는 중"],
  );
  const { posts } = await call(owner, api.posts);
  assert.deepEqual(
    posts.map((p) => [p.channel, p.labels, p.importance, p.count]),
    [["p1", ["Direct conflict"], "discuss", 1]],
  );
  assert.deepEqual(
    (await call(owner, api.decisions)).decisions.map((d) => [d.id, d.title]),
    [[1, "결제는 alice가"]],
  );
  assert.equal(
    (await call(owner, api.labels)).labels.find((l) => l.name === "Direct conflict")?.importance,
    "discuss",
  );
  assert.deepEqual((await call(owner, api.settings)).mergeCheck.check, { problem: "missing" });
  assert.match((await call(owner, api.settings)).version, /\S/);
  assert.deepEqual(
    (await call(owner, api.history, { channel: "p1" })).messages.map((m) => m.kind),
    ["text", "decision"],
  );

  // The new repo has nothing, and labels are the defaults.
  const other = on(owner, REPO2);
  assert.deepEqual((await call(other, api.works)).works, []);
  assert.deepEqual((await call(other, api.posts)).posts, []);
  assert.deepEqual((await call(other, api.decisions)).decisions, []);
  assert.equal(
    (await call(other, api.labels)).labels.find((l) => l.name === "Direct conflict")?.importance,
    "reference",
  );
  assert.equal((await call(other, api.settings)).mergeCheck.check, null);

  // It stays the same after another restart (the already-moved DB).
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(
      (await call(owner, api.posts)).posts.map((p) => p.channel),
      ["p1"],
    ),
  );
});

test("when a repo is moved to another account on GitHub, its things follow under the new name, and the old remote and old settings are read as the new name", async (t) => {
  const MOVED = "omagari-moved/space";
  // The accepted accounts include the account it moves to. The old repo name (REPO) also remains in the settings.
  const world = await startWorld({
    accept: [REPO, "omagari-moved"],
    seed: await readFile(new URL("./contract47.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  // The works owner's runners post come and go, so look only at alice's work from that version.
  const seen = async (as: As) => ({
    works: (await call(as, api.works)).works
      .filter((w) => w.login === "alice")
      .map((w) => [w.login, w.branch, textOf(w.line)]),
    posts: (await call(as, api.posts)).posts.map((p) => [p.channel, p.labels, p.importance]),
    decisions: (await call(as, api.decisions)).decisions.map((d) => [d.id, d.title]),
    discuss: (await call(as, api.labels)).labels
      .filter((l) => l.importance === "discuss")
      .map((l) => l.name),
    check: (await call(as, api.settings)).mergeCheck.check,
    history: (await call(as, api.history, { channel: "p1" })).messages.map((m) => m.kind),
    // Forums by filter: the new account's workspace gets the default forums under English names.
    channels: (await call(as, api.channels)).channels
      .map((c) => `${c.kind}:${c.kind === "forum" ? JSON.stringify(c.filter) : c.name}`)
      .sort(),
  });
  const before = await seen(world.owner);
  assert.deepEqual(before.works, [["alice", "payment", "결제 고치는 중"]]);
  assert.deepEqual(before.posts, [["p1", ["Direct conflict"], "discuss"]]);

  // When permissions are read again (here when logging in again, and on the server every 10 minutes too) it learns of the move.
  world.github.move(REPO, MOVED);
  const owner = await world.login("owner");
  assert.deepEqual((await call(owner, api.me)).repos, [MOVED]);
  assert.deepEqual(await seen(on(owner, MOVED)), before);
  assert.equal(
    (await call(owner, api.channels)).channels.find((c) => c.name === "일반")?.repo,
    MOVED,
  );
  // The CLI that calls by the old name and the runner of the old remote also reach the new repo.
  assert.deepEqual(await seen(on(owner, REPO)), before);
  const desk = await world.desk(owner, undefined, undefined, { repo: REPO });
  t.after(desk.remove);
  assert.equal((await call({ ...owner, session: "old-alice-session" }, api.me)).repo, MOVED);

  // Even after another restart, an empty repo is not created again from the old name in the settings.
  await world.restartServer();
  await eventually(async () => assert.deepEqual((await call(owner, api.me)).repos, [MOVED]));
  assert.deepEqual(await seen(owner), before);
});
