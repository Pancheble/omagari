import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { connect as connectLocal, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import {
  ContractFailure,
  cliToRunner,
  decode,
  encode,
  MAX_FRAME_BYTES,
  RUNNER_SOCKET,
  runnerToCli,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";
import { observe } from "./observe.ts";

export { OBSERVATION_NOTICE } from "./observe.ts";

const execFileAsync = promisify(execFile);

/**
 * 러너의 바깥 경계: 에이전트 실행기. 러너 세션의 한 턴을 화면 없이 돌린다.
 * 테스트는 여기에 가짜를 꽂는다.
 */
export type Executor = (input: {
  /** 받은 메시지 */
  message: string;
  /** 이어 갈 세션. 없으면 새 세션을 띄운다. */
  resume?: string;
  /** 허용할 도구. 이것 말고는 쓰지 못하게 띄운다. */
  tools: string[];
  /** 작업 폴더 */
  folder: string;
}) => Promise<{ answer: string; session: string }>;

/** 관측을 다시 읽는 주기. Room의 기준 커밋 확인 주기(3초)에서 시작한다. */
const OBSERVE_MS = 3000;

/** 러너 세션에 허용하는 도구. 파일을 쓰거나 명령을 실행하는 도구는 넣지 않는다(ADR-0003). */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

/**
 * Claude Code 실행기. `claude -p`로 띄우고 `--resume`으로 잇는다.
 * `--allowedTools`는 승인 없이 돌 도구를 정할 뿐이라 주인의 `permissions.allow`가 있으면 목록 밖의 Bash도 돈다.
 * 그래서 `--tools`로 쓸 수 있는 도구 자체를 줄이고, `--tools`가 손대지 않는 MCP 도구는 따로 뺀다(ADR-0003).
 * 메시지는 플래그로 읽히지 않게 표준 입력으로 넘긴다.
 */
export const claudeCode: Executor = async ({ message, resume, tools, folder }) => {
  const run = execFileAsync(
    "claude",
    [
      "-p",
      "--output-format=json",
      `--tools=${tools.join(",")}`,
      "--disallowedTools=mcp__*",
      ...(resume ? [`--resume=${resume}`] : []),
    ],
    { cwd: folder, maxBuffer: 64 * 1024 * 1024 },
  );
  run.child.stdin?.end(message);
  // 실행 중의 실패도 결과를 stdout에 JSON으로 내고 0이 아닌 코드로 끝난다(Claude Code 비대화 실행 문서).
  const { stdout } = await run.catch((error) => {
    if (error.stdout) return error;
    throw error;
  });
  const result = JSON.parse(stdout);
  if (
    result.is_error ||
    typeof result.result !== "string" ||
    typeof result.session_id !== "string"
  ) {
    throw new Error(`Claude Code가 답하지 못했다: ${result.result ?? stdout}`);
  }
  return { answer: result.result, session: result.session_id };
};

/** 실행 기록 한 줄: 언제, 어느 세션으로, 무엇을 받아, 어떤 도구로 돌렸고, 실패했으면 왜. */
export type RunRecord = {
  at: string;
  session?: string;
  message: string;
  tools: string[];
  error?: string;
};

/** 러너의 로컬 자리. 레포 하나(연결된 워크트리 포함)에 하나라 CLI는 어느 워크트리에서든 같은 러너를 찾는다. */
export async function runnerPaths(folder: string) {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: folder },
  );
  const common = stdout.trim();
  // 소켓 경로는 길이 상한(macOS 104바이트)이 있어 레포 안이 아니라 사용자의 임시 폴더에 둔다.
  const id = createHash("sha256").update(common).digest("hex").slice(0, 16);
  return {
    /** CLI가 붙는 소켓 */
    socket: join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `omagari-${id}.sock`),
    /** 실행 기록. 서버로 나가지 않는다. */
    log: join(common, "omagari", "runs.jsonl"),
  };
}

/** GitHub 원격 URL에서 `owner/name`을 읽는다: https, ssh, scp 꼴(git@github.com:owner/name). */
const GITHUB_REMOTE = /(?:@|\/\/)github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i;

/**
 * 폴더가 어느 레포의 것인지 읽는다. `remotes`는 GitHub 원격의 이름과 그 레포다.
 * Git 레포가 아니거나 GitHub 원격이 없으면 이유를 들어 던진다.
 */
