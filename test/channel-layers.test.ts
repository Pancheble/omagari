// 채널과 포럼을 레포와 워크스페이스 두 층에(ADR-0043). 채팅 채널은 레포나 워크스페이스에 속하고, 레포 채널은 그 레포에 push 권한이 있는 멤버만 본다.
// 레포 채널의 `@호출`은 그 레포의 러너가, 워크스페이스 채널의 `@호출`은 마지막에 붙인 러너가 답하고 답에 레포와 브랜치가 붙는다.
// 포럼은 레포 조건으로 거르고, 보는 사람이 push 권한이 없는 레포의 포스트는 어디에도 보이지 않는다.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, REPO, REPO2, REPO3, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string; login?: string; repos?: string[] };
/** `as`가 `repo`로 부른다. */
const on = (as: As, repo: string) => ({ ...as, repos: [repo] });
const refused = (code: string) => (error: ContractFailure) => error.code === code;
const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

test("레포 채널은 그 레포가 보이는 멤버만 보고 그 레포의 러너가 답하고, 워크스페이스 채널은 마지막에 붙인 러너가 답하며 답에 레포와 브랜치가 붙는다", async (t) => {
  const core = fakeExecutor(() => "코어 러너의 답");
  const pay = fakeExecutor(() => "결제 러너의 답");
  const world = await startWorld({ accept: [REPO, REPO2], executor: core.executor });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  // alice는 REPO2에만 push 권한이 있다.
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");
  const live = await world.live(alice);

  // 레포 채널은 그 레포가 보이는 멤버만 만들 수 있고, 이 워크스페이스의 레포여야 한다.
  await assert.rejects(
    call(alice, api.createChannel, { name: "코어", repo: REPO }),
    refused("not_found"),
  );
  await assert.rejects(
    call(owner, api.createChannel, { name: "남", repo: REPO3 }),
    refused("not_found"),
  );
  const shared = (await call(owner, api.createChannel, { name: "공용" })).channel;
  const coreChat = (await call(owner, api.createChannel, { name: "코어", repo: REPO })).channel;
  const payChat = (await call(on(owner, REPO2), api.createChannel, { name: "결제", repo: REPO2 }))
    .channel;
  assert.equal(shared.repo, undefined);
  assert.equal(coreChat.repo, REPO);
  assert.equal(payChat.repo, REPO2);
  // 이름은 워크스페이스에 하나다. 레포가 달라도 겹치면 conflict.
  await assert.rejects(
    call(owner, api.createChannel, { name: "코어", repo: REPO2 }),
    refused("conflict"),
  );

  // 채널 목록: alice는 워크스페이스 채널과 REPO2의 채널만 본다.
  const names = async (as: As) =>
    (await call(as, api.channels)).channels
      .filter((c) => c.kind === "chat")
      .map((c) => `${c.name}:${c.repo ?? ""}`)
      .sort();
  assert.deepEqual(await names(owner), [`결제:${REPO2}`, `공용:`, `코어:${REPO}`].sort());
  assert.deepEqual(await names(alice), [`결제:${REPO2}`, `공용:`].sort());
  // 실시간 연결도 그렇다: 만든 채널과 그 글이 REPO를 볼 수 없는 alice의 연결에는 가지 않는다.
  await eventually(() => {
    const seen = live.received.flatMap((m) => (m.kind === "channel" ? [m.payload.name] : []));
    assert.deepEqual(seen.sort(), ["결제", "공용"]);
  });
  await call(owner, api.send, { channel: coreChat.id, text: "코어 이야기" });
  await call(owner, api.send, { channel: payChat.id, text: "결제 이야기" });
  await eventually(() =>
    assert.deepEqual(
      live.messages().map((m) => m.kind === "text" && m.text),
      ["결제 이야기"],
    ),
  );
  // 읽고 쓰고 묻는 것도 막힌다.
  await assert.rejects(call(alice, api.history, { channel: coreChat.id }), refused("not_found"));
  await assert.rejects(
    call(alice, api.send, { channel: coreChat.id, text: "몰래" }),
    refused("not_found"),
  );
  await assert.rejects(call(alice, api.dms, { channel: coreChat.id }), refused("not_found"));
  assert.equal((await call(alice, api.history, { channel: payChat.id })).messages.length, 1);

  // `@호출`: owner의 러너가 REPO에 하나, REPO2에 하나다(나중에 붙은 쪽이 REPO2).
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
  const coreAnswer = await answered(coreChat.id, "코어에서 묻는다");
  assert.equal(coreAnswer.text, "코어 러너의 답", "레포 채널은 그 레포의 러너가 답한다");
  assert.equal(coreAnswer.source.repo, REPO);
  const payAnswer = await answered(payChat.id, "결제에서 묻는다");
  assert.equal(payAnswer.text, "결제 러너의 답");
  assert.equal(payAnswer.source.repo, REPO2);
  // 워크스페이스 채널은 마지막에 붙인 러너가 답하고 답에 레포와 브랜치가 붙는다.
  const sharedAnswer = await answered(shared.id, "공용에서 묻는다", "public");
  assert.equal(sharedAnswer.text, "결제 러너의 답");
  assert.equal(sharedAnswer.source.repo, REPO2);
  assert.equal(typeof sharedAnswer.source.branch, "string");
  assert.equal(core.calls.length, 1);
  assert.equal(pay.calls.length, 2);
  // 레포 채널의 러너가 꺼져 있으면 다른 레포의 러너가 대신 답하지 않는다.
  await desk.stop();
  await eventually(() =>
    assert.rejects(
      call(owner, api.ask, {
        agent: "owner",
        executor: "claude-code",
        channel: payChat.id,
        message: "꺼진 레포",
      }),
      refused("runner_offline"),
    ),
  );
  // 워크스페이스 채널은 남은 러너가 답한다.
  const rest = await answered(shared.id, "남은 러너에게");
  assert.equal(rest.text, "코어 러너의 답");
  assert.equal(rest.source.repo, REPO);
});

