import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { dependencyProblem, NO_SECCOMP } from "@omagari/runner";
import { CHECK_LIMITS, checkWork, osSandbox } from "../packages/runner/src/check.ts";
import { fakeSandbox, startWorld, tempRepo, writer } from "./harness.ts";

/** Commits the files to the default branch (origin/main) so they look merged. The current branch must be main. */
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

test("omagari runner check carries my work, even uncommitted changes, into a temporary worktree, runs the default branch's check command inside the sandbox, and leaves it in the run log", async (t) => {
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
    "gone.txt": "file to delete\n",
  });
  await repo.git("switch", "--create", "feat");
  // Even if I change the config file on my branch and in my working folder, the default branch's command runs.
  await write(".omagari.json", config({ check: "exit 0" }));
  await repo.git("commit", "--all", "--message=my branch config");
  await write(".omagari.json", config({ check: "true" }));

  // An uncommitted deletion and an untracked new file are carried over.
  await rm(join(repo.folder, "gone.txt"));
  await write("check.sh", 'test ! -e gone.txt && test "$(cat new.txt)" = "new file"\n');
  await write("new.txt", "new file\n");
  const passed = await world.cli("runner", "check");
  assert.equal(passed.code, 0, passed.stderr);
  assert.match(
    passed.stdout,
    /Check command: sh check\.sh \(\.omagari\.json on default branch origin\/main\)/,
  );
  assert.match(passed.stdout, /Verdict: Pass \(\d+\.\ds\)/);
  assert.doesNotMatch(passed.stdout, /End of output/);

  // What was handed to the sandbox: in the temporary worktree, outside network blocked, writes only to the temporary worktree and temporary folder, reading the home folder blocked.
  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.ok(call);
  assert.notEqual(call.folder, repo.folder);
  const temp = call.env.TMPDIR;
  assert.ok(temp);
  // sandbox-runtime overrides TMPDIR to /tmp/claude when it wraps, so before the command the runner's temporary folder is restored.
  assert.equal(call.command, `export TMPDIR='${temp}'; sh check.sh`);
  // Unix sockets are opened and attached only under the temporary worktree and temporary folder (ADR-0037). The temporary folder is short, so socket paths in it don't exceed macOS's 104-byte limit.
  assert.deepEqual(call.policy.network, {
    allowedDomains: [],
    deniedDomains: [],
    allowLocalBinding: true,
    allowUnixSockets: [call.folder, temp],
  });
  assert.ok(Buffer.byteLength(join(temp, `omagari-${"0".repeat(16)}.sock`)) < 104, temp);
  assert.deepEqual(call.policy.filesystem.allowWrite?.slice(0, 2), [call.folder, temp]);
  assert.deepEqual(call.policy.filesystem.denyRead, [homedir()]);
  assert.deepEqual(call.policy.filesystem.allowRead?.slice(0, 2), [call.folder, temp]);
  // Only chosen environment variables are passed on. Variables holding tokens and keys are not.
  assert.equal(call.env.PATH, process.env.PATH);
  assert.equal(call.env.HOME, temp);
  for (const [key, value] of Object.entries(call.env)) {
    assert.match(key, /^(PATH|LANG|LANGUAGE|TERM|TZ|USER|LOGNAME|SHELL|HOME|TMPDIR|LC_\w+)$/);
    assert.doesNotMatch(value, /secret/);
  }
  // The temporary worktree is under the repo's Git folder, so it doesn't show up in my folder's worktree list.
  assert.ok(call.folder.startsWith(await realpath(join(repo.folder, ".git"))));
  assert.equal((await repo.git("worktree", "list")).split("\n").length, 1);
  assert.equal(
    await repo.git("status", "--porcelain"),
    "M .omagari.json\n M check.sh\n D gone.txt\n?? new.txt", // the one leading space is trimmed
  );

  // If it breaks, it is Broken by exit code, and the tail of the output (last 25 lines) is shown.
  await write("check.sh", "seq 1 40 >&2\necho failing test >&2\nexit 3\n");
  const broken = await world.cli("runner", "check");
  assert.equal(broken.code, 1);
  assert.match(broken.stdout, /Verdict: Broken \(\d+\.\ds\)\nEnd of output:\n {2}17\n/);
  assert.match(broken.stdout, / {2}40\n {2}failing test\n/);
  assert.doesNotMatch(broken.stdout, / {2}16\n/);

  // What ran is left in the run log: the check command, the verdict, the time taken.
  const log = await world.cli("runner", "log");
  const lines = log.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(
    lines[0] ?? "",
    /check command "sh check\.sh" {2}folder .+ {2}verdict Pass {2}\d+\.\ds$/,
  );
  assert.match(
    lines[1] ?? "",
    /check command "sh check\.sh" {2}folder .+ {2}verdict Broken {2}\d+\.\ds$/,
  );
});

