// 서버 하나에 워크스페이스 여럿(ADR-0043). 받을 계정이 둘이면 워크스페이스가 둘이고, 둘은 어느 API 응답과 실시간 연결 메시지에도 섞이지 않는다.
// 한 사람이 둘에 다 들어간 경우(owner)와 한쪽에만 들어간 경우(alice는 A, carol과 dave는 B)를 본다.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string; login?: string; repos?: string[] };
/** `as`가 워크스페이스 `workspace`로 부른다. */
const in_ = (as: As, workspace: string) => ({ ...as, workspace });
const refused = (code: string) => (error: ContractFailure) => error.code === code;

const A = "omagari-test";
const B = "other-team";
const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

test("계정 둘의 레포를 한 서버에 띄우면 워크스페이스가 둘이고, 한 사람은 둘을 오가며 한쪽에만 있는 사람은 다른 쪽의 것을 어디서도 받지 못한다", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3], observeMs: 50, followMs: 50 });
  t.after(world.stop);
  // owner는 두 워크스페이스에 다 들어간다. alice는 A만, carol과 dave는 B만 들어간다.
  world.github.grant("owner", REPO3);
  world.github.grant("alice");
  world.github.grant("carol", REPO3);
  world.github.grant("dave", REPO3);
  const owner = { ...(await world.login("owner")) };
  const alice = await world.login("alice");
  const carol = await world.login("carol");
  const dave = await world.login("dave");

  // 워크스페이스 목록: 들어간 워크스페이스만, 그 안의 보이는 레포와 함께.
  const names = (as: As) => call(as, api.workspaces);
  assert.deepEqual(await names(owner), {
    workspaces: [
      { id: A, name: A, repos: [REPO] },
      { id: B, name: B, repos: [REPO3] },
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
  // 들어가지 않은 워크스페이스는 고르지도 못한다.
  await assert.rejects(call(in_(alice, B), api.members), refused("not_found"));
  await assert.rejects(call(in_(carol, A), api.channels), refused("not_found"));
  await assert.rejects(call(in_(alice, B), api.metrics, { days: 1 }), refused("not_found"));

  // 멤버: 워크스페이스마다 그 레포의 멤버만 있다. 고르지 않으면 첫 워크스페이스다.
  const logins = async (as: As) => (await call(as, api.members)).members.map((m) => m.login);
  assert.deepEqual(await logins(owner), ["alice", "owner"]);
  assert.deepEqual(await logins(in_(owner, B)), ["carol", "dave", "owner"]);
  assert.deepEqual(await logins(carol), ["carol", "dave", "owner"]);
  assert.deepEqual(await logins(alice), ["alice", "owner"]);
  // 레포로 골라도 그 레포의 워크스페이스다. 고른 워크스페이스에 없는 레포는 보이지 않는다.
  assert.deepEqual(await logins({ ...owner, repos: [REPO3] }), ["carol", "dave", "owner"]);
  await assert.rejects(
    call({ ...in_(owner, A), repos: [REPO3] }, api.members),
    refused("not_found"),
  );

  // 채널: 같은 이름의 채널이 두 워크스페이스에 따로 있고, 기본 포럼도 워크스페이스마다 있다.
  const chatA = (await call(in_(owner, A), api.createChannel, { name: "일반" })).channel.id;
  const chatB = (await call(in_(owner, B), api.createChannel, { name: "일반" })).channel.id;
  assert.notEqual(chatA, chatB);
  await assert.rejects(
    call(in_(owner, A), api.createChannel, { name: "일반" }),
    refused("conflict"),
  );
  const listed = async (as: As) => (await call(as, api.channels)).channels;
  const forumsA = (await listed(alice)).filter((c) => c.kind === "forum").map((c) => c.name);
  assert.deepEqual(forumsA, ["논의", "참고"]);
  const idsA = (await listed(in_(owner, A))).map((c) => c.id);
  const idsB = (await listed(in_(owner, B))).map((c) => c.id);
  assert.equal(idsA.length, 3);
  assert.equal(idsB.length, 3);
  assert.deepEqual(
    idsA.filter((id) => idsB.includes(id)),
    [],
    "채널과 포럼의 id는 워크스페이스끼리 겹치지 않는다",
  );
  assert.deepEqual((await listed(carol)).map((c) => c.id).sort(), idsB.toSorted());
  // 포럼도 워크스페이스마다 만들고 지운다.
  const forum = (
    await call(in_(owner, B), api.createForum, { name: "결제", filter: { labels: ["결제"] } })
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

  // 채널의 글: 한쪽에만 들어간 사람은 다른 쪽 채널을 읽지도 쓰지도 못한다.
  await call(in_(owner, A), api.send, { channel: chatA, text: "A의 이야기" });
  await call(carol, api.send, { channel: chatB, text: "B의 이야기" });
  assert.deepEqual(
    (await call(alice, api.history, { channel: chatA })).messages.map(
      (m) => m.kind === "text" && m.text,
    ),
    ["A의 이야기"],
  );
  await assert.rejects(call(alice, api.history, { channel: chatB }), refused("not_found"));
  await assert.rejects(
    call(alice, api.send, { channel: chatB, text: "몰래" }),
    refused("not_found"),
  );
  await assert.rejects(call(carol, api.history, { channel: chatA }), refused("not_found"));
  await assert.rejects(call(carol, api.dms, { channel: chatA }), refused("not_found"));
  // owner는 둘 다 읽는다.
  assert.equal((await call(owner, api.history, { channel: chatB })).messages.length, 1);

  // 실시간 연결: 연결은 한 워크스페이스의 것만 받는다. owner의 창이 A와 B에 하나씩 있다.
  const liveAlice = await world.live(alice);
  const liveCarol = await world.live(carol);
  const liveDave = await world.live(dave);
  const liveOwnerA = await world.live(owner, undefined, { workspace: A });
  const liveOwnerB = await world.live(owner, undefined, { workspace: B });
  await assert.doesNotReject(world.live(owner, undefined, { repo: REPO3 }).then((l) => l.close()));
  const bad = await world.live(alice, undefined, { workspace: B });
  assert.equal(await bad.closed, 1008);
  assert.equal(bad.received[0]?.kind, "error");

  // 멤버 목록과 접속 상태: owner는 A와 B에서 각각 창이 있어 둘 다 온라인이다. 그리고 한 워크스페이스의 창은 다른 쪽의 접속 상태로 새지 않는다.
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
      "owner의 창은 A에만 있어 B에서는 오프라인이다",
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

  // 채널 메시지와 채널·포럼 변경은 그 워크스페이스를 고른 연결에만 간다.
  await call(in_(owner, A), api.send, { channel: chatA, text: "A에게만" });
  await call(carol, api.send, { channel: chatB, text: "B에게만" });
  const chats = (live: Awaited<ReturnType<typeof world.live>>) =>
    live
      .messages()
      .filter((m) => m.kind === "text")
      .map((m) => (m.kind === "text" ? m.text : ""));
  await eventually(() => {
    assert.deepEqual(chats(liveAlice), ["A에게만"]);
    assert.deepEqual(chats(liveOwnerA), ["A에게만"]);
    assert.deepEqual(chats(liveCarol), ["B에게만"]);
    assert.deepEqual(chats(liveDave), ["B에게만"]);
  });
  await call(in_(owner, B), api.createChannel, { name: "잡담" });
  await eventually(() =>
    assert.equal(
      liveCarol.received.some((m) => m.kind === "channel" && m.payload.name === "잡담"),
      true,
    ),
  );
  assert.equal(
    liveAlice.received.some((m) => m.kind === "channel" && m.payload.name === "잡담"),
    false,
  );
  assert.equal(
    liveOwnerA.received.some((m) => m.kind === "channel" && m.payload.name === "잡담"),
    false,
    "같은 사람의 A 창에도 B의 채널은 가지 않는다",
  );
  // 끊긴 사이의 것을 이어 받을 때도 그 워크스페이스의 것만 온다. B의 마지막 번호보다 앞에서 A로 붙어도 B의 글은 오지 않는다.
  const resumed = await world.live(owner, 0, { workspace: A });
  await eventually(() => assert.deepEqual(chats(resumed), ["A의 이야기", "A에게만"]));
  const seq = (live: Awaited<ReturnType<typeof world.live>>) =>
    live.received.find((m) => m.kind === "welcome")?.payload;
  assert.notEqual(
    (seq(resumed) as { seq: number }).seq,
    (seq(liveCarol) as { seq: number }).seq,
    "마지막 메시지 번호도 워크스페이스마다다",
  );

  // 지표: 방문한 멤버 수는 워크스페이스마다다. A는 owner와 alice, B는 owner와 carol, dave다.
  const today = async (as: As) => (await call(as, api.metrics, { days: 1 })).days.at(-1);
  assert.equal((await today(in_(owner, A)))?.members, 2);
  assert.equal((await today(in_(owner, B)))?.members, 3);
  assert.equal((await today(alice))?.members, 2);
  assert.equal((await today(carol))?.members, 3);

  // 채팅 채널의 `@호출`은 그 워크스페이스의 러너가 답한다. owner의 러너는 A에만 있어 B에서는 꺼져 있다.
  const asked = await world.ask(owner as As & { login: string }, chatA, "A에서 묻는다");
  assert.equal(asked.channel, chatA);
  await assert.rejects(
    world.ask(owner as As & { login: string }, chatB, "B에서 묻는다"),
    refused("runner_offline"),
  );
  assert.equal((await today(in_(owner, A)))?.qas, 1);
  assert.equal((await today(in_(owner, B)))?.qas, 0);

  // 포스트와 알림, 결정: B의 레포에서 carol의 두 브랜치가 같은 줄을 고쳐 B에 알림이 선다.
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
    "포스트가 걸리는 포럼은 B의 포럼이다",
  );
  assert.deepEqual(
    (await call(in_(owner, B), api.posts)).posts.map((p) => p.channel),
    [post],
  );
  assert.deepEqual((await call(owner, api.posts)).posts, [], "A에는 B의 포스트가 없다");
  assert.deepEqual((await call(alice, api.posts)).posts, []);
  await assert.rejects(call({ ...alice, repos: [REPO3] }, api.posts), refused("not_found"));
  await assert.rejects(call(alice, api.history, { channel: post }), refused("not_found"));
  await assert.rejects(call(alice, api.setPostLabels, { post, labels: [] }), refused("not_found"));
  // 알림 줄의 자리도 워크스페이스마다다. owner가 A로 보면 B의 알림 줄은 없다.
  const alertLines = async (as: As) =>
    (await call(as, api.history, { channel: "alerts" })).messages;
  assert.equal((await alertLines(in_(owner, B))).length, 1);
  assert.deepEqual(await alertLines(owner), []);
  assert.deepEqual(await alertLines(alice), []);
  // 실시간 연결: B의 알림 줄과 포스트의 글은 B의 연결에만 간다.
  await call(carol, api.send, { channel: post, text: "제가 먼저 고칠게요" });
  await eventually(() =>
    assert.equal(
      liveDave.messages().some((m) => m.kind === "text" && m.text === "제가 먼저 고칠게요"),
      true,
    ),
  );
  for (const live of [liveAlice, liveOwnerA, resumed])
    assert.equal(
      live.messages().some((m) => m.kind === "alert" || m.channel === post),
      false,
      "B의 알림과 포스트의 글은 A의 연결에 가지 않는다",
    );

  // 결정은 그 포스트의 레포, 곧 B의 것이다.
  const { decision } = await call(carol, api.proposeDecision, {
    post,
    title: "환불은 결제 모듈을 거친다",
    context: "환불과 결제가 같은 줄을 고친다.",
    decision: "환불은 결제 모듈의 refund를 부른다.",
    consequences: "환불 브랜치가 결제 브랜치 뒤에 머지된다.",
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

  // B에서만 있었던 일은 A의 작업과 상태에 섞이지 않는다.
  assert.equal(
    (await call(owner, api.works)).works.some((w) => w.login === "carol"),
    false,
    "A의 작업에 B의 것이 섞이지 않는다",
  );
  assert.deepEqual(
    (await call(in_(owner, B), api.works)).works.map((w) => `${w.login}/${w.branch}`),
    ["carol/payment", "carol/refund"],
  );
});

test("워크스페이스가 하나이던 판(계약 46)의 DB로 켜도 있던 것이 첫 워크스페이스에 그대로 있고, 새 워크스페이스에는 섞이지 않는다", async (t) => {
  // 지표가 보는 기간 안에 들도록 방문, 문답, 판정 수의 시각은 지금으로 바꿔 넣는다.
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(Date.now());
  const seed = (await readFile(new URL("./contract46.sql", import.meta.url), "utf8"))
    .replace("'2026-11-18'", `'${today}'`)
    .replace("1790000000004", String(Date.now()))
    .replace("1790000000006", String(Date.now()));
  const world = await startWorld({ accept: [REPO, REPO3], seed });
  t.after(world.stop);
  world.github.grant("owner", REPO3);
  // 그 판의 alice 세션은 다시 로그인하지 않아도 옛 워크스페이스의 멤버다.
  const alice = { url: world.server.url, session: "old-alice-session" };
  assert.deepEqual(await call(alice, api.workspaces), {
    workspaces: [{ id: A, name: A, repos: [REPO] }],
  });

  // 있던 채팅 채널과 그 글, 포럼, 방문, 문답, 판정 수가 옛 워크스페이스에 그대로 있다.
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
    [["p1", ["직접 충돌"], "discuss", 1]],
  );
  assert.deepEqual(
    (await call(owner, api.decisions)).decisions.map((d) => d.title),
    ["결제는 alice가"],
  );
  const metrics = (await call(owner, api.metrics, { days: 3 })).days;
  assert.equal(
    metrics.find((d) => d.day === today)?.members,
    2,
    "옛 판의 방문(alice)과 지금 부른 owner",
  );
  assert.equal(
    metrics.reduce((n, d) => n + d.runs.pass, 0),
    1,
  );
  assert.equal(
    metrics.reduce((n, d) => n + d.qas, 0),
    1,
  );

  // 새 워크스페이스에는 기본 포럼만 있고 옛것은 하나도 없다. 같은 이름의 채널을 새로 만들 수 있다.
  const other = in_(owner, B);
  assert.deepEqual(await channels(other), ["forum:논의", "forum:참고"]);
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
    "B에는 옛 방문(alice)이 없고 owner만 있다",
  );

  // 다시 떠도(이미 옮긴 DB) 그대로다. 채널이 둘로 늘지 않는다.
  await world.restartServer();
  await eventually(async () => {
    assert.deepEqual(await channels(owner), ["chat:일반", "forum:논의", "forum:참고"]);
    assert.deepEqual(await channels(in_(owner, B)), ["chat:일반", "forum:논의", "forum:참고"]);
  });
  assert.deepEqual(
    (await call(owner, api.posts)).posts.map((p) => p.channel),
    ["p1"],
  );
});
