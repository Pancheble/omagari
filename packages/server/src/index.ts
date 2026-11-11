import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { serve, upgradeWebSocket } from "@hono/node-server";
import {
  api,
  CONTRACT_VERSION,
  type ContractError,
  ContractFailure,
  decode,
  encode,
  MAX_FRAME_BYTES,
  RUNNER_SOCKET,
  runnerToServer,
  serverToRunner,
  type Work,
} from "@omagari/contract";
import type { WSContext } from "hono/ws";
import { type WebSocket, WebSocketServer } from "ws";
import type { GitHub } from "./github.ts";
import { createApp, mount } from "./http.ts";

export { type GitHub, realGitHub } from "./github.ts";

/** push 권한을 다시 확인하는 주기. Room의 10분에서 시작한다(ADR-0011). */
const RECHECK_MS = 10 * 60_000;
/** 러너 연결의 생사를 묻는 주기. 답이 없으면 다음 주기에 끊는다. */
const HEARTBEAT_MS = 30_000;
/** 끝나지 않은 기기 인증을 들고 있는 수의 상한. 로그인 없이 부르는 경로라 GitHub에 무한히 묻지 않는다. */
const MAX_PENDING_LOGINS = 100;

const hash = (session: string) => createHash("sha256").update(session).digest("hex");

