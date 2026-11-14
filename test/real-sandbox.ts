// 실제 샌드박스 손 점검(이슈 #138). 러너가 검사 명령을 가두는 샌드박스가 막을 것을 막고 열 것을 여는지 본다.
// 주인 기기에서 사람이 돌린다. 이름이 *.test.ts가 아니라 CI(`npm test`)는 돌리지 않는다.
// 러너의 `checkWork`와 실제 샌드박스(`osSandbox`)를 그대로 쓴다. 점검 명령은 임시 레포의 기본 브랜치 `.omagari.json`에 넣어 돌리므로
// 막는 설정, 임시 워크트리, 의존성 잇기가 모두 러너가 쓰는 그대로다. 돌리는 법과 읽는 법: docs/sandbox-check.md
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, homedir, platform } from "node:os";
import { join, relative } from "node:path";
import { parseArgs, promisify } from "node:util";
import { CHECK_LIMITS, checkWork, osSandbox } from "../packages/runner/src/check.ts";

const { values } = parseArgs({ options: { quick: { type: "boolean", default: false } } });
const execFileAsync = promisify(execFile);
const home = homedir();
const root = join(import.meta.dirname, "..");
const progress = (line: string) =>
  console.error(`${new Date().toISOString().slice(11, 19)} ${line}`);

