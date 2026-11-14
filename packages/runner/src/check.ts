// 검사 명령: 레포에 커밋한 설정 파일에서 기본 브랜치의 판만 읽고(ADR-0034), 임시 워크트리에서 샌드박스 안에서만 돌린다(ADR-0033).
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { CHECK_FILE, CheckConfig, type CheckReading, type Verdict } from "@omagari/contract";

const execFileAsync = promisify(execFile);

/** 상한(Room의 값, ADR-0035). 넘으면 끊고, 끊긴 것은 통과가 아니다. 테스트는 러너를 띄울 때 줄인다. */
export const CHECK_LIMITS = {
  checkMs: 5 * 60_000,
  setupMs: 10 * 60_000,
  outputBytes: 4 * 1024 * 1024,
};
export type CheckLimits = typeof CHECK_LIMITS;

/** 출력의 끝부분: 끝 25줄(Room의 값)이고, 줄이 아주 길면 합쳐 4000자까지만 남긴다. */
const TAIL_LINES = 25;
const TAIL_CHARS = 4000;
/** 도는 동안 들고 있는 출력. 끝부분만 보이므로 앞은 버린다. */
const KEEP_CHARS = 64 * 1024;

/** 샌드박스 안으로 넘기는 환경 변수. 이것과 `LC_`로 시작하는 것 말고는 넘기지 않는다. 토큰과 키가 든 변수는 넘기지 않는다(ADR-0033). */
const PASSED_ENV = ["PATH", "LANG", "LANGUAGE", "TERM", "TZ", "USER", "LOGNAME", "SHELL"];

/**
 * 러너의 바깥 경계: 샌드박스. 셸 명령 하나를 가둬 돌릴 실행 인자를 만든다. 러너는 그것을 `folder`에서 `env`만 주고 띄운다.
 * 실제 것은 `@anthropic-ai/sandbox-runtime`이다(`osSandbox`). 테스트는 여기에 가짜를 꽂는다.
 */
export type Sandbox = {
  /** 이 기기에서 쓸 수 없으면 그 까닭과 까는 법. 쓸 수 있으면 없다. */
  unavailable(): Promise<string | undefined>;
  wrap(input: SandboxInput): Promise<string[]>;
};
export type SandboxInput = {
  /** 셸 명령 한 줄 */
  command: string;
  /** 명령이 도는 폴더(임시 워크트리) */
  folder: string;
  /** 넘기는 환경 변수 전부 */
  env: Record<string, string>;
  /** 막는 설정. `@anthropic-ai/sandbox-runtime`에 그대로 넘긴다. */
  policy: SandboxRuntimeConfig;
};

/** 샌드박스 도구를 까는 법. macOS는 따로 깔 것이 없다. */
const INSTALL =
  "Linux는 bubblewrap, socat, ripgrep을 깐다(예: sudo apt install bubblewrap socat ripgrep). Ubuntu 24.04부터는 AppArmor가 막으면 bubblewrap의 사용자 네임스페이스를 풀어야 한다";

/** 프록시를 띄우는 초기화. 한 번만 한다. 막는 설정은 명령마다 넘긴다. */
let initialized: Promise<void> | undefined;

/** 이 기기의 샌드박스: macOS는 `sandbox-exec`, Linux는 bubblewrap(ADR-0033). 쓰지 않는 기기에서는 불러오지도 않는다. */
export const osSandbox: Sandbox = {
  async unavailable() {
    if (process.platform !== "darwin" && process.platform !== "linux")
      return `이 기기(${process.platform})에서는 샌드박스를 쓸 수 없어 돌리지 않는다. macOS나 Linux에서 켠 러너만 검사 명령을 돌린다`;
    const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
    const { errors } = await SandboxManager.checkDependenciesAsync();
    if (errors.length > 0) return `샌드박스 도구가 없다: ${errors.join(", ")}. 까는 법: ${INSTALL}`;
  },
  async wrap({ command, policy }) {
    const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
    initialized ??= SandboxManager.initialize(policy).catch((error) => {
      initialized = undefined;
      throw error;
    });
    await initialized;
    return ["/bin/sh", "-c", await SandboxManager.wrapWithSandbox(command, undefined, policy)];
  },
};

