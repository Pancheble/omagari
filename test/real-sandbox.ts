// Real sandbox hand check (issue #138). Checks that the sandbox the runner uses to confine check commands blocks what it should and opens what it should.
// A person runs it on the owner's machine. Its name isn't *.test.ts, so CI (`npm test`) doesn't run it.
// It uses the runner's `checkWork` and the real sandbox (`osSandbox`) as they are. The check command is put in the temp repo's default branch `.omagari.json` and run, so
// the block settings, the temp worktree, and dependency linking are all exactly what the runner uses. How to run and read it: docs/sandbox-check.md
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { arch, homedir, platform } from "node:os";
import { basename, join, relative } from "node:path";
import { parseArgs, promisify } from "node:util";
import {
  CHECK_LIMITS,
  checkWork,
  osMounts,
  osSandbox,
  windowsDrives,
} from "../packages/runner/src/check.ts";

const { values } = parseArgs({
  options: { quick: { type: "boolean", default: false } },
});
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

/** Environment variables with tokens: put fake values in this shell and check they don't reach the check command. */
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
  console.error(`The sandbox can't be used on this machine, so the check couldn't run: ${missing}`);
  process.exit(2);
}

/** What this check creates under the home folder. All of it is removed at the end. */
const base = await realpath(await mkdtemp(join(home, ".omagari-sandbox-check-")));
const repo = join(base, "repo");
const canary = join(base, "canary", "secret.txt");
const outside = join(base, "outside.txt");
await mkdir(join(base, "canary"), { recursive: true });
await writeFile(canary, "secret\n");

