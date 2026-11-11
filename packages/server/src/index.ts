import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, upgradeWebSocket } from "@hono/node-server";
import {
  api,
  CONTRACT_VERSION,
  decode,
  encode,
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

export async function startServer(options: { port?: number; github?: GitHub } = {}) {
  const runners = new Set<unknown>(); // hello를 마친 러너의 연결
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

  const sockets = new WebSocketServer({ noServer: true });
  const server = serve({
    fetch: app.fetch,
    port: options.port ?? 0,
    websocket: { server: sockets },
  });
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async stop() {
      for (const socket of sockets.clients) socket.terminate();
      server.close();
      await once(server, "close");
    },
  };
}
