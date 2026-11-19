// Several workspaces on one server (ADR-0043). With two accepted accounts there are two workspaces, and the two never mix in any API response or live connection message.
// It covers a person in both (owner) and people in only one (alice in A, carol and dave in B).
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string; login?: string; repos?: string[] };
/** Calls as `as` using workspace `workspace`. */
const in_ = (as: As, workspace: string) => ({ ...as, workspace });
const refused = (code: string) => (error: ContractFailure) => error.code === code;

const A = "omagari-test";
const B = "other-team";
const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

test("with the repos of two accounts on one server there are two workspaces, one person moves between both, and a person in only one never receives the other's things anywhere", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3], observeMs: 50, followMs: 50 });
  t.after(world.stop);
  // owner is in both workspaces. alice is only in A, and carol and dave are only in B.
  world.github.grant("owner", REPO3);
  world.github.grant("alice");
  world.github.grant("carol", REPO3);
  world.github.grant("dave", REPO3);
  const owner = { ...(await world.login("owner")) };
  const alice = await world.login("alice");
  const carol = await world.login("carol");
  const dave = await world.login("dave");

  // Workspace list: only the workspaces you are in, with the visible repos inside.
  const names = (as: As) => call(as, api.workspaces);
  assert.deepEqual(await names(owner), {
    workspaces: [
      { id: A, name: A, kind: "organization", avatar: null, repos: [REPO] },
      { id: B, name: B, kind: "organization", avatar: null, repos: [REPO3] },
    ],
  });
  assert.deepEqual(
    (await names(alice)).workspaces.map((w) => w.id),
    [A],
  );
  assert.deepEqual(
    (await names(carol)).workspaces.map((w) => w.id),
    [B],
  );
  // You cannot even pick a workspace you are not in.
  await assert.rejects(call(in_(alice, B), api.members), refused("not_found"));
  await assert.rejects(call(in_(carol, A), api.channels), refused("not_found"));
  await assert.rejects(call(in_(alice, B), api.metrics, { days: 1 }), refused("not_found"));

  // Members: each workspace has only that repo's members. If none is picked, it is the first workspace.
  const logins = async (as: As) => (await call(as, api.members)).members.map((m) => m.login);
  assert.deepEqual(await logins(owner), ["alice", "owner"]);
  assert.deepEqual(await logins(in_(owner, B)), ["carol", "dave", "owner"]);
  assert.deepEqual(await logins(carol), ["carol", "dave", "owner"]);
  assert.deepEqual(await logins(alice), ["alice", "owner"]);
  // Picking by repo also gives that repo's workspace. A repo not in the picked workspace is not visible.
  assert.deepEqual(await logins({ ...owner, repos: [REPO3] }), ["carol", "dave", "owner"]);
  await assert.rejects(
    call({ ...in_(owner, A), repos: [REPO3] }, api.members),
    refused("not_found"),
  );

  // Channels: channels with the same name exist separately in the two workspaces, and the default forums exist per workspace too.
  const chatA = (await call(in_(owner, A), api.createChannel, { name: "general" })).channel.id;
  const chatB = (await call(in_(owner, B), api.createChannel, { name: "general" })).channel.id;
  assert.notEqual(chatA, chatB);
  await assert.rejects(
    call(in_(owner, A), api.createChannel, { name: "general" }),
    refused("conflict"),
  );
  const listed = async (as: As) => (await call(as, api.channels)).channels;
  const forumsA = (await listed(alice)).filter((c) => c.kind === "forum").map((c) => c.name);
  assert.deepEqual(forumsA, ["Discuss", "FYI"]);
  const idsA = (await listed(in_(owner, A))).map((c) => c.id);
  const idsB = (await listed(in_(owner, B))).map((c) => c.id);
  assert.equal(idsA.length, 3);
  assert.equal(idsB.length, 3);
  assert.deepEqual(
    idsA.filter((id) => idsB.includes(id)),
    [],
    "channel and forum ids do not overlap between workspaces",
  );
  assert.deepEqual((await listed(carol)).map((c) => c.id).sort(), idsB.toSorted());
  // Forums are also created and deleted per workspace.
  const forum = (
    await call(in_(owner, B), api.createForum, { name: "payment", filter: { labels: ["payment"] } })
  ).channel;
  assert.deepEqual(
    (await listed(alice)).map((c) => c.id),
    idsA,
  );
  await assert.rejects(
    call(in_(owner, A), api.deleteForum, { id: forum.id }),
    refused("not_found"),
  );
  await assert.rejects(call(alice, api.deleteForum, { id: forum.id }), refused("not_found"));

  // Channel posts: someone in only one workspace can neither read nor write the other's channels.
  await call(in_(owner, A), api.send, { channel: chatA, text: "A's story" });
  await call(carol, api.send, { channel: chatB, text: "B's story" });
  assert.deepEqual(
    (await call(alice, api.history, { channel: chatA })).messages.map(
      (m) => m.kind === "text" && m.text,
    ),
    ["A's story"],
  );
  await assert.rejects(call(alice, api.history, { channel: chatB }), refused("not_found"));
  await assert.rejects(
    call(alice, api.send, { channel: chatB, text: "sneaky" }),
    refused("not_found"),
  );
  await assert.rejects(call(carol, api.history, { channel: chatA }), refused("not_found"));
  await assert.rejects(call(carol, api.dms, { channel: chatA }), refused("not_found"));
  // owner reads both.
  assert.equal((await call(owner, api.history, { channel: chatB })).messages.length, 1);

  // Live connection: a connection receives only one workspace's things. owner has one window in A and one in B.
  const liveAlice = await world.live(alice);
  const liveCarol = await world.live(carol);
  const liveDave = await world.live(dave);
  const liveOwnerA = await world.live(owner, undefined, { workspace: A });
  const liveOwnerB = await world.live(owner, undefined, { workspace: B });
  await assert.doesNotReject(world.live(owner, undefined, { repo: REPO3 }).then((l) => l.close()));
  const bad = await world.live(alice, undefined, { workspace: B });
  assert.equal(await bad.closed, 1008);
  assert.equal(bad.received[0]?.kind, "error");

  // Member list and presence: owner has a window in each of A and B, so is online in both. And a window in one workspace does not leak into the other's presence.
  await eventually(() => {
    assert.deepEqual(
      liveAlice.members().map((m) => [m.login, m.presence]),
      [
        ["alice", "online"],
        ["owner", "online"],
      ],
    );
    assert.deepEqual(
      liveCarol.members().map((m) => [m.login, m.presence]),
      [
        ["carol", "online"],
        ["dave", "online"],
        ["owner", "online"],
      ],
    );
  });
  await liveOwnerB.close();
  await eventually(async () => {
    assert.equal(
      (await call(carol, api.members)).members.find((m) => m.login === "owner")?.presence,
      "offline",
      "owner's window is only in A, so offline in B",
    );
    assert.equal(
      (await call(alice, api.members)).members.find((m) => m.login === "owner")?.presence,
      "online",
    );
  });
  assert.deepEqual(
    liveAlice.members().map((m) => m.login),
    ["alice", "owner"],
  );
  assert.equal(
    liveAlice.members().some((m) => m.login === "carol" || m.login === "dave"),
    false,
  );

  // Channel messages and channel/forum changes go only to connections that picked that workspace.
  await call(in_(owner, A), api.send, { channel: chatA, text: "only to A" });
  await call(carol, api.send, { channel: chatB, text: "only to B" });
  const chats = (live: Awaited<ReturnType<typeof world.live>>) =>
    live
      .messages()
      .filter((m) => m.kind === "text")
      .map((m) => (m.kind === "text" ? m.text : ""));
  await eventually(() => {
    assert.deepEqual(chats(liveAlice), ["only to A"]);
    assert.deepEqual(chats(liveOwnerA), ["only to A"]);
    assert.deepEqual(chats(liveCarol), ["only to B"]);
    assert.deepEqual(chats(liveDave), ["only to B"]);
  });
  await call(in_(owner, B), api.createChannel, { name: "chitchat" });
  await eventually(() =>
    assert.equal(
      liveCarol.received.some((m) => m.kind === "channel" && m.payload.name === "chitchat"),
      true,
    ),
  );
  assert.equal(
    liveAlice.received.some((m) => m.kind === "channel" && m.payload.name === "chitchat"),
    false,
  );
  assert.equal(
    liveOwnerA.received.some((m) => m.kind === "channel" && m.payload.name === "chitchat"),
    false,
    "B's channel does not go to the same person's A window either",
  );
  // When catching up on what was missed during a disconnect, only that workspace's things come. Even attaching to A from before B's last number, B's posts do not come.
  const resumed = await world.live(owner, 0, { workspace: A });
  await eventually(() => assert.deepEqual(chats(resumed), ["A's story", "only to A"]));
  const seq = (live: Awaited<ReturnType<typeof world.live>>) =>
    live.received.find((m) => m.kind === "welcome")?.payload;
  assert.notEqual(
    (seq(resumed) as { seq: number }).seq,
    (seq(liveCarol) as { seq: number }).seq,
    "the last message number is also per workspace",
  );

  // Metrics: the visited member count is per workspace. A has owner and alice, B has owner, carol, and dave.
  const today = async (as: As) => (await call(as, api.metrics, { days: 1 })).days.at(-1);
  assert.equal((await today(in_(owner, A)))?.members, 2);
  assert.equal((await today(in_(owner, B)))?.members, 3);
  assert.equal((await today(alice))?.members, 2);
  assert.equal((await today(carol))?.members, 3);

  // An `@mention` in a chat channel is answered by that workspace's runner. owner's runner is only in A, so it is off in B.
  const asked = await world.ask(owner as As & { login: string }, chatA, "Asking in A");
  assert.equal(asked.channel, chatA);
  await assert.rejects(
    world.ask(owner as As & { login: string }, chatB, "Asking in B"),
    refused("runner_offline"),
  );
  assert.equal((await today(in_(owner, A)))?.qas, 1);
  assert.equal((await today(in_(owner, B)))?.qas, 0);

  // Posts, notifications, decisions: in B's repo carol's two branches edit the same line, so a notification stands in B.
  const desk = await world.desk(carol, undefined, undefined, { repo: REPO3 });
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
    const { posts } = await call(carol, api.posts);
    assert.equal(posts.length, 1);
    return posts;
  });
  const post = posts[0]?.channel as string;
  const forumsOf = posts[0]?.forums;
  assert.ok(
    forumsOf?.every((id) => idsB.includes(id) || id === forum.id),
    "the post's forum is B's forum",
  );
  assert.deepEqual(
    (await call(in_(owner, B), api.posts)).posts.map((p) => p.channel),
    [post],
  );
  assert.deepEqual((await call(owner, api.posts)).posts, [], "A has no posts from B");
  assert.deepEqual((await call(alice, api.posts)).posts, []);
  await assert.rejects(call({ ...alice, repos: [REPO3] }, api.posts), refused("not_found"));
  await assert.rejects(call(alice, api.history, { channel: post }), refused("not_found"));
  await assert.rejects(call(alice, api.setPostLabels, { post, labels: [] }), refused("not_found"));
  // The notification line slot is also per workspace. Looking from A as owner, there is no notification line from B.
  const alertLines = async (as: As) =>
    (await call(as, api.history, { channel: "alerts" })).messages;
  assert.equal((await alertLines(in_(owner, B))).length, 1);
  assert.deepEqual(await alertLines(owner), []);
  assert.deepEqual(await alertLines(alice), []);
  // Live connection: B's notification line and post text go only to B's connections.
  await call(carol, api.send, { channel: post, text: "I'll fix it first" });
  await eventually(() =>
    assert.equal(
      liveDave.messages().some((m) => m.kind === "text" && m.text === "I'll fix it first"),
      true,
    ),
  );
  for (const live of [liveAlice, liveOwnerA, resumed])
    assert.equal(
      live.messages().some((m) => m.kind === "alert" || m.channel === post),
      false,
      "B's notifications and post text do not go to A's connection",
    );

  // A decision belongs to that post's repo, that is, B's.
  const { decision } = await call(carol, api.proposeDecision, {
    post,
    title: "Refunds go through the payment module",
    context: "Refunds and payments edit the same line.",
    decision: "Refunds call refund in the payment module.",
    consequences: "The refund branch is merged after the payment branch.",
  });
  assert.deepEqual(
    (await call(in_(owner, B), api.decisions)).decisions.map((d) => d.id),
    [decision.id],
  );
  assert.deepEqual((await call(owner, api.decisions)).decisions, []);
  assert.deepEqual((await call(alice, api.decisions)).decisions, []);
  assert.deepEqual(
    (await call(carol, api.decisions)).decisions.map((d) => d.id),
    [decision.id],
  );

  // Things that happened only in B do not mix into A's works and status.
  assert.equal(
    (await call(owner, api.works)).works.some((w) => w.login === "carol"),
    false,
    "B's things do not mix into A's works",
  );
  assert.deepEqual(
    (await call(in_(owner, B), api.works)).works.map((w) => `${w.login}/${w.branch}`),
    ["carol/payment", "carol/refund"],
  );
});