/** 정하는 법. 설정이 없거나 읽지 못했을 때 붙인다. */
const HOW = `정하는 법: 레포 최상위에 ${CHECK_FILE}을 {"check": "<검사 명령>", "setup": "<준비 명령, 없어도 된다>"} 꼴로 커밋해 기본 브랜치에 머지한다`;

/**
 * 기본 브랜치에서 읽은 설정. 읽었으면 `config`, 못 읽었으면 까닭과 정하는 법(`problem`)과 그 갈래(`why`, 서버로 나가는 것)다.
 * `branch`는 읽은 원격 추적 브랜치다.
 */
export type CheckRead = { branch?: string } & (
  | { config: CheckConfig; problem?: undefined; why?: undefined }
  | {
      config?: undefined;
      problem: string;
      why: Extract<CheckReading, { problem: unknown }>["problem"];
    }
);

/** 서버에 알리는 꼴(`checkCommand`). 명령만 싣고 까닭은 갈래만 싣는다. */
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
 * 설정 파일을 `remote`의 기본 브랜치(`refs/remotes/<remote>/HEAD`)에서 읽는다. 작업 폴더나 내 브랜치의 판은 읽지 않는다(ADR-0034).
 * 원격 추적이라 받아 온(fetch) 만큼만 안다.
 */
export async function readCheck(folder: string, remote: string | undefined): Promise<CheckRead> {
  if (!remote)
    return {
      why: "unknown_branch",
      problem: "레포의 GitHub 원격을 몰라 기본 브랜치를 읽지 못했다",
    };
  const ref = `refs/remotes/${remote}/HEAD`;
  const branch = await gitOut(folder, ["rev-parse", "--abbrev-ref", ref]).catch(() => undefined);
  if (!branch)
    return {
      why: "unknown_branch",
      problem: `${remote}의 기본 브랜치를 모른다. git remote set-head ${remote} --auto 로 정하라`,
    };
  const text = await gitOut(folder, ["show", `${ref}:${CHECK_FILE}`]).catch(() => undefined);
  if (text === undefined)
    return {
      branch,
      why: "missing",
      problem: `기본 브랜치(${branch})에 ${CHECK_FILE}이 없다. ${HOW}`,
    };
  let parsed: ReturnType<typeof CheckConfig.safeParse> | undefined;
  try {
    parsed = CheckConfig.safeParse(JSON.parse(text));
  } catch {}
  if (!parsed?.success)
    return {
      branch,
      why: "invalid",
      problem: `기본 브랜치(${branch})의 ${CHECK_FILE}을 읽지 못했다(JSON이 아니거나 꼴이 다르다). ${HOW}`,
    };
  return { branch, config: parsed.data };
}

/** 러너를 켤 때 주인에게 알리는 것: 합쳐 돌려 보기가 켜졌는지, 켜졌으면 어떤 명령이 어디서 도는지(ADR-0034). */
export function checkNotice(read: CheckRead, on: boolean) {
  const toggle = `omagari runner --merge-check ${on ? "off" : "on"}`;
  if (!on)
    return `합쳐 돌려 보기(꺼 둠): 이 기기에서는 검사 명령을 돌리지 않는다. 켜려면 ${toggle}. 고른 것은 이 레포에 남는다.`;
  if (!read.config)
    return `합쳐 돌려 보기(켜짐): 검사 명령이 없어 돌리지 않는다. ${read.problem}\n  끄려면 ${toggle}. 고른 것은 이 레포에 남는다.`;
  return [
    "합쳐 돌려 보기(켜짐): 내 작업과 다른 멤버의 작업에 간접 충돌(추정)이 걸리면, 두 작업을 합쳐 아래 명령을 이 기기에서 저절로 돌린다.",
    `  검사 명령: ${read.config.check}`,
    ...(read.config.setup ? [`  준비 명령: ${read.config.setup}`] : []),
    `  명령은 기본 브랜치(${read.branch})의 ${CHECK_FILE}에서 읽고, 샌드박스 안에서 돈다: 바깥 네트워크, 임시 폴더 밖에 쓰기, 홈 폴더 읽기가 막힌다.`,
    `  끄려면 ${toggle}. 고른 것은 이 레포에 남는다. 이 기기에서 도는지는 omagari runner check로 본다.`,
  ].join("\n");
}

