import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import {
  ContractFailure,
  decode,
  encode,
  RUNNER_SOCKET,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";

/**
 * 러너의 바깥 경계: 에이전트 실행기.
 * 넘기는 것과 받는 것은 #6이 정한다. 테스트는 여기에 가짜를 꽂는다.
 */
export type Executor = Record<string, never>;

const exec = promisify(execFile);
/** GitHub 원격 URL에서 `owner/name`을 읽는다: https, ssh, scp 꼴(git@github.com:owner/name). */
const GITHUB_REMOTE = /(?:@|\/\/)github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i;

/** 폴더가 어느 레포의 것인지 읽는다. Git 레포가 아니거나 GitHub 원격이 없으면 이유를 들어 던진다. */
export async function readRepo(folder: string): Promise<{ folder: string; repos: string[] }> {
  const git = async (...args: string[]) =>
    (await exec("git", ["-C", folder, ...args])).stdout.trim();
  const top = await git("rev-parse", "--show-toplevel").catch(() => {
    throw new Error(`Git 레포가 아닌 폴더다: ${folder}`);
  });
  const urls = (await git("remote", "-v")).split("\n").map((line) => line.split(/\s+/)[1] ?? "");
  const repos = [...new Set(urls.flatMap((url) => GITHUB_REMOTE.exec(url)?.[1] ?? []))];
  if (repos.length === 0) throw new Error(`GitHub 원격이 없는 레포다: ${top}`);
  return { folder: top, repos };
}

/**
 * 러너를 켠다. 폴더의 레포를 읽고, 서버에 붙어 hello에 welcome을 받으면 돌아온다.
 * 못 받으면 연결을 닫고 던진다. 켜진 뒤 끊기면 다시 붙고, 서버가 거절하면(1008) 멈춘다.
 */
export async function startRunner(options: {
  serverUrl: string;
  /** 레포를 받은 폴더. 러너는 이 폴더(의 Git 최상위) 하나에 짝지어진다. */
  folder: string;
  /** 로그인으로 받은 세션. GitHub 토큰은 러너에 오지 않는다. */
  session: string;
  executor?: Executor;
  /** welcome을 기다리는 시간. */
  welcomeTimeoutMs?: number;
}) {
  const { folder, repos } = await readRepo(options.folder);
  const url = new URL(RUNNER_SOCKET, options.serverUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const timeoutMs = options.welcomeTimeoutMs ?? 10_000;
  const stopping = new AbortController();
  const ended = Promise.withResolvers<Error | undefined>();
  let socket: WebSocket | undefined;

  const end = (reason?: Error) => {
    stopping.abort();
    socket?.close();
    ended.resolve(reason);
  };

  async function connect() {
    const current = new WebSocket(url);
    socket = current;
    const welcomed = Promise.withResolvers<{ login: string; repo: string }>();
    let refusal: Error | undefined;
    const timer = setTimeout(
      () => welcomed.reject(new Error(`서버가 ${timeoutMs}ms 안에 답하지 않았다: ${url}`)),
      timeoutMs,
    );

    current.addEventListener("open", () =>
      current.send(encode(runnerToServer, "hello", { session: options.session, repos })),
    );
    current.addEventListener("message", ({ data }) => {
      const decoded = decode(serverToRunner, data);
      if ("error" in decoded) {
        current.send(encode(runnerToServer, "error", decoded.error, decoded.re));
        if (decoded.error.code === "version_mismatch") {
          welcomed.reject(new ContractFailure(decoded.error));
          // 내장 WebSocket의 close()는 코드 1000과 3000~4999만 받는다. 코드 없이 닫는다.
          current.close();
        }
        return;
      }
      const { message } = decoded;
      if (message.kind === "welcome") {
        welcomed.resolve(message.payload);
      } else {
        // 거절의 이유. welcome 전이면 던지고, 뒤면 1008로 닫힐 때 `ended`로 낸다.
        refusal = new ContractFailure(message.payload);
        welcomed.reject(refusal);
      }
    });
    current.addEventListener("close", () =>
      welcomed.reject(refusal ?? new Error(`서버에 붙지 못했다: ${url}`)),
    );

    try {
      const welcome = await welcomed.promise;
      current.addEventListener("close", ({ code }) => {
        if (code === 1008) end(refusal ?? new Error("서버가 러너를 거절했다"));
        else void reconnect();
      });
      return welcome;
    } catch (error) {
      current.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 끊긴 뒤 다시 붙는다. 1초에서 시작해 30초까지 늘려 가며 기다린다. 거절당하면 멈춘다. */
  async function reconnect() {
    for (let delay = 1000; !stopping.signal.aborted; delay = Math.min(delay * 2, 30_000)) {
      try {
        await sleep(delay, undefined, { signal: stopping.signal });
        await connect();
        return;
      } catch (error) {
        if (error instanceof ContractFailure) return end(error);
      }
    }
  }

  const welcome = await connect();
  return {
    folder,
    login: welcome.login,
    repo: welcome.repo,
    /** 러너가 멈추면 끝난다. 서버가 거절해서 멈췄으면 그 이유가 온다. */
    ended: ended.promise,
    stop: () => end(),
  };
}
