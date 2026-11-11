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

/** 러너를 켠다. 서버에 붙어 hello에 welcome을 받으면 돌아오고, 못 받으면 연결을 닫고 던진다. */
export async function startRunner(options: {
  serverUrl: string;
  /** 레포를 받은 폴더. 러너는 이 폴더 하나에 짝지어진다. */
  folder: string;
  executor?: Executor;
  /** welcome을 기다리는 시간. */
  welcomeTimeoutMs?: number;
}) {
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
  return {
    folder: options.folder,
    stop() {
      socket.close();
    },
  };
}
