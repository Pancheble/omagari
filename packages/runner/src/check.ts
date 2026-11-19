// Check command: reads only the default branch's version of the config file committed to the repo (ADR-0034), and runs only inside the sandbox in a temp worktree (ADR-0033).
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import {
  CHECK_FILE,
  CheckConfig,
  type CheckReading,
  type ObservedFile,
  type Verdict,
} from "@omagari/contract";
import { secret } from "./observe.ts";

const execFileAsync = promisify(execFile);

/** Limits (Room's values, ADR-0035). Past them the run is cut off, and a cut-off run is not a pass. Tests shrink them when they start the runner. */
export const CHECK_LIMITS = {
  checkMs: 5 * 60_000,
  setupMs: 10 * 60_000,
  outputBytes: 4 * 1024 * 1024,
};
export type CheckLimits = typeof CHECK_LIMITS;

/** The tail of the output: the last 25 lines (Room's value). If lines are very long, it keeps at most 4000 characters in total. */
const TAIL_LINES = 25;
const TAIL_CHARS = 4000;
/** Output held while the command runs. Only the tail is shown, so the front is dropped. */
const KEEP_CHARS = 64 * 1024;

/** Environment variables passed into the sandbox. Only these and ones starting with `LC_` are passed. Variables that hold tokens or keys are not passed (ADR-0033). */
const PASSED_ENV = ["PATH", "LANG", "LANGUAGE", "TERM", "TZ", "USER", "LOGNAME", "SHELL"];

/**
 * The runner's outer boundary: the sandbox. Builds the exec arguments that run one shell command locked in. The runner starts it in `folder` with only `env`.
 * The real one is `@anthropic-ai/sandbox-runtime` (`osSandbox`). Tests plug a fake in here.
 */
export type Sandbox = {
  /** A machine like Linux, where the sandbox blocks every Unix socket. If a command that ran alone breaks because of sockets, this reason gets attached. */
  blocksUnixSockets?: boolean;
  /** Why the sandbox can't be used on this machine, and how to install it. Absent if it can be used. */
  unavailable(): Promise<string | undefined>;
  wrap(input: SandboxInput): Promise<string[]>;
};
export type SandboxInput = {
  /** One shell command line */
  command: string;
  /** Folder the command runs in (the temp worktree) */
  folder: string;
  /** All the environment variables passed in */
  env: Record<string, string>;
  /** The blocking config. Passed straight to `@anthropic-ai/sandbox-runtime`. */
  policy: SandboxRuntimeConfig;
};

/** How to install the sandbox tools. macOS needs nothing extra. */
const INSTALL =
  "On Linux, install bubblewrap, socat, and ripgrep (for example: sudo apt install bubblewrap socat ripgrep). From Ubuntu 24.04, if AppArmor blocks it, you have to allow unprivileged user namespaces for bubblewrap";

/** Why the check doesn't run on a machine without the seccomp helper (Linux other than x64 and arm64), and how to fix it. */
export const NO_SECCOMP =
  "This machine has no sandbox-runtime seccomp helper, so it can't block Unix sockets. It won't run without blocking them. To fix it: start the runner on x64 or arm64 Linux (or WSL2 on top of it)";

/** The reason that the sandbox on Linux blocks every Unix socket. Attached to "cannot tell" when a command that ran alone broke because of the socket blocking (ADR-0038). */
export const SOCKET_BLOCKED =
  "On this machine (Linux) the sandbox blocks Unix sockets. A check command that uses sockets breaks even when run alone, so you can't tell whether the merge broke it";

/** The output shows signs of breaking because sockets were blocked: it mentions sockets and also has a permission error (seccomp returns `EPERM`). A heuristic. */
const socketTrouble = (output: string) =>
  /EPERM|Operation not permitted/i.test(output) &&
  /socket|\blisten\b|\bconnect\b|\bbind\b|AF_UNIX|\.sock\b/i.test(output);

/**
 * Why this machine can't be used, from the sandbox-runtime's tool check result. An error means the tool is missing,
 * and a seccomp warning means it would run without blocking sockets, which breaks the blocking in ADR-0038, so it doesn't run.
 * Other warnings (bubblewrap below 0.5 and so on) don't block it: seccomp blocks every Unix socket right now, so there are no socket files to hide, and the write, network, and home blocking still hold (#163).
 */
