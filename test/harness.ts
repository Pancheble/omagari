// 테스트 경계의 틀. 실제 서버와 실제 러너를 임시 Git 레포 위에 띄운다.
// 조작과 확인은 서버 API(`call`)와 CLI·훅 실행 파일의 입출력으로만 한다.
// 가짜는 바깥 두 곳에만 꽂는다: GitHub(서버), 에이전트 실행기(러너).
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { api, call } from "@omagari/contract";
import { type Executor, startRunner } from "@omagari/runner";
import { type GitHub, startServer } from "@omagari/server";

const executable = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CLI = executable("../packages/cli/src/main.ts");
const HOOK = executable("../packages/hooks/src/main.ts");

/** 워크스페이스의 레포. `tempRepo`의 origin이 이 레포를 가리킨다. */
export const REPO = "omagari-test/space";

/** 실행 파일 하나를 돌리고 종료 코드와 출력을 돌려준다. 0이 아닌 종료도 결과다. */
function run(
  file: string,
  args: string[],
  options: { cwd: string; stdin?: string; keepStdinOpen?: boolean; env?: object },
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd: options.cwd, env: { ...process.env, ...options.env } },
      (error, stdout, stderr) => {
        if (child.exitCode === null)
          reject(error); // 뜨지 못했거나 신호로 죽었다
        else resolve({ code: child.exitCode, stdout, stderr });
      },
    );
    // 입력을 읽지 않고 먼저 끝나는 실행 파일(git 등)에 쓰면 EPIPE가 난다. 그것은 실패가 아니다.
    // 듣는 곳이 없으면 잡히지 않은 예외가 되어, 그때 돌던 테스트를 실패시키고 그 테스트의 정리를 건너뛴다.
    child.stdin?.on("error", () => {});
    if (options.keepStdinOpen) child.stdin?.write(options.stdin ?? "");
    else child.stdin?.end(options.stdin ?? "");
  });
}

/** 끝나지 않는 실행 파일(러너처럼)을 띄운다. 나온 글을 기다리고, 신호를 보내 끝낸다. */
function launch(file: string, args: string[], options: { cwd: string; env?: object }) {
  const child = spawn(file, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exited = once(child, "exit").then(([code]) => ({ code, stdout, stderr }));
  return {
    /** 스스로 끝났을 때의 종료 코드와 출력. */
    exited,
    /** stdout에 `pattern`이 나올 때까지 기다리고 맞은 것을 돌려준다. */
    output: (pattern: RegExp) =>
      eventually(() => {
        const match = pattern.exec(stdout);
        if (!match)
          throw new Error(`아직 나오지 않았다: ${pattern}\nstdout: ${stdout}\nstderr: ${stderr}`);
        return match;
      }),
    /** 신호를 보내고 끝나기를 기다린다. */
    stop: (signal: NodeJS.Signals = "SIGINT") => {
      if (child.exitCode === null) child.kill(signal);
      return exited;
    },
  };
}

/** `check`가 던지지 않을 때까지 되풀이한다. 기다려야 보이는 것(연결, 재확인)을 확인할 때 쓴다. */
export async function eventually<T>(check: () => T | Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(20);
    }
  }
}