test("포럼은 레포로 거르고, 레포의 라벨 이름을 바꾸면 그 레포를 거르는 포럼이 따라가고, push 권한이 없는 레포의 포스트는 어느 포럼에도 보이지 않는다", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2], observeMs: 50, followMs: 50 });
  t.after(world.stop);
  const owner = world.owner as As & { login: string };
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");

  // 같은 줄을 고치는 두 브랜치로 REPO와 REPO2에 직접 충돌 포스트를 하나씩 세운다.
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

  const postOf = (as: As, repo: string) =>
    eventually(async () => {
      const { posts } = await call(on(as, repo), api.posts);
      assert.equal(posts.length, 1);
      return posts[0] as (typeof posts)[number];
    });
  const corePost = await postOf(owner, REPO);
  const payPost = await postOf(owner, REPO2);
  assert.equal(corePost.repo, REPO);
  assert.equal(payPost.repo, REPO2);

  // 포럼의 레포 조건. 비면 모든 레포이고 적지도 않는다. 이 워크스페이스의 레포가 아니면 거절한다(대소문자는 맞춘다).
  const forum = async (name: string, filter: object) =>
    (await call(owner, api.createForum, { name, filter: filter as never })).channel;
  const coreForum = await forum("코어", { labels: ["직접 충돌"], repos: [REPO] });
  const payForum = await forum("결제", { labels: ["직접 충돌"], repos: [REPO2.toUpperCase()] });
  const allForum = await forum("전체", { labels: ["직접 충돌"], repos: [] });
  assert.deepEqual(payForum.filter, { labels: ["직접 충돌"], repos: [REPO2] });
  assert.deepEqual(allForum.filter, { labels: ["직접 충돌"] });
  await assert.rejects(
    call(owner, api.createForum, { name: "남", filter: { labels: ["a"], repos: [REPO3] } }),
    refused("invalid_request"),
  );
  await assert.rejects(
    call(owner, api.updateForum, {
      id: coreForum.id,
      name: "코어",
      filter: { importance: "discuss", repos: ["omagari-test/nowhere"] },
    }),
    refused("invalid_request"),
  );
  // 이미 있던 포럼("참고")은 레포 조건이 없어 모든 레포의 포스트가 걸린다.
  const forumsOf = async (as: As, repo: string) =>
    (await call(on(as, repo), api.posts)).posts.map((p) => [...p.forums].sort());
  const ids = (...forums: { id: string }[]) => forums.map((f) => f.id).sort();
  const reference = (await call(owner, api.channels)).channels.find((c) => c.name === "참고");
  assert.ok(reference);
  await eventually(async () => {
    assert.deepEqual(await forumsOf(owner, REPO), [ids(coreForum, allForum, reference)]);
    assert.deepEqual(await forumsOf(owner, REPO2), [ids(payForum, allForum, reference)]);
  });
  // 중요도 포럼도 레포로 거른다(고친다).
  const only = await call(owner, api.updateForum, {
    id: reference.id,
    name: "참고",
    filter: { importance: "reference", repos: [REPO2] },
  });
  assert.deepEqual(only.channel.filter, { importance: "reference", repos: [REPO2] });
  await eventually(async () =>
    assert.deepEqual(await forumsOf(owner, REPO), [ids(coreForum, allForum)]),
  );

  // push 권한이 없는 레포의 포스트는 보이지 않는다. alice는 REPO2의 포스트만 본다.
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
    "알림 줄의 자리에는 REPO2의 알림만 있다",
  );
  const live = await world.live(alice, 0);
  await eventually(() =>
    assert.deepEqual(
      live.messages().flatMap((m) => (m.kind === "alert" ? [m.post.channel] : [])),
      [payPost.channel],
    ),
  );
  // 포럼 자체는 워크스페이스의 것이라 alice도 본다. 거르기의 레포 조건도 보인다.
  assert.deepEqual(
    (await call(alice, api.channels)).channels.find((c) => c.id === coreForum.id)?.filter,
    { labels: ["직접 충돌"], repos: [REPO] },
  );

  // REPO2에서 라벨 이름을 바꾸면: REPO2만 거르는 포럼은 이름을 바꾸고, 모든 레포를 거르는 포럼은 새 이름을 더하고,
  await call(on(owner, REPO2), api.editLabel, { name: "직접 충돌", next: { name: "충돌" } });
  const filterOf = async (id: string) =>
    (await call(owner, api.channels)).channels.find((c) => c.id === id)?.filter;
  assert.deepEqual(await filterOf(payForum.id), { labels: ["충돌"], repos: [REPO2] });
  assert.deepEqual(await filterOf(allForum.id), { labels: ["직접 충돌", "충돌"] });
  // (가짜 GitHub는 라벨을 레포끼리 나누지 않아 REPO도 다음 주기에 같은 이름을 받는다. REPO만 거르는 포럼이 그대로인지는 여기서 가리지 않는다.)
  await eventually(async () => {
    assert.deepEqual(await forumsOf(owner, REPO2), [ids(payForum, allForum, reference)]);
  });
});

test("채널이 워크스페이스에만 속하던 판(계약 47)의 DB로 켜면 있던 채널이 첫 레포의 채널이 되고, 포럼과 알림 줄의 자리는 그대로이고, 다시 떠도 그 뒤에 만든 채널을 옮기지 않는다", async (t) => {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(Date.now());
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

  // 있던 채팅 채널은 첫 레포의 채널이다. 그 레포가 보이는 alice는 그대로 읽고, 포럼은 그대로이고 레포 조건이 없다.
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
  // 다른 워크스페이스에만 있는 사람은 그 채널을 보지 못한다.
  world.github.grant("carol", REPO3);
  const carol = await world.login("carol");
  await assert.rejects(call(carol, api.history, { channel: "c1" }), refused("not_found"));
  assert.deepEqual(await channels(carol), ["forum:논의:", "forum:참고:"]);
  assert.equal((await call(owner, api.history, { channel: "alerts" })).messages.length, 1);

  // 그 뒤에 만든 워크스페이스 채널은 다시 떠도 레포로 옮겨지지 않는다.
  await call(owner, api.createChannel, { name: "공용" });
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(await channels(owner), [...expected, "chat:공용:"].sort()),
  );
});