test("when the config file is missing, unreadable, or the sandbox can't be used, it doesn't run and shows why and how to fix it", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;

  const none = await world.cli("runner", "check");
  assert.equal(none.code, 1);
  assert.match(none.stdout, /Verdict: Couldn't run/);
  assert.match(
    none.stdout,
    /The default branch \(origin\/main\) has no \.omagari\.json\. How to set it: /,
  );
  // A config that exists only in the working folder is not read.
  await writer(repo.folder)(".omagari.json", config({ check: "true" }));
  assert.match((await world.cli("runner", "check")).stdout, /has no \.omagari\.json/);
  await rm(join(repo.folder, ".omagari.json"));

  await merge(repo, { ".omagari.json": config({ chek: "npm test" }) });
  const wrong = await world.cli("runner", "check");
  assert.equal(wrong.code, 1);
  assert.match(
    wrong.stdout,
    /Couldn't read \.omagari\.json on the default branch \(origin\/main\) \(it isn't JSON or has the wrong shape\)\. How to set it: /,
  );

  await merge(repo, { ".omagari.json": config({ check: "true" }) });
  fake.unavailable = "Sandbox tool missing: bubblewrap. To install: sudo apt install bubblewrap";
  const unsandboxed = await world.cli("runner", "check");
  assert.equal(unsandboxed.code, 1);
  assert.match(
    unsandboxed.stdout,
    /Verdict: Couldn't run \(\d+\.\ds\)\n {2}Sandbox tool missing: bubblewrap\. To install: /,
  );
  // There is no way to run without confining it.
  assert.equal(fake.calls.length, 0);
  assert.equal((await repo.git("worktree", "list")).split("\n").length, 1);
});

