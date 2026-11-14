import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeSandbox, startWorld, tempRepo, writer } from "./harness.ts";

/** 기본 브랜치(origin/main)에 파일들을 커밋해 머지된 것처럼 둔다. 지금 브랜치가 main이어야 한다. */
async function merge(
  repo: { folder: string; git: (...args: string[]) => Promise<string> },
  files: Record<string, string>,
) {
  const write = writer(repo.folder);
  for (const [path, content] of Object.entries(files)) await write(path, content);
  await repo.git("add", "--all");
  await repo.git("commit", "--message=merged");
  await repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

const config = (value: object) => `${JSON.stringify(value)}\n`;

test("omagari runner check가 내 작업을 커밋하지 않은 변경까지 임시 워크트리에 옮겨 기본 브랜치의 검사 명령을 샌드박스 안에서 돌리고, 실행 기록에 남긴다", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  const write = writer(repo.folder);
  process.env.GITHUB_TOKEN = "ghp_secret_for_check";
  process.env.OMAGARI_SECRET_KEY = "sk_secret_for_check";
  t.after(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.OMAGARI_SECRET_KEY;
  });

  await merge(repo, {
    ".omagari.json": config({ check: "sh check.sh" }),
    "check.sh": "test ! -e gone.txt\n",
    "gone.txt": "지울 파일\n",
  });
  await repo.git("switch", "--create", "feat");
  // 내 브랜치와 작업 폴더에서 설정 파일을 바꿔도 기본 브랜치의 명령이 돈다.
  await write(".omagari.json", config({ check: "exit 0" }));
  await repo.git("commit", "--all", "--message=내 브랜치의 설정");
  await write(".omagari.json", config({ check: "true" }));

  // 커밋하지 않은 지움과, 추적하지 않는 새 파일이 옮겨진다.
  await rm(join(repo.folder, "gone.txt"));
  await write("check.sh", 'test ! -e gone.txt && test "$(cat new.txt)" = "새 파일"\n');
  await write("new.txt", "새 파일\n");
  const passed = await world.cli("runner", "check");
  assert.equal(passed.code, 0, passed.stderr);
  assert.match(
    passed.stdout,
    /검사 명령: sh check\.sh \(기본 브랜치 origin\/main의 \.omagari\.json\)/,
  );
  assert.match(passed.stdout, /판정: 통과 \(\d+\.\d초\)/);
  assert.doesNotMatch(passed.stdout, /출력의 끝부분/);

  // 샌드박스에 넘긴 것: 임시 워크트리에서, 바깥 네트워크를 막고, 쓰기는 임시 워크트리와 임시 폴더만, 홈 폴더 읽기를 막는다.
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.ok(call);
  assert.equal(call.command, "sh check.sh");
  assert.notEqual(call.folder, repo.folder);
  const temp = call.env.TMPDIR;
  assert.ok(temp);
  assert.deepEqual(call.policy.network, {
    allowedDomains: [],
    deniedDomains: [],
    allowLocalBinding: true,
  });
  assert.deepEqual(call.policy.filesystem.allowWrite?.slice(0, 2), [call.folder, temp]);
  assert.deepEqual(call.policy.filesystem.denyRead, [homedir()]);
  assert.deepEqual(call.policy.filesystem.allowRead?.slice(0, 2), [call.folder, temp]);
  // 환경 변수는 정해 둔 것만 넘어간다. 토큰과 키가 든 변수는 넘어가지 않는다.
  assert.equal(call.env.PATH, process.env.PATH);
  assert.equal(call.env.HOME, temp);
  for (const [key, value] of Object.entries(call.env)) {
    assert.match(key, /^(PATH|LANG|LANGUAGE|TERM|TZ|USER|LOGNAME|SHELL|HOME|TMPDIR|LC_\w+)$/);
    assert.doesNotMatch(value, /secret/);
  }
  // 임시 워크트리는 레포의 Git 폴더 아래에 있어, 내 폴더의 워크트리 목록에 나타나지 않는다.
  assert.ok(call.folder.startsWith(await realpath(join(repo.folder, ".git"))));
  assert.equal((await repo.git("worktree", "list")).split("\n").length, 1);
  assert.equal(
    await repo.git("status", "--porcelain"),
    "M .omagari.json\n M check.sh\n D gone.txt\n?? new.txt", // 앞의 빈칸 하나는 잘린다
  );

  // 깨지면 종료 코드대로 깨짐이고, 출력의 끝부분(끝 25줄)을 보인다.
  await write("check.sh", "seq 1 40 >&2\necho 실패한 테스트 >&2\nexit 3\n");
  const broken = await world.cli("runner", "check");
  assert.equal(broken.code, 1);
  assert.match(broken.stdout, /판정: 깨짐 \(\d+\.\d초\)\n출력의 끝부분:\n {2}17\n/);
  assert.match(broken.stdout, / {2}40\n {2}실패한 테스트\n/);
  assert.doesNotMatch(broken.stdout, / {2}16\n/);

  // 돌린 것이 실행 기록에 남는다: 검사 명령, 판정, 걸린 시간.
  const log = await world.cli("runner", "log");
  const lines = log.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /검사 명령 "sh check\.sh" {2}폴더 .+ {2}판정 통과 {2}\d+\.\d초$/);
  assert.match(lines[1] ?? "", /검사 명령 "sh check\.sh" {2}폴더 .+ {2}판정 깨짐 {2}\d+\.\d초$/);
});