test("even when started with a DB from the single-workspace version (contract 46), what was there stays in the first workspace and does not mix into a new workspace", async (t) => {
  // So the times fall within the period the metrics look at, the times of the visit, Q&A, and verdict counts are replaced with now.
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(Date.now());
  const seed = (await readFile(new URL("./contract46.sql", import.meta.url), "utf8"))
    .replace("'2026-11-18'", `'${today}'`)
    .replace("1790000000004", String(Date.now()))
    .replace("1790000000006", String(Date.now()));
  const world = await startWorld({ accept: [REPO, REPO3], seed });
  t.after(world.stop);
  world.github.grant("owner", REPO3);
  // Alice's session from that version is a member of the old workspace even without logging in again.
  const alice = { url: world.server.url, session: "old-alice-session" };
  assert.deepEqual(await call(alice, api.workspaces), {
    workspaces: [{ id: A, name: A, kind: "organization", avatar: null, repos: [REPO] }],
  });

  // The existing chat channel and its posts, forums, visits, Q&A, and verdict counts stay in the old workspace.
  const owner = await world.login("owner");
  assert.deepEqual(
    (await call(owner, api.workspaces)).workspaces.map((w) => w.id),
    [A, B],
  );
  const channels = async (as: As) =>
    (await call(as, api.channels)).channels.map((c) => `${c.kind}:${c.name}`).sort();
  assert.deepEqual(await channels(owner), ["chat:일반", "forum:논의", "forum:참고"]);
  assert.deepEqual(
    (await call(owner, api.history, { channel: "c1" })).messages.map(
      (m) => m.kind === "text" && m.text,
    ),
    ["안녕하세요"],
  );
  const { posts } = await call(owner, api.posts);
  assert.deepEqual(
    posts.map((p) => [p.channel, p.labels, p.importance, p.count]),
    [["p1", ["Direct conflict"], "discuss", 1]],
  );
  assert.deepEqual(
    (await call(owner, api.decisions)).decisions.map((d) => d.title),
    ["결제는 alice가"],
  );
  const metrics = (await call(owner, api.metrics, { days: 3 })).days;
  assert.equal(
    metrics.find((d) => d.day === today)?.members,
    2,
    "the old version's visit (alice) and owner, who just called",
  );
  assert.equal(
    metrics.reduce((n, d) => n + d.runs.pass, 0),
    1,
  );
  assert.equal(
    metrics.reduce((n, d) => n + d.qas, 0),
    1,
  );

  // The new workspace has only the default forums and none of the old ones. A channel with the same name can be created fresh.
  const other = in_(owner, B);
  assert.deepEqual(await channels(other), ["forum:Discuss", "forum:FYI"]);
  assert.deepEqual((await call(other, api.posts)).posts, []);
  assert.deepEqual((await call(other, api.decisions)).decisions, []);
  const chat = (await call(other, api.createChannel, { name: "일반" })).channel.id;
  assert.deepEqual((await call(other, api.history, { channel: chat })).messages, []);
  const gone = await call(in_(owner, B), api.metrics, { days: 3 });
  assert.equal(
    gone.days.reduce((n, d) => n + d.runs.pass + d.qas, 0),
    0,
  );
  assert.equal(
    gone.days.find((d) => d.day === today)?.members,
    1,
    "B has no old visit (alice), only owner",
  );

  // It stays the same after another restart (the already-moved DB). The channels do not grow to two.
  await world.restartServer();
  await eventually(async () => {
    assert.deepEqual(await channels(owner), ["chat:일반", "forum:논의", "forum:참고"]);
    assert.deepEqual(await channels(in_(owner, B)), ["chat:일반", "forum:Discuss", "forum:FYI"]);
  });
  assert.deepEqual(
    (await call(owner, api.posts)).posts.map((p) => p.channel),
    ["p1"],
  );
});