const gitEnv = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Omagari Check",
  GIT_AUTHOR_EMAIL: "check@omagari.invalid",
  GIT_COMMITTER_NAME: "Omagari Check",
  GIT_COMMITTER_EMAIL: "check@omagari.invalid",
};
const git = async (folder: string, ...args: string[]) =>
  (
    await execFileAsync("git", ["-C", folder, ...args], {
      env: { ...process.env, ...gitEnv },
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout.trim();

/** 토큰이 든 환경 변수: 가짜 값을 이 셸에 두고, 검사 명령 안에 넘어오지 않는지 본다. */
Object.assign(process.env, {
  GITHUB_TOKEN: "ghp_fake_for_sandbox_check",
  OMAGARI_SECRET_KEY: "sk_fake_for_sandbox_check",
  AWS_SECRET_ACCESS_KEY: "fake_for_sandbox_check",
});

type Row = { name: string; ok: boolean | "observe"; note: string };
const rows: Row[] = [];
const add = (name: string, ok: Row["ok"], note: string) => {
  rows.push({ name, ok, note });
  progress(`${ok === true ? "ok  " : ok === false ? "FAIL" : "obs "} ${name}`);
};

const missing = await osSandbox.unavailable();
if (missing) {
  console.error(`이 기기에서는 샌드박스를 쓸 수 없어 점검하지 못한다: ${missing}`);
  process.exit(2);
}

/** 이 점검이 홈 폴더 아래에 만드는 것. 끝나면 모두 지운다. */
const base = await realpath(await mkdtemp(join(home, ".omagari-sandbox-check-")));
const repo = join(base, "repo");
const canary = join(base, "canary", "secret.txt");
const outside = join(base, "outside.txt");
await mkdir(join(base, "canary"), { recursive: true });
await writeFile(canary, "비밀\n");

/** 임시 레포: 기본 브랜치 `origin/main`의 `.omagari.json`에 `command`를 넣어 `checkWork`로 돌린다. */
async function setupRepo(folder: string) {
  await mkdir(folder, { recursive: true });
  await git(folder, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(folder, ".gitignore"), "node_modules\n");
  await writeFile(join(folder, "README.md"), "점검용 레포\n");
  await mkdir(join(folder, "node_modules", ".cache"), { recursive: true });
  await mkdir(join(folder, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(folder, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
}
async function publish(folder: string, remote: string, command: string) {
  await writeFile(join(folder, ".omagari.json"), `${JSON.stringify({ check: command })}\n`);
  await git(folder, "add", ".omagari.json", "README.md", ".gitignore");
  await git(folder, "commit", "--quiet", "--allow-empty", "--message=점검");
  await git(folder, "update-ref", `refs/remotes/${remote}/main`, "HEAD");
  await git(folder, "symbolic-ref", `refs/remotes/${remote}/HEAD`, `refs/remotes/${remote}/main`);
}
async function run(folder: string, command: string, remote = "origin") {
  await publish(folder, remote, command);
  return checkWork({ folder, remote, sandbox: osSandbox, limits: CHECK_LIMITS });
}
/** 명령이 통과(종료 코드 0)하면 그 항목은 된 것이다. 명령은 "기대한 대로 가둬졌을 때 0"이 되게 쓴다. */
async function probe(
  name: string,
  command: string,
  kind: "check" | "observe",
  note: string,
  otherwise = "아니다",
) {
  const result = await run(repo, command);
  const out = result.output.replace(/\s+/g, " ").trim().slice(-200);
  if (result.verdict === "not_run")
    return add(name, false, `돌리지 못했다: ${result.reason ?? ""} ${out}`);
  const passed = result.verdict === "pass";
  if (kind === "observe") return add(name, "observe", passed ? note : `${otherwise} ${out}`.trim());
  add(name, passed, passed ? note : `${out || "출력 없음"}`);
}

try {
  await setupRepo(repo);
  // 러너는 레포 폴더에서 떠 있다. sandbox-runtime의 .git/hooks와 .git/config 쓰기 막기는 띄운 프로세스의 현재 폴더 기준이라 같게 맞춘다.
  const start = process.cwd();
  process.chdir(repo);
  const nodeUnderHome = relative(home, process.execPath).startsWith("..") === false;

  // 도구
  const deps = await execFileAsync("which", ["rg"]).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  );
  add(
    "도구: sandbox-runtime 0.0.81이 이 기기에서 돈다",
    true,
    `ripgrep ${deps || "(PATH에 없음)"}`,
  );

  // 1. 바깥 네트워크가 막힌다. 막힌 쪽만 보면 네트워크가 없어서일 수 있어 샌드박스 밖에서 먼저 닿는지 본다.
  const reachable = await fetch("https://example.com", { signal: AbortSignal.timeout(8000) }).then(
    (r) => r.ok,
    () => false,
  );
  if (reachable)
    await probe(
      "바깥 네트워크가 막힌다",
      "! curl -fsS -m 8 -o /dev/null https://example.com && ! curl -fsS -m 8 -o /dev/null http://1.1.1.1",
      "check",
      "https와 http 모두 닿지 않는다",
    );
  else
    add(
      "바깥 네트워크가 막힌다",
      "observe",
      "이 기기에서 샌드박스 밖에서도 example.com에 닿지 않아 가리지 못했다",
    );

  // 2. 쓰기: 임시 워크트리 밖과 레포 폴더, 홈 폴더에 쓰지 못한다. 임시 워크트리 안에는 쓴다.
  await probe(
    "임시 워크트리 밖에 쓰지 못한다",
    `! (echo x > '${outside}') && ! (echo x > '${join(repo, "leak.txt")}') && ! (echo x > '${join(home, ".omagari-sandbox-leak")}')`,
    "check",
    "홈 폴더, 레포 폴더, 임시 폴더 밖 어디에도 쓰지 못한다",
  );
  const leaked = await Promise.all(
    [outside, join(repo, "leak.txt"), join(home, ".omagari-sandbox-leak")].map((p) =>
      access(p).then(
        () => p,
        () => undefined,
      ),
    ),
  );
  for (const p of leaked.filter(Boolean) as string[]) {
    add("임시 워크트리 밖에 쓰지 못한다(파일이 실제로 생겼는지)", false, `생겼다: ${p}`);
    await rm(p, { force: true });
  }
  await probe("임시 워크트리 안에 쓴다", "echo x > inside.txt", "check", "쓸 수 있다");
  await probe(
    "HOME에 쓴다(러너는 HOME을 임시 폴더로 둔다)",
    'echo x > "$HOME/h.txt"',
    "check",
    "쓸 수 있다",
  );
  await probe(
    "TMPDIR이 러너가 준 임시 폴더다(sandbox-runtime이 /tmp/claude로 덮는지, 관찰)",
    'echo "TMPDIR=$TMPDIR"; test "$TMPDIR" = "$HOME"',
    "observe",
    "러너가 준 임시 폴더 그대로다",
    "덮였다",
  );
  await probe(
    "TMPDIR 안에 쓴다(관찰)",
    'echo "TMPDIR=$TMPDIR"; echo x > "$TMPDIR/t.txt"',
    "observe",
    "쓸 수 있다",
    "쓰지 못한다",
  );

  // 3. 홈 폴더를 읽지 못한다
  const sshDir = join(home, ".ssh");
  const hasSsh = await access(sshDir).then(
    () => true,
    () => false,
  );
  await probe(
    "홈 폴더를 읽지 못한다",
    `! cat '${canary}' >/dev/null 2>&1 && ! ls '${home}' >/dev/null 2>&1${hasSsh ? ` && ! ls '${sshDir}' >/dev/null 2>&1` : ""}`,
    "check",
    `홈 폴더 아래의 파일과 목록을 읽지 못한다${hasSsh ? "(~/.ssh 포함)" : "(이 기기에 ~/.ssh가 없어 그것은 보지 못함)"}`,
  );

  // 4. 자기 기기의 포트를 열고 붙는다
  await probe(
    "자기 기기의 포트를 열고 붙을 수 있다",
    `node -e "const n=require('net');const s=n.createServer(c=>c.end('hi')).listen(0,'127.0.0.1',()=>{n.connect(s.address().port,'127.0.0.1').on('data',d=>{process.exit(String(d)==='hi'?0:1)}).on('error',()=>process.exit(2))})"`,
    "check",
    "127.0.0.1에 서버를 열고 붙었다",
  );
  // 샌드박스 밖의 포트에 붙는지도 본다(막힐 수 있다: 관찰)
  const outer = createServer((c) => c.end("hi")).listen(0, "127.0.0.1");
  await new Promise((r) => outer.once("listening", r));
  const outerPort = (outer.address() as { port: number }).port;
  await probe(
    "샌드박스 밖에서 떠 있는 서버(127.0.0.1)에 붙는다",
    `node -e "require('net').connect(${outerPort},'127.0.0.1').on('data',()=>process.exit(0)).on('error',()=>process.exit(1))"`,
    "observe",
    "붙는다",
    "막힌다",
  );
  outer.close();

  await probe(
    "유닉스 소켓을 임시 워크트리 안에 열고 붙는다(짧은 상대 경로, 관찰)",
    `node -e "const n=require('net');const s=n.createServer(c=>c.end('hi')).listen('u.sock',()=>{n.connect('u.sock').on('data',()=>process.exit(0)).on('error',()=>process.exit(1))}).on('error',()=>process.exit(2))"`,
    "observe",
    "된다",
    "막힌다",
  );
  await probe(
    "유닉스 소켓을 TMPDIR(sandbox-runtime이 덮은 /tmp/claude)에 연다(관찰)",
    `node -e "require('net').createServer().listen(require('os').tmpdir()+'/u.sock',()=>process.exit(0)).on('error',(e)=>{console.log(e.code);process.exit(1)})"`,
    "observe",
    "된다",
    "막힌다",
  );

  // 5. 토큰이 든 환경 변수가 넘어오지 않는다
  await probe(
    "토큰이 든 환경 변수가 넘어오지 않는다",
    `test -z "$GITHUB_TOKEN" && test -z "$OMAGARI_SECRET_KEY" && test -z "$AWS_SECRET_ACCESS_KEY" && ! env | cut -d= -f1 | grep -Ei 'TOKEN|SECRET|API_KEY'`,
    "check",
    "GITHUB_TOKEN 등 셋과 이름에 TOKEN·SECRET·API_KEY가 든 변수가 없다",
  );

  // 6. Node
  await probe(
    nodeUnderHome
      ? "Node가 홈 폴더 아래에 있어도(nvm 같은 기기) 검사 명령이 돈다"
      : "Node가 돈다(Node가 홈 폴더 밖에 있어 nvm 같은 경우는 보지 못함)",
    `node -e "console.log(process.version, process.execPath)" && node -e "require('fs').readFileSync('README.md')"`,
    "check",
    `${process.version}, ${process.execPath}`,
  );

  // 7. node_modules 안
  await probe(
    "node_modules/.cache 안에 쓴다(이은 폴더 안, 관찰)",
    "echo x > node_modules/.cache/probe.txt",
    "observe",
    "쓸 수 있다",
    "막힌다",
  );
  await probe(
    "node_modules/pkg 안에 쓴다(이은 폴더 안, 관찰)",
    "echo x > node_modules/pkg/probe.txt",
    "observe",
    "쓸 수 있다",
    "막힌다",
  );
  await probe(
    "node_modules 안에 새 폴더를 만든다(워크트리 쪽, 관찰)",
    "mkdir node_modules/.newcache && echo x > node_modules/.newcache/probe.txt",
    "observe",
    "만들 수 있다",
    "막힌다",
  );
  await probe(
    "이은 의존성을 읽는다",
    "node -e \"require('./node_modules/pkg')\"",
    "check",
    "읽는다",
  );

  // 8. #142가 남긴 것 1: 샌드박스 안의 git이 임시 워크트리의 인덱스를 쓴다
  await probe(
    "임시 워크트리 안의 git이 인덱스를 쓴다(add, write-tree, commit)",
    "echo n > n.txt && git add n.txt && git write-tree >/dev/null && git -c user.name=x -c user.email=x@x.invalid commit -q -m t && git status --short | wc -l | grep -q '^ *0$'",
    "check",
    "add, write-tree, commit, status가 된다",
  );
  await probe(
    "임시 워크트리의 .git/config에 쓴다(관찰)",
    "echo '[core]' >> .git/config",
    "observe",
    "쓸 수 있다",
    "막힌다",
  );
  await probe(
    "임시 워크트리의 .git/hooks에 쓴다(관찰)",
    "mkdir -p .git/hooks && echo x > .git/hooks/pre-commit",
    "observe",
    "쓸 수 있다",
    "막힌다",
  );
  await probe(
    "임시 워크트리의 .git/HEAD에 쓴다(관찰)",
    "echo x >> .git/HEAD",
    "observe",
    "쓸 수 있다",
    "막힌다",
  );

  // 임시 워크트리의 .git/config로 샌드박스 밖에서 명령이 도는지(러너가 샌드박스 밖에서 임시 워크트리에 git을 부른다). 막혀 있으면 표지가 안 생긴다.
  const marker = join(base, "escaped.txt");
  await probe(
    "임시 워크트리의 .git/config에 core.fsmonitor를 써 둔다(관찰)",
    `git config core.fsmonitor "touch '${marker}'; true"`,
    "observe",
    "쓸 수 있다",
    "막힌다",
  );
  const escaped = await access(marker).then(
    () => true,
    () => false,
  );
  add(
    "샌드박스가 끝난 뒤 러너의 git이 쓴 fsmonitor로 밖에서 명령이 돌았다(관찰)",
    escaped ? false : "observe",
    escaped ? `샌드박스 밖에서 ${marker}가 만들어졌다` : "안 돌았다",
  );
  // 같은 점검을 러너의 현재 폴더가 레포가 아닐 때도 본다.
  process.chdir(start);
  await rm(marker, { force: true });
  await probe(
    "러너의 현재 폴더가 레포가 아닐 때 .git/config에 core.fsmonitor를 쓴다(관찰)",
    `git config core.fsmonitor "touch '${marker}'; true"`,
    "observe",
    "쓸 수 있다",
    "막힌다",
  );
  const escapedElsewhere = await access(marker).then(
    () => true,
    () => false,
  );
  add(
    "러너의 현재 폴더가 레포가 아닐 때, 샌드박스가 끝난 뒤 러너의 git이 쓴 fsmonitor로 밖에서 명령이 돌았다(관찰)",
    escapedElsewhere ? false : "observe",
    escapedElsewhere ? "샌드박스 밖에서 표지 파일이 만들어졌다" : "안 돌았다",
  );
  process.chdir(repo);

  // 9. #142가 남긴 것 2: 홈 아래의 임시 워크트리와 objects가 denyRead 위에서 다시 열린다
  const objects = join(await realpath(join(repo, ".git")), "objects");
  await probe(
    "홈 아래의 임시 워크트리와 레포의 objects를 읽는다",
    "git log -1 --format=%H >/dev/null && git cat-file -p HEAD:.omagari.json >/dev/null && git cat-file -p HEAD:README.md >/dev/null && cat README.md >/dev/null",
    "check",
    `git log, cat-file이 된다(objects ${relative(home, objects)})`,
  );
  await probe(
    "레포의 Git 폴더(원격 URL이 든 config)는 읽지 못한다",
    `! cat '${join(repo, ".git", "config")}' >/dev/null 2>&1`,
    "check",
    "막힌다",
  );

  // 10. 이 레포의 `npm test`
  if (!values.quick) {
    const top = await git(root, "rev-parse", "--show-toplevel");
    process.chdir(top);
    const remote = "omagari-sandbox-check";
    progress("이 레포에서 npm test를 돈다(수 분)");
    const tree = join(base, "repo-tree");
    // 이 레포에는 `.omagari.json`이 없을 수 있어, 기본 브랜치에 있는 것처럼 가짜 원격 추적 ref를 잠깐 만든다.
    await mkdir(tree);
    const index = join(tree, "index");
    const env = { ...process.env, ...gitEnv, GIT_INDEX_FILE: index };
    await execFileAsync("git", ["-C", top, "read-tree", "HEAD"], { env });
    const blob = (
      await new Promise<string>((resolve, reject) => {
        const child = execFile(
          "git",
          ["-C", top, "hash-object", "-w", "--stdin"],
          { env },
          (e, out) => (e ? reject(e) : resolve(out)),
        );
        child.stdin?.end(
          `${JSON.stringify({
            // `npm test` 그대로이고, 끝에 통과·실패 수와 실패한 테스트 이름이 보이게 모아 찍는다.
            check:
              "npm test > omagari-test.log 2>&1; code=$?; grep -E '^✖' omagari-test.log | sort -u | head -12; grep -E '^ℹ (tests|pass|fail|cancelled)' omagari-test.log; exit $code",
          })}\n`,
        );
      })
    ).trim();
    await execFileAsync(
      "git",
      ["-C", top, "update-index", "--add", "--cacheinfo", `100644,${blob},.omagari.json`],
      { env },
    );
    const written = (await execFileAsync("git", ["-C", top, "write-tree"], { env })).stdout.trim();
    const commit = await git(top, "commit-tree", written, "-m", "점검");
    await git(top, "update-ref", `refs/remotes/${remote}/main`, commit);
    await git(top, "symbolic-ref", `refs/remotes/${remote}/HEAD`, `refs/remotes/${remote}/main`);
    try {
      const report = (name: string, result: Awaited<ReturnType<typeof checkWork>>) => {
        const out = result.output.replace(/\s+/g, " ").trim();
        add(
          name,
          result.verdict === "pass",
          `판정 ${result.verdict}, ${(result.ms / 1000).toFixed(0)}초. ${result.reason ?? ""} 출력 끝: ${out.slice(-700)}`,
        );
      };
      const first = await checkWork({
        folder: top,
        remote,
        sandbox: osSandbox,
        limits: CHECK_LIMITS,
      });
      report("이 레포의 npm test가 샌드박스 안에서 통과한다", first);
      if (first.verdict !== "pass") {
        // sandbox-runtime이 덮어쓰는 TMPDIR을 러너가 준 임시 폴더로 되돌려 다시 돌린다(check.ts는 고치지 않는다: 그래도 되는지 보는 실험).
        const fixedTmp: typeof osSandbox = {
          unavailable: () => osSandbox.unavailable(),
          wrap: (input) =>
            osSandbox.wrap({
              ...input,
              command: `TMPDIR='${input.env.TMPDIR}'; export TMPDIR; ${input.command}`,
            }),
        };
        progress("TMPDIR을 되돌려 npm test를 다시 돈다(수 분)");
        report(
          "(실험) TMPDIR을 러너가 준 임시 폴더로 되돌리면 이 레포의 npm test가 통과한다",
          await checkWork({ folder: top, remote, sandbox: fixedTmp, limits: CHECK_LIMITS }),
        );
      }
    } finally {
      await git(top, "update-ref", "-d", `refs/remotes/${remote}/main`).catch(() => {});
      await git(top, "symbolic-ref", "--delete", `refs/remotes/${remote}/HEAD`).catch(() => {});
    }
  }
} finally {
  process.chdir(home);
  await rm(base, { recursive: true, force: true });
}

const date = new Date().toISOString().slice(0, 10);
const version = JSON.parse(
  await readFile(
    join(root, "node_modules", "@anthropic-ai", "sandbox-runtime", "package.json"),
    "utf8",
  ),
).version;
console.log(
  `**실제 샌드박스 손 점검 결과** (${date}, ${platform()} ${arch()}, Node ${process.version}(${process.execPath}), @anthropic-ai/sandbox-runtime ${version})\n`,
);
for (const row of rows)
  console.log(
    `- ${row.ok === true ? "[x]" : row.ok === false ? "[ ] (실패)" : "(관찰)"} ${row.name}: ${row.note}`,
  );
process.exit(rows.some((row) => row.ok === false) ? 1 : 0);