test("설정 파일이 없거나 읽지 못하거나 샌드박스를 쓸 수 없으면 돌리지 않고 까닭과 고치는 법을 보인다", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;

  const none = await world.cli("runner", "check");
  assert.equal(none.code, 1);
  assert.match(none.stdout, /판정: 돌리지 못함/);
  assert.match(none.stdout, /기본 브랜치\(origin\/main\)에 \.omagari\.json이 없다\. 정하는 법: /);
  // 작업 폴더에만 있는 설정은 읽지 않는다.
  await writer(repo.folder)(".omagari.json", config({ check: "true" }));
  assert.match((await world.cli("runner", "check")).stdout, /\.omagari\.json이 없다/);
  await rm(join(repo.folder, ".omagari.json"));

  await merge(repo, { ".omagari.json": config({ chek: "npm test" }) });
  const wrong = await world.cli("runner", "check");
  assert.equal(wrong.code, 1);
  assert.match(
    wrong.stdout,
    /\.omagari\.json을 읽지 못했다\(JSON이 아니거나 꼴이 다르다\)\. 정하는 법: /,
  );

  await merge(repo, { ".omagari.json": config({ check: "true" }) });
  fake.unavailable = "샌드박스 도구가 없다: bubblewrap. 까는 법: sudo apt install bubblewrap";
  const unsandboxed = await world.cli("runner", "check");
  assert.equal(unsandboxed.code, 1);
  assert.match(
    unsandboxed.stdout,
    /판정: 돌리지 못함 \(\d+\.\d초\)\n {2}샌드박스 도구가 없다: bubblewrap\. 까는 법: /,
  );
  // 가두지 않고 돌리는 길이 없다.
  assert.equal(fake.calls.length, 0);
  assert.equal((await repo.git("worktree", "list")).split("\n").length, 1);
});

