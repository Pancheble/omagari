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
  type ShareLevel,
  serverToRunner,
  type Work,
  type WorkView,
} from "@omagari/contract";
import { nearby } from "./nearby.ts";
import { observe } from "./observe.ts";

export { observationNotice } from "./observe.ts";

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
  /** 턴이 시간 상한을 넘으면 abort된다. 실행기는 띄운 것을 끈다. */
  signal: AbortSignal;
}) => Promise<{ answer: string; session: string }>;

/** 관측을 다시 읽는 주기. Room의 기준 커밋 확인 주기(3초)에서 시작한다. */
const OBSERVE_MS = 3000;

/** 러너 세션에 허용하는 도구. 파일을 쓰거나 명령을 실행하는 도구는 넣지 않는다(ADR-0003). */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];
/** 한 턴의 시간 상한. 넘으면 끊는다. Room의 러너와 같은 10분이다(1단계 질문 A11). */
const TURN_TIMEOUT_MS = 10 * 60_000;

/**
 * Claude Code 실행기. `claude -p`로 띄우고 `--resume`으로 잇는다.
 * `--allowedTools`는 승인 없이 돌 도구를 정할 뿐이라 주인의 `permissions.allow`가 있으면 목록 밖의 Bash도 돈다.
 * 그래서 `--tools`로 쓸 수 있는 도구 자체를 줄이고, `--tools`가 손대지 않는 MCP 도구는 따로 뺀다(ADR-0003).
 * 메시지는 플래그로 읽히지 않게 표준 입력으로 넘긴다.
 */
export const claudeCode: Executor = async ({ message, resume, tools, folder, signal }) => {
  const run = execFileAsync(
    "claude",
    [
      "-p",
      "--output-format=json",
      `--tools=${tools.join(",")}`,
      "--disallowedTools=mcp__*",
      ...(resume ? [`--resume=${resume}`] : []),
    ],
    { cwd: folder, maxBuffer: 64 * 1024 * 1024, signal },
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
    /** 주인이 고른 공유 수준. 다시 켤 때 따로 고르지 않으면 이것을 쓴다. */
    share: join(common, "omagari", "share"),
    /** 편집 전 훅이 작업 세션마다 보여 준 것을 적어 두는 폴더. 세션 id마다 파일 하나다. */
    hooks: join(common, "omagari", "hooks"),
  };
}

/**
 * 같은 기기에서 `folder`의 레포에 짝지어진 러너에 요청 하나를 보내고 답 하나를 받는다. CLI와 훅이 쓴다.
 * 러너가 꺼져 있으면 던지고, 러너가 답하지 못했으면 그 오류를 `ContractFailure`로 던진다.
 */
