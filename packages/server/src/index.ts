import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, upgradeWebSocket } from "@hono/node-server";
import {
  api,
  CONTRACT_VERSION,
  decode,
  encode,
  MAX_MESSAGE_BYTES,
  RUNNER_SOCKET,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";
import { WebSocketServer } from "ws";
import { createApp, mount } from "./http.ts";

/**
 * 서버의 바깥 경계: GitHub(로그인, push 권한, 초안 PR).
 * 무엇을 묻는지는 그것을 쓰는 이슈가 더한다. 테스트는 여기에 가짜를 꽂는다.
 */
export type GitHub = Record<string, never>;

export async function startServer(
  options: {
    port?: number;
    /** 듣는 주소. 기본은 이 기기 안에서만 듣는다. 바깥에 열 때만 "0.0.0.0"처럼 준다. */
    hostname?: string;
    github?: GitHub;
  } = {},
) {
  const hostname = options.hostname ?? "127.0.0.1";
  // hello를 마친 러너의 연결.
  // ponytail: 러너의 생사를 close로만 안다. 잠든 기기처럼 close 없이 사라진 연결은 남는다.
  // ping/pong은 러너가 다시 붙기와 한 설계라 "떨어지면 오프라인"을 만드는 #8이 넣는다.
  const runners = new Set<unknown>();
  const app = createApp();

  mount(app, api.health, () => ({ contract: CONTRACT_VERSION, runners: runners.size }));

  app.get(
    RUNNER_SOCKET,
    upgradeWebSocket(() => ({
      onMessage({ data }, socket) {
        const decoded = decode(runnerToServer, data);
        if ("error" in decoded) {
          socket.send(encode(serverToRunner, "error", decoded.error, decoded.re));
          if (decoded.error.code === "version_mismatch") socket.close(1008, "version_mismatch");
          return;
        }
        const { message } = decoded;
        if (message.kind === "hello") {
          runners.add(socket);
          socket.send(encode(serverToRunner, "welcome", {}, message.id));
        } else {
          console.warn("러너가 서버의 메시지를 거절했다:", message.payload);
        }
      },
      onClose(_, socket) {
        runners.delete(socket);
      },
    })),
  );

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const server = serve({
    fetch: app.fetch,
    port: options.port ?? 0,
    hostname,
    websocket: { server: sockets },
  });
  await once(server, "listening");

  return {
    url: `http://${hostname}:${(server.address() as AddressInfo).port}`,
    async stop() {
      for (const socket of sockets.clients) socket.terminate();
      server.close();
      await once(server, "close");
    },
  };
}