test("준비 명령은 검사 명령 앞에 돌고, 실패하거나 상한을 넘으면 끊고 돌리지 못함이다", async (t) => {
  const fake = fakeSandbox();
  const limitMs = 2000;
  const world = await startWorld({
    sandbox: fake.sandbox,
    checkLimits: { checkMs: limitMs, setupMs: limitMs, outputBytes: 10_000 },
  });
  t.after(world.stop);
  const { repo } = world;
  const commands = () => fake.calls.splice(0).map((call) => call.command);

  await merge(repo, {
    ".omagari.json": config({ check: "test -f prepared", setup: "touch prepared" }),
  });
  const prepared = await world.cli("runner", "check");
  assert.equal(prepared.code, 0, prepared.stdout);
  assert.match(prepared.stdout, /준비 명령: touch prepared\n판정: 통과/);
  assert.deepEqual(commands(), ["touch prepared", "test -f prepared"]);
  // 준비 명령이 임시 워크트리에 만든 것은 내 폴더에 남지 않는다.
  await assert.rejects(access(join(repo.folder, "prepared")));

  await merge(repo, {
    ".omagari.json": config({ check: "true", setup: "echo 준비 실패; exit 2" }),
  });
  const failed = await world.cli("runner", "check");
  assert.equal(failed.code, 1);
  assert.match(
    failed.stdout,
    /판정: 돌리지 못함 \(.+\)\n {2}준비 명령이 실패했다\(종료 코드 2\)\n출력의 끝부분:\n {2}준비 실패/,
  );
  assert.deepEqual(commands(), ["echo 준비 실패; exit 2"]);

  // 끊는 것은 명령이 띄운 것까지다. 상한을 넘긴 만큼 기다리지 않는다.
  await merge(repo, { ".omagari.json": config({ check: "true", setup: "sleep 30 & wait" }) });
  const slowSetup = await world.cli("runner", "check");
  assert.match(
    slowSetup.stdout,
    /판정: 돌리지 못함 \((\d+\.\d)초\)\n {2}준비 명령을 2초 상한에서 끊었다/,
  );
  assert.ok(Number(/\((\d+\.\d)초\)/.exec(slowSetup.stdout)?.[1]) < 10);

  await merge(repo, { ".omagari.json": config({ check: "echo 시작; sleep 30" }) });
  const slow = await world.cli("runner", "check");
  assert.equal(slow.code, 1);
  assert.match(
    slow.stdout,
    /판정: 돌리지 못함 \(.+\)\n {2}검사 명령을 2초 상한에서 끊었다\. 끊긴 것은 통과로 치지 않는다\n출력의 끝부분:\n {2}시작/,
  );

  await merge(repo, { ".omagari.json": config({ check: "yes 출력 | head -c 100000; true" }) });
  const loud = await world.cli("runner", "check");
  assert.equal(loud.code, 1);
  assert.match(
    loud.stdout,
    /검사 명령을 출력 10000바이트 상한에서 끊었다\. 끊긴 것은 통과로 치지 않는다/,
  );

  const log = (await world.cli("runner", "log")).stdout;
  assert.match(
    log,
    /검사 명령 "true" {2}준비 명령 "sleep 30 & wait" {2}폴더 .+ {2}판정 돌리지 못함: 준비 명령을 2초 상한에서 끊었다/,
  );
});

