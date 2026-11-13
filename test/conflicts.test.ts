import assert from "node:assert/strict";
import { test } from "node:test";
import { type Alert, api, type ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, said, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };

const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;
/** `n`번 줄(1부터)을 `to`로 바꾼 판. */
const edit = (n: number, to: string, lines = BASE) => lines.toSpliced(n - 1, 1, to);

/** 기준 커밋에 `files`를 두고 origin/main을 올린다. 두 멤버가 같은 판에서 시작한다. */
async function base(world: World, files: string[]) {
  for (const path of files) await writer(world.repo.folder)(path, text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/**
 * 멤버 `login`의 기기. 내 레포를 받은 것처럼 내 main 위에서 `branch`를 시작한다. 같은 레포의 두 클론이다.
 * 받는 동안은 러너를 꺼 둔다. 반쯤 받은 레포의 작업이 잠깐 관측되어 알림이 서지 않게 한다.
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
 * owner가 payment 브랜치로 옮기고, 서버가 그것을 볼 때까지 기다린다. 관측이 브랜치 이름을 읽은 뒤에 옮기면
 * 그 주기의 바뀐 파일이 옛 브랜치의 것으로 잠깐 보일 수 있어서다.
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

/** 채널 `name`(기본은 알림 채널 "부딪힘")의 지난 대화에 선 `kind`(기본은 직접 충돌) 알림들. 채널이 없으면 비어 있다. */
async function alerts<K extends Alert["kind"] = "direct">(
  as: As,
  name = "부딪힘",
  kind = "direct" as K,
): Promise<Of<K>[]> {
  const channel = (await call(as, api.channels)).channels.find((c) => c.name === name);
  if (!channel) return [];
  const { messages } = await call(as, api.history, { channel: channel.id });
  return messages.flatMap((m) =>
    m.kind === "alert" && m.alert.kind === kind
      ? [{ id: m.id, ...m.alert } as unknown as Of<K>]
      : [],
  );
}

/** `kind` 알림이 정확히 하나가 될 때까지 기다리고, `check`가 맞을 때까지 기다린 그 알림. */
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

/** 멤버 목록에서 작업마다 직접 충돌 표시. */
async function marks(as: As) {
  const { members } = await call(as, api.members);
  return Object.fromEntries(
    members.flatMap((m) => m.works.map((w) => [`${m.login}/${w.branch}`, w.conflict])),
  );
}

const OWNER = { login: "owner", name: "owner", branch: "payment" };
const ALICE = { login: "alice", name: "alice", branch: "refund" };

test("같은 곳을 고치면 부딪힘 채널에 알림 하나가 오고, 바뀌면 같은 알림이 고쳐지고, 다 풀리면 풀렸다가 한 번 적힌다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, ["src/pay.ts", "src/clean.ts"]);
  const { desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);
  const web = await world.live(world.owner);

  // 같은 파일이어도 떨어진 줄을 고치면 합쳐서 부딪히지 않는다.
  await writer(world.repo.folder)("src/clean.ts", text(edit(2, "owner")));
  await writer(desk.folder)("src/clean.ts", text(edit(8, "alice")));
  // 같은 줄을 고치면 부딪힌다.
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  assert.deepEqual(await alerts(world.owner), []);
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice")));

  // 처음 알림에 "부딪힘" 채널이 생긴다. 알림에는 두 사람, 두 브랜치, 파일, 부딪히는 줄(각자의 사본 기준)이 있다.
  const first = await theAlert(world.owner, () => {});
  assert.deepEqual(first, {
    id: first.id,
    kind: "direct",
    works: [ALICE, OWNER],
    files: [{ path: "src/pay.ts", lines: [[{ from: 3, to: 3 }], [{ from: 3, to: 3 }]] }],
    more: 0,
    resolved: null,
  });
  // 양쪽 러너가 같은 쌍을 올려도 알림은 하나다. 다른 멤버도 같은 것을 본다.
  await eventually(async () => assert.deepEqual(await alerts(world.owner), [first]));
  await eventually(async () =>
    assert.deepEqual(await marks(world.owner), { "alice/refund": true, "owner/payment": true }),
  );

  // 부딪힘이 바뀌면 같은 알림이 고쳐지고 실시간 연결로 다시 온다.
  await writer(desk.folder)("src/pay.ts", text(edit(4, "alice too", edit(3, "alice"))));
  const changed = await theAlert(world.owner, (alert) =>
    assert.deepEqual(alert.files, [
      { path: "src/pay.ts", lines: [[{ from: 3, to: 4 }], [{ from: 3, to: 3 }]] },
    ]),
  );
  assert.equal(changed.id, first.id);
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

  // 다 풀리면 같은 알림에 풀린 시각이 한 번 적히고, 새 알림은 서지 않는다. 표시도 사라진다.
  await desk.git("checkout", "--", "src/pay.ts");
  const resolved = await theAlert(world.owner, (alert) => assert.notEqual(alert.resolved, null));
  assert.equal(resolved.id, first.id);
  await eventually(async () =>
    assert.deepEqual(await marks(world.owner), { "alice/refund": false, "owner/payment": false }),
  );
  await eventually(() =>
    assert.ok(web.messages().some((m) => m.kind === "alert" && m.alert.resolved !== null)),
  );
  // 알림 채널을 바꾸면 그 뒤의 알림은 그 채널로 간다. 풀린 뒤 다시 부딪히면 새 알림이다.
  const team = await world.channel(world.owner, "팀");
  await call(world.owner, api.setAlertChannel, { channel: team });
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice again")));
  await theAlert(world.owner, (alert) => assert.equal(alert.resolved, null), "팀");
  assert.deepEqual(await alerts(world.owner), [resolved]);
  await web.close();
});

test("한 쌍에서 여러 파일이 부딪히면 알림 하나로 묶고 여덟 개까지 이름, 나머지는 개수다", async (t) => {
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

test("한쪽 러너만 켜져 있어도 알림이 온다", async (t) => {
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
  // alice의 러너가 꺼져도 그 작업은 서버에 남고, owner의 러너가 혼자 계산한다.
  await desk.stop();
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  await theAlert(world.owner, (alert) =>
    assert.deepEqual(alert.files, [
      { path: "src/pay.ts", lines: [[{ from: 3, to: 3 }], [{ from: 3, to: 3 }]] },
    ]),
  );
  await eventually(async () =>
    assert.deepEqual(await marks(world.owner), { "alice/refund": true, "owner/payment": true }),
  );
});

test("상대의 내용을 읽을 수 없으면 부딪힐 수 있음으로 알리고, 알림 채널을 바꾸면 그 채널로 간다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, ["src/pay.ts", "src/bob.ts"]);
  await assert.rejects(
    call(world.owner, api.setAlertChannel, { channel: "nope" }),
    (error: ContractFailure) => error.code === "not_found",
  );
  const mine = await world.channel(world.owner, "팀");
  assert.deepEqual(await call(world.owner, api.setAlertChannel, { channel: mine }), {
    channel: { id: mine, name: "팀" },
  });

  // alice는 내용을 내보내지 않는다(공유 수준 declared). alice의 러너는 owner의 내용으로 계산하지만,
  // owner의 러너가 확인할 수 없는 것은 "부딪힐 수 있음"이다. 두 러너의 결과는 하나로 묶인다.
  const alice = await clone(world, "alice", "refund", "declared");
  t.after(alice.desk.remove);
  // bob은 이 기기가 받지 않은 커밋 위에서 일한다. bob의 러너는 내 기준 커밋을 모른다.
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

  // 줄이 떨어져 있어도 확인하지 못했으니 알린다. alice의 러너는 owner의 내용으로 깨끗하다고 보지만 owner의 러너는 확인하지 못한다.
  // 두 러너의 결과는 쌍마다 하나로 묶인다. 표시는 확인된 직접 충돌에만 붙는다.
  await eventually(async () => {
    // 브랜치를 옮기는 사이에 잠깐 선 알림은 이미 풀렸다. 열린 것만 본다.
    const found = (await alerts(world.owner, "팀"))
      .filter((alert) => alert.resolved === null)
      .map(({ works, files }) => ({ works, files }));
    assert.deepEqual(
      found.sort((x, y) => (x.works[0].login < y.works[0].login ? -1 : 1)),
      [
        { works: [ALICE, OWNER], files: [{ path: "src/pay.ts", unknown: "share" }] },
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
  // 정한 채널이 있으면 "부딪힘" 채널을 만들지 않는다.
  assert.equal(
    (await call(world.owner, api.channels)).channels.some((c) => c.name === "부딪힘"),
    false,
  );
});

test("알림에 달린 포스트: 열면 생기고 다시 열면 같고, 글과 DM·@호출이 채널처럼 돌며 그 대화는 포스트의 것이다", async (t) => {
  const fake = fakeExecutor(() => "답");
  const world = await startWorld({ observeMs: 50, executor: fake.executor });
  t.after(world.stop);
  await base(world, ["src/pay.ts"]);
  const { as: alice, desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);
  await writer(world.repo.folder)("src/pay.ts", text(edit(3, "owner")));
  await writer(desk.folder)("src/pay.ts", text(edit(3, "alice")));
  const alert = await theAlert(world.owner, () => {});
  const room = (await call(world.owner, api.channels)).channels.find((c) => c.name === "부딪힘");
  assert.ok(room);
  await call(world.owner, api.send, { channel: room.id, text: "채널의 말" });
  const web = await world.live(alice);
  /** 실시간 연결로 마지막에 받은 그 알림 줄의 포스트. */
  const postOf = () =>
    web
      .messages()
      .flatMap((m) => (m.kind === "alert" && m.id === alert.id ? [m.post] : []))
      .at(-1);

  // 처음 열면 포스트가 생기고, 알림 줄에 글 수 0의 포스트가 붙어 모두에게 간다. 다시 열어도 같은 포스트다.
  const opened = await call(world.owner, api.openPost, { alert: alert.id });
  assert.deepEqual(opened.post, { channel: opened.post.channel, alert: alert.id, count: 0 });
  assert.equal(opened.message.id, alert.id);
  assert.deepEqual((await call(alice, api.openPost, { alert: alert.id })).post, opened.post);
  const post = opened.post.channel;
  await eventually(() => assert.deepEqual(postOf(), { channel: post, count: 0 }));
  assert.deepEqual((await call(alice, api.posts)).posts, [opened.post]);
  // 포스트는 채널 목록에 없고, 알림이 아닌 메시지에는 포스트를 열지 못한다.
  assert.deepEqual(
    (await call(alice, api.channels)).channels.map((c) => c.name),
    ["부딪힘"],
  );
  await assert.rejects(call(alice, api.openPost, { alert: alert.id + 1 }), {
    code: "not_found",
  } satisfies Partial<ContractFailure>);

  // 포스트에 쓴 글은 다른 멤버에게 실시간으로 가고 지난 대화로 다시 읽힌다. 알림 줄의 글 수가 따라 바뀐다.
  await call(world.owner, api.send, { channel: post, text: "이 줄은 제가 고칠게요" });
  await eventually(() =>
    assert.ok(
      web.messages().some((m) => m.channel === post && said(m) === "이 줄은 제가 고칠게요"),
    ),
  );
  assert.deepEqual((await call(alice, api.history, { channel: post })).messages.map(said), [
    "이 줄은 제가 고칠게요",
  ]);
  await eventually(() => assert.deepEqual(postOf(), { channel: post, count: 1 }));

  // 같은 채널의 채널 세션과 포스트의 채널 세션은 따로 이어 간다.
  await world.settled(world.owner, await world.ask(world.owner, room.id, "채널에서 묻기"));
  const dm = await world.ask(world.owner, post, "포스트에서 묻기");
  await world.settled(world.owner, dm);
  await world.settled(world.owner, await world.ask(world.owner, post, "포스트에서 또 묻기"));
  const [inRoom, inPost, again] = fake.calls;
  assert.equal(inRoom?.resume, undefined);
  assert.equal(inPost?.resume, undefined, "포스트는 채널의 세션을 잇지 않는다");
  assert.equal(again?.resume, "session-2", "포스트의 세션을 잇는다");
  // 러너에 넘어간 대화는 포스트의 것이고 맨 위에 알림이 있다. 채널의 말은 없다.
  const given = inPost?.message ?? "";
  assert.match(given, /<channel_messages channel="부딪힘의 알림 \d+번 포스트">/);
  assert.match(given, /<alert kind="직접 충돌"[^>]*>\n[^<]*src\/pay\.ts: 3 \/ 3/);
  assert.match(given, /이 줄은 제가 고칠게요/);
  assert.doesNotMatch(given, /채널의 말/);
  assert.ok(given.indexOf("<alert") < given.indexOf("이 줄은 제가 고칠게요"));

  // 포스트의 DM을 포스트에 올리고, `@호출`도 포스트에 선다. 둘 다 글 수에 든다.
  const shared = await call(world.owner, api.postQa, { qa: dm.id, text: "근거" });
  assert.equal(shared.message.channel, post);
  const called = await call(world.owner, api.ask, {
    agent: "owner",
    executor: "claude-code",
    channel: post,
    message: "모두 보게 묻기",
    visibility: "public",
  });
  assert.equal(called.message?.channel, post);
  await world.settled(world.owner, called.qa);
  assert.deepEqual(
    (await call(alice, api.history, { channel: post })).messages.map((m) => m.kind),
    ["text", "qa", "qa"],
  );
  await eventually(() => assert.deepEqual(postOf(), { channel: post, count: 3 }));
  const [atRoom] = (await call(alice, api.history, { channel: room.id })).messages.filter(
    (m) => m.kind === "alert",
  );
  assert.deepEqual(atRoom?.kind === "alert" && atRoom.post, { channel: post, count: 3 });
});

/** 정의 줄을 견줄 기준 판: 함수 둘과 그것을 쓰는 파일. */
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

/** 기준 커밋에 src/pay.ts와 src/checkout.ts를 둔다. */
async function symbolBase(world: World) {
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** 넣은 글(CLI의 응답)에서 편지함의 소식 줄만. */
const inboxLines = (output: string) =>
  output.split("<omagari-inbox>\n")[1]?.split("\n</omagari-inbox>")[0]?.split("\n") ?? [];

/** `cwd`에서 `omagari status`를 거듭 돌려 편지함에 `line`이 넘겨질 때까지 기다린다. 넘긴 것은 다시 오지 않으니 본 것을 모은다. */
async function receives(world: World, cwd: string, line: string) {
  const seen: string[] = [];
  await eventually(async () => {
    seen.push(...inboxLines((await world.cliIn(cwd, "status")).stdout));
    assert.ok(seen.includes(line), JSON.stringify(seen));
  });
}

test("함수의 정의 줄을 바꾸면 그 함수를 쓰는 다른 작업에 추정 간접 충돌이 오고, 본문만 바꾼 함수는 빠지며, 되돌리거나 쓰는 곳이 사라지면 풀렸다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await symbolBase(world);
  const alice = await clone(world, "alice", "refund");
  t.after(alice.desk.remove);
  await payment(world);

  // owner가 한 번에 pay의 본문과 refund의 정의 줄을 바꾼다. alice는 둘 다 쓴다. 알림에는 refund만 있다.
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
  const first = await theAlert(world.owner, () => {}, undefined, "indirect");
  assert.deepEqual(first, {
    id: first.id,
    kind: "indirect",
    works: [ALICE, OWNER],
    symbols: [REFUND],
    more: 0,
    resolved: null,
  });
  // 직접 충돌은 없다(함께 바꾼 파일이 없다). 쓰는 쪽 작업의 편지함에 "추정"과 함께 들어간다.
  assert.deepEqual(await alerts(world.owner), []);
  await receives(
    world,
    alice.desk.folder,
    `- 간접 충돌(추정): 내 작업과 owner의 브랜치 "payment". 한쪽이 정의 줄을 바꾸거나 없앤 심볼을 다른 쪽이 쓴다. 이름으로만 이어 다른 심볼일 수 있다. "refund"(나: 씀 "src/checkout.ts":1, "src/checkout.ts":2 / 상대: 정의 줄 바꿈 "src/pay.ts":4)`,
  );

  // 바꾼 정의 줄을 되돌리면 풀렸다.
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
    `- 풀렸다: 내 작업과 owner의 브랜치 "payment"의 간접 충돌(추정)`,
  );

  // 다시 바꾸면 새 알림이다. 쓰는 쪽 러너가 꺼져 있으면 바꾼 쪽 러너만으로는 풀었다고 보지 않는다.
  await writer(world.repo.folder)("src/pay.ts", changed);
  const again = await eventually(async () => {
    const open = (await alerts(world.owner, undefined, "indirect")).filter((a) => !a.resolved);
    assert.equal(open.length, 1);
    return open[0] as Of<"indirect">;
  });
  assert.deepEqual(again.symbols, [REFUND]);
  await alice.desk.stop();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "alice" && w.offlineSince)),
  );
  assert.deepEqual(
    (await alerts(world.owner, undefined, "indirect")).find((a) => a.id === again.id)?.resolved,
    null,
  );

  // 쓰는 곳이 사라지면 풀렸다.
  await alice.desk.start();
  await writer(alice.desk.folder)("src/checkout.ts", "export const total = 1;\n");
  await eventually(async () =>
    assert.notEqual(
      (await alerts(world.owner, undefined, "indirect")).find((a) => a.id === again.id)?.resolved,
      null,
    ),
  );
});

test("두 작업에 같은 이름의 새 정의가 생기면 중복 구현이 양쪽 편지함에 들어가고, 한 쌍에 직접 충돌과 간접 충돌이 함께 있으면 종류마다 알림이 따로다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await symbolBase(world);
  const alice = await clone(world, "alice", "refund");
  t.after(alice.desk.remove);
  await payment(world);

  // 같은 이름의 새 함수를 다른 파일에 따로 만든다.
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
    `- 중복 구현: 내 작업과 alice의 브랜치 "refund"에 같은 이름의 새 정의가 따로 생겼다. "split"(나: 새로 만듦 "src/money.ts":1 / 상대: 새로 만듦 "src/split.ts":1)`,
  );
  await receives(
    world,
    alice.desk.folder,
    `- 중복 구현: 내 작업과 owner의 브랜치 "payment"에 같은 이름의 새 정의가 따로 생겼다. "split"(나: 새로 만듦 "src/split.ts":1 / 상대: 새로 만듦 "src/money.ts":1)`,
  );

  // 같은 줄(pay의 본문)을 둘이 고치고, owner는 refund의 정의 줄도 바꾼다. 한 쌍에 세 종류가 따로 선다.
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
  assert.deepEqual(kinds, []); // 두 작업 모두 owner의 것이 걸려 있어 피드에는 없다
  const all = await alerts(world.owner, undefined, "duplicate");
  assert.deepEqual(
    all.map((a) => a.id),
    [duplicate.id],
  );
});