export async function callRunner<K extends keyof typeof cliToRunner & string>(
  folder: string,
  kind: K,
  payload: Parameters<typeof encode<typeof cliToRunner, K>>[2],
) {
  const { socket } = await runnerPaths(folder);
  const connection = connectLocal(socket);
  connection.end(encode(cliToRunner, kind, payload));
  const frame = await text(connection).catch(() => {
    throw new Error(`러너가 꺼져 있다: ${socket}`);
  });
  const decoded = decode(runnerToCli, frame);
  if ("error" in decoded) throw new Error(`러너의 답을 읽지 못했다: ${decoded.error.message}`);
  const { message } = decoded;
  if (message.kind === "error") throw new ContractFailure(message.payload);
  return message;
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
  /** 한 턴의 시간 상한. 기본 10분. */
  turnTimeoutMs?: number;
  /** 관측의 공유 수준. 기본 full. */
  share?: ShareLevel;
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
  /** welcome이 알려 준 이 러너의 멤버. */
  let login: string | undefined;
  /** 서버에서 받아 둔 지금 상황. 훅이 서버 대신 이것을 읽는다. 끊기면 지우지 않고 끊긴 시각을 단다. */
  let situation: { works: WorkView[]; disconnectedAt: string | null } | undefined;
  /** 마지막으로 관측한 내 작업. 공유 수준과 상관없이 바뀐 파일의 경로가 있다. */
  let mine: Work[] = [];

  async function connect() {
    const current = new WebSocket(url);
    socket = current;
    const welcomed = Promise.withResolvers<{ login: string; repo: string }>();
    let refusal: Error | undefined;
    const timer = setTimeout(
      () => welcomed.reject(new Error(`서버가 ${timeoutMs}ms 안에 답하지 않았다: ${url}`)),
      timeoutMs,
    );

    // 러너가 돌리는 실행기는 아직 Claude Code 하나다. Codex는 #16이 더한다.
    current.addEventListener("open", () =>
      current.send(
        encode(runnerToServer, "hello", {
          session: options.session,
          repos,
          executors: ["claude-code"],
        }),
      ),
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
        login = message.payload.login;
        welcomed.resolve(message.payload);
      } else if (message.kind === "situation") {
        situation = { works: message.payload.works, disconnectedAt: null };
      } else if (message.kind === "ask") {
        // 답은 문답이 온 연결로 보낸다. 그사이 끊겼으면 서버는 이미 실패로 돌려줬고, 보낸 것은 버려진다.
        void reply(message.payload.message).then(({ kind, payload }) =>
          current.send(encode(runnerToServer, kind, payload, message.id)),
        );
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
        if (situation) situation.disconnectedAt ??= new Date().toISOString();
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

  // ponytail: 러너 세션은 하나라 터미널과 서버의 문답이 같이 잇고, 러너가 다시 켜지면 새 세션으로 시작한다. 채널마다의 세션은 #21이 넣는다.
  let session: string | undefined;
  /** 턴의 줄. 터미널에서 온 것도 서버에서 온 것도 온 순서대로 한 번에 하나씩 돈다. */
  let queue: Promise<unknown> = Promise.resolve();
  const turnTimeoutMs = options.turnTimeoutMs ?? TURN_TIMEOUT_MS;

  /** 러너 세션의 한 턴. 시간 상한을 넘으면 끊는다. 성공이든 실패든 실행 기록을 남긴다. */
  async function turn(message: string) {
    const record: RunRecord = {
      at: new Date().toISOString(),
      session,
      message,
      tools: READ_ONLY_TOOLS,
    };
    const signal = AbortSignal.timeout(turnTimeoutMs);
    // 실행기가 signal을 따르지 않아도 줄은 상한에서 다음 턴으로 넘어간다.
    const cut = new Promise<never>((_, reject) => {
      signal.onabort = () => reject(signal.reason);
    });
    try {
      const result = await Promise.race([
        executor({ message, resume: session, tools: READ_ONLY_TOOLS, folder, signal }),
        cut,
      ]);
      if (!result.answer.trim()) throw new Error("실행기가 답 없이 끝났다");
      record.session = session = result.session;
      return result.answer;
    } catch (error) {
      if (signal.aborted) {
        record.error = `한 턴이 ${turnTimeoutMs / 60_000}분을 넘어 끊었다`;
        throw new ContractFailure({ code: "turn_timeout", message: record.error });
      }
      record.error = error instanceof Error ? error.message : String(error);
      throw new ContractFailure({ code: "executor_failed", message: record.error });
    } finally {
      await appendFile(paths.log, `${JSON.stringify(record)}\n`);
    }
  }

  /** 줄을 서서 한 턴을 돌리고, 답이나 오류를 보낼 꼴로 돌려준다. 던지지 않는다. */
  function reply(message: string) {
    const replied = queue
      .then(() => turn(message))
      .then(
        (text) => ({ kind: "answer" as const, payload: { text } }),
        (error) => {
          const failure =
            error instanceof ContractFailure
              ? error
              : new ContractFailure({ code: "internal", message: String(error) });
          return {
            kind: "error" as const,
            payload: { code: failure.code, message: failure.message },
          };
        },
      );
    queue = replied;
    return replied;
  }

  async function replyToCli(frame: string) {
    const decoded = decode(cliToRunner, frame);
    if ("error" in decoded) return encode(runnerToCli, "error", decoded.error, decoded.re);
    const { message } = decoded;
    if (message.kind === "situation" || message.kind === "nearby") {
      // 문답의 줄에 서지 않고 받아 둔 것으로 바로 답한다. 서버는 부르지 않는다.
      // 두 요청에 실린 실행기(ADR-0015)는 아직 쓰지 않는다. 작업이 어느 에이전트의 것인지 서버에 알리는 것은 다음 계약 변경에서 더한다.
      if (!situation || !login) {
        return encode(
          runnerToCli,
          "error",
          { code: "runner_offline", message: "러너가 아직 서버에서 상황을 받지 못했다" },
          message.id,
        );
      }
      if (message.kind === "situation") {
        // ponytail: 받아 둔 것을 내용까지 통째로 준다. 세션을 시작할 때 한 번이라 견딘다. 편집마다 부르는 훅은 nearby로 거른다.
        return encode(runnerToCli, "situation", { login, ...situation, mine }, message.id);
      }
      const { disconnectedAt, works } = situation;
      return encode(
        runnerToCli,
        "nearby",
        { works: await nearby(folder, works, login, message.payload.path), disconnectedAt },
        message.id,
      );
    }
    const { kind, payload } = await reply(message.payload.message);
    return encode(runnerToCli, kind, payload, message.id);
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
      .then(replyToCli)
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
   * 관측: 주기마다 등록한 폴더와 연결된 워크트리의 작업을 다시 읽고, 이 연결로 지난번에 보낸 것과 다를 때만 보낸다. 다시 붙으면 처음부터 보낸다.
   * 읽지 못하면 까닭을 한 번만 알리고 다음 주기에 다시 읽는다.
   */
  async function observeLoop(remote: string) {
    // ponytail: 파일 감시(Room의 0.3초 묶음) 없이 3초마다 전체를 다시 읽는다. 늘 전체라 1분 재조정도 따로 없다.
    // 고친 뒤 3초가 길거나 큰 레포에서 읽기가 무거워지면 fs.watch로 깨운다.
    // ponytail: 달라지면 작업 전체(내용 합계 8MiB까지)를 다시 보낸다. 큰 작업을 자주 고치면 파일마다의 차이만 보낸다.
    let sent: { to?: WebSocket; works?: string } = {};
    let problem: string | undefined;
    while (!stopping.signal.aborted) {
      let problems: string[];
      try {
        const observed = await observe(folder, remote, options.share ?? "full");
        mine = observed.works;
        problems = observed.problems;
        // intent는 바뀐 파일의 경로도 내보내지 않는다. 경로는 이 기기의 훅만 쓴다.
        const works = mine.map((work) => (work.share === "intent" ? { ...work, files: [] } : work));
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
      } catch (error) {
        problems = [error instanceof Error ? error.message : String(error)];
      }
      const message = problems.join("\n  ") || undefined;
      if (message && message !== problem && !stopping.signal.aborted)
        console.warn(`관측: ${message}`);
      problem = message;
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