// 러너를 CLI로 다섯 번 켜고 끈다.
test("러너를 켤 때 검사 명령과 샌드박스 안에서 돈다는 것을 알리고, --merge-check로 끄고 켠 것이 그 레포에 남는다", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // alice가 레포를 받은 폴더
  t.after(desk.remove);

  /** alice의 러너를 `omagari runner <args>`로 켜고, 켤 때의 알림까지 나오면 끈다. 처음이면 기기 인증으로 로그인한다. */
  const notice = async (...args: string[]) => {
    const runner = world.launchCliIn(desk.folder, "runner", ...args);
    t.after(() => runner.stop("SIGKILL"));
    const [, code] = await runner.output(/코드 (\S+) |러너가 켜졌다/);
    if (code) world.github.approve(code, "alice");
    const [found = ""] = await runner.output(
      /합쳐 돌려 보기\(.+\): [^\n]*(\n {2}[^\n]*)*남는다\.[^\n]*\n/,
    );
    await runner.stop();
    return found;
  };

  const none = await notice();
  assert.match(
    none,
    /^합쳐 돌려 보기\(켜짐\): 검사 명령이 없어 돌리지 않는다\. 기본 브랜치\(origin\/main\)에 \.omagari\.json이 없다\. 정하는 법: /,
  );

  await merge(desk, { ".omagari.json": config({ check: "npm test", setup: "npm ci" }) });
  const on = await notice();
  assert.match(on, /^합쳐 돌려 보기\(켜짐\): /);
  assert.match(on, /\n {2}검사 명령: npm test\n {2}준비 명령: npm ci\n/);
  assert.match(on, /기본 브랜치\(origin\/main\)의 \.omagari\.json에서 읽고, 샌드박스 안에서 돈다/);
  assert.match(on, /끄려면 omagari runner --merge-check off\./);

  // 명령이 바뀐 뒤 다시 켜면 바뀐 명령을 다시 알린다.
  await merge(desk, { ".omagari.json": config({ check: "npm run check" }) });
  const changed = await notice();
  assert.match(changed, /\n {2}검사 명령: npm run check\n/);
  assert.doesNotMatch(changed, /준비 명령/);

  // 끈 것은 다시 켜도 남는다.
  assert.match(
    await notice("--merge-check", "off"),
    /^합쳐 돌려 보기\(꺼 둠\): 이 기기에서는 검사 명령을 돌리지 않는다\. 켜려면 omagari runner --merge-check on\./,
  );
  assert.match(await notice(), /^합쳐 돌려 보기\(꺼 둠\)/);
  assert.match(
    await notice("--merge-check=on"),
    /^합쳐 돌려 보기\(켜짐\)[^\n]*\n {2}검사 명령: npm run check\n/,
  );

  const wrong = await world.cliIn(desk.folder, "runner", "--merge-check", "maybe");
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /합쳐 돌려 보기는 on, off 가운데 하나다: maybe/);
});

test("임시 워크트리는 레포의 Git 폴더 아래에서 다시 쓰이고, 내 폴더의 의존성이 이어지되 워크스페이스 패키지는 임시 워크트리 안을 가리킨다", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  const write = writer(repo.folder);

  // 워크스페이스 패키지 둘과, 설치된 의존성: 최상위와 한 단계 아래의 node_modules, 워크스페이스 링크, 범위 폴더.
  await merge(repo, {
    ".gitignore": "node_modules/\ndist/\n",
    ".omagari.json": config({ check: "sh check.sh" }),
    "check.sh": [
      'test "$(cat node_modules/dep/index.txt)" = "설치된 것"',
      'test "$(cat packages/app/node_modules/inner/index.txt)" = "안쪽 것"',
      "echo 임시에서만 > packages/lib/code.txt",
      'test "$(cat node_modules/@ws/lib/code.txt)" = "임시에서만"',
      'test "$(git status --porcelain)" = " M packages/lib/code.txt"',
      "mkdir -p dist && echo built > dist/out.txt",
      "echo 새 파일 > leftover.txt",
      "",
    ].join("\n"),
    "packages/lib/code.txt": "합친 코드\n",
    "packages/app/package.json": "{}\n",
  });
  await write("packages/lib/code.txt", "내 작업의 코드\n");
  await write("node_modules/dep/index.txt", "설치된 것");
  await write("packages/app/node_modules/inner/index.txt", "안쪽 것");
  await mkdir(join(repo.folder, "node_modules/@ws"), { recursive: true });
  // 워크스페이스 링크는 npm처럼 상대 링크다. 이 링크는 내 폴더의 packages/lib를 가리킨다(여기서는 내 작업의 코드가 든 같은 파일을 읽는다).
  await symlink("../../packages/lib", join(repo.folder, "node_modules/@ws/lib"));
  const before = await repo.git("status", "--porcelain");

  const first = await world.cli("runner", "check");
  assert.match(first.stdout, /판정: 통과/, first.stdout);
  const second = await world.cli("runner", "check");
  assert.match(second.stdout, /판정: 통과/, second.stdout);

  // 두 번 다 같은 폴더이고, 레포의 Git 폴더 아래다. 내 폴더의 git status와 워크트리 목록에는 나타나지 않는다.
  const [one, two] = fake.calls;
  assert.ok(one && two);
  assert.equal(one.folder, two.folder);
  const gitDir = await realpath(join(repo.folder, ".git"));
  assert.equal(one.folder, join(gitDir, "omagari", "check-worktree"));
  assert.equal(await repo.git("status", "--porcelain"), before);
  assert.equal((await repo.git("worktree", "list")).split("\n").length, 1);

  // 샌드박스가 읽을 수 있는 것: 개체 폴더와 이은 의존성 폴더뿐이다. 레포의 Git 폴더(원격 URL의 토큰이 든 config)는 열지 않는다.
  const read = one.policy.filesystem.allowRead ?? [];
  assert.ok(read.includes(join(gitDir, "objects")));
  assert.ok(read.includes(await realpath(join(repo.folder, "node_modules"))));
  assert.ok(!read.includes(gitDir));

  // 돌린 뒤: 추적하는 파일은 되돌려지고, 새 파일과 이은 링크는 없어지고, 무시되는 빌드 산출물은 남는다.
  assert.equal(
    await readFile(join(one.folder, "packages/lib/code.txt"), "utf8"),
    "내 작업의 코드\n",
  );
  await assert.rejects(access(join(one.folder, "leftover.txt")));
  await assert.rejects(access(join(one.folder, "node_modules")));
  assert.equal(await readFile(join(one.folder, "dist/out.txt"), "utf8"), "built\n");
  // 내 폴더는 그대로다(명령이 쓴 것은 임시 워크트리에만 간다).
  assert.equal(
    await readFile(join(repo.folder, "packages/lib/code.txt"), "utf8"),
    "내 작업의 코드\n",
  );
});