export function dependencyProblem({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (errors.length > 0)
    return `Sandbox tools are missing: ${errors.join(", ")}. To install: ${INSTALL}`;
  if (warnings.some((warning) => warning.includes("seccomp not available"))) return NO_SECCOMP;
}

/** Initialization that starts the proxy. Done once. The blocking config is passed with each command. */
let initialized: Promise<void> | undefined;

/** The sandbox on this machine: `sandbox-exec` on macOS, bubblewrap on Linux (ADR-0033). On a machine that doesn't use it, it isn't even loaded. */
export const osSandbox: Sandbox = {
  blocksUnixSockets: process.platform === "linux",
  async unavailable() {
    if (process.platform !== "darwin" && process.platform !== "linux")
      return process.platform === "win32"
        ? "On Windows, start the runner inside WSL2. Keep the repo inside WSL2 too, and install bubblewrap, socat, and ripgrep in WSL2 (ADR-0038)"
        : `The sandbox can't be used on this machine (${process.platform}), so nothing runs. Only a runner started on macOS, Linux, or Windows WSL2 runs check commands`;
    const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
    return dependencyProblem(await SandboxManager.checkDependenciesAsync());
  },
  async wrap({ command, policy }) {
    const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
    initialized ??= SandboxManager.initialize(policy).catch((error) => {
      initialized = undefined;
      throw error;
    });
    await initialized;
    // 0.0.81 reads the Unix socket allowance (`network.allowUnixSockets`) only from the config set by `initialize` and `updateConfig`, not from the config passed per command
    // (`getAllowUnixSockets` in `sandbox-manager.js`). The temp folder differs on every run, so we set it to this run's config each time. Only one run goes at a time (`turn`).
    SandboxManager.updateConfig(policy);
    return ["/bin/sh", "-c", await SandboxManager.wrapWithSandbox(command, undefined, policy)];
  },
};

/** How to set it. Attached when the config is missing or couldn't be read. */
const HOW = `How to set it: commit ${CHECK_FILE} at the top of the repo as {"check": "<check command>", "setup": "<setup command, optional>"} and merge it into the default branch`;

/**
 * The config read from the default branch. If read, `config`. If not, the reason with how to set it (`problem`) and its kind (`why`, which goes to the server).
 * `branch` is the remote-tracking branch it was read from.
 */
export type CheckRead = { branch?: string } & (
  | { config: CheckConfig; problem?: undefined; why?: undefined }
  | {
      config?: undefined;
      problem: string;
      why: Extract<CheckReading, { problem: unknown }>["problem"];
    }
);

/** The form reported to the server (`checkCommand`). It carries only the command, and only the kind of reason. */
export const checkReading = (read: CheckRead): CheckReading =>
  read.config ? { config: read.config } : { problem: read.why };

const gitOut = async (folder: string, args: string[], env?: Record<string, string>) =>
  (
    await execFileAsync("git", ["-C", folder, ...args], {
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout.trim();

/**
 * Reads the config file from the default branch of `remote` (`refs/remotes/<remote>/HEAD`). It doesn't read the working folder's or my branch's version (ADR-0034).
 * It's remote-tracking, so it only knows what has been fetched.
 */
export async function readCheck(folder: string, remote: string | undefined): Promise<CheckRead> {
  if (!remote)
    return {
      why: "unknown_branch",
      problem: "Don't know the repo's GitHub remote, so the default branch couldn't be read",
    };
  const ref = `refs/remotes/${remote}/HEAD`;
  const branch = await gitOut(folder, ["rev-parse", "--abbrev-ref", ref]).catch(() => undefined);
  if (!branch)
    return {
      why: "unknown_branch",
      problem: `Don't know the default branch of ${remote}. Set it with git remote set-head ${remote} --auto`,
    };
  const text = await gitOut(folder, ["show", `${ref}:${CHECK_FILE}`]).catch(() => undefined);
  if (text === undefined)
    return {
      branch,
      why: "missing",
      problem: `The default branch (${branch}) has no ${CHECK_FILE}. ${HOW}`,
    };
  let parsed: ReturnType<typeof CheckConfig.safeParse> | undefined;
  try {
    parsed = CheckConfig.safeParse(JSON.parse(text));
  } catch {}
  if (!parsed?.success)
    return {
      branch,
      why: "invalid",
      problem: `Couldn't read ${CHECK_FILE} on the default branch (${branch}) (it isn't JSON or has the wrong shape). ${HOW}`,
    };
  return { branch, config: parsed.data };
}

/** What to tell the owner when the runner starts: whether merge runs are on and, if so, which command runs where (ADR-0034). */
export function checkNotice(read: CheckRead, on: boolean) {
  const toggle = `omagari runner --merge-check ${on ? "off" : "on"}`;
  if (!on)
    return `Merge run (off): this machine doesn't run check commands. To turn it on: ${toggle}. Your choice stays in this repo.`;
  if (!read.config)
    return `Merge run (on): there's no check command, so nothing runs. ${read.problem}\n  To turn it off: ${toggle}. Your choice stays in this repo.`;
  return [
    "Merge run (on): when your work and another member's work hit a (guessed) indirect conflict, the two works are merged and the command below runs on this machine automatically.",
    `  Check command: ${read.config.check}`,
    ...(read.config.setup ? [`  Setup command: ${read.config.setup}`] : []),
    `  The commands are read from ${CHECK_FILE} on the default branch (${read.branch}) and run inside the sandbox: outside network, writes outside the temp folder, and reads of the home folder are blocked.`,
    `  To turn it off: ${toggle}. Your choice stays in this repo. To see whether it runs on this machine, use omagari runner check.`,
  ].join("\n");
}

/** `path` is under `home` (not `home` itself). */
const under = (home: string, path: string) => {
  const inner = relative(home, path);
  return isAbsolute(path) && inner !== "" && !inner.startsWith("..") && !isAbsolute(inner);
};

/**
 * The place in the `/proc/mounts` text where Windows drives are mounted. WSL2 mounts drives as 9p (formerly `drvfs`) with a source like `C:\\`.
 * The mount point can change through automount `root` in `/etc/wsl.conf`, so we read it from the list instead of guessing the name (ADR-0038).
 * Spaces are written as `\\040`.
 */
export function windowsDrives(mounts: string | undefined): string[] {
  const octal = (text: string) =>
    text.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  return (mounts ?? "")
    .split("\n")
    .map((line) => line.split(" "))
    .filter(
      ([source = "", , type = ""]) =>
        /^[A-Za-z]:/.test(octal(source)) && ["9p", "drvfs"].includes(type),
    )
    .map(([, at = ""]) => octal(at));
}

/** The `/proc/mounts` text if this is WSL2. Otherwise nothing. The WSL2 kernel name contains `microsoft`. */
export async function osMounts(): Promise<string | undefined> {
  if (process.platform !== "linux") return undefined;
  const release = await readFile("/proc/sys/kernel/osrelease", "utf8").catch(() => "");
  if (!/microsoft/i.test(release)) return undefined;
  return readFile("/proc/mounts", "utf8").catch(() => undefined);
}

/**
 * The folder that holds the `apply-seccomp` helper (Unix socket blocking) that the first line inside the sandbox calls on Linux. The runner's `node_modules` may be under the user's home folder,
 * and if the home read-blocking hides it, the command can't start and fails with `No such file or directory`, so we reopen it (#174). The location matches `vendor/seccomp/<arch>`, which sandbox-runtime looks for.
 */
function seccompHelper() {
  if (process.platform !== "linux") return [];
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : undefined;
  if (!arch) return [];
  const entry = fileURLToPath(import.meta.resolve("@anthropic-ai/sandbox-runtime"));
  return [join(dirname(dirname(entry)), "vendor", "seccomp", arch)];
}

/**
 * The blocking config (ADR-0033): blocks the outside network but allows this machine's own ports. Unix sockets can be opened and connected to only under `sockets` (the temp worktree and temp folder) (ADR-0037). Writes are allowed only to the temp worktree, the temp folder, and the Git folder that git inside the sandbox uses.
 * Reads block the home folder and reopen only the temp worktree, the temp folder, the tool locations, the linked dependency folders, and the repo's objects folder. The repo's Git folder is not opened (the remote URL may hold a token). The tool locations are the ones under the home folder
 * among where the Node that runs the runner is installed and the PATH folders (a machine where Node is installed in the home folder, like nvm).
 */
function policy(
  writable: string[],
  extraRead: string[],
  sockets: string[],
  drives: string[],
): SandboxRuntimeConfig {
  const home = homedir();
  const node = dirname(dirname(process.execPath));
  // WSL2's PATH has Windows-side folders mixed in. We don't reopen those, and only open the drive location when Node is on a drive.
  const tools = [node, ...(process.env.PATH ?? "").split(delimiter)].filter(
    (path) =>
      under(home, path) || (path === node && drives.some((d) => path === d || under(d, path))),
  );
  return {
    network: {
      allowedDomains: [],
      deniedDomains: [],
      allowLocalBinding: true,
      allowUnixSockets: sockets,
    },
    filesystem: {
      denyRead: [home, ...drives],
      allowRead: [...writable, ...new Set([...tools, ...extraRead, ...seccompHelper()])],
      allowWrite: writable,
      denyWrite: [],
    },
  };
}

/** The environment variables passed in. The home folder can't be read, so `HOME` and `TMPDIR` point to the temp folder so tools write their config and cache there. */
function passedEnv(temp: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && (PASSED_ENV.includes(key) || key.startsWith("LC_")))
      env[key] = value;
  return { ...env, HOME: temp, TMPDIR: temp };
}

const duration = (ms: number) => (ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`);
const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024}MB` : `${bytes} bytes`;

/** The tail of the output. Terminal control characters are removed. */
function tail(output: string) {
  const lines = stripVTControlCharacters(output).trimEnd().split(/\r?\n/);
  return lines.slice(-TAIL_LINES).join("\n").slice(-TAIL_CHARS);
}

/**
 * Runs one shell command locked in the sandbox within the limits. If time or output (when `outputBytes` is given) goes over, it cuts the run off and returns the limit that was exceeded (`cut`).
 * It starts in its own process group, so when the run is cut off or ends, anything the command started and left behind is killed too.
 */
async function sandboxed(
  sandbox: Sandbox,
  input: SandboxInput,
  limits: { ms: number; outputBytes?: number },
) {
  const [file = "", ...args] = await sandbox.wrap(input);
  const child = spawn(file, args, {
    cwd: input.folder,
    env: input.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const killGroup = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {} // Already finished
  };
  let output = "";
  let bytes = 0;
  let cut: string | undefined;
  const stop = (limit: string) => {
    cut ??= limit;
    killGroup();
  };
  const timer = setTimeout(() => stop(duration(limits.ms)), limits.ms);
  const take = (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (limits.outputBytes !== undefined && bytes > limits.outputBytes)
      return stop(`output ${size(limits.outputBytes)}`);
    output = (output + chunk).slice(-KEEP_CHARS);
  };
  child.stdout.setEncoding("utf8").on("data", take);
  child.stderr.setEncoding("utf8").on("data", take);
  // If something started in the background after the shell ends (like a server a test started) holds the output, it never closes. When the shell ends, we kill the whole group.
  child.once("exit", killGroup);
  try {
    const [code] = (await once(child, "close")) as [number | null];
    return { code, cut, output: tail(output) };
  } finally {
    clearTimeout(timer);
  }
}

/** Names of the dependency folders to link. */
const DEPS = ["node_modules", ".venv"];
/** The folder that holds packages one level down. */
const GROUPS = ["packages", "apps", "libs"];

/**
 * Links one dependency folder (`src`) of my folder to the same place (`dst`) in the temp worktree. If we linked it whole, Node would resolve the link to the real path
 * and workspace packages would be read from my folder's code, not the merged code. So `node_modules` is linked entry by entry (`@scope` and `.bin` go one level deeper),
 * and links that point to a package in my folder are re-pointed to the same package in the temp worktree.
 */
async function mirror(src: string, dst: string, folder: string, worktree: string) {
  await mkdir(dst);
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    const real = await realpath(from).catch(() => undefined);
    if (!real) continue; // Broken link
    const inner = relative(folder, real);
    if (entry.isSymbolicLink() && under(folder, real) && !inner.split(sep).includes("node_modules"))
      await symlink(join(worktree, inner), to);
    else if (entry.isDirectory() && (entry.name.startsWith("@") || entry.name === ".bin"))
      await mirror(from, to, folder, worktree);
    else await symlink(real, to);
  }
}

/**
 * There's no link on the way to `path` (`path` starts from a real path). Checked before writing to or deleting from the temp worktree outside the sandbox.
 * It's so we don't follow a link the check command swapped in and write outside the sandbox (#150).
 */
const direct = async (path: string) => (await realpath(path).catch(() => "")) === path;

/**
 * Links my folder's top-level dependency folders and the ones one level down into the temp worktree. Returns the linked places (in the worktree) and the real folders to read.
 * If something is already at the place to link (even a link left by a previous check command), it's deleted and made fresh without following it. A place with a link on the way is skipped.
 */
async function linkDeps(folder: string, worktree: string) {
  const places = [""];
  for (const group of GROUPS) {
    const names = await readdir(join(folder, group)).catch(() => []);
    for (const name of names) places.push(join(group, name));
  }
  const links: string[] = [];
  const reads: string[] = [];
  for (const place of places) {
    const at = join(worktree, place);
    if (!(await direct(at)) || !(await stat(at)).isDirectory()) continue;
    for (const dep of DEPS) {
      const src = join(folder, place, dep);
      if (!(await stat(src).catch(() => undefined))?.isDirectory()) continue;
      const dst = join(at, dep);
      await rm(dst, { recursive: true, force: true });
      if (dep === "node_modules") await mirror(src, dst, folder, worktree);
      else await symlink(await realpath(src), dst);
      links.push(dst);
      reads.push(await realpath(src));
    }
  }
  return { links, reads };
}

/** Doesn't read the user's or system's Git config. It stops the merged code's `.gitattributes` from calling that config's filters (for example git-lfs) outside the sandbox. */
const NO_USER_CONFIG = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

/**
 * The git the runner calls on the temp worktree outside the sandbox (#144). It uses the runner's Git folder (`gitDir`), which the sandbox can't write,
 * and never finds or reads the temp worktree's `.git`. The config (`core.fsmonitor`, `core.hooksPath`, filters) and hooks the check command wrote there don't run.
 */
const workGit = (gitDir: string, worktree: string, args: string[]) =>
  gitOut(worktree, [`--git-dir=${gitDir}`, `--work-tree=${worktree}`, ...args], NO_USER_CONFIG);

/**
 * Sets the temp worktree to `tree` (my work). Tracked files are reverted and new untracked files are deleted, but ignored files (build outputs) stay.
 */
async function reset(gitDir: string, worktree: string, tree: string) {
  await workGit(gitDir, worktree, ["read-tree", "--reset", tree]);
  await workGit(gitDir, worktree, ["checkout-index", "--all", "--force"]);
  await workGit(gitDir, worktree, ["clean", "--force", "-d", "--quiet"]);
}

/** Runs only one at a time. It reuses a single temp worktree, so overlapping runs would overwrite each other. */
let turn: Promise<unknown> = Promise.resolve();

/**
 * Puts every file in my folder (including uncommitted changes and new untracked files, but not gitignored ones) into a temp index (`index`) and writes it as a tree.
 * It doesn't touch my folder's index. The tree stays as an object in the repo, so the same content gives the same id (the merge run's fingerprint).
 */
export async function workTree(folder: string, index: string) {
  // Starting from the current index means unchanged files aren't read again. If there's none (a repo with no commits), we start from an empty index.
  const current = await gitOut(folder, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  await copyFile(current, index).catch(() => {});
  const withIndex = { GIT_INDEX_FILE: index };
  await gitOut(folder, ["add", "--all"], withIndex);
  // What the observation always leaves out (.env, .env.*) isn't put in the check tree either. It stops the merged code from printing it and sending it to the server.
  const secrets = (await gitOut(folder, ["ls-files", "--cached", "-z"], withIndex))
    .split("\0")
    .filter((path) => path && secret(path));
  if (secrets.length > 0) {
    const drop = execFileAsync(
      "git",
      ["-C", folder, "update-index", "--force-remove", "-z", "--stdin"],
      {
        env: { ...process.env, ...withIndex },
      },
    );
    drop.child.stdin?.end(secrets.join("\0"));
    await drop;
  }
  return gitOut(folder, ["write-tree"], withIndex);
}

/**
 * The other work in a merge run: the observation uploaded to the server, and the base commit of my work.
 * With `alone`, it doesn't merge and runs only one side (ADR-0035): `mine` is my tree, `theirs` is the other side's version (a tree made by putting the observation on the other side's base commit).
 */
export type MergeWith = {
  base: string;
  theirs: { base: string; files: ObservedFile[] };
  alone?: "mine" | "theirs";
};

/**
 * Merges the other side's changed files into my tree (`mine`) with Git (ADR-0036). The other side's version is a tree made by putting the observation's content on the other side's base commit,
 * and the ancestor is where the two base commits diverged. Files with missing content aren't put on (it runs without that file). If lines conflict, you get the reason instead of a merged tree.
 */
async function mergeTree(
  folder: string,
  run: string,
  mine: string,
  { base, theirs, alone }: MergeWith,
) {
  if (alone === "mine") return { tree: mine };
  const known = await gitOut(folder, ["cat-file", "-e", `${theirs.base}^{commit}`]).then(
    () => true,
    () => false,
  );
  if (!known)
    return {
      problem: `The other side's base commit (${theirs.base.slice(0, 7)}) isn't on this machine. Fetch it with git fetch and it will run next time`,
    };
  const ancestor = await gitOut(folder, ["merge-base", base, theirs.base]).catch(() => "");
  if (!ancestor)
    return {
      problem: "The two works' base commits have no point where they diverged (unrelated history)",
    };
  const withIndex = { GIT_INDEX_FILE: join(run, "theirs-index") };
  await gitOut(folder, ["read-tree", theirs.base], withIndex);
  // ponytail: Every file of the other side is put on as a regular file (100644). If the executable bit or symlinks become a problem, put the mode in the observation.
  const lines: string[] = [];
  for (const file of theirs.files) {
    if ("omitted" in file) continue;
    if ("deleted" in file) {
      lines.push(`0 ${"0".repeat(40)}\t${file.path}`);
      continue;
    }
    const blob = execFileAsync("git", ["-C", folder, "hash-object", "-w", "--stdin"]);
    blob.child.stdin?.end(file.content);
    lines.push(`100644 ${(await blob).stdout.trim()}\t${file.path}`);
  }
  const update = execFileAsync("git", ["-C", folder, "update-index", "--index-info"], {
    env: { ...process.env, ...withIndex },
  });
  update.child.stdin?.end(lines.map((line) => `${line}\n`).join(""));
  await update;
  const their = await gitOut(folder, ["write-tree"], withIndex);
  if (alone === "theirs") return { tree: their };
  // On conflict it exits with 1; the first line is the merged tree (with conflict markers), and after that are the conflicting paths.
  const merged = await execFileAsync("git", [
    "-C",
    folder,
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    `--merge-base=${ancestor}`,
    mine,
    their,
  ]).then(
    ({ stdout }) => ({ clean: true, out: stdout }),
    (error) => {
      if (error.code !== 1) throw error;
      return { clean: false, out: String(error.stdout) };
    },
  );
  const [tree = "", ...paths] = merged.out.trim().split("\n");
  if (!merged.clean)
    return {
      problem: `Lines conflict, so it can't merge: ${paths.join(", ")}`,
    };
  return { tree };
}

/**
 * The tree of an observation uploaded to the server (its content put on that work's base commit). Used when a debate experiment treats the absent member's work as "my tree" (ADR-0040).
 * Done only with a temp index in the runner's repo. If the base commit isn't on this machine, you get the reason.
 */
export async function observedTree(folder: string, work: { base: string; files: ObservedFile[] }) {
  const run = await mkdtemp(join(tmpdir(), "omagari-tree-"));
  try {
    return await mergeTree(folder, run, "", {
      base: work.base,
      theirs: work,
      alone: "theirs",
    });
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}

/**
 * A tree made by putting a patch on a tree (`tree`) (the experiment in ADR-0040). Done only with a temp index in the runner's repo (`git apply --cached`). It doesn't touch my folder's files, index, or branch.
 * If it doesn't apply, you get the reason. `git apply` rejects paths that point outside the repo.
 */
async function patchTree(folder: string, run: string, tree: string, patch: string) {
  const withIndex = {
    ...NO_USER_CONFIG,
    GIT_INDEX_FILE: join(run, "patch-index"),
  };
  await gitOut(folder, ["read-tree", tree], withIndex);
  const apply = execFileAsync("git", ["-C", folder, "apply", "--cached", "--whitespace=nowarn"], {
    env: { ...process.env, ...withIndex },
  });
  apply.child.stdin?.end(patch);
  const failed = await apply.then(
    () => undefined,
    (error) => String(error.stderr ?? error.message).trim(),
  );
  if (failed !== undefined) return { problem: `The patch doesn't apply: ${failed}` };
  return { tree: await gitOut(folder, ["write-tree"], withIndex) };
}

/**
 * Sets up the temp worktree: it's placed under the repo's Git folder (`<Git folder>/omagari/check-worktree`) and reused. It doesn't show up in my folder's `git status` or in the observation.
 * While running, it's moved to a fresh place per run (`<Git folder>/omagari/check-run-*`), and when the run ends it's moved back to the resting place. The sandbox opens writes by path, so
 * a process the check command left behind after escaping its process group can write only to the previous run's place, not to the resting place or the next run's place (#150).
 * We don't use `git worktree add`. That would make `git` inside the sandbox read the repo's whole Git folder (including the config with the token in the remote URL).
 * Instead it has its own Git folder and borrows only the objects folder for reading (alternates). So the sandbox needs only the objects folder opened.
 * There are two Git folders (#144). The one the runner uses (`<run>/runner-git`) can't be written by the sandbox, and the one git inside the sandbox uses (`<run>/git`) is a copy of it.
 * The temp worktree's `.git` is a file that points to the latter. Both are freshly made in this run's temp folder, so we don't trust anything left over from a previous run.
 * Then it's set to `tree` (my work or the merged one).
 */
async function prepareWork(folder: string, run: string, tree: string) {
  const gitDir = join(run, "runner-git");
  const sandboxGit = join(run, "git");
  const common = await realpath(
    await gitOut(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const rest = join(common, "omagari", "check-worktree");
  await mkdir(dirname(rest), { recursive: true });
  const worktree = await mkdtemp(join(dirname(rest), "check-run-"));
  const head = await gitOut(folder, ["rev-parse", "HEAD"]);
  // Hooks are left out (`--template=`).
  await gitOut(run, ["init", "--quiet", "--bare", "--template=", gitDir], NO_USER_CONFIG);
  await mkdir(join(gitDir, "objects", "info"), { recursive: true });
  await writeFile(join(gitDir, "objects", "info", "alternates"), `${join(common, "objects")}\n`);
  const place = async () => {
    // Move the one at the resting place to this run's place (moved onto an empty folder). If there's none (first time, or it was broken and deleted), start empty.
    await rename(rest, worktree).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await mkdir(worktree, { recursive: true });
    // Delete the `.git` a previous run's check command changed. Even if it's a link, we don't follow it.
    await rm(join(worktree, ".git"), { recursive: true, force: true });
    await workGit(gitDir, worktree, ["update-ref", "--no-deref", "HEAD", head]);
    await reset(gitDir, worktree, tree);
    await cp(gitDir, sandboxGit, { recursive: true });
    await gitOut(run, [`--git-dir=${sandboxGit}`, "config", "core.bare", "false"], NO_USER_CONFIG);
    // `wx`: if something appeared in the meantime, it fails instead of following it and writing.
    await writeFile(join(worktree, ".git"), `gitdir: ${sandboxGit}\n`, {
      flag: "wx",
    });
  };
  // If the previous run died and left it broken, delete it and build from scratch.
  await place().catch(async () => {
    await rm(worktree, { recursive: true, force: true });
    await rm(rest, { recursive: true, force: true });
    await rm(sandboxGit, { recursive: true, force: true });
    await place();
  });
  return { worktree, rest, tree, common, gitDir, sandboxGit };
}

/** The result of `checkWork`. Same as `checked` in the contract. */
export type CheckResult = {
  verdict: Verdict;
  reason?: string;
  branch?: string;
  config?: CheckConfig;
  ms: number;
  output: string;
};

/**
 * Runs the default branch's check command once, inside the sandbox, on my work in `folder` (`omagari runner check`).
 * With `merge`, it runs on my work merged with the other side's work (a merge run). If lines conflict and can't merge, it's "could not run".
 * With `patch`, it puts the patch on top and runs (a debate experiment). If it doesn't apply, it's "could not run".
 * If there's a setup command, it runs first, and if that fails, it's "could not run". If the config couldn't be read or the sandbox can't be used, nothing runs.
 * There's no way to run without locking it in. The temp worktree sits under the repo's Git folder and is reused.
 */
export function checkWork(options: {
  folder: string;
  remote: string | undefined;
  sandbox: Sandbox;
  limits: CheckLimits;
  /** My tree already written (`workTree`). If absent, it's written from the current folder. */
  tree?: string;
  /** The other side's work for a merge run. If absent, only my work runs. */
  merge?: MergeWith;
  /** The patch to put on the merged result, for a debate experiment. */
  patch?: string;
  /** Where to get the `/proc/mounts` text of WSL2. Tests plug it in to pretend to be WSL2. By default it looks at this machine (`osMounts`). */
  mounts?: () => Promise<string | undefined>;
}): Promise<CheckResult> {
  const result = turn.then(() => checkOne(options));
  turn = result.catch(() => {});
  return result;
}

async function checkOne(options: {
  folder: string;
  remote: string | undefined;
  sandbox: Sandbox;
  limits: CheckLimits;
  /** My tree already written (`workTree`). If absent, it's written from the current folder. */
  tree?: string;
  /** The other side's work for a merge run. If absent, only my work runs. */
  merge?: MergeWith;
  patch?: string;
  mounts?: () => Promise<string | undefined>;
}): Promise<CheckResult> {
  const { folder, sandbox, limits } = options;
  const started = Date.now();
  const read = await readCheck(folder, options.remote);
  const done = (verdict: Verdict, rest: { reason?: string; output?: string } = {}) => ({
    verdict,
    ...(rest.reason !== undefined && { reason: rest.reason }),
    ...(read.branch !== undefined && { branch: read.branch }),
    ...(read.config && { config: read.config }),
    ms: Date.now() - started,
    output: rest.output ?? "",
  });
  if (!read.config) return done("not_run", { reason: read.problem });
  const { check, setup } = read.config;
  const missing = await sandbox.unavailable();
  if (missing) return done("not_run", { reason: missing });
  // One temp folder holds the temp worktree and the temp folders the command uses (`HOME`, `TMPDIR`). Paths are real paths, to match the sandbox config.
  // The command opens Unix sockets in the temp folder, so it goes somewhere short. In macOS's user temp folder (`/var/folders/…/T/`) the socket path would pass the 104-byte limit, so it goes in `/tmp` (ADR-0037).
  // ponytail: If it fits in 40 bytes, we use it as is. A runner that runs inside a sandbox (this repo's tests) can't write to `/tmp`, and the temp folder it's given is short.
  const base = Buffer.byteLength(tmpdir()) <= 40 ? tmpdir() : "/tmp";
  const run = await realpath(await mkdtemp(join(base, "omagari-check-")));
  const temp = join(run, "tmp");
  let work: Awaited<ReturnType<typeof prepareWork>> | undefined;
  let links: string[] = [];
  try {
    await mkdir(temp);
    // Merging is done only in the runner's repo (the temp worktree and the sandbox's Git folder are untouched). We check the merged tree out into the temp worktree.
    let tree = options.tree ?? (await workTree(folder, join(run, "index")));
    if (options.merge) {
      const merged = await mergeTree(folder, run, tree, options.merge);
      if (merged.problem !== undefined) return done("not_run", { reason: merged.problem });
      tree = merged.tree;
    }
    if (options.patch !== undefined) {
      const patched = await patchTree(folder, run, tree, options.patch);
      if (patched.problem !== undefined) return done("not_run", { reason: patched.problem });
      tree = patched.tree;
    }
    work = await prepareWork(folder, run, tree);
    const { worktree, common, sandboxGit } = work;
    const deps = await linkDeps(folder, worktree);
    links = deps.links;
    const drives = windowsDrives(await (options.mounts ?? osMounts)());
    const readable = [join(common, "objects"), ...deps.reads];
    // sandbox-runtime overrides TMPDIR with /tmp/claude when it wraps (#146). Before the command, the runner restores the temp folder it gave. The runner process's environment is untouched.
    const input = (command: string) => ({
      command: `export TMPDIR='${temp.replaceAll("'", `'\\''`)}'; ${command}`,
      folder: worktree,
      env: passedEnv(temp),
      policy: policy([worktree, temp, sandboxGit], readable, [worktree, temp], drives),
    });
    if (setup) {
      const ran = await sandboxed(sandbox, input(setup), {
        ms: limits.setupMs,
      });
      if (ran.cut)
        return done("not_run", {
          reason: `The setup command was cut off at the ${ran.cut} limit`,
          output: ran.output,
        });
      if (ran.code !== 0)
        return done("not_run", {
          reason: `The setup command failed (exit code ${ran.code ?? "none, ended by a signal"})`,
          output: ran.output,
        });
    }
    const ran = await sandboxed(sandbox, input(check), {
      ms: limits.checkMs,
      outputBytes: limits.outputBytes,
    });
    if (ran.cut)
      return done("not_run", {
        reason: `The check command was cut off at the ${ran.cut} limit. A cut-off run doesn't count as a pass`,
        output: ran.output,
      });
    // On Linux the sandbox blocks every Unix socket. If it looks like sockets broke it, we attach the reason. We don't attach it on macOS or to breaks unrelated to sockets.
    const socket = ran.code !== 0 && sandbox.blocksUnixSockets && socketTrouble(ran.output);
    return done(ran.code === 0 ? "pass" : "broken", {
      output: ran.output,
      ...(socket && { reason: SOCKET_BLOCKED }),
    });
  } catch (error) {
    return done("not_run", {
      reason: `Couldn't run: ${error instanceof Error ? error.message : error}`,
    });
  } finally {
    // After the run, first move it to the resting place. A process left in the sandbox can write only to this run's place, so it can't touch anything more (#150).
    // Then we remove the linked links (a place where a link appeared on the way is left alone, not followed) and revert tracked files. Ignored files stay.
    if (work) {
      const { worktree, rest } = work;
      const moved = await rename(worktree, rest).then(
        () => true,
        () => false,
      );
      if (moved) {
        for (const link of links) {
          const at = join(rest, relative(worktree, link));
          if (await direct(dirname(at))) await rm(at, { recursive: true, force: true });
        }
        await reset(work.gitDir, rest, work.tree).catch(() => {});
      } else await rm(worktree, { recursive: true, force: true });
    }
    await rm(run, { recursive: true, force: true });
  }
}
