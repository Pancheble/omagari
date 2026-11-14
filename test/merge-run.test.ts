import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { type Alert, api, call } from "@omagari/contract";
import type { Sandbox } from "@omagari/runner";
import { eventually, fakeSandbox, place, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };
type Indirect = Exclude<Alert, { kind: "direct" }>;

/** 잠잠해지기를 기다리는 시간. 테스트에서는 줄여 본다. */
const QUIET_MS = 600;

const PAY = `export function pay(amount: number) {
  return amount;
}

export function refund(amount: number) {
  return -amount;
}
`;
const USE = `import { pay, refund } from "./pay";
pay(1);
refund(1);
`;

/**
 * 기본 브랜치(origin/main)에 파일들을 머지한 것처럼 둔다. 지금 브랜치와 작업 폴더는 건드리지 않는다(관측이 흔들리지 않게).
 * 테스트의 준비라 Git을 직접 부른다.
 */
function mergeToMain(folder: string, files: Record<string, string>) {
  const env = {
    ...process.env,
    GIT_INDEX_FILE: `${folder}/.git/main-index`,
    GIT_AUTHOR_NAME: "Omagari Test",
    GIT_AUTHOR_EMAIL: "test@omagari.invalid",
    GIT_COMMITTER_NAME: "Omagari Test",
    GIT_COMMITTER_EMAIL: "test@omagari.invalid",
  };
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", folder, ...args], { env, input, encoding: "utf8" }).trim();
  git(["read-tree", "refs/remotes/origin/main"]);
  for (const [path, content] of Object.entries(files)) {
    const blob = git(["hash-object", "-w", "--stdin"], content);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
  }
  const commit = git(
    ["commit-tree", git(["write-tree"]), "-p", "refs/remotes/origin/main"],
    "merged",
  );
  git(["update-ref", "refs/remotes/origin/main", commit]);
}

/** 기준 커밋에 `files`를 두고 origin/main을 올린다. 멤버들이 같은 판에서 시작한다. */
async function base(world: World, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files))
    await writer(world.repo.folder)(path, content);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** 멤버 `login`의 기기: 같은 레포의 다른 클론에서 `branch`를 시작한다. 받는 동안은 러너를 꺼 둔다. */
async function member(
  world: World,
  login: string,
  branch: string,
  extra: { sandbox?: Sandbox; quietMs?: number; mergeCheck?: "on" | "off" } = {},
) {
  world.github.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, undefined, undefined, extra);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  await desk.start();
  return { as, desk };
}

/** 포럼 "부딪힘"의 간접 충돌(추정) 알림들을 두 작업의 상대 멤버로 찾는다. */
async function indirect(as: As) {
  const channel = (await call(as, api.channels)).channels.find((c) => c.name === "부딪힘");
  if (!channel) return [];
  const { messages } = await call(as, api.history, { channel: channel.id });
  return messages.flatMap((m) =>
    m.kind === "alert" && m.alert.kind === "indirect" ? [m.alert as Indirect] : [],
  );
}

/** `login`과의 간접 충돌 알림 하나가 `check`를 지날 때까지 기다린다. */
const alertWith = (as: As, login: string, check: (alert: Indirect) => void = () => {}) =>
  eventually(async () => {
    const found = (await indirect(as)).filter(
      (a) =>
        a.resolved === null &&
        a.works.some((w) => w.login === login) &&
        a.works.some((w) => w.login === "owner"),
    );
    assert.equal(found.length, 1, JSON.stringify(found));
    const [alert] = found as [Indirect];
    check(alert);
    return alert;
  }, 15_000);

/** 넣은 글(CLI의 응답)에서 편지함의 소식 줄만. */
const inboxLines = (output: string) =>
  output.split("<omagari-inbox>\n")[1]?.split("\n</omagari-inbox>")[0]?.split("\n") ?? [];

/** `cwd`에서 `omagari status`를 거듭 돌려 편지함에 `prefix`로 시작하는 줄이 넘겨질 때까지 기다린다. */
async function receives(world: World, cwd: string, prefix: string) {
  await eventually(async () => {
    const lines = inboxLines((await world.cliIn(cwd, "status")).stdout);
    assert.ok(
      lines.some((line) => line.startsWith(prefix)),
      JSON.stringify(lines),
    );
  });
}