test("the setup command runs before the check command, and if it fails or goes over the limit it is cut off and is Couldn't run", async (t) => {
  const fake = fakeSandbox();
  const limitMs = 2000;
  const world = await startWorld({
    sandbox: fake.sandbox,
    checkLimits: { checkMs: limitMs, setupMs: limitMs, outputBytes: 10_000 },
  });
  t.after(world.stop);
  const { repo } = world;
  // Strip the TMPDIR-restore prefix (#146) before looking. That prefix is checked separately in the first test.
  const commands = () =>
    fake.calls.splice(0).map((call) => call.command.replace(/^export TMPDIR='[^']*'; /, ""));

  await merge(repo, {
    ".omagari.json": config({
      check: "test -f prepared",
      setup: "touch prepared",
    }),
  });
  const prepared = await world.cli("runner", "check");
  assert.equal(prepared.code, 0, prepared.stdout);
  assert.match(prepared.stdout, /Setup command: touch prepared\nVerdict: Pass/);
  assert.deepEqual(commands(), ["touch prepared", "test -f prepared"]);
  // What the setup command made in the temporary worktree doesn't stay in my folder.
  await assert.rejects(access(join(repo.folder, "prepared")));

  await merge(repo, {
    ".omagari.json": config({
      check: "true",
      setup: "echo setup failed; exit 2",
    }),
  });
  const failed = await world.cli("runner", "check");
  assert.equal(failed.code, 1);
  assert.match(
    failed.stdout,
    /Verdict: Couldn't run \(.+\)\n {2}The setup command failed \(exit code 2\)\nEnd of output:\n {2}setup failed/,
  );
  assert.deepEqual(commands(), ["echo setup failed; exit 2"]);

  // What gets cut is up to what the command started. It doesn't wait out the amount past the limit.
  await merge(repo, {
    ".omagari.json": config({ check: "true", setup: "sleep 30 & wait" }),
  });
  const slowSetup = await world.cli("runner", "check");
  assert.match(
    slowSetup.stdout,
    /Verdict: Couldn't run \((\d+\.\d)s\)\n {2}The setup command was cut off at the 2 s limit/,
  );
  assert.ok(Number(/\((\d+\.\d)s\)/.exec(slowSetup.stdout)?.[1]) < 10);

  await merge(repo, {
    ".omagari.json": config({ check: "echo start; sleep 30" }),
  });
  const slow = await world.cli("runner", "check");
  assert.equal(slow.code, 1);
  assert.match(
    slow.stdout,
    /Verdict: Couldn't run \(.+\)\n {2}The check command was cut off at the 2 s limit\. A cut-off run doesn't count as a pass\nEnd of output:\n {2}start/,
  );

  await merge(repo, {
    ".omagari.json": config({ check: "yes output | head -c 100000; true" }),
  });
  const loud = await world.cli("runner", "check");
  assert.equal(loud.code, 1);
  assert.match(
    loud.stdout,
    /The check command was cut off at the output 10000 bytes limit\. A cut-off run doesn't count as a pass/,
  );

  const log = (await world.cli("runner", "log")).stdout;
  assert.match(
    log,
    /check command "true" {2}setup command "sleep 30 & wait" {2}folder .+ {2}verdict Couldn't run: The setup command was cut off at the 2 s limit/,
  );
});

// Start and stop the runner five times with the CLI.
test("when the runner starts it announces that the check command runs inside the sandbox, and what --merge-check turned off or on stays in that repo", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // a folder where alice got the repo
  t.after(desk.remove);

  /** Starts alice's runner with `omagari runner <args>` and stops it once the start notice has appeared. If it is the first time, it logs in with device auth. */
  const notice = async (...args: string[]) => {
    const runner = world.launchCliIn(desk.folder, "runner", ...args);
    t.after(() => runner.stop("SIGKILL"));
    const [, code] = await runner.output(/enter code (\S+) |Runner started/);
    if (code) world.github.approve(code, "alice");
    const [found = ""] = await runner.output(
      /Merge run \(.+\): [^\n]*(\n {2}[^\n]*)*stays in this repo\.[^\n]*\n/,
    );
    await runner.stop();
    return found;
  };

  const none = await notice();
  assert.match(
    none,
    /^Merge run \(on\): there's no check command, so nothing runs\. The default branch \(origin\/main\) has no \.omagari\.json\. How to set it: /,
  );

  await merge(desk, {
    ".omagari.json": config({ check: "npm test", setup: "npm ci" }),
  });
  const on = await notice();
  assert.match(on, /^Merge run \(on\): /);
  assert.match(on, /\n {2}Check command: npm test\n {2}Setup command: npm ci\n/);
  assert.match(
    on,
    /read from \.omagari\.json on the default branch \(origin\/main\) and run inside the sandbox/,
  );
  assert.match(on, /To turn it off: omagari runner --merge-check off\./);

  // If it is started again after the command changed, it announces the changed command again.
  await merge(desk, { ".omagari.json": config({ check: "npm run check" }) });
  const changed = await notice();
  assert.match(changed, /\n {2}Check command: npm run check\n/);
  assert.doesNotMatch(changed, /Setup command/);

  // What was turned off stays even when started again.
  assert.match(
    await notice("--merge-check", "off"),
    /^Merge run \(off\): this machine doesn't run check commands\. To turn it on: omagari runner --merge-check on\./,
  );
  assert.match(await notice(), /^Merge run \(off\)/);
  assert.match(
    await notice("--merge-check=on"),
    /^Merge run \(on\)[^\n]*\n {2}Check command: npm run check\n/,
  );

  const wrong = await world.cliIn(desk.folder, "runner", "--merge-check", "maybe");
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /Merge run must be one of on, off: maybe/);
});