test("검사 명령이 임시 워크트리의 Git 설정과 훅을 바꿔 둬도 러너가 샌드박스 밖에서 부르는 git은 그것을 돌리지 않는다(#144)", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  // 샌드박스 밖에서 무언가 돌면 이 폴더에 표지가 생긴다. 가짜 샌드박스는 가두지 않으므로, 검사 명령은 실제 샌드박스가 여는 곳(임시 워크트리와 그 안의 git)에만 쓴다.
  const marks = await mkdtemp(join(tmpdir(), "omagari-escape-"));
  t.after(() => rm(marks, { recursive: true, force: true }));
  const touch = (name: string) => `touch '${join(marks, name)}'`;
  await merge(repo, {
    ".omagari.json": config({ check: "sh check.sh" }),
    "check.sh": [
      `git config core.fsmonitor "${touch("fsmonitor")}; false"`,
      `git config filter.x.smudge "${touch("filter")}; cat"`,
      `git config filter.x.clean "${touch("filter")}; cat"`,
      "printf '* filter=x\\n' > .gitattributes",
      'hooks="$PWD/hooks"',
      'git config core.hooksPath "$hooks"',
      'for dir in "$hooks" "$(git rev-parse --git-path hooks)"; do',
      '  mkdir -p "$dir"',
      "  for hook in reference-transaction post-checkout post-index-change; do",
      `    printf '#!/bin/sh\\n${touch("hook")}\\n' > "$dir/$hook" && chmod +x "$dir/$hook"`,
      "  done",
      "done",
      "",
    ].join("\n"),
  });

  // 두 번 돌린다. 첫 번째 뒤의 되돌리기와 두 번째의 마련이 모두 샌드박스 밖의 git이다.
  for (let round = 0; round < 2; round++) {
    const ran = await world.cli("runner", "check");
    assert.match(ran.stdout, /판정: 통과/, ran.stdout);
  }
  assert.deepEqual(await readdir(marks), []);
  // 샌드박스 안의 git이 쓰는 Git 폴더는 쓸 수 있게 열린다.
  const [call] = fake.calls;
  assert.ok(call);
  assert.equal(call.policy.filesystem.allowWrite?.length, 3);
});