/** 커밋 하나가 있는 실제 Git 레포를 임시 폴더에 만든다. origin은 `repo`(GitHub)를 가리킨다. 기기의 Git 설정은 읽지 않는다. */
export async function tempRepo(repo = REPO) {
  // macOS의 임시 폴더는 심볼릭 링크다. Git이 내는 최상위 폴더와 같게 실제 경로로 둔다.
  const folder = await realpath(await mkdtemp(join(tmpdir(), "omagari-")));
  const env = {
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Omagari Test",
    GIT_AUTHOR_EMAIL: "test@omagari.invalid",
    GIT_COMMITTER_NAME: "Omagari Test",
    GIT_COMMITTER_EMAIL: "test@omagari.invalid",
  };
  const git = async (...args: string[]) => {
    const result = await run("git", args, { cwd: folder, env });
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await git("init", "--initial-branch=main");
  await git("commit", "--allow-empty", "--message=init");
  await git("remote", "add", "origin", `https://github.com/${repo}.git`);
  return { folder, git, remove: () => rm(folder, { recursive: true, force: true }) };
}

/**
 * 가짜 GitHub. 기기 인증은 사람이 코드를 넣는 대신 `approve`로 끝내고,
 * push 권한은 `grant`와 `revoke`로 준다. 내준 GitHub 토큰은 `tokens`에 남는다.
 */
export function fakeGitHub() {
  const pushers = new Set<string>();
  const devices = new Map<string, { userCode: string; login?: string }>();
  const tokens = new Map<string, string>();
  const github: GitHub = {
    async startDevice() {
      const deviceCode = crypto.randomUUID();
      const userCode = `${deviceCode.slice(0, 4)}-${deviceCode.slice(4, 8)}`.toUpperCase();
      devices.set(deviceCode, { userCode });
      return {
        deviceCode,
        userCode,
        verificationUri: "https://github.com/login/device",
        expiresInMs: 60_000,
        intervalMs: 5,
      };
    },
    async pollDevice(deviceCode) {
      const login = devices.get(deviceCode)?.login;
      if (!login) return { pending: true };
      devices.delete(deviceCode);
      const token = `gho_fake_${crypto.randomUUID()}`;
      tokens.set(token, login);
      return { token };
    },
    async login(token) {
      const login = tokens.get(token);
      if (!login) throw new Error("모르는 토큰이다");
      return login;
    },
    async canPush(token, repo) {
      return repo === REPO && pushers.has(tokens.get(token) ?? "");
    },
  };
  return {
    github,
    tokens,
    /** 사람이 브라우저에서 `userCode`를 넣고 `login` 계정으로 승인했다. */
    approve(userCode: string, login: string) {
      const device = [...devices.values()].find((d) => d.userCode === userCode);
      if (!device) throw new Error(`모르는 코드다: ${userCode}`);
      device.login = login;
    },
    grant: (login: string) => pushers.add(login),
    revoke: (login: string) => pushers.delete(login),
  };
}

type ExecutorInput = Parameters<Executor>[0];

/**
 * 가짜 에이전트 실행기. 받은 입력과 옵션을 `calls`에 적고 `answer`가 정한 답을 낸다.
 * 이어 갈 세션이 없으면 `session-<몇 번째 부름>`으로 새 세션을 띄운다.
 */
export function fakeExecutor(answer: (input: ExecutorInput) => string = () => "가짜 답") {
  const calls: ExecutorInput[] = [];
  const executor: Executor = async (input) => {
    calls.push(input);
    return { answer: answer(input), session: input.resume ?? `session-${calls.length}` };
  };
  return { executor, calls };
}

/**
 * 서버 하나, 레포 하나, 그 레포에 push 권한이 있는 `owner`와 owner의 러너 하나.
 * 가짜 실행기를 넘기지 않으면 늘 실패하는 것이 꽂힌다.
 */
export async function startWorld(
  options: { executor?: Executor; recheckMs?: number; heartbeatMs?: number } = {},
) {
  const repo = await tempRepo();
  const data = await mkdtemp(join(tmpdir(), "omagari-server-")); // 서버의 DB와 CLI의 설정
  const cleanup = () => Promise.all([repo.remove(), rm(data, { recursive: true, force: true })]);
  const fake = fakeGitHub();
  const serverOptions = {
    repo: REPO,
    github: fake.github,
    database: join(data, "omagari.db"),
    recheckMs: options.recheckMs,
    heartbeatMs: options.heartbeatMs,
  };
  let server = await startServer(serverOptions).catch(async (error) => {
    await cleanup();
    throw error;
  });

  /** API로 기기 인증을 마치고 그 계정의 세션으로 부를 상대를 돌려준다. */
  const login = async (name: string) => {
    const started = await call(server, api.login);
    fake.approve(started.userCode, name);
    for (;;) {
      await sleep(started.intervalMs);
      const polled = await call(server, api.loginPoll, { device: started.device });
      if ("session" in polled) return { url: server.url, session: polled.session, login: name };
    }
  };

  fake.grant("owner");
  const owner = await login("owner").catch(async (error) => {
    await server.stop();
    await cleanup();
    throw error;
  });
  const runner = await startRunner({
    serverUrl: server.url,
    folder: repo.folder,
    session: owner.session,
    // 넘긴 가짜가 없으면 실제 실행기 대신 늘 실패하는 것을 꽂는다.
    executor: options.executor ?? (() => Promise.reject(new Error("가짜 실행기를 넘기지 않았다"))),
  }).catch(async (error) => {
    await server.stop();
    await cleanup();
    throw error;
  });
  const cliEnv = () => ({ OMAGARI_SERVER: server.url, XDG_CONFIG_HOME: join(data, "config") });

  return {
    repo,
    get server() {
      return server;
    },
    github: fake,
    owner,
    runner,
    login,
    /** CLI가 세션을 남기는 폴더. */
    config: join(data, "config"),
    /** 멤버 `as`의 눈으로 본 멤버마다의 에이전트 상태. */
    agents: async (as: { url: string; session: string }) =>
      Object.fromEntries(
        (await call(as, api.members)).members.map((member) => [member.login, member.agent]),
      ),
    /** 서버를 끄고 같은 포트, 같은 DB로 다시 띄운다. 배포로 서버가 다시 뜨는 것과 같다. */
    async restartServer() {
      const { port } = new URL(server.url);
      await server.stop();
      server = await startServer({ ...serverOptions, port: Number(port) });
    },
    /** `omagari <args>`를 레포 폴더에서 돌린다. */
    cli: (...args: string[]) =>
      run(process.execPath, [CLI, ...args], { cwd: repo.folder, env: cliEnv() }),
    /** `omagari <args>`를 `cwd`에서 돌린다. */
    cliIn: (cwd: string, ...args: string[]) =>
      run(process.execPath, [CLI, ...args], { cwd, env: cliEnv() }),
    /** 끝나지 않는 `omagari <args>`(러너)를 `cwd`에서 띄운다. */
    launchCliIn: (cwd: string, ...args: string[]) =>
      launch(process.execPath, [CLI, ...args], { cwd, env: cliEnv() }),
    /** 훅 실행 파일에 에이전트가 주는 입력(JSON)을 넣어 돌린다. */
    hook: (stdin: string, options: { keepStdinOpen?: boolean } = {}) =>
      run(process.execPath, [HOOK], { cwd: repo.folder, stdin, ...options }),
    async stop() {
      await runner.stop();
      await server.stop();
      await cleanup();
    },
  };
}
