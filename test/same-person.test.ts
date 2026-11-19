// 같은 사람의 작업끼리도 브랜치가 다르면 남의 작업처럼 부딪힘을 본다(ADR-0041). 같은 작업(같은 사람, 같은 브랜치)만 건너뛴다.
// owner 한 사람이 러너 하나로 같은 레포의 워크트리 둘(payment, refund)을 돌린다.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { type Alert, api, type ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;

const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;
const MONEY = `export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { refund } from "./money";
export const total = refund(2);
`;

const PAYMENT = { login: "owner", name: "owner", branch: "payment" };
const REFUND = { login: "owner", name: "owner", branch: "refund" };

/** 기준 커밋을 두고 owner가 main 폴더에서 payment를, 연결된 워크트리에서 refund를 시작한다. refund 폴더를 돌려준다. */
async function twoBranches(world: World) {
  const write = writer(world.repo.folder);
  await write("src/pay.ts", text(BASE));
  await write("src/money.ts", MONEY);
  await write("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await world.repo.git("switch", "--create", "payment");
  const tree = await world.worktree("refund");
  await eventually(async () => {
    const branches = (await world.works(world.owner)).map((w) => `${w.login}/${w.branch}`);
    assert.ok(branches.includes("owner/payment") && branches.includes("owner/refund"));
  });
  return tree;
}

/** `kind` 알림 가운데 아직 풀리지 않은 것. */
async function open(world: World, kind: Alert["kind"]) {
  const { posts } = await call(world.owner, api.posts);
  return posts.flatMap(({ message: m, channel }) =>
    m.kind === "alert" && m.alert.kind === kind && !m.alert.resolved
      ? [{ ...m.alert, channel }]
      : [],
  );
}

/** 훅을 `cwd`에서 돌리고 넣은 글을 돌려준다. 넣지 않았으면 "". */
async function runHook(world: World, cwd: string, input: object) {
  const { code, stdout, stderr } = await world.hook(JSON.stringify({ cwd, ...input }), { cwd });
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  return stdout === "" ? "" : (JSON.parse(stdout).hookSpecificOutput.additionalContext as string);
}

/** `cwd`의 작업 세션이 `path`를 고치기 직전의 편집 전 훅. 처음 보는 세션이라 늘 지금 근처 작업을 넣는다. */
const preEdit = (world: World, cwd: string, path: string) =>
  runHook(world, cwd, {
    session_id: crypto.randomUUID(),
    transcript_path: join(cwd, "transcript.jsonl"),
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(cwd, path), old_string: "a", new_string: "b" },
  });

/** `cwd`에서 시작한 작업 세션의 세션 시작 훅. */
const sessionStart = (world: World, cwd: string) =>
  runHook(world, cwd, {
    session_id: crypto.randomUUID(),
    transcript_path: join(cwd, "transcript.jsonl"),
    hook_event_name: "SessionStart",
    source: "startup",
  });

/** 넣은 글에서 `tag`로 감싼 줄들의 작업(멤버 · 브랜치)만. */
const worksIn = (context: string, tag: string) =>
  (context.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0]?.split("\n") ?? []).map((line) =>
    line.split(" · ").slice(0, 2).join(" · "),
  );

test("한 사람의 두 브랜치가 같은 곳을 고치면 직접 충돌 알림과 포스트가 서고, 두 훅에 내 다른 브랜치만 근처 작업으로 들어간다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const refund = await twoBranches(world);

  // payment만 고친 파일에는 근처 작업이 없다(같은 작업).
  await writer(world.repo.folder)("src/only.ts", "only\n");
  await writer(world.repo.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "payment")));
  await writer(refund)("src/pay.ts", text(BASE.toSpliced(2, 1, "refund")));

  const alert = await eventually(async () => {
    const found = await open(world, "direct");
    assert.equal(found.length, 1, JSON.stringify(found));
    return found[0] as Extract<Alert, { kind: "direct" }> & { channel: string };
  });
  assert.deepEqual(alert.works, [PAYMENT, REFUND]);
  assert.deepEqual(
    alert.files.map((f) => f.path),
    ["src/pay.ts"],
  );
  // 알림 하나가 포스트 하나다.
  assert.ok(alert.channel);

  // 편집 전 훅: 내 다른 브랜치가 근처 작업으로 들어가고, 내가 고치는 브랜치는 들어가지 않는다.
  await eventually(async () =>
    assert.deepEqual(
      worksIn(await preEdit(world, world.repo.folder, "src/pay.ts"), "omagari-nearby"),
      [`- owner · branch "refund"`],
    ),
  );
  assert.deepEqual(worksIn(await preEdit(world, refund, "src/pay.ts"), "omagari-nearby"), [
    `- owner · branch "payment"`,
  ]);
  assert.deepEqual(
    worksIn(await preEdit(world, world.repo.folder, "src/only.ts"), "omagari-nearby"),
    [],
  );

  // 세션 시작 훅: 브랜치마다 다른 쪽만 보인다.
  assert.deepEqual(worksIn(await sessionStart(world, world.repo.folder), "omagari-situation"), [
    `- owner · branch "refund"`,
  ]);
  assert.deepEqual(worksIn(await sessionStart(world, refund), "omagari-situation"), [
    `- owner · branch "payment"`,
  ]);
});