export async function readRepo(folder: string) {
  const git = async (...args: string[]) =>
    (await execFileAsync("git", ["-C", folder, ...args])).stdout.trim();
  const top = await git("rev-parse", "--show-toplevel").catch(() => {
    throw new Error(`Git 레포가 아닌 폴더다: ${folder}`);
  });
  const remotes = (await git("remote", "-v")).split("\n").flatMap((line) => {
    const [name = "", url = ""] = line.split(/\s+/);
    const repo = GITHUB_REMOTE.exec(url)?.[1];
    return repo ? [{ name, repo }] : [];
  });
  const repos = [...new Set(remotes.map((remote) => remote.repo))];
  if (repos.length === 0) throw new Error(`GitHub 원격이 없는 레포다: ${top}`);
  return { folder: top, repos, remotes };
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
  /** 관측을 다시 읽는 주기. */
  observeMs?: number;
}) {
  const { folder, repos, remotes } = await readRepo(options.folder);
  const paths = await runnerPaths(folder);
  await mkdir(dirname(paths.log), { recursive: true });
  const executor = options.executor ?? claudeCode;
  const url = new URL(RUNNER_SOCKET, options.serverUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const timeoutMs = options.welcomeTimeoutMs ?? 10_000;
  const stopping = new AbortController();
  const ended = Promise.withResolvers<Error | undefined>();
  let socket: WebSocket | undefined;
  /** welcome을 받은 연결. 관측은 여기로만 보낸다. */
  let live: WebSocket | undefined;

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
      live = current;
      current.addEventListener("close", ({ code }) => {
        if (live === current) live = undefined;
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

  // ponytail: 터미널의 대화 하나만 잇고, 러너가 다시 켜지면 새 세션으로 시작한다. 채널마다의 세션은 #21이 넣는다.
  // ponytail: 턴을 줄 세우지 않고 시간 제한도 없다. 한 번에 한 턴과 10분 끊기는 #9가 넣는다.
  let session: string | undefined;

  /** 러너 세션의 한 턴. 성공이든 실패든 실행 기록을 남긴다. */
  async function turn(message: string) {
    const record: RunRecord = {
      at: new Date().toISOString(),
      session,
      message,
      tools: READ_ONLY_TOOLS,
    };
    try {
      const result = await executor({ message, resume: session, tools: READ_ONLY_TOOLS, folder });
      if (!result.answer.trim()) throw new Error("실행기가 답 없이 끝났다");
      record.session = session = result.session;
      return result.answer;
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      throw new ContractFailure({ code: "executor_failed", message: record.error });
    } finally {
      await appendFile(paths.log, `${JSON.stringify(record)}\n`);
    }
  }

  async function reply(frame: string) {
    const decoded = decode(cliToRunner, frame);
    if ("error" in decoded) return encode(runnerToCli, "error", decoded.error, decoded.re);
    const { message } = decoded;
    try {
      return encode(
        runnerToCli,
        "answer",
        { text: await turn(message.payload.message) },
        message.id,
      );
    } catch (error) {
      const failure =
        error instanceof ContractFailure
          ? error
          : new ContractFailure({ code: "internal", message: String(error) });
      return encode(
        runnerToCli,
        "error",
        { code: failure.code, message: failure.message },
        message.id,
      );
    }
  }

  // 같은 레포(워크트리 포함)에 러너는 하나다. 소켓에 누가 답하면 이미 켜진 러너가 있다.
  const taken = await new Promise<boolean>((resolve) => {
    const probe = connectLocal(paths.socket);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
  if (taken) throw new Error(`이 레포의 러너가 이미 켜져 있다: ${folder}`);
  // CLI는 요청 하나를 쓰고 쓰기를 닫는다. 러너는 답 하나를 쓰고 닫는다.
  const local = createServer({ allowHalfOpen: true }, (connection) => {
    connection.on("error", () => {}); // CLI가 먼저 끊어도 러너는 돈다
    text(connection)
      .then(reply)
      .then(
        (answer) => connection.end(answer),
        () => connection.destroy(),
      );
  });
  await rm(paths.socket, { force: true }); // 꺼진 러너가 남긴 소켓
  local.listen(paths.socket);
  await once(local, "listening");
  const localClosed = once(local, "close");

  const end = (reason?: Error) => {
    stopping.abort();
    socket?.close();
    local.close();
    ended.resolve(reason);
  };

  const welcome = await connect().catch(async (error) => {
    local.close();
    await localClosed;
    throw error;
  });
  // 서버가 받아들인 레포의 원격. 기준 커밋은 그 원격의 기본 브랜치에서 찾는다.
  const remote = remotes.find((r) => r.repo.toLowerCase() === welcome.repo.toLowerCase());
  const observing = remote ? observeLoop(remote.name) : Promise.resolve();

  /**
   * 관측: 주기마다 작업을 다시 읽고, 이 연결로 지난번에 보낸 것과 다를 때만 보낸다. 다시 붙으면 처음부터 보낸다.
   * 읽지 못하면 까닭을 한 번만 알리고 다음 주기에 다시 읽는다.
   */
  async function observeLoop(remote: string) {
    // ponytail: 파일 감시(Room의 0.3초 묶음) 없이 3초마다 전체를 다시 읽는다. 늘 전체라 1분 재조정도 따로 없다.
    // 고친 뒤 3초가 길거나 큰 레포에서 읽기가 무거워지면 fs.watch로 깨운다.
    // ponytail: 달라지면 작업 전체(내용 합계 8MiB까지)를 다시 보낸다. 큰 작업을 자주 고치면 파일마다의 차이만 보낸다.
    let sent: { to?: WebSocket; works?: string } = {};
    let problem: string | undefined;
    while (!stopping.signal.aborted) {
      try {
        const works = await observe(folder, remote);
        const json = JSON.stringify(works);
        if (live && (live !== sent.to || json !== sent.works)) {
          const frame = encode(runnerToServer, "observation", { works });
          if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
            throw new Error(
              `관측이 ${MAX_FRAME_BYTES}바이트를 넘어 보내지 못했다(바뀐 파일이 너무 많다)`,
            );
          }
          live.send(frame);
          sent = { to: live, works: json };
        }
        problem = undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== problem && !stopping.signal.aborted) console.warn(`관측: ${message}`);
        problem = message;
      }
      await sleep(options.observeMs ?? OBSERVE_MS, undefined, { signal: stopping.signal }).catch(
        () => {},
      );
    }
  }

  return {
    folder,
    login: welcome.login,
    repo: welcome.repo,
    /** 러너가 멈추면 끝난다. 서버가 거절해서 멈췄으면 그 이유가 온다. */
    ended: ended.promise,
    async stop() {
      end();
      await Promise.all([localClosed, observing]);
    },
  };
}