test("the temporary worktree is reused under the repo's Git folder, and my folder's dependencies are linked, but workspace packages point inside the temporary worktree", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  const write = writer(repo.folder);

  // Two workspace packages, and installed dependencies: node_modules at the top and one level down, a workspace link, a scope folder.
  await merge(repo, {
    ".gitignore": "node_modules/\ndist/\n",
    ".omagari.json": config({ check: "sh check.sh" }),
    "check.sh": [
      'test "$(cat node_modules/dep/index.txt)" = "installed one"',
      'test "$(cat packages/app/node_modules/inner/index.txt)" = "inner one"',
      "echo temp only > packages/lib/code.txt",
      'test "$(cat node_modules/@ws/lib/code.txt)" = "temp only"',
      'test "$(git status --porcelain)" = " M packages/lib/code.txt"',
      "mkdir -p dist && echo built > dist/out.txt",
      "echo new file > leftover.txt",
      "",
    ].join("\n"),
    "packages/lib/code.txt": "merged code\n",
    "packages/app/package.json": "{}\n",
  });
  await write("packages/lib/code.txt", "my work's code\n");
  await write("node_modules/dep/index.txt", "installed one");
  await write("packages/app/node_modules/inner/index.txt", "inner one");
  await mkdir(join(repo.folder, "node_modules/@ws"), { recursive: true });
  // A workspace link is a relative link, like npm. This link points to my folder's packages/lib (here it reads the same file that holds my work's code).
  await symlink("../../packages/lib", join(repo.folder, "node_modules/@ws/lib"));
  const before = await repo.git("status", "--porcelain");

  const first = await world.cli("runner", "check");
  assert.match(first.stdout, /Verdict: Pass/, first.stdout);
  const second = await world.cli("runner", "check");
  assert.match(second.stdout, /Verdict: Pass/, second.stdout);

  // It runs under the repo's Git folder, and moves its place each run (#150). When it ends it goes back to the resting place. It doesn't show in my folder's git status or worktree list.
  const [one, two] = fake.calls;
  assert.ok(one && two);
  assert.notEqual(one.folder, two.folder);
  const gitDir = await realpath(join(repo.folder, ".git"));
  for (const call of [one, two]) assert.equal(dirname(call.folder), join(gitDir, "omagari"));
  const rest = join(gitDir, "omagari", "check-worktree");
  const places = await readdir(join(gitDir, "omagari"));
  assert.deepEqual(
    places.filter((name) => name.startsWith("check-")),
    ["check-worktree"],
  );
  assert.equal(await repo.git("status", "--porcelain"), before);
  assert.equal((await repo.git("worktree", "list")).split("\n").length, 1);

  // What the sandbox can read: only the object folder and the linked dependency folders. The repo's Git folder (the config that holds the remote URL's token) is not opened.
  const read = one.policy.filesystem.allowRead ?? [];
  assert.ok(read.includes(join(gitDir, "objects")));
  assert.ok(read.includes(await realpath(join(repo.folder, "node_modules"))));
  assert.ok(!read.includes(gitDir));

  // After running: tracked files are restored, new files and linked links are gone, and ignored build outputs stay.
  assert.equal(await readFile(join(rest, "packages/lib/code.txt"), "utf8"), "my work's code\n");
  await assert.rejects(access(join(rest, "leftover.txt")));
  await assert.rejects(access(join(rest, "node_modules")));
  assert.equal(await readFile(join(rest, "dist/out.txt"), "utf8"), "built\n");
  // My folder is unchanged (what the command wrote goes only to the temporary worktree).
  assert.equal(
    await readFile(join(repo.folder, "packages/lib/code.txt"), "utf8"),
    "my work's code\n",
  );
});