/** `path`가 `home` 아래에 있다(`home` 자신은 아니다). */
const under = (home: string, path: string) => {
  const inner = relative(home, path);
  return isAbsolute(path) && inner !== "" && !inner.startsWith("..") && !isAbsolute(inner);
};

/**
 * 막는 설정(ADR-0033): 바깥 네트워크를 막고 자기 기기의 포트는 쓴다. 쓰기는 임시 워크트리와 임시 폴더만이다.
 * 읽기는 홈 폴더를 막고 임시 워크트리, 임시 폴더, 도구 자리, 이어 둔 의존성 폴더, 레포의 개체 폴더만 다시 연다. 레포의 Git 폴더는 열지 않는다(원격 URL에 토큰이 있을 수 있다). 도구 자리는 러너를 돌리는 Node가 깔린 곳과 PATH의 폴더 가운데
 * 홈 폴더 아래의 것이다(nvm처럼 Node를 홈 폴더에 깐 기기).
 */
function policy(worktree: string, temp: string, extraRead: string[]): SandboxRuntimeConfig {
  const home = homedir();
  const tools = [
    dirname(dirname(process.execPath)),
    ...(process.env.PATH ?? "").split(delimiter),
  ].filter((path) => under(home, path));
  return {
    network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: true },
    filesystem: {
      denyRead: [home],
      allowRead: [worktree, temp, ...new Set([...tools, ...extraRead])],
      allowWrite: [worktree, temp],
      denyWrite: [],
    },
  };
}

/** 넘기는 환경 변수. 홈 폴더는 읽지 못하므로 도구가 설정과 캐시를 임시 폴더에 쓰게 `HOME`과 `TMPDIR`을 그리로 둔다. */
function passedEnv(temp: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && (PASSED_ENV.includes(key) || key.startsWith("LC_")))
      env[key] = value;
  return { ...env, HOME: temp, TMPDIR: temp };
}