test("한 사람의 두 브랜치 사이에도 간접 충돌(추정)과 중복 구현 알림이 선다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const refund = await twoBranches(world);

  // payment가 refund의 정의 줄을 바꾼다. refund 브랜치의 checkout은 그것을 쓴다. 두 브랜치가 같은 이름의 새 함수를 만든다.
  await writer(world.repo.folder)(
    "src/money.ts",
    MONEY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );
  await writer(world.repo.folder)("src/a.ts", "export function audit() {}\n");
  await writer(refund)("src/b.ts", "export function audit() {}\n");

  await eventually(async () => {
    const [indirect] = await open(world, "indirect");
    assert.ok(indirect && indirect.kind !== "direct", "간접 충돌이 아직 없다");
    assert.deepEqual(indirect.works, [PAYMENT, REFUND]);
    assert.deepEqual(
      indirect.symbols.map((s) => s.name),
      ["refund"],
    );
  });
  await eventually(async () => {
    const [duplicate] = await open(world, "duplicate");
    assert.ok(duplicate && duplicate.kind !== "direct", "중복 구현이 아직 없다");
    assert.deepEqual(duplicate.works, [PAYMENT, REFUND]);
    assert.deepEqual(
      duplicate.symbols.map((s) => s.name),
      ["audit"],
    );
  });
});

test("한 사람의 두 작업 사이의 부딪힘에도 토론이 열려 양쪽이 각 브랜치의 작업 세션을 갈라 입장을 내고, 대행은 부를 수 없다", async (t) => {
  const owner = fakeExecutor(({ folder }) =>
    JSON.stringify({ claim: `${folder}의 안`, evidence: ["src/money.ts:1 refund의 정의"] }),
  );
  owner.executor.recent = async (_folder, branch) => `work-${branch}`;
  // 한 라운드로 줄여, 두 입장이 공개된 뒤 반박 라운드가 시작되지 않게 한다.
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    debateRounds: 1,
    executor: owner.executor,
  });
  t.after(world.stop);
  await twoBranches(world);

  // payment가 refund의 시그니처를 바꾸겠다고 선언한다. refund 브랜치의 checkout이 그것을 쓴다(payment 자신의 쓰임은 같은 작업이라 빠진다).
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

  const post = await eventually(async () => {
    const found = (await call(world.owner, api.posts)).posts.find(
      (p) => p.message.kind === "alert" && p.message.alert.kind === "declared",
    );
    assert.ok(found?.debate?.revealed, JSON.stringify(found?.debate));
    return found;
  });
  const debate = post.debate;
  assert.ok(debate);
  assert.deepEqual(
    debate.seats.map((s) => [s.login, s.branch, s.state]),
    [
      ["owner", "payment", "submitted"],
      ["owner", "refund", "submitted"],
    ],
  );
  assert.equal(debate.options.length, 2);
  // 같은 러너가 브랜치마다 그 브랜치의 작업 세션을 갈라 띄웠다.
  assert.deepEqual(owner.calls.map((c) => [c.resume, c.fork]).sort(), [
    ["work-payment", true],
    ["work-refund", true],
  ]);

  // 주인이 늘 있으니 다른 멤버도 주인도 대행을 부를 수 없다.
  world.github.grant("alice");
  const alice = await world.login("alice");
  for (const as of [alice, world.owner]) {
    await assert.rejects(call(as, api.proxyDebate, { post: post.channel, seat: 0 }), (error) => {
      assert.equal((error as ContractFailure).code, "conflict");
      return true;
    });
  }
});

test("omagari impact가 내 다른 브랜치의 작업은 보이고 같은 브랜치의 내 작업은 보이지 않는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const refund = await twoBranches(world);

  // payment가 refund 함수의 정의 줄을 바꾼다.
  await writer(world.repo.folder)(
    "src/money.ts",
    MONEY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );
  const works = (stdout: string) =>
    stdout
      .split("Other members' Work that is changing the definition line:\n")[1]
      ?.split("Other members' Claims")[0];
  await eventually(async () => {
    const mine = await world.cliIn(refund, "impact", "refund");
    assert.equal(mine.code, 0, mine.stderr);
    assert.match(works(mine.stdout) ?? "", /^ {2}owner · "payment" · "src\/money.ts":1 /);
  });
  // 같은 브랜치(payment)에서 묻으면 내 작업은 빠진다.
  const own = await world.cliIn(world.repo.folder, "impact", "refund");
  assert.equal(own.code, 0, own.stderr);
  assert.equal(works(own.stdout), "  none\n");
});
