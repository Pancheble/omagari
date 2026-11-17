import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { type Alert, api, call } from "@omagari/contract";
import type { Sandbox } from "@omagari/runner";
import { eventually, fakeSandbox, place, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };
type Indirect = Exclude<Alert, { kind: "direct" }>;

/** owner의 새 파일과 bob의 currency가 함께 있을 때만 깨지는 검사 명령. 따로 돌리면 둘 다 통과한다. */
const CHECK2 =
  "if [ -e src/draft.ts ] && grep -q currency src/pay.ts; then echo 깨졌다; exit 1; fi";

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

/** 간접 충돌(추정) 알림들을 두 작업의 상대 멤버로 찾는다. */
async function indirect(as: As) {
  const messages = (await call(as, api.posts)).posts.map((p) => p.message);
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
  }, 30_000);

/** `login`과의 간접 충돌 알림이 합쳐 돌려 보니 통과해 풀림으로 닫힐 때까지 기다린다. 통과한 검사 명령이 남는다. */
const closedWith = (as: As, login: string) =>
  eventually(async () => {
    const found = (await indirect(as)).filter(
      (a) => a.works.some((w) => w.login === login) && a.works.some((w) => w.login === "owner"),
    );
    const last = found.at(-1);
    assert.ok(last && last.resolved !== null, JSON.stringify(found));
    assert.equal(last.run?.verdict, "pass");
    assert.equal(last.run?.check, "sh check.sh");
    return last;
  }, 30_000);

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
  timeout: 150_000,
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
  // 검사 명령: 합친 폴더의 src를 적고, 문이 열릴 때까지 기다렸다가, pay에 currency가 생겼는데 owner의 새 파일이 pay(1)로 부르면 깨진다.
  // 그래서 bob의 작업만, owner의 작업만 돌리면 통과한다(ADR-0035의 깨짐).
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": `ls src
while [ ! -e ${gate} ]; do sleep 0.05; done
if grep -q currency src/pay.ts && grep -qs "pay(1)" src/draft.ts; then echo "pay(1)에 currency가 빠졌다"; exit 1; fi
`,
  });
  // owner는 pay와 refund를 쓴다. 푸시하지 않은 커밋과 커밋하지 않은 새 파일이 있다.
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  await writer(folder)("src/committed.ts", "export const a = 1;\n");
  await git("add", ".");
  await git("commit", "--message=푸시하지 않은 커밋");
  const DRAFT = `import { pay } from "./pay";\npay(1);\n`;
  await writer(folder)("src/draft.ts", DRAFT);
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
  // "돌려 보는 중"은 임시 워크트리를 마련하기 전에 올라가니, 샌드박스에 닿을 때까지 기다린 뒤 하나만 도는지 본다.
  await eventually(() => assert.equal(fake.calls.length, 1));
  await sleep(QUIET_MS * 2);
  assert.equal(fake.calls.length, 1);
  assert.equal((await indirect(world.owner)).filter((a) => a.run).length, 1);

  // 문을 열면 판정이 난다. bob과의 쌍은 깨지고 따로 돌리면 둘 다 통과해 확인됨이고 출력의 끝부분이 실린다. carol과의 쌍은 통과해 닫힌다.
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
  assert.equal(broken.run?.alone, undefined);
  const passed = await closedWith(world.owner, "carol");
  assert.equal(passed.confirmed, false);
  // 합친 것 둘에, 깨진 쪽만 따로 둘을 더 돌렸다.
  assert.equal(fake.calls.length, 4);

  // 판정이 바뀌면 두 작업의 편지함에 다시 들어가 CLI 응답으로 넘어간다.
  // 깨짐은 알림 줄 끝에 판정과 출력의 끝을 싣는다. 출력은 JSON 문자열이라 줄바꿈이 \n으로 남는다.
  // 편지함은 한 번 넘기면 비워지므로, 판정이 든 줄을 넘겨받는 같은 확인에서 본다.
  await eventually(async () => {
    const line = inboxLines((await world.cliIn(folder, "status")).stdout).find((l) =>
      l.startsWith(OWNER_SEES),
    );
    assert.ok(line, "깨짐 판정이 든 소식이 오지 않았다");
    assert.match(
      line,
      /· 합쳐 돌려 본 판정: 깨짐\(돌린 멤버 owner, 검사 명령 "sh check\.sh", \d+초\)\. 출력 끝: "bob\.ts\\ncommitted\.ts\\ndraft\.ts\\npay\.ts\\nuse\.ts\\npay\(1\)에 currency가 빠졌다"$/,
    );
  });
  await receives(world, bob.desk.folder, BOB_SEES);

  // 같은 내용이면 다시 돌리지 않는다.
  await sleep(QUIET_MS * 2);
  assert.equal(fake.calls.length, 4);

  // bob의 러너가 꺼져도 서버에 남은 관측으로 돈다. owner가 고치면 지난 판정은 지난 결과가 되고, 잠잠해지면 다시 돌려 통과다.
  await bob.desk.stop();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "bob" && w.offlineSince)),
  );
  // 다시 돌리는 동안 문을 닫아, 지난 결과인 알림이 통과로 바로 닫히기 전에 볼 수 있게 한다(#153).
  await rm(gate);
  await writer(folder)("src/draft.ts", DRAFT.replace("pay(1);", 'pay(1, "krw");'));
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "broken");
    assert.equal(a.run?.stale, true);
    assert.equal(a.confirmed, true);
  });
  await writeFile(gate, "");
  const fixed = await closedWith(world.owner, "bob");
  assert.equal(fixed.run?.stale, false);
  assert.equal(fixed.confirmed, false);
  // owner가 고쳐 carol의 쌍도 새 지문으로 다시 돈다. 러너는 한 번에 하나만 돌려 bob의 판정이 난 뒤에 돌 수 있다.
  // bob의 통과만 기다리면 carol의 새 판정이 서버에 닿기 전에 지표를 읽는다(#135). 통과해 닫힌 carol의 알림이 새 지문의 판정을 보일 때까지 기다린다.
  await eventually(async () => {
    const found = (await indirect(world.owner)).filter(
      (a) => a.works.some((w) => w.login === "carol") && a.works.some((w) => w.login === "owner"),
    );
    const last = found.at(-1);
    assert.equal(last?.run?.verdict, "pass", JSON.stringify(found));
    assert.notEqual(last?.run?.fingerprint, passed.run?.fingerprint);
  }, 30_000);

  // 합쳐 돌린 것이 실행 기록에 남는다: 두 작업, 검사 명령, 판정.
  const log = (await world.cli("runner", "log")).stdout;
  assert.match(
    log,
    /검사 명령 "sh check\.sh" {2}합쳐 돌려 보기 payment \+ bob의 currency {2}폴더 .+ {2}판정 깨짐 /,
  );
  assert.match(log, /합쳐 돌려 보기 payment \+ carol의 reason {2}폴더 .+ {2}판정 통과 /);
  assert.match(log, /합쳐 돌려 보기 payment \+ bob의 currency {2}폴더 .+ {2}판정 통과 /);

  // 지표: 오늘 돌려 본 것은 넷이다. bob의 깨짐, carol의 통과, owner가 고친 뒤 다시 돌린 carol과 bob의 통과. 돌려 보는 중과 다시 올린 것(같은 지문)은 세지 않는다.
  await world.signInCli(world.owner);
  const shown = await world.cli("metrics", "--days", "1");
  assert.equal(shown.code, 0, shown.stderr);
  const [header, today] = shown.stdout.trimEnd().split("\n");
  assert.equal(
    header,
    "날짜(Asia/Seoul)  들어온 멤버  문답  돌려 봄  통과  깨짐  가릴 수 없음  돌리지 못함",
  );
  assert.match(today ?? "", /^\d{4}-\d{2}-\d{2} {2}\d+ {2}\d+ {2}4 {2}3 {2}1 {2}0 {2}0$/);
});

test("검사 명령이 없거나 샌드박스를 쓸 수 없거나 줄이 부딪히면 돌리지 못함과 까닭이 붙고, 빠진 파일은 빼고 돌려 적으며, 공유 수준이 full이 아니면 출력을 올리지 않는다", {
  timeout: 150_000,
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
    ".omagari.json": `${JSON.stringify({ check: CHECK2 })}\n`,
  });
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.equal(a.run?.reason, "샌드박스 도구가 없다: bubblewrap");
    assert.equal(a.run?.check, CHECK2);
  });
  assert.equal(fake.calls.length, 0);

  // 상대의 내용이 빠진 파일(바이너리)은 그 파일 없이 돌리고 적는다. 이런 판정은 깨져도 확인됨이 아니다. owner는 declared라 출력을 올리지 않는다.
  fake.unavailable = undefined;
  await writer(bob.desk.folder)("logo.bin", Buffer.from([0, 1, 2, 0]));
  const broken = await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "broken");
    assert.deepEqual(a.run?.omitted, ["logo.bin"]);
  });
  assert.equal(broken.confirmed, false);
  assert.equal(broken.run?.output, undefined);
  assert.equal(fake.calls.length, 3);

  // 빠진 파일이 있으면 통과해도 닫지 않는다.
  await rm(join(world.repo.folder, "src/draft.ts"));
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "pass");
    assert.equal(a.run?.stale, false);
  });
  assert.equal(fake.calls.length, 4);

  // 두 작업이 같은 줄을 바꿔 합쳐지지 않으면 돌리지 못함이고 까닭이 붙는다.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: string)"),
  );
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.equal(a.run?.reason, "줄이 부딪혀 합쳐지지 않는다: src/pay.ts");
  });
  assert.equal(fake.calls.length, 4);
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
    const messages = (await call(world.owner, api.posts)).posts.map((p) => p.message);
    assert.ok(messages.some((m) => m.kind === "alert" && m.alert.kind === "direct"));
  });
  await sleep(1500);
  assert.equal((await alertWith(world.owner, "bob")).run, undefined);
  assert.equal(fake.calls.length, 0);
  assert.equal(bobSandbox.calls.length, 0);
});

/** 멤버 목록에서 `login`의 `branch` 작업에 "합치면 깨짐" 표시가 붙었는지. */
async function brokenMark(world: World, login: string, branch: string) {
  const { members } = await call(world.owner, api.members);
  return members.find((m) => m.login === login)?.works.find((w) => w.branch === branch)?.broken;
}

test("합친 것이 깨지면 두 작업을 따로 돌려 가린다: 둘 다 통과할 때만 확인됨이고, 통과하면 알림을 닫고 다시 돌린 판정이 나올 때까지 세우지 않는다", {
  timeout: 240_000,
}, async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
  });
  t.after(world.stop);
  fake.blocksUnixSockets = true; // Linux처럼
  const hold = (await place(t))("hold");
  // 합친 것은 bob의 currency와 owner의 pay(1)이 함께 있으면 깨진다. 표시 파일이 있는 쪽은 혼자서도 깨진다. `hold`가 있는 동안은 기다린다.
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": `while [ -e ${hold} ]; do sleep 0.05; done
if [ -e src/owner-oops ]; then echo "Error: listen EPERM: operation not permitted /tmp/x.sock"; exit 1; fi
if [ -e src/bob-oops ]; then echo 혼자서도 깨진다; exit 1; fi
if grep -q currency src/pay.ts && grep -qs "pay(1)" src/draft.ts; then echo 합치면 깨진다; exit 1; fi
`,
  });
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  const DRAFT = `import { pay } from "./pay";\npay(1);\n`;
  const write = writer(folder);
  await write("src/draft.ts", DRAFT);
  await write("src/owner-oops", "");
  const bob = await member(world, "bob", "currency");
  t.after(bob.desk.remove);
  const bobWrite = writer(bob.desk.folder);
  await bobWrite(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );

  // owner의 작업이 혼자서도 깨진다: 가릴 수 없음이고 추정으로 남는다.
  const mine = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "unclear"));
  assert.deepEqual(mine.run?.alone, ["mine"]);
  assert.equal(mine.confirmed, false);
  assert.equal(fake.calls.length, 3);
  // 소켓 막기로 깨졌으므로 까닭이 붙는다(#163). 소켓과 상관없이 깨진 bob의 것에는 붙지 않는다.
  assert.match(mine.run?.reason ?? "", /이 기기\(Linux\)에서는 샌드박스가 유닉스 소켓을 막는다/);

  // bob의 작업이 혼자서도 깨진다: 가릴 수 없음이고 그쪽이 적힌다.
  await rm(join(folder, "src/owner-oops"));
  await bobWrite("src/bob-oops", "");
  const theirs = await alertWith(world.owner, "bob", (a) =>
    assert.deepEqual(a.run?.alone, ["theirs"]),
  );
  assert.equal(theirs.run?.verdict, "unclear");
  assert.equal(theirs.run?.reason, undefined);
  assert.equal(theirs.confirmed, false);
  assert.equal(fake.calls.length, 6);
  assert.equal(await brokenMark(world, "owner", "payment"), false);
  // 추정인 동안 포스트는 종류 라벨만 붙은 참고라 "참고" 포럼에 보이고 이슈가 없다.
  const forums = Object.fromEntries(
    (await call(world.owner, api.channels)).channels.map((c) => [c.name, c.id]),
  );
  const guessed = (await call(world.owner, api.posts)).posts[0];
  assert.deepEqual(guessed?.labels, ["간접 충돌"]);
  assert.equal(guessed?.importance, "reference");
  assert.deepEqual(guessed?.forums, [forums.참고]);
  assert.equal(guessed?.issue, null);
  assert.equal(world.github.issues.length, 0);

  // bob이 고치면 둘 다 혼자서는 통과해 깨짐이고 확인됨이다. 두 작업 모두 앞에서 혼자 돌린 내용과 같아(owner는 바로 앞, bob은 처음) 따로 돌리지 않는다.
  await rm(join(bob.desk.folder, "src/bob-oops"));
  const broken = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "broken"));
  assert.equal(broken.confirmed, true);
  assert.equal(broken.run?.alone, undefined);
  assert.equal(fake.calls.length, 7);
  // 확인됨이 붙어 논의가 되면 포스트의 라벨을 단 이슈가 열리고 판정 댓글 하나가 달린다. 같은 판정이 거듭 와도 늘지 않고, 댓글은 포스트의 글로 들어오지 않는다.
  const issue = await eventually(() => {
    const [opened] = world.github.issues;
    assert.ok(opened);
    assert.deepEqual(opened.labels, ["간접 충돌", "확인됨"]);
    assert.equal(opened.comments.length, 1);
    return opened;
  });
  assert.match(issue.comments[0]?.body ?? "", /깨졌어요/);
  assert.match(issue.comments[0]?.body ?? "", /`sh check\.sh`/);
  assert.match(issue.comments[0]?.body ?? "", /```\n합치면 깨진다\n```/);
  await sleep(300);
  assert.equal(issue.comments.length, 1);
  const [post] = (await call(world.owner, api.posts)).posts;
  assert.ok(post?.issue?.labels.includes("확인됨"));
  assert.deepEqual(post?.labels, ["간접 충돌", "확인됨"]);
  assert.equal(post?.importance, "discuss");
  // 논의가 되면 "참고" 포럼에서 빠지고 "논의" 포럼에 보인다(ADR-0039).
  assert.deepEqual(post?.forums, [forums.논의]);
  const thread = await call(world.owner, api.history, { channel: post?.message.channel ?? "" });
  assert.ok(!thread.messages.some((m) => "github" in m && m.github));
  // 깨짐인 두 작업에 멤버 목록의 표시가 붙는다.
  await eventually(async () => {
    assert.equal(await brokenMark(world, "owner", "payment"), true);
    assert.equal(await brokenMark(world, "bob", "currency"), true);
  });

  // owner가 고치면 합친 것이 통과하고 따로 돌리지 않는다. 알림은 풀림으로 닫히고 두 편지함에 들어가며, 표시가 사라진다.
  await write("src/draft.ts", DRAFT.replace("pay(1);", 'pay(1, "krw");'));
  await closedWith(world.owner, "bob");
  assert.equal(fake.calls.length, 8);
  // 통과로 닫히면 라벨이 떼어지고 이슈가 닫히며 통과한 검사 명령이 댓글에 남는다.
  await eventually(() => {
    assert.ok(!issue.labels.includes("확인됨"));
    assert.equal(issue.open, false);
    assert.equal(issue.comments.length, 2);
  });
  assert.match(issue.comments[1]?.body ?? "", /통과했어요[\s\S]*`sh check\.sh`/);
  // 새 알림을 만들지 않고 그 알림을 닫았다.
  const withBob = async () =>
    (await indirect(world.owner)).filter((a) => a.works.some((w) => w.login === "bob")).length;
  assert.equal(await withBob(), 1);
  await receives(world, folder, `- 풀렸다: 내 작업과 bob의 브랜치 "currency"`);
  await receives(world, bob.desk.folder, `- 풀렸다: 내 작업과 owner의 브랜치 "payment"`);
  await eventually(async () => {
    assert.equal(await brokenMark(world, "owner", "payment"), false);
    assert.equal(await brokenMark(world, "bob", "currency"), false);
  });
  // 내용이 그대로인 동안에는 다시 서지 않는다.
  await sleep(QUIET_MS * 2);
  const open = async () => (await indirect(world.owner)).filter((a) => a.resolved === null);
  assert.deepEqual(await open(), []);

  // 내용이 바뀌어도 다시 돌린 판정이 나올 때까지 서지 않는다. 다시 돌려 깨지면 확인된 새 알림이 선다.
  await writeFile(hold, "");
  await write("src/draft.ts", `${DRAFT}pay(2);\n`);
  await eventually(() => assert.equal(fake.calls.length, 9), 30_000);
  await sleep(QUIET_MS);
  assert.deepEqual(await open(), []);
  await rm(hold);
  const again = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "broken"));
  assert.equal(await withBob(), 2);
  assert.equal(again.confirmed, true);
  // owner만 한 번 더 돌렸다. bob만 돌린 것은 앞에서 같은 내용으로 돌렸다.
  assert.equal(fake.calls.length, 10);
  const reopened = await eventually(() => {
    const opened = world.github.issues[1];
    assert.ok(opened?.labels.includes("확인됨"));
    return opened;
  });

  // 확인이 풀려(가릴 수 없음) 참고로 내려가도 알림이 남아 있으면 이슈는 닫지 않는다. 확인됨은 포스트와 이슈에서 뗀다.
  await write("src/owner-oops", "");
  await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "unclear"));
  await eventually(async () => {
    const now = (await call(world.owner, api.posts)).posts.at(-1);
    assert.deepEqual(now?.labels, ["간접 충돌"]);
    assert.equal(now?.importance, "reference");
    assert.ok(!reopened.labels.includes("확인됨"));
  });
  assert.equal(reopened.open, true);
  await rm(join(folder, "src/owner-oops"));

  // 다시 통과해 닫힌 뒤 가릴 수 없음이 나면 추정인 새 알림이 선다. 둘 다 앞에서 돌린 내용이라 지난 판정을 다시 쓴다.
  await write("src/draft.ts", DRAFT.replace("pay(1);", 'pay(1, "krw");'));
  await closedWith(world.owner, "bob");
  await write("src/draft.ts", DRAFT);
  await write("src/owner-oops", "");
  const unclear = await alertWith(world.owner, "bob", (a) =>
    assert.equal(a.run?.verdict, "unclear"),
  );
  assert.equal(await withBob(), 3);
  assert.equal(unclear.confirmed, false);

  // 지표: 지문이 다른 판정만 센다. 통과 하나, 깨짐 둘, 가릴 수 없음 셋. 앞에서 돌린 내용의 판정을 다시 쓴 것은 세지 않는다.
  await world.signInCli(world.owner);
  const shown = await world.cli("metrics", "--days", "1");
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(
    shown.stdout.trimEnd().split("\n")[1] ?? "",
    /^\d{4}-\d{2}-\d{2} {2}\d+ {2}\d+ {2}6 {2}1 {2}2 {2}3 {2}0$/,
  );
});

test("다른 러너가 올린 같은 내용의 판정이 서버에 있으면 돌리지 않는다", {
  timeout: 120_000,
}, async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": "exit 0\n",
  });
  // bob이 pay를 쓰는 쪽이라 bob의 러너가 돌린다. owner가 pay의 정의 줄을 바꾼다.
  const fake = fakeSandbox();
  const bob = await member(world, "bob", "more", { sandbox: fake.sandbox, quietMs: QUIET_MS });
  t.after(bob.desk.remove);
  await writer(bob.desk.folder)("src/draft.ts", `import { pay } from "./pay";\npay(1);\n`);
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );
  await closedWith(world.owner, "bob");
  assert.equal(fake.calls.length, 1);

  // bob의 러너를 다시 켜면 기억은 없지만, 서버에 붙은 같은 지문의 판정을 받아 다시 돌리지 않는다.
  await bob.desk.stop();
  await bob.desk.start();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "bob" && !w.offlineSince)),
  );
  await sleep(QUIET_MS * 4);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(
    (await indirect(world.owner)).filter((a) => a.resolved === null),
    [],
  );
});
