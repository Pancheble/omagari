// 한 워크스페이스에 같은 계정의 레포 여럿(ADR-0043). 레포는 그 레포의 Admin만 넣고 빼고, 러너는 폴더의 원격으로 레포에 이어지며,
// 멤버는 push 권한이 있는 레포만 본다. 작업, 알림, 포스트, 라벨, 결정은 레포마다 나뉜다.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO2, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string };
/** `as`가 `repo`로 부른다. */
const on = (as: As, repo: string) => ({ ...as, repos: [repo] });
const refused = (code: string) => (error: ContractFailure) => error.code === code;

const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

test("Admin만 같은 계정의 레포를 넣고 빼며, 러너는 원격으로 그 레포에 이어지고, 작업과 알림과 라벨이 레포마다 나뉜다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const { owner } = world;

  // 워크스페이스에 없는 레포에만 push 권한이 있으면 들어오지 못한다.
  world.github.grant("alice", REPO2);
  await assert.rejects(world.login("alice"), refused("forbidden"));

  // 받을 계정 밖의 레포와, Admin이 아닌 레포는 넣지 못한다.
  await assert.rejects(call(owner, api.addRepo, { repo: "stranger/code" }), refused("forbidden"));
  await assert.rejects(call(owner, api.addRepo, { repo: REPO2 }), refused("forbidden"));
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  assert.deepEqual(await call(owner, api.addRepo, { repo: REPO2 }), { repos: [REPO, REPO2] });

  // alice는 push 권한이 있는 REPO2만 본다. Admin이 아니라 넣고 빼지 못한다.
  const alice = await world.login("alice");
  assert.deepEqual(await call(alice, api.me), {
    login: "alice",
    name: "alice",
    avatar: null,
    repo: REPO2,
    repos: [REPO2],
    gif: false,
    prefs: { language: "en" },
  });
  await assert.rejects(call(alice, api.removeRepo, { repo: REPO2 }), refused("forbidden"));
  // 레포 넣기 목록에는 내가 Admin인 레포만 실린다. Admin이 아니면 비어 다른 레포의 이름도 수도 보이지 않는다(시안 93-C).
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

  // 워크스페이스에 없는 레포의 러너는 거절된다.
  await assert.rejects(world.desk(alice, undefined, undefined, { repo: "omagari-test/nowhere" }));
  // alice의 러너는 원격으로 REPO2에 이어진다. 두 브랜치가 같은 줄을 고쳐 REPO2에 직접 충돌이 선다(ADR-0041).
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
  // REPO2의 것은 REPO2에서만 보인다.
  assert.deepEqual(
    (await call(on(owner, REPO2), api.posts)).posts.map((p) => p.channel),
    posts.map((p) => p.channel),
  );
  assert.deepEqual((await call(owner, api.posts)).posts, []);
  assert.deepEqual(
    (await call(owner, api.works)).works.map((w) => w.login),
    ["owner"],
    "REPO의 작업에 REPO2의 것이 섞이지 않는다",
  );
  assert.deepEqual(
    (await call(on(owner, REPO2), api.works)).works.map((w) => `${w.login}/${w.branch}`),
    ["alice/payment", "alice/refund"],
  );
  // REPO의 멤버 목록에 REPO2에만 있는 alice는 없다.
  assert.deepEqual(
    (await call(owner, api.members)).members.map((m) => m.login),
    ["owner"],
  );
  // REPO2의 포스트는 REPO2를 볼 수 없는 사람에게 없는 것이다.
  const post = posts[0]?.channel as string;
  world.github.grant("bob");
  const bob = await world.login("bob");
  await assert.rejects(call(bob, api.history, { channel: post }), refused("not_found"));
  await assert.rejects(call(bob, api.setPostLabels, { post, labels: [] }), refused("not_found"));
  assert.deepEqual(
    (await call(bob, api.history, { channel: "alerts" })).messages,
    [],
    "알림 줄의 자리에도 REPO2의 알림은 없다",
  );

  // 라벨의 중요도는 레포마다다.
  await call(on(owner, REPO2), api.editLabel, {
    name: "Duplicate work",
    next: { importance: "discuss" },
  });
  const importance = async (as: As) =>
    (await call(as, api.labels)).labels.find((l) => l.name === "Duplicate work")?.importance;
  assert.equal(await importance(on(owner, REPO2)), "discuss");
  assert.equal(await importance(owner), "reference");
  assert.equal(await importance(alice), "discuss");

  // 레포를 빼면 그 레포의 러너가 끊기고 아무에게도 보이지 않는다. 다시 넣으면 그 레포의 것이 돌아온다.
  assert.deepEqual(await call(owner, api.removeRepo, { repo: REPO2 }), { repos: [REPO] });
  await assert.rejects(call(alice, api.posts), refused("not_found"));
  assert.deepEqual(await call(owner, api.addRepo, { repo: REPO2 }), { repos: [REPO, REPO2] });
  assert.deepEqual(
    (await call(alice, api.posts)).posts.map((p) => p.channel),
    [post],
  );
});