/** Temp repo: put `command` in `.omagari.json` on the default branch `origin/main` and run it with `checkWork`. */
async function setupRepo(folder: string) {
  await mkdir(folder, { recursive: true });
  await git(folder, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(folder, ".gitignore"), "node_modules\n");
  await writeFile(join(folder, "README.md"), "repo for the check\n");
  await mkdir(join(folder, "node_modules", ".cache"), { recursive: true });
  await mkdir(join(folder, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(folder, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
}
async function publish(folder: string, remote: string, command: string) {
  await writeFile(join(folder, ".omagari.json"), `${JSON.stringify({ check: command })}\n`);
  await git(folder, "add", ".omagari.json", "README.md", ".gitignore");
  await git(folder, "commit", "--quiet", "--allow-empty", "--message=check");
  await git(folder, "update-ref", `refs/remotes/${remote}/main`, "HEAD");
  await git(folder, "symbolic-ref", `refs/remotes/${remote}/HEAD`, `refs/remotes/${remote}/main`);
}
async function run(folder: string, command: string, remote = "origin") {
  await publish(folder, remote, command);
  return checkWork({
    folder,
    remote,
    sandbox: osSandbox,
    limits: CHECK_LIMITS,
  });
}
/** If the command passes (exit code 0), the item is done. Write the command to exit 0 "when confined as expected". */
async function probe(
  name: string,
  command: string,
  kind: "check" | "observe",
  note: string,
  otherwise = "no",
) {
  const result = await run(repo, command);
  const out = result.output.replace(/\s+/g, " ").trim().slice(-200);
  if (result.verdict === "not_run")
    return add(name, false, `could not run: ${result.reason ?? ""} ${out}`);
  const passed = result.verdict === "pass";
  if (kind === "observe") return add(name, "observe", passed ? note : `${otherwise} ${out}`.trim());
  add(name, passed, passed ? note : `${out || "no output"}`);
}

try {
  await setupRepo(repo);
  // The runner is started in the repo folder. sandbox-runtime's write block on .git/hooks and .git/config is relative to the started process's current folder, so match it.
  const start = process.cwd();
  process.chdir(repo);
  const nodeUnderHome = relative(home, process.execPath).startsWith("..") === false;

  // Tool
  const deps = await execFileAsync("which", ["rg"]).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  );
  add(
    "Tool: sandbox-runtime 0.0.81 runs on this machine",
    true,
    `ripgrep ${deps || "(not in PATH)"}`,
  );

  // 1. The outside network is blocked. Looking only at the blocked side could just mean there's no network, so first check it's reachable outside the sandbox.
  const reachable = await fetch("https://example.com", {
    signal: AbortSignal.timeout(8000),
  }).then(
    (r) => r.ok,
    () => false,
  );
  if (reachable)
    await probe(
      "The outside network is blocked",
      "! curl -fsS -m 8 -o /dev/null https://example.com && ! curl -fsS -m 8 -o /dev/null http://1.1.1.1",
      "check",
      "Neither https nor http gets through",
    );
  else
    add(
      "The outside network is blocked",
      "observe",
      "example.com isn't reachable even outside the sandbox on this machine, so it couldn't be told",
    );

  // 2. Writing: can't write outside the temp worktree, in the repo folder, or in the home folder. Can write inside the temp worktree.
  // Linux (bubblewrap) covers a read-blocked folder with an empty tmpfs instead of an error (#176). Writing under home succeeds inside the sandbox and disappears at the end.
  // So on Linux the block is judged by whether a file really appeared outside, not by whether the write failed. On macOS the write fails.
  const linux = platform() === "linux";
  const leaks = [outside, join(repo, "leak.txt"), join(home, ".omagari-sandbox-leak")];
  await probe(
    "Can't write outside the temp worktree",
    linux
      ? leaks.map((p) => `(echo x > '${p}' || true)`).join("; ")
      : leaks.map((p) => `! (echo x > '${p}')`).join(" && "),
    "check",
    linux
      ? "Tried to write (it goes to an empty tmpfs and disappears; whether it appeared outside is the next line)"
      : "Can't write anywhere outside the home folder, repo folder, and temp folder",
  );
  const leaked = await Promise.all(
    leaks.map((p) =>
      access(p).then(
        () => p,
        () => undefined,
      ),
    ),
  );
  for (const p of leaked.filter(Boolean) as string[]) {
    add(
      "Can't write outside the temp worktree (whether a file really appeared)",
      false,
      `appeared: ${p}`,
    );
    await rm(p, { force: true });
  }
  if (leaked.every((p) => !p))
    add(
      "A file written outside the temp worktree doesn't really appear outside",
      true,
      "Nothing appeared anywhere outside home, the repo folder, and the temp folder",
    );
  await probe("Writes inside the temp worktree", "echo x > inside.txt", "check", "can write");
  await probe(
    "Writes to HOME (the runner sets HOME to a temp folder)",
    'echo x > "$HOME/h.txt"',
    "check",
    "can write",
  );
  await probe(
    "TMPDIR is the temp folder the runner gave (whether sandbox-runtime overrides it with /tmp/claude, observed)",
    'echo "TMPDIR=$TMPDIR"; test "$TMPDIR" = "$HOME"',
    "observe",
    "It is the temp folder the runner gave",
    "overridden",
  );
  await probe(
    "Writes inside TMPDIR (observed)",
    'echo "TMPDIR=$TMPDIR"; echo x > "$TMPDIR/t.txt"',
    "observe",
    "can write",
    "can't write",
  );

  // 3. Can't read the home folder
  const sshDir = join(home, ".ssh");
  const hasSsh = await access(sshDir).then(
    () => true,
    () => false,
  );
  // The canary right under home. On Linux `ls home` opens an empty tmpfs and succeeds (#176), so judge by whether the canary is invisible, not by whether the listing fails. On macOS `ls` fails too.
  const homeCanary = join(home, `.omagari-sandbox-canary-${process.pid}`);
  await writeFile(homeCanary, "secret\n");
  try {
    await probe(
      "Can't read the home folder",
      `! cat '${canary}' >/dev/null 2>&1 && ! cat '${homeCanary}' >/dev/null 2>&1 && ! ls -A '${home}' 2>/dev/null | grep -q '${basename(homeCanary)}'${hasSsh ? ` && ! ls '${sshDir}' >/dev/null 2>&1` : ""}`,
      "check",
      `Can't read files under the home folder and they don't show in the listing${hasSsh ? " (including ~/.ssh)" : " (this machine has no ~/.ssh, so that wasn't checked)"}`,
    );
  } finally {
    await rm(homeCanary, { force: true });
  }

  // 3-1. On WSL2, can't read Windows drives (#164, ADR-0038)
  const drives = windowsDrives(await osMounts());
  if (drives.length === 0)
    add("On WSL2, can't read Windows drives", "observe", "Skipped because this isn't WSL2");
  else
    await probe(
      "On WSL2, can't read Windows drives",
      // The drive spot is covered by an empty tmpfs (#176), so `ls` can succeed. If it errors or is empty, it is blocked.
      drives.map((d) => `[ -z "$(ls -A '${d}' 2>/dev/null)" ]`).join(" && "),
      "check",
      `${drives.join(", ")} errors or is empty`,
    );

  // 4. Opens and connects to a port on its own machine
  await probe(
    "Can open and connect to a port on its own machine",
    `node -e "const n=require('net');const s=n.createServer(c=>c.end('hi')).listen(0,'127.0.0.1',()=>{n.connect(s.address().port,'127.0.0.1').on('data',d=>{process.exit(String(d)==='hi'?0:1)}).on('error',()=>process.exit(2))})"`,
    "check",
    "Opened a server on 127.0.0.1 and connected",
  );
  // Also check whether it connects to a port outside the sandbox (it may be blocked: observed)
  const outer = createServer((c) => c.end("hi")).listen(0, "127.0.0.1");
  await new Promise((r) => outer.once("listening", r));
  const outerPort = (outer.address() as { port: number }).port;
  await probe(
    "Connects to a server running outside the sandbox (127.0.0.1)",
    `node -e "require('net').connect(${outerPort},'127.0.0.1').on('data',()=>process.exit(0)).on('error',()=>process.exit(1))"`,
    "observe",
    "connects",
    "blocked",
  );
  outer.close();

  // Unix sockets (#145, ADR-0037): open and connect only inside the temp worktree and temp folder. Can't connect to sockets outside.
  const listenConnect = (path: string) =>
    `node -e "const n=require('net');const p=${path};n.createServer(c=>c.end('hi')).listen(p,()=>{n.connect(p).on('data',()=>process.exit(0)).on('error',e=>{console.log(e.code);process.exit(1)})}).on('error',e=>{console.log(e.code);process.exit(2)})"`;
  // On Linux, sandbox-runtime blocks Unix sockets entirely with seccomp and doesn't read allowUnixSockets (ADR-0037, until #167).
  // So on Linux the right expectation is "blocked with EPERM", not "opens".
  const socketIn = (path: string) =>
    linux ? `${listenConnect(path)} | grep -qx EPERM` : listenConnect(path);
  const socketNote = linux ? "blocked (Linux blocks all sockets until #167)" : "works";
  await probe(
    `Unix socket inside the temp worktree ${linux ? "can't open (Linux)" : "opens and connects"} (short relative path)`,
    socketIn("'u.sock'"),
    "check",
    socketNote,
  );
  await probe(
    `Unix socket inside the temp folder (HOME) the runner gave ${linux ? "can't open (Linux)" : "opens and connects"} (absolute path, within 104 bytes)`,
    socketIn("process.env.HOME+'/omagari-0123456789abcdef.sock'"),
    "check",
    socketNote,
  );
  // A socket opened outside the sandbox. Put it outside the home folder (/tmp, readable) to check it's blocked by the socket block, not the read block.
  const outerSock = join(await realpath("/tmp"), `omagari-outer-${process.pid}.sock`);
  const outerUnix = createServer((c) => c.end("hi")).listen(outerSock);
  await new Promise((r) => outerUnix.once("listening", r));
  const connectFails = (path: string) =>
    `node -e "require('net').connect(${path}).on('data',()=>process.exit(1)).on('error',e=>{console.log(e.code);process.exit(0)})"`;
  try {
    await probe(
      "Can't connect to a Unix socket opened outside the sandbox (/tmp)",
      connectFails(`'${outerSock}'`),
      "check",
      "blocked",
    );
    await probe(
      "Can't connect even through a link inside the temp worktree that points to an outside socket",
      `ln -s '${outerSock}' l.sock && ${connectFails("'l.sock'")}`,
      "check",
      "blocked",
    );
  } finally {
    outerUnix.close();
  }
  const docker = "/var/run/docker.sock";
  if (
    await access(docker).then(
      () => true,
      () => false,
    )
  )
    await probe(
      "Can't connect to the Docker socket",
      connectFails(`'${docker}'`),
      "check",
      "blocked",
    );
  else
    add(
      "Can't connect to the Docker socket",
      "observe",
      `this machine has no ${docker}, so it wasn't checked`,
    );
  await probe(
    "Opens a Unix socket in TMPDIR (/tmp/claude, overridden by sandbox-runtime) (observed)",
    `node -e "require('net').createServer().listen(require('os').tmpdir()+'/u.sock',()=>process.exit(0)).on('error',(e)=>{console.log(e.code);process.exit(1)})"`,
    "observe",
    "works",
    "blocked",
  );

  // 5. Environment variables with tokens don't come through
  await probe(
    "Environment variables with tokens don't come through",
    `test -z "$GITHUB_TOKEN" && test -z "$OMAGARI_SECRET_KEY" && test -z "$AWS_SECRET_ACCESS_KEY" && ! env | cut -d= -f1 | grep -Ei 'TOKEN|SECRET|API_KEY'`,
    "check",
    "GITHUB_TOKEN and two others, and variables with TOKEN, SECRET, or API_KEY in the name, are absent",
  );

  // 6. Node
  await probe(
    nodeUnderHome
      ? "The check command runs even when Node is under the home folder (a machine with nvm)"
      : "Node runs (Node is outside the home folder, so cases like nvm weren't checked)",
    `node -e "console.log(process.version, process.execPath)" && node -e "require('fs').readFileSync('README.md')"`,
    "check",
    `${process.version}, ${process.execPath}`,
  );

  // 7. Inside node_modules
  await probe(
    "Writes inside node_modules/.cache (inside a linked folder, observed)",
    "echo x > node_modules/.cache/probe.txt",
    "observe",
    "can write",
    "blocked",
  );
  await probe(
    "Writes inside node_modules/pkg (inside a linked folder, observed)",
    "echo x > node_modules/pkg/probe.txt",
    "observe",
    "can write",
    "blocked",
  );
  await probe(
    "Creates a new folder inside node_modules (worktree side, observed)",
    "mkdir node_modules/.newcache && echo x > node_modules/.newcache/probe.txt",
    "observe",
    "can create",
    "blocked",
  );
  await probe(
    "Reads the linked dependencies",
    "node -e \"require('./node_modules/pkg')\"",
    "check",
    "reads",
  );

  // 8. Left by #142, part 1: git inside the sandbox writes the temp worktree's index
  await probe(
    "git inside the temp worktree writes the index (add, write-tree, commit)",
    "echo n > n.txt && git add n.txt && git write-tree >/dev/null && git -c user.name=x -c user.email=x@x.invalid commit -q -m t && git status --short | wc -l | grep -q '^ *0$'",
    "check",
    "add, write-tree, commit, and status work",
  );
  await probe(
    "Writes to the temp worktree's .git/config (observed)",
    "echo '[core]' >> \"$(git rev-parse --git-dir)/config\"",
    "observe",
    "can write",
    "blocked",
  );
  await probe(
    "Writes to the temp worktree's .git/hooks (observed)",
    'mkdir -p "$(git rev-parse --git-path hooks)" && echo x > "$(git rev-parse --git-path hooks)/pre-commit"',
    "observe",
    "can write",
    "blocked",
  );
  await probe(
    "Writes to the temp worktree's .git/HEAD (observed)",
    'echo x >> "$(git rev-parse --git-dir)/HEAD"',
    "observe",
    "can write",
    "blocked",
  );

  // Whether a command runs outside the sandbox through the temp worktree's .git/config (the runner calls git on the temp worktree outside the sandbox). If blocked, no marker appears.
  const marker = join(base, "escaped.txt");
  await probe(
    "Writes core.fsmonitor to the temp worktree's .git/config (observed)",
    `git config core.fsmonitor "touch '${marker}'; true"`,
    "observe",
    "can write",
    "blocked",
  );
  const escaped = await access(marker).then(
    () => true,
    () => false,
  );
  add(
    "After the sandbox ended, a command ran outside through the fsmonitor the runner's git used (observed)",
    escaped ? false : "observe",
    escaped ? `${marker} was created outside the sandbox` : "didn't run",
  );
  // Do the same check when the runner's current folder isn't a repo.
  process.chdir(start);
  await rm(marker, { force: true });
  await probe(
    "Writes core.fsmonitor to .git/config when the runner's current folder isn't a repo (observed)",
    `git config core.fsmonitor "touch '${marker}'; true"`,
    "observe",
    "can write",
    "blocked",
  );
  const escapedElsewhere = await access(marker).then(
    () => true,
    () => false,
  );
  add(
    "When the runner's current folder isn't a repo, after the sandbox ended a command ran outside through the fsmonitor the runner's git used (observed)",
    escapedElsewhere ? false : "observe",
    escapedElsewhere ? "A marker file was created outside the sandbox" : "didn't run",
  );
  process.chdir(repo);

  // 9. Left by #142, part 2: the temp worktree and objects under home are reopened over denyRead
  const objects = join(await realpath(join(repo, ".git")), "objects");
  await probe(
    "Reads the temp worktree under home and the repo's objects",
    "git log -1 --format=%H >/dev/null && git cat-file -p HEAD:.omagari.json >/dev/null && git cat-file -p HEAD:README.md >/dev/null && cat README.md >/dev/null",
    "check",
    `git log and cat-file work (objects ${relative(home, objects)})`,
  );
  await probe(
    "Can't read the repo's Git folder (the config with the remote URL)",
    `! cat '${join(repo, ".git", "config")}' >/dev/null 2>&1`,
    "check",
    "blocked",
  );

  // 10. #150: a process the check command left outside its process group tries, after the check ends, to turn the node_modules of the temp worktree path it was given
  // into a link pointing outside (under home, where the sandbox can't write). The next run's dependency linking must not follow that link and write outside.
  const lured = join(base, "lured");
  await mkdir(lured);
  const leftover = [
    'W="$PWD"',
    'for i in $(seq 1 600); do [ -e "$W/node_modules" ] || break; sleep 0.05; done',
    `mkdir -p "$W"; rm -rf "$W/node_modules"; ln -s '${lured}' "$W/node_modules" && echo linked > "$W/leftover.txt"`,
  ].join("; ");
  const spawnLeftover = `const c=require("node:child_process").spawn("sh",["-c",process.argv[1]],{detached:true,stdio:"ignore"});c.unref();console.log("pid="+c.pid+" at="+process.cwd())`;
  const planted = await run(repo, `node -e '${spawnLeftover}' '${leftover}'`);
  const [, pidText, at = ""] = /pid=(\d+) at=(\S+)/.exec(planted.output) ?? [];
  const pid = Number(pidText);
  if (!pid) add("Starts a leftover process (#150)", false, `couldn't start: ${planted.output}`);
  else {
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 400 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    if (alive()) process.kill(pid, "SIGKILL");
    // If the leftover process put a link on the path it was given, it leaves a marker next to it. It also notes what that path is now (an idle spot or an abandoned one).
    const wrote = await readFile(join(at, "leftover.txt"), "utf8").then(
      () => true,
      () => false,
    );
    add(
      "After the check ends, a leftover process puts a link pointing outside on the path it was given (#150, observed)",
      "observe",
      `${wrote ? "put it" : "couldn't put it"} (${relative(repo, at)})`,
    );
    await probe(
      "The next check runs even after there was a leftover process (#150)",
      "true",
      "check",
      "runs",
    );
    const into = await readdir(lured);
    add(
      "The runner doesn't link dependencies outside by following the link the leftover process changed (#150)",
      into.length === 0,
      into.length === 0 ? "the outside folder is empty" : `appeared outside: ${into.join(", ")}`,
    );
  }

  // 11. This repo's `npm test`
  if (!values.quick) {
    const top = await git(root, "rev-parse", "--show-toplevel");
    process.chdir(top);
    const remote = "omagari-sandbox-check";
    progress("Running npm test in this repo (a few minutes)");
    const tree = join(base, "repo-tree");
    // This repo may have no `.omagari.json`, so briefly make a fake remote-tracking ref as if it were on the default branch.
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
            // It is `npm test` as is, and at the end it prints the pass and fail counts and the names of failed tests together.
            check:
              "npm test > omagari-test.log 2>&1; code=$?; grep -E '^✖' omagari-test.log | sort -u | head -12; grep -oE '\\bE[A-Z]{3,}\\b' omagari-test.log | sort | uniq -c | sort -rn | head -5; grep -oE '[a-z]+ EPERM' omagari-test.log | sort | uniq -c | sort -rn | head -5; grep EPERM omagari-test.log | grep -vE 'listen|connect' | sort -u | head -5; grep -E '^ℹ (tests|pass|fail|cancelled)' omagari-test.log; exit $code",
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
    const commit = await git(top, "commit-tree", written, "-m", "check");
    await git(top, "update-ref", `refs/remotes/${remote}/main`, commit);
    await git(top, "symbolic-ref", `refs/remotes/${remote}/HEAD`, `refs/remotes/${remote}/main`);
    try {
      const report = (name: string, result: Awaited<ReturnType<typeof checkWork>>) => {
        const out = result.output.replace(/\s+/g, " ").trim();
        add(
          name,
          result.verdict === "pass",
          `verdict ${result.verdict}, ${(result.ms / 1000).toFixed(0)}s. ${result.reason ?? ""} End of output: ${out.slice(-700)}`,
        );
      };
      const first = await checkWork({
        folder: top,
        remote,
        sandbox: osSandbox,
        limits: CHECK_LIMITS,
      });
      report("This repo's npm test passes inside the sandbox", first);
      if (first.verdict !== "pass") {
        // Put the TMPDIR that sandbox-runtime overrides back to the temp folder the runner gave and run again (check.ts isn't changed: an experiment to see whether that works).
        const fixedTmp: typeof osSandbox = {
          unavailable: () => osSandbox.unavailable(),
          wrap: (input) =>
            osSandbox.wrap({
              ...input,
              command: `TMPDIR='${input.env.TMPDIR}'; export TMPDIR; ${input.command}`,
            }),
        };
        progress("Running npm test again with TMPDIR restored (a few minutes)");
        report(
          "(Experiment) This repo's npm test passes when TMPDIR is restored to the temp folder the runner gave",
          await checkWork({
            folder: top,
            remote,
            sandbox: fixedTmp,
            limits: CHECK_LIMITS,
          }),
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
  `**Real sandbox hand check result** (${date}, ${platform()} ${arch()}, Node ${process.version}(${process.execPath}), @anthropic-ai/sandbox-runtime ${version})\n`,
);
for (const row of rows)
  console.log(
    `- ${row.ok === true ? "[x]" : row.ok === false ? "[ ] (failed)" : "(observed)"} ${row.name}: ${row.note}`,
  );
process.exit(rows.some((row) => row.ok === false) ? 1 : 0);
