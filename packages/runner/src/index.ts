import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { promisify } from "node:util";
import {
  ContractFailure,
  cliToRunner,
  decode,
  encode,
  RUNNER_SOCKET,
  runnerToCli,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";

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

/** 러너를 켠다. 서버에 붙어 hello에 welcome을 받으면 돌아오고, 못 받으면 연결을 닫고 던진다. */
export async function startRunner(options: {
  serverUrl: string;
  /** 레포를 받은 폴더. 러너는 이 폴더 하나에 짝지어진다. */
  folder: string;
  executor?: Executor;
  /** welcome을 기다리는 시간. */
  welcomeTimeoutMs?: number;
}) {
  const paths = await runnerPaths(options.folder);
  await mkdir(dirname(paths.log), { recursive: true });

  const url = new URL(RUNNER_SOCKET, options.serverUrl);
  url.protocol = url.protocol.replace("http", "ws");
  // ponytail: 끊기면 다시 붙지 않는다. 다시 붙기는 러너 로그인(#8)과 함께 넣는다.
  const socket = new WebSocket(url);
  const welcomed = Promise.withResolvers<void>();
  const timeoutMs = options.welcomeTimeoutMs ?? 10_000;
  const timer = setTimeout(
    () => welcomed.reject(new Error(`서버가 ${timeoutMs}ms 안에 답하지 않았다: ${url}`)),
    timeoutMs,
  );

  socket.addEventListener("open", () => socket.send(encode(runnerToServer, "hello", {})));
  socket.addEventListener("close", () => welcomed.reject(new Error(`서버에 붙지 못했다: ${url}`)));
  socket.addEventListener("message", ({ data }) => {
    const decoded = decode(serverToRunner, data);
    if ("error" in decoded) {
      socket.send(encode(runnerToServer, "error", decoded.error, decoded.re));
      if (decoded.error.code === "version_mismatch") {
        welcomed.reject(new ContractFailure(decoded.error));
        // 내장 WebSocket의 close()는 코드 1000과 3000~4999만 받는다. 코드 없이 닫는다.
        socket.close();
      }
      return;
    }
    const { message } = decoded;
    if (message.kind === "welcome") {
      welcomed.resolve();
    } else {
      console.warn("서버가 러너의 메시지를 거절했다:", message.payload);
      welcomed.reject(new ContractFailure(message.payload));
    }
  });

  try {
    await welcomed.promise;
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const executor = options.executor ?? claudeCode;
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
      const result = await executor({
        message,
        resume: session,
        tools: READ_ONLY_TOOLS,
        folder: options.folder,
      });
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
  try {
    // ponytail: 꺼진 러너가 남긴 소켓을 지우고 연다. 같은 레포에 러너 둘을 막는 것은 러너 켜기(#8)가 한다.
    await rm(paths.socket, { force: true });
    local.listen(paths.socket);
    await once(local, "listening");
  } catch (error) {
    socket.close();
    throw error;
  }

  return {
    folder: options.folder,
    async stop() {
      socket.close();
      local.close();
      await once(local, "close");
    },
  };
}