export async function startServer(options: {
  /** 워크스페이스의 레포 `owner/name`. 서버 하나에 워크스페이스 하나, 레포 하나다(ADR-0012). */
  repo: string;
  github: GitHub;
  /** SQLite 파일. 주지 않으면 메모리에 두고 서버가 꺼지면 잃는다. */
  database?: string;
  port?: number;
  /** 듣는 주소. 기본은 이 기기 안에서만 듣는다. 바깥에 열 때만 "0.0.0.0"처럼 준다. */
  hostname?: string;
  recheckMs?: number;
  heartbeatMs?: number;
}) {
  const { repo, github } = options;
  const hostname = options.hostname ?? "127.0.0.1";
  const db = new DatabaseSync(options.database ?? ":memory:");
  // 세션은 해시로만 둔다. GitHub 토큰은 서버 밖으로 나가지 않는다.
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    github_token TEXT NOT NULL
  ) STRICT`);
  // 작업(멤버 + 브랜치)마다의 마지막 관측. `files`는 계약의 ObservedFile 배열(JSON)이다.
  db.exec(`CREATE TABLE IF NOT EXISTS works (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    base TEXT NOT NULL,
    files TEXT NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT`);
  /** 멤버의 작업을 러너가 지금 보는 것으로 바꾼다. */
  // ponytail: 멤버 하나에 러너 하나로 본다. 한 멤버가 기기 둘에서 러너를 켜면 나중에 보낸 쪽이 덮는다. 그때는 러너마다 나눈다.
  const replaceWorks = (login: string, works: Work[]) => {
    db.exec("BEGIN");
    db.prepare("DELETE FROM works WHERE login = ?").run(login);
    const insert = db.prepare(
      "INSERT OR REPLACE INTO works (login, branch, base, files) VALUES (?, ?, ?, ?)",
    );
    for (const work of works) insert.run(login, work.branch, work.base, JSON.stringify(work.files));
    db.exec("COMMIT");
  };
  const sessionLogin = (session: string) =>
    (
      db.prepare("SELECT login FROM sessions WHERE hash = ?").get(hash(session)) as
        | { login: string }
        | undefined
    )?.login;

  /** 끝나지 않은 기기 인증. 서버가 꺼지면 잃는다. 다시 로그인하면 된다. */
  const logins = new Map<
    string,
    { deviceCode: string; expiresAt: number; intervalMs: number; nextPollAt: number }
  >();
  /** hello를 마친 러너의 연결. */
  const runners = new Map<WSContext, { login: string; hash: string }>();

  const refuse = (socket: WSContext, error: ContractError, re?: string) => {
    socket.send(encode(serverToRunner, "error", error, re));
    socket.close(1008, error.code);
  };

  const app = createApp((authorization) => {
    const session = authorization?.match(/^Bearer (\S+)$/)?.[1];
    return session && sessionLogin(session);
  });

  mount(app, api.health, () => ({ contract: CONTRACT_VERSION }));

  mount(app, api.login, async () => {
    const now = Date.now();
    for (const [device, pending] of logins) if (pending.expiresAt < now) logins.delete(device);
    if (logins.size >= MAX_PENDING_LOGINS) {
      throw new ContractFailure({
        code: "internal",
        message: "로그인이 밀려 있다. 잠시 뒤 다시 하라",
      });
    }
    const started = await github.startDevice();
    const device = randomBytes(16).toString("hex");
    logins.set(device, {
      deviceCode: started.deviceCode,
      expiresAt: now + started.expiresInMs,
      intervalMs: started.intervalMs,
      nextPollAt: now + started.intervalMs,
    });
    return {
      device,
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      intervalMs: started.intervalMs,
    };
  });

  mount(app, api.loginPoll, async ({ device }) => {
    const pending = logins.get(device);
    if (!pending || pending.expiresAt < Date.now()) {
      logins.delete(device);
      throw new ContractFailure({
        code: "unauthorized",
        message: "기기 인증이 끝났다. 로그인을 다시 하라",
      });
    }
    // 너무 자주 물으면 GitHub에 넘기지 않는다(GitHub의 slow_down을 부르지 않는다).
    if (Date.now() < pending.nextPollAt) return { pending: true as const };
    const polled = await github.pollDevice(pending.deviceCode);
    if ("pending" in polled) {
      pending.intervalMs = polled.intervalMs ?? pending.intervalMs;
      pending.nextPollAt = Date.now() + pending.intervalMs;
      return { pending: true as const };
    }
    logins.delete(device);
    if ("error" in polled)
      throw new ContractFailure({ code: "unauthorized", message: polled.error });

    const login = await github.login(polled.token);
    const push = await github.canPush(polled.token, repo);
    if (push === undefined) {
      throw new ContractFailure({
        code: "internal",
        message: `GitHub에서 ${repo}의 push 권한을 확인하지 못했다. 잠시 뒤 다시 하라`,
      });
    }
    if (!push) {
      throw new ContractFailure({
        code: "forbidden",
        message: `${login}는 ${repo}에 push 권한이 없어 이 워크스페이스에 들어올 수 없다`,
      });
    }
    const session = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (hash, login, github_token) VALUES (?, ?, ?)").run(
      hash(session),
      login,
      polled.token,
    );
    return { session, login };
  });

  mount(app, api.members, () => {
    const online = new Set([...runners.values()].map((runner) => runner.login));
    const rows = db.prepare("SELECT DISTINCT login FROM sessions ORDER BY login").all() as {
      login: string;
    }[];
    return {
      members: rows.map(({ login }) => ({
        login,
        agent: online.has(login) ? ("online" as const) : ("offline" as const),
      })),
    };
  });

  mount(app, api.works, () => {
    // 워크스페이스에서 빠진 사람(세션이 없는 사람)의 작업은 보이지 않는다.
    const rows = db
      .prepare(
        `SELECT login, branch, base, files FROM works
         WHERE login IN (SELECT login FROM sessions) ORDER BY login, branch`,
      )
      .all() as { login: string; branch: string; base: string; files: string }[];
    return { works: rows.map((row) => ({ ...row, files: JSON.parse(row.files) })) };
  });

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
          const { session, repos } = message.payload;
          const login = sessionLogin(session);
          if (!login) {
            return refuse(
              socket,
              { code: "unauthorized", message: "세션이 없거나 끝났다. 다시 로그인하라" },
              message.id,
            );
          }
          if (!repos.some((r) => r.toLowerCase() === repo.toLowerCase())) {
            return refuse(
              socket,
              {
                code: "forbidden",
                message: `이 폴더는 ${repo}의 폴더가 아니다(GitHub 원격: ${repos.join(", ")})`,
              },
              message.id,
            );
          }
          runners.set(socket, { login, hash: hash(session) });
          socket.send(encode(serverToRunner, "welcome", { login, repo }, message.id));
          return;
        }
        const runner = runners.get(socket);
        if (!runner) {
          // hello를 마치지 않은 연결의 메시지는 받지 않는다.
          refuse(socket, { code: "unauthorized", message: "hello를 먼저 보내라" }, message.id);
        } else if (message.kind === "observation") {
          replaceWorks(runner.login, message.payload.works);
        } else {
          console.warn("러너가 서버의 메시지를 거절했다:", message.payload);
        }
      },
      onClose(_, socket) {
        runners.delete(socket);
      },
    })),
  );

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  // 연결의 생사: 주기마다 ping을 보내고, 다음 주기까지 pong이 없으면 끊는다.
  // 잠든 기기처럼 close 없이 사라진 러너도 이렇게 오프라인이 된다. 러너(내장 WebSocket)는 pong을 알아서 보낸다.
  const alive = new WeakSet<WebSocket>();
  sockets.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
  });
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);

  // push 권한을 잃은 세션을 지우고 그 러너를 내보낸다. GitHub이 답하지 못하면 다음 주기에 다시 본다.
  let stopped = false;
  let checking = false;
  const recheck = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const rows = db.prepare("SELECT hash, login, github_token FROM sessions").all() as {
        hash: string;
        login: string;
        github_token: string;
      }[];
      for (const row of rows) {
        if ((await github.canPush(row.github_token, repo)) !== false || stopped) continue;
        db.prepare("DELETE FROM sessions WHERE hash = ?").run(row.hash);
        for (const [socket, runner] of runners) {
          if (runner.hash !== row.hash) continue;
          refuse(socket, {
            code: "forbidden",
            message: `${row.login}는 이제 ${repo}에 push 권한이 없어 워크스페이스에서 빠졌다`,
          });
        }
      }
    } catch (error) {
      console.error("push 권한을 다시 확인하지 못했다:", error);
    } finally {
      checking = false;
    }
  }, options.recheckMs ?? RECHECK_MS);

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
      stopped = true;
      clearInterval(heartbeat);
      clearInterval(recheck);
      for (const socket of sockets.clients) socket.terminate();
      server.close();
      await once(server, "close");
      db.close();
    },
  };
}