test("even if the check command changes the temporary worktree's Git config and hooks, the git the runner calls outside the sandbox doesn't run them (#144)", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  // If something runs outside the sandbox, a marker appears in this folder. The fake sandbox doesn't confine, so the check command writes only where the real sandbox opens (the temporary worktree and the git inside it).
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

  // It runs twice. The restore after the first and the preparation of the second are both git outside the sandbox.
  for (let round = 0; round < 2; round++) {
    const ran = await world.cli("runner", "check");
    assert.match(ran.stdout, /Verdict: Pass/, ran.stdout);
  }
  assert.deepEqual(await readdir(marks), []);
  // The Git folder that the git inside the sandbox uses is opened for writing.
  const [call] = fake.calls;
  assert.ok(call);
  assert.equal(call.policy.filesystem.allowWrite?.length, 3);
});

test("even if a leftover process after the check, or the check command, swaps the temporary worktree's dependency places for links that point outside, the runner doesn't write or delete outside the sandbox (#150)", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  const write = writer(repo.folder);
  // Outside: an empty folder where the leftover process turns node_modules, and a folder where the check command turns packages/app.
  const outside = await mkdtemp(join(tmpdir(), "omagari-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(outside, "empty"));
  await mkdir(join(outside, "app/node_modules/keep"), { recursive: true });
  const done = join(outside, "leftover-done");
  // The leftover process leaves its process group (detached), waits for the check to end, and then puts a link at the temporary worktree path it was handed.
  // Like the real sandbox, it writes only inside the path it was handed. When done (even on failure) it leaves a marker (used only for the test to wait on).
  const leftover = [
    'W="$PWD"',
    `for i in $(seq 1 400); do [ -e "$W/node_modules" ] || break; sleep 0.05; done`,
    `ln -s '${join(outside, "empty")}' "$W/node_modules"; touch '${done}'`,
  ].join("; ");
  const spawnLeftover = `require("node:child_process").spawn("sh", ["-c", process.argv[1]], { detached: true, stdio: "ignore" }).unref()`;
  await merge(repo, {
    // Without a trailing /, the link is also ignored, so the restore (git clean) doesn't remove it.
    ".gitignore": "node_modules\n",
    ".omagari.json": config({ check: "sh check.sh" }),
    "check.sh": [
      `[ -e '${done}' ] || '${process.execPath}' -e '${spawnLeftover}' '${leftover}'`,
      `rm -rf packages/app && ln -s '${join(outside, "app")}' packages/app`,
      "",
    ].join("\n"),
    "packages/app/package.json": "{}\n",
  });
  await write("node_modules/dep/index.txt", "installed one");
  await write("packages/app/node_modules/inner/index.txt", "inner one");

  const first = await world.cli("runner", "check");
  assert.match(first.stdout, /Verdict: Pass/, first.stdout);
  for (let i = 0; i < 200; i++) {
    if (
      await access(done).then(
        () => true,
        () => false,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await access(done);
  const second = await world.cli("runner", "check");
  assert.match(second.stdout, /Verdict: Pass/, second.stdout);

  // The leftover process didn't link dependencies outside by following the link it turned, and didn't delete the outside node_modules by following the packages/app link.
  assert.deepEqual(await readdir(join(outside, "app/node_modules")), ["keep"]);
  assert.deepEqual(await readdir(join(outside, "empty")), []);
});

const WSL_MOUNTS = [
  "/dev/sdc / ext4 rw 0 0",
  "C:\\134 /mnt/c 9p rw,noatime 0 0",
  "D:\\134 /win/d\\040x drvfs rw 0 0",
  "drivers /usr/lib/wsl/drivers 9p ro 0 0",
].join("\n");

test("it blocks reading the places where Windows drives are mounted in WSL2's mount list, and doesn't change the blocking on other machines", async (t) => {
  const repo = await tempRepo();
  t.after(repo.remove);
  await merge(repo, { ".omagari.json": config({ check: "true" }) });
  const policyOf = async (mounts?: string) => {
    const fake = fakeSandbox();
    const result = await checkWork({
      folder: repo.folder,
      remote: "origin",
      sandbox: fake.sandbox,
      limits: CHECK_LIMITS,
      mounts: async () => mounts,
    });
    assert.equal(result.verdict, "pass", result.reason);
    return fake.calls[0]?.policy.filesystem;
  };
  const wsl = await policyOf(WSL_MOUNTS);
  assert.deepEqual(wsl?.denyRead, [homedir(), "/mnt/c", "/win/d x"]);
  // The temporary worktree is reopened even on top of a hidden place.
  assert.ok(
    wsl?.allowRead?.some((p) =>
      String(typeof p === "string" ? p : p.path).includes("omagari-check-"),
    ),
  );
  assert.deepEqual((await policyOf(undefined))?.denyRead, [homedir()]);
});

test("on plain Windows, the reason for Couldn't run is the WSL2 guidance", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    assert.match((await osSandbox.unavailable()) ?? "", /start the runner inside WSL2/);
  } finally {
    Object.defineProperty(process, "platform", platform as PropertyDescriptor);
  }
});

test("when a solo run on Linux looks broken by the Unix socket block, a reason is added; when it broke regardless of sockets or the machine doesn't block sockets, it isn't added", async (t) => {
  const fake = fakeSandbox();
  fake.blocksUnixSockets = true;
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  const socketFail = "echo 'Error: listen EPERM: operation not permitted /tmp/a.sock'; exit 1";

  await merge(repo, { ".omagari.json": config({ check: socketFail }) });
  const blocked = await world.cli("runner", "check");
  assert.match(
    blocked.stdout,
    /Verdict: Broken \(\d+\.\ds\)\n {2}On this machine \(Linux\) the sandbox blocks Unix sockets/,
  );

  await merge(repo, {
    ".omagari.json": config({ check: "echo assertion failed; exit 1" }),
  });
  assert.doesNotMatch((await world.cli("runner", "check")).stdout, /Unix sockets/);

  // On a machine that doesn't block sockets (macOS), it isn't added even for the same output.
  await merge(repo, { ".omagari.json": config({ check: socketFail }) });
  fake.blocksUnixSockets = false;
  assert.doesNotMatch((await world.cli("runner", "check")).stdout, /blocks Unix sockets/);
});

test("when the warning that the seccomp helper is missing appears, the machine can't use the sandbox, and other warnings don't block it", () => {
  const seccomp = "seccomp not available - unix socket access not restricted";
  assert.equal(dependencyProblem({ errors: [], warnings: [seccomp] }), NO_SECCOMP);
  assert.match(NO_SECCOMP, /To fix it: /);
  assert.equal(
    dependencyProblem({
      errors: [],
      warnings: ["bubblewrap 0.4.1 is older than 0.5.0"],
    }),
    undefined,
  );
  assert.match(
    dependencyProblem({
      errors: ["socat not installed"],
      warnings: [seccomp],
    }) ?? "",
    /socat/,
  );
});

test("the .env and .env.* that observation always leaves out are not put into the check tree either, so they can't leave through the check command's output", async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({ sandbox: fake.sandbox });
  t.after(world.stop);
  const { repo } = world;
  await merge(repo, {
    ".omagari.json": config({
      check: "test ! -e .env && test ! -e config/.env.local && test -e .env.example",
    }),
    ".env.example": "KEY=\n",
  });
  const write = writer(repo.folder);
  await write(".env", "KEY=DUMMY-SECRET\n"); // untracked and not gitignored
  await write("config/.env.local", "KEY=DUMMY-SECRET\n");

  const checked = await world.cli("runner", "check");
  assert.match(checked.stdout, /Verdict: Pass/);
  // Files in my folder are unchanged.
  assert.equal(await readFile(join(repo.folder, ".env"), "utf8"), "KEY=DUMMY-SECRET\n");
});