const duration = (ms: number) => (ms >= 60_000 ? `${ms / 60_000}분` : `${ms / 1000}초`);
const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024}MB` : `${bytes}바이트`;

/** 출력의 끝부분. 터미널 제어 문자는 뺀다. */
function tail(output: string) {
  const lines = stripVTControlCharacters(output).trimEnd().split(/\r?\n/);
  return lines.slice(-TAIL_LINES).join("\n").slice(-TAIL_CHARS);
}

/**
 * 셸 명령 하나를 샌드박스로 가둬 상한 안에서 돌린다. 시간이나 출력(`outputBytes`를 주면)을 넘으면 끊고 넘은 상한(`cut`)을 돌려준다.
 * 따로 프로세스 그룹으로 띄워, 끊거나 끝날 때 명령이 띄우고 남긴 것까지 함께 끈다.
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
    } catch {} // 이미 끝났다
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
      return stop(`출력 ${size(limits.outputBytes)}`);
    output = (output + chunk).slice(-KEEP_CHARS);
  };
  child.stdout.setEncoding("utf8").on("data", take);
  child.stderr.setEncoding("utf8").on("data", take);
  // 셸이 끝나도 뒤에 띄워 둔 것(테스트가 띄운 서버 같은 것)이 출력을 잡고 있으면 닫히지 않는다. 끝나면 그룹째 끈다.
  child.once("exit", killGroup);
  try {
    const [code] = (await once(child, "close")) as [number | null];
    return { code, cut, output: tail(output) };
  } finally {
    clearTimeout(timer);
  }
}

/** 이을 의존성 폴더의 이름. */
const DEPS = ["node_modules", ".venv"];
/** 한 단계 아래의 패키지를 두는 폴더. */
const GROUPS = ["packages", "apps", "libs"];

/**
 * 내 폴더의 의존성 폴더 하나(`src`)를 임시 워크트리의 같은 자리(`dst`)에 잇는다. 통째로 링크하면 Node가 링크를 실제 경로로 풀어
 * 워크스페이스 패키지가 합친 코드가 아닌 내 폴더의 코드로 읽힌다. 그래서 `node_modules`는 항목마다 잇고(`@범위`와 `.bin`은 한 겹 더 들어가),
 * 내 폴더 안의 패키지를 가리키는 링크는 임시 워크트리 안의 같은 패키지를 가리키게 다시 건다.
 */
async function mirror(src: string, dst: string, folder: string, worktree: string) {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    const real = await realpath(from).catch(() => undefined);
    if (!real) continue; // 끊어진 링크
    const inner = relative(folder, real);
    if (entry.isSymbolicLink() && under(folder, real) && !inner.split(sep).includes("node_modules"))
      await symlink(join(worktree, inner), to);
    else if (entry.isDirectory() && (entry.name.startsWith("@") || entry.name === ".bin"))
      await mirror(from, to, folder, worktree);
    else await symlink(real, to);
  }
}

/** 내 폴더의 최상위와 한 단계 아래의 의존성 폴더를 임시 워크트리에 잇는다. 이은 자리(워크트리 안)와 읽을 실제 폴더를 돌려준다. */
async function linkDeps(folder: string, worktree: string) {
  const places = [""];
  for (const group of GROUPS) {
    const names = await readdir(join(folder, group)).catch(() => []);
    for (const name of names) places.push(join(group, name));
  }
  const links: string[] = [];
  const reads: string[] = [];
  for (const place of places) {
    if (!(await stat(join(worktree, place)).catch(() => undefined))?.isDirectory()) continue;
    for (const dep of DEPS) {
      const src = join(folder, place, dep);
      if (!(await stat(src).catch(() => undefined))?.isDirectory()) continue;
      const dst = join(worktree, place, dep);
      if (dep === "node_modules") await mirror(src, dst, folder, worktree);
      else await symlink(await realpath(src), dst);
      links.push(dst);
      reads.push(await realpath(src));
    }
  }
  return { links, reads };
}

/**
 * 임시 워크트리를 `tree`(내 작업)로 맞춘다. 추적하는 파일은 되돌리고 추적하지 않는 새 파일은 지우되, 무시되는 파일(빌드 산출물)은 남긴다.
 */
async function reset(worktree: string, tree: string) {
  await gitOut(worktree, ["read-tree", "--reset", tree]);
  await gitOut(worktree, ["checkout-index", "--all", "--force"]);
  await gitOut(worktree, ["clean", "--force", "-d", "--quiet"]);
}

/** 한 번에 하나만 돌린다. 임시 워크트리 하나를 다시 쓰므로 겹치면 서로 덮는다. */
let turn: Promise<unknown> = Promise.resolve();

/**
 * 임시 워크트리를 마련한다: 레포의 Git 폴더 아래(`<Git 폴더>/omagari/check-worktree`)에 두고 다시 쓴다. 내 폴더의 `git status`와 관측에 잡히지 않는다.
 * `git worktree add`는 쓰지 않는다. 그러면 샌드박스 안의 `git`이 레포의 Git 폴더 전체(원격 URL의 토큰이 든 config 포함)를 읽어야 한다.
 * 대신 자기만의 Git 폴더를 두고 개체 폴더만 빌려 읽는다(alternates). 그래서 샌드박스에는 개체 폴더만 열면 된다.
 * 내 작업은 내 폴더의 파일 전부(커밋하지 않은 변경과 추적하지 않는 새 파일 포함, gitignore된 것은 빼고)를 임시 인덱스(`index`)에 담은 트리다.
 * 내 폴더의 인덱스는 건드리지 않는다.
 */
async function prepareWork(folder: string, index: string) {
  const common = await realpath(
    await gitOut(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const worktree = join(common, "omagari", "check-worktree");
  // 지금 인덱스에서 시작하면 바뀌지 않은 파일은 다시 읽지 않는다. 없으면(커밋이 없는 레포) 빈 인덱스에서 시작한다.
  const current = await gitOut(folder, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  await copyFile(current, index).catch(() => {});
  const withIndex = { GIT_INDEX_FILE: index };
  await gitOut(folder, ["add", "--all"], withIndex);
  const tree = await gitOut(folder, ["write-tree"], withIndex);
  const head = await gitOut(folder, ["rev-parse", "HEAD"]);
  const place = async () => {
    await mkdir(worktree, { recursive: true });
    // 훅은 없는 채로 둔다. 있으면 옮겨 온 파일이 샌드박스 밖에서 돈다.
    await gitOut(worktree, ["init", "--quiet", "--template="]);
    await mkdir(join(worktree, ".git", "objects", "info"), { recursive: true });
    await writeFile(
      join(worktree, ".git", "objects", "info", "alternates"),
      `${join(common, "objects")}\n`,
    );
    await gitOut(worktree, ["update-ref", "--no-deref", "HEAD", head]);
    await reset(worktree, tree);
  };
  // 지난 돌림이 죽으며 망가졌으면 지우고 처음부터 만든다.
  await place().catch(async () => {
    await rm(worktree, { recursive: true, force: true });
    await place();
  });
  return { worktree, tree, common };
}

/** `checkWork`의 결과. 계약의 `checked`와 같다. */
export type CheckResult = {
  verdict: Verdict;
  reason?: string;
  branch?: string;
  config?: CheckConfig;
  ms: number;
  output: string;
};

/**
 * `folder`의 내 작업에 기본 브랜치의 검사 명령을 샌드박스 안에서 한 번 돌린다(`omagari runner check`). 상대 작업은 합치지 않는다.
 * 준비 명령이 있으면 먼저 돌리고, 실패하면 돌리지 못함이다. 설정을 읽지 못했거나 샌드박스를 쓸 수 없으면 아무것도 돌리지 않는다.
 * 가두지 않고 돌리는 길은 없다. 임시 워크트리는 레포의 Git 폴더 아래에 두고 다시 쓴다.
 */
export function checkWork(options: {
  folder: string;
  remote: string | undefined;
  sandbox: Sandbox;
  limits: CheckLimits;
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
  // 임시 폴더 하나에 임시 워크트리와, 명령이 쓰는 임시 폴더(`HOME`, `TMPDIR`)를 둔다. 경로는 샌드박스 설정과 맞게 실제 경로로 둔다.
  const run = await realpath(await mkdtemp(join(tmpdir(), "omagari-check-")));
  const temp = join(run, "tmp");
  let work: Awaited<ReturnType<typeof prepareWork>> | undefined;
  let links: string[] = [];
  try {
    await mkdir(temp);
    work = await prepareWork(folder, join(run, "index"));
    const { worktree, common } = work;
    const deps = await linkDeps(folder, worktree);
    links = deps.links;
    const readable = [join(common, "objects"), ...deps.reads];
    const input = (command: string) => ({
      command,
      folder: worktree,
      env: passedEnv(temp),
      policy: policy(worktree, temp, readable),
    });
    if (setup) {
      const ran = await sandboxed(sandbox, input(setup), { ms: limits.setupMs });
      if (ran.cut)
        return done("not_run", {
          reason: `준비 명령을 ${ran.cut} 상한에서 끊었다`,
          output: ran.output,
        });
      if (ran.code !== 0)
        return done("not_run", {
          reason: `준비 명령이 실패했다(종료 코드 ${ran.code ?? "없음, 신호로 끝났다"})`,
          output: ran.output,
        });
    }
    const ran = await sandboxed(sandbox, input(check), {
      ms: limits.checkMs,
      outputBytes: limits.outputBytes,
    });
    if (ran.cut)
      return done("not_run", {
        reason: `검사 명령을 ${ran.cut} 상한에서 끊었다. 끊긴 것은 통과로 치지 않는다`,
        output: ran.output,
      });
    return done(ran.code === 0 ? "pass" : "broken", { output: ran.output });
  } catch (error) {
    return done("not_run", {
      reason: `돌리지 못했다: ${error instanceof Error ? error.message : error}`,
    });
  } finally {
    // 돌린 뒤 추적하는 파일을 되돌리고 이은 링크를 뗀다. 무시되는 파일은 남긴다.
    for (const link of links) await rm(link, { recursive: true, force: true });
    if (work) await reset(work.worktree, work.tree).catch(() => {});
    await rm(run, { recursive: true, force: true });
  }
}