test("간접 충돌(추정)이 걸린 쌍이 잠잠해지면 쓰는 쪽 러너가 두 작업을 합쳐 검사 명령을 돌리고, 판정이 알림과 두 편지함에 붙는다", {
  timeout: 90_000,
}, async (t) => {
  const fake = fakeSandbox();
  // 문이 열리지 않은 채 실패해도 오래 걸리지 않게 검사 명령의 상한을 줄인다.
  const world = await startWorld({
    observeMs: 50,
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
    checkLimits: { checkMs: 20_000 },
  });
  t.after(world.stop);
  const gate = (await place(t))("gate");
  // 검사 명령: 합친 폴더의 src를 적고, 문이 열릴 때까지 기다렸다가, pay에 currency가 생겼는데 pay(1)로 부르면 깨진다.
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": `ls src
while [ ! -e ${gate} ]; do sleep 0.05; done
if grep -q currency src/pay.ts && grep -q "pay(1)" src/use.ts; then echo "pay(1)에 currency가 빠졌다"; exit 1; fi
`,
  });
  // owner는 pay와 refund를 쓴다. 푸시하지 않은 커밋과 커밋하지 않은 새 파일이 있다.
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  await writer(folder)("src/committed.ts", "export const a = 1;\n");
  await git("add", ".");
  await git("commit", "--message=푸시하지 않은 커밋");
  await writer(folder)("src/draft.ts", "export const b = 1;\n");
  // bob은 pay의, carol은 refund의 정의 줄을 커밋하지 않고 바꾼다. 둘의 러너는 잠잠한 시간이 길어(기본 2분) 이 테스트에서 돌리지 않는다.
  const bob = await member(world, "bob", "currency");
  t.after(bob.desk.remove);
  const carol = await member(world, "carol", "reason");
  t.after(carol.desk.remove);
  await writer(bob.desk.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );
  await writer(bob.desk.folder)("src/bob.ts", "export const bob = 1;\n");
  await writer(carol.desk.folder)(
    "src/pay.ts",
    PAY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );

  // 알림이 막 섰을 때는 아직 잠잠하지 않아 돌리지 않았다.
  const fresh = await alertWith(world.owner, "bob");
  assert.equal(fresh.run, undefined);
  assert.equal(fake.calls.length, 0);
  await alertWith(world.owner, "carol");
  // 알림이 처음 들어간 것은 넘겨 둔다. 판정이 나면 다시 들어오는지 본다.
  const OWNER_SEES = `- 간접 충돌(추정): 내 작업과 bob의 브랜치 "currency"`;
  const BOB_SEES = `- 간접 충돌(추정): 내 작업과 owner의 브랜치 "payment"`;
  await receives(world, folder, OWNER_SEES);
  await receives(world, bob.desk.folder, BOB_SEES);

  // 잠잠해지면 한 쌍을 돌린다. 도는 동안은 "돌려 보는 중"이고, 러너는 한 번에 하나만 돌린다.
  const first = await eventually(async () => {
    const runs = (await indirect(world.owner)).flatMap((a) =>
      a.run && a.works.some((w) => w.login === "owner") ? [a] : [],
    );
    assert.equal(runs.length, 1);
    return runs[0] as Indirect;
  });
  assert.equal(first.run?.verdict, "running", JSON.stringify(first.run));
  assert.equal(first.run?.check, "sh check.sh");
  assert.equal(first.run?.login, "owner");
  assert.equal(first.run?.stale, false);
  assert.equal(first.confirmed, false);
  await sleep(QUIET_MS * 2);
  assert.equal(fake.calls.length, 1);
  assert.equal((await indirect(world.owner)).filter((a) => a.run).length, 1);

  // 문을 열면 판정이 난다. bob과의 쌍은 깨져 확인됨이고 출력의 끝부분이 실린다. carol과의 쌍은 통과다.
  await writeFile(gate, "");
  const broken = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "broken"));
  assert.equal(broken.confirmed, true);
  assert.equal(broken.run?.stale, false);
  assert.deepEqual(broken.run?.omitted, []);
  assert.equal(typeof broken.run?.ms, "number");
  // 합친 것에는 bob의 커밋하지 않은 변경, owner의 푸시하지 않은 커밋과 커밋하지 않은 새 파일이 모두 있다.
  assert.match(
    broken.run?.output ?? "",
    /bob\.ts\ncommitted\.ts\ndraft\.ts\npay\.ts\nuse\.ts\npay\(1\)에 currency가 빠졌다$/,
  );
  const passed = await alertWith(world.owner, "carol", (a) => assert.equal(a.run?.verdict, "pass"));
  assert.equal(passed.confirmed, false);
  assert.equal(fake.calls.length, 2);

  // 판정이 바뀌면 두 작업의 편지함에 다시 들어가 CLI 응답으로 넘어간다.
  await receives(world, folder, OWNER_SEES);
  await receives(world, bob.desk.folder, BOB_SEES);

  // 같은 내용이면 다시 돌리지 않는다.
  await sleep(QUIET_MS * 2);
  assert.equal(fake.calls.length, 2);

  // bob의 러너가 꺼져도 서버에 남은 관측으로 돈다. owner가 고치면 지난 판정은 지난 결과가 되고, 잠잠해지면 다시 돌려 통과다.
  await bob.desk.stop();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "bob" && w.offlineSince)),
  );
  await writer(folder)("src/use.ts", USE.replace("pay(1);", 'pay(1, "krw");'));
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "broken");
    assert.equal(a.run?.stale, true);
    assert.equal(a.confirmed, true);
  });
  const fixed = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "pass"));
  assert.equal(fixed.run?.stale, false);
  assert.equal(fixed.confirmed, false);

  // 합쳐 돌린 것이 실행 기록에 남는다: 두 작업, 검사 명령, 판정.
  const log = (await world.cli("runner", "log")).stdout;
  assert.match(
    log,
    /검사 명령 "sh check\.sh" {2}합쳐 돌려 보기 payment \+ bob의 currency {2}폴더 .+ {2}판정 깨짐 /,
  );
  assert.match(log, /합쳐 돌려 보기 payment \+ carol의 reason {2}폴더 .+ {2}판정 통과 /);
  assert.match(log, /합쳐 돌려 보기 payment \+ bob의 currency {2}폴더 .+ {2}판정 통과 /);
});

test("검사 명령이 없거나 샌드박스를 쓸 수 없거나 줄이 부딪히면 돌리지 못함과 까닭이 붙고, 빠진 파일은 빼고 돌려 적으며, 공유 수준이 full이 아니면 출력을 올리지 않는다", {
  timeout: 90_000,
}, async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({
    observeMs: 50,
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
    share: "declared",
  });
  t.after(world.stop);
  await base(world, { "src/pay.ts": PAY, "src/use.ts": USE });
  const bob = await member(world, "bob", "currency");
  t.after(bob.desk.remove);
  await writer(bob.desk.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)("src/draft.ts", "export const b = 1;\n");

  // 기본 브랜치에 검사 명령이 없다.
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.match(a.run?.reason ?? "", /기본 브랜치\(origin\/main\)에 \.omagari\.json이 없다/);
  });

  // 검사 명령이 머지되면 다시 돈다. 샌드박스를 쓸 수 없으면 가두지 않고 돌리지 않는다.
  fake.unavailable = "샌드박스 도구가 없다: bubblewrap";
  mergeToMain(world.repo.folder, {
    ".omagari.json": `${JSON.stringify({ check: "echo 깨졌다; exit 1" })}\n`,
  });
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.equal(a.run?.reason, "샌드박스 도구가 없다: bubblewrap");
    assert.equal(a.run?.check, "echo 깨졌다; exit 1");
  });
  assert.equal(fake.calls.length, 0);

  // 상대의 내용이 빠진 파일(바이너리)은 그 파일 없이 돌리고 적는다. owner는 declared라 출력을 올리지 않는다.
  fake.unavailable = undefined;
  await writer(bob.desk.folder)("logo.bin", Buffer.from([0, 1, 2, 0]));
  const broken = await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "broken");
    assert.deepEqual(a.run?.omitted, ["logo.bin"]);
  });
  assert.equal(broken.run?.output, undefined);
  assert.equal(fake.calls.length, 1);

  // 두 작업이 같은 줄을 바꿔 합쳐지지 않으면 돌리지 못함이고 까닭이 붙는다.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: string)"),
  );
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.equal(a.run?.reason, "줄이 부딪혀 합쳐지지 않는다: src/pay.ts");
  });
  assert.equal(fake.calls.length, 1);
});

test("직접 충돌만 걸린 쌍과 정의를 바꾼 쪽은 돌리지 않고, 합쳐 돌려 보기를 꺼 둔 러너도 돌리지 않는다", {
  timeout: 60_000,
}, async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ observeMs: 50, sandbox: fake.sandbox, quietMs: 0 });
  t.after(world.stop);
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    "notes.txt": "a\nb\n",
    ".omagari.json": `${JSON.stringify({ check: "true" })}\n`,
  });
  // carol과 owner는 같은 줄을 바꿔 직접 충돌만 걸린다.
  const carol = await member(world, "carol", "notes");
  t.after(carol.desk.remove);
  await writer(carol.desk.folder)("notes.txt", "carol\nb\n");
  // bob은 pay를 쓰고 owner가 pay의 정의 줄을 바꾼다. 쓰는 쪽인 bob의 러너는 합쳐 돌려 보기를 꺼 뒀다.
  const bobSandbox = fakeSandbox();
  const bob = await member(world, "bob", "more", {
    sandbox: bobSandbox.sandbox,
    quietMs: 0,
    mergeCheck: "off",
  });
  t.after(bob.desk.remove);
  await writer(bob.desk.folder)("src/use.ts", `${USE}pay(2);\n`);
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)("notes.txt", "owner\nb\n");
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );

  await alertWith(world.owner, "bob");
  await eventually(async () => {
    const channel = (await call(world.owner, api.channels)).channels.find(
      (c) => c.name === "부딪힘",
    );
    assert.ok(channel);
    const { messages } = await call(world.owner, api.history, { channel: channel.id });
    assert.ok(messages.some((m) => m.kind === "alert" && m.alert.kind === "direct"));
  });
  await sleep(1500);
  assert.equal((await alertWith(world.owner, "bob")).run, undefined);
  assert.equal(fake.calls.length, 0);
  assert.equal(bobSandbox.calls.length, 0);
});