test("push 권한이 있는 레포만 보이고, GitHub에서 권한을 잃으면 다시 확인한 뒤 그 레포가 보이지 않는다", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2], recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("owner", REPO2);
  world.github.grant("alice", REPO);
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");
  assert.deepEqual((await call(alice, api.me)).repos, [REPO, REPO2]);
  const live = await world.live(alice);

  // REPO2의 권한을 잃으면 REPO만 남는다.
  world.github.revoke("alice", REPO2);
  await eventually(async () => assert.deepEqual((await call(alice, api.me)).repos, [REPO]));
  await assert.rejects(call(on(alice, REPO2), api.members), refused("not_found"));
  await eventually(async () =>
    assert.deepEqual(
      (await call(on(world.owner, REPO2), api.members)).members.map((m) => m.login),
      ["owner"],
    ),
  );
  assert.equal(live.received.at(-1)?.kind !== "error", true, "REPO를 고른 웹은 그대로다");

  // 모든 레포의 권한을 잃으면 세션이 끝난다.
  world.github.revoke("alice", REPO);
  await eventually(() => assert.rejects(call(alice, api.me), refused("unauthorized")));
  assert.equal(await live.closed, 1008);
});

test("레포가 하나이던 판의 DB로 켜도 있던 것이 그 레포에 그대로 있고, 새로 넣은 레포에는 섞이지 않는다", async (t) => {
  const world = await startWorld({
    accept: [REPO, REPO2],
    seed: await readFile(new URL("./contract45.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  world.github.grant("owner", REPO2);
  // 그 판의 alice 세션은 다시 로그인하지 않아도 옛 레포의 멤버다.
  const alice = { url: world.server.url, session: "old-alice-session" };
  assert.deepEqual(await call(alice, api.me), {
    login: "alice",
    name: "앨리스",
    avatar: null,
    repo: REPO,
    repos: [REPO],
    gif: false,
    prefs: { language: "en" },
  });

  // owner는 새 레포의 권한을 받은 뒤 다시 들어온다.
  const owner = await world.login("owner");
  const [work] = (await call(owner, api.works)).works;
  assert.deepEqual(
    [work?.login, work?.branch, work?.line?.text],
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

  // 새 레포에는 아무것도 없고, 라벨은 기본값이다.
  const other = on(owner, REPO2);
  assert.deepEqual((await call(other, api.works)).works, []);
  assert.deepEqual((await call(other, api.posts)).posts, []);
  assert.deepEqual((await call(other, api.decisions)).decisions, []);
  assert.equal(
    (await call(other, api.labels)).labels.find((l) => l.name === "Direct conflict")?.importance,
    "reference",
  );
  assert.equal((await call(other, api.settings)).mergeCheck.check, null);

  // 다시 떠도(이미 옮긴 DB) 그대로다.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(
      (await call(owner, api.posts)).posts.map((p) => p.channel),
      ["p1"],
    ),
  );
});

test("GitHub에서 레포를 다른 계정으로 옮기면 그 레포의 것이 새 이름 아래로 따라가고, 옛 원격과 옛 설정도 새 이름으로 읽는다", async (t) => {
  const MOVED = "omagari-moved/space";
  // 받을 계정에 옮겨 갈 계정이 있다. 옛 레포 이름(REPO)도 설정에 남아 있다.
  const world = await startWorld({
    accept: [REPO, "omagari-moved"],
    seed: await readFile(new URL("./contract47.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  // owner의 러너들이 올리는 작업은 때에 따라 있어 그 판의 alice 작업만 본다.
  const seen = async (as: As) => ({
    works: (await call(as, api.works)).works
      .filter((w) => w.login === "alice")
      .map((w) => [w.login, w.branch, w.line?.text]),
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

  // 권한을 다시 읽을 때(여기서는 다시 로그인할 때, 서버에서는 10분마다도) 옮겨진 것을 안다.
  world.github.move(REPO, MOVED);
  const owner = await world.login("owner");
  assert.deepEqual((await call(owner, api.me)).repos, [MOVED]);
  assert.deepEqual(await seen(on(owner, MOVED)), before);
  assert.equal(
    (await call(owner, api.channels)).channels.find((c) => c.name === "일반")?.repo,
    MOVED,
  );
  // 옛 이름으로 부르는 CLI와 옛 원격의 러너도 새 레포에 닿는다.
  assert.deepEqual(await seen(on(owner, REPO)), before);
  const desk = await world.desk(owner, undefined, undefined, { repo: REPO });
  t.after(desk.remove);
  assert.equal((await call({ ...owner, session: "old-alice-session" }, api.me)).repo, MOVED);

  // 다시 떠도 설정의 옛 이름으로 빈 레포가 다시 생기지 않는다.
  await world.restartServer();
  await eventually(async () => assert.deepEqual((await call(owner, api.me)).repos, [MOVED]));
  assert.deepEqual(await seen(owner), before);
});
