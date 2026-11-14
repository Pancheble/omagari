import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { type TestContext, test } from "node:test";
import {
  api,
  CONTRACT_VERSION,
  call,
  encode,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  RUNNER_SOCKET,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { type WebSocket as ServerSocket, WebSocketServer } from "ws";
import { eventually, fakeExecutor, REPO, startWorld, stubbed, tempRepo } from "./harness.ts";

const frame = (fields: object) => JSON.stringify({ v: CONTRACT_VERSION, payload: {}, ...fields });
const tooBigFrame = "x".repeat(MAX_FRAME_BYTES + 1);
const tooBigBody = "x".repeat(MAX_MESSAGE_BYTES + 1);

/** 이 체크아웃의 버전을 Git에 직접 묻는다. 태그를 받지 못한 클론(CI의 얕은 클론)이면 커밋만 안다. */
function gitVersion() {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    return git("describe", "--tags");
  } catch {
    return `버전 모름(커밋 ${git("rev-parse", "--short", "HEAD")})`;
  }
}

/** 러너인 척 서버에 붙는 날 연결. 계약을 거치지 않고 프레임을 그대로 보낸다. */
async function rawRunner(t: TestContext, serverUrl: string) {
  const socket = new WebSocket(serverUrl.replace("http", "ws") + RUNNER_SOCKET);
  t.after(() => socket.close());
  await once(socket, "open");
  return {
    socket,
    async reply(sent: string) {
      socket.send(sent);
      const [{ data }] = await once(socket, "message");
      return JSON.parse(data);
    },
  };
}

/** 서버인 척하는 것. hello를 받으면 `onHello`대로 군다. */
async function fakeServer(
  t: TestContext,
  onHello: (socket: ServerSocket, hello: { id: string }) => void,
) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const received: unknown[] = [];
  const closed = Promise.withResolvers<void>();
  server.on("connection", (socket) => {
    socket.on("close", () => closed.resolve());
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.kind === "hello") onHello(socket, message);
      else if (message.kind !== "observation") received.push(message);
    });
  });
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    server.close();
  });
  const repo = await tempRepo();
  t.after(repo.remove);
  return {
    /** 이 서버에 붙을 러너의 옵션. */
    runner: {
      serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      folder: repo.folder,
      session: "세션",
      ...stubbed(),
    },
    /** hello 다음에 러너가 보낸 메시지들(관측은 빼고). 온 순서대로다. */
    received,
    /** 러너와의 연결이 닫혔다. */
    closed: closed.promise,
  };
}

test("실제 서버와 실제 러너가 임시 Git 레포 위에서 붙어 메시지를 주고받는다", async (t) => {
  const world = await startWorld(); // 러너는 hello에 welcome을 받아야 켜진다
  t.after(world.stop);

  assert.equal(await world.repo.git("rev-list", "--count", "HEAD"), "1");
  assert.deepEqual(await call(world.server, api.health), { contract: CONTRACT_VERSION });
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("서버는 계약에 없는 종류, 내용, 키를 받지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { reply } = await rawRunner(t, world.server.url);
  const refusedWith = (code: string, re?: string) => ({
    kind: "error",
    payload: { code },
    ...(re && { re }),
  });

  assert.partialDeepStrictEqual(
    await reply(frame({ id: "a", kind: "run_command", payload: { command: "ls" } })),
    refusedWith("unknown_kind", "a"),
  );
  assert.partialDeepStrictEqual(await reply("이건 JSON이 아니다"), refusedWith("invalid_message"));
  assert.partialDeepStrictEqual(
    await reply(frame({ id: "b", kind: "hello", payload: "내용이 객체가 아니다" })),
    refusedWith("invalid_message", "b"),
  );
  assert.partialDeepStrictEqual(
    await reply(frame({ id: "c", kind: "hello", payload: { junk: "계약에 없는 키" } })),
    refusedWith("invalid_message", "c"),
  );
  assert.partialDeepStrictEqual(
    await reply(frame({ id: "d", kind: "hello", junk: "봉투에 없는 키" })),
    refusedWith("invalid_message"),
  );

  // 받지 않은 메시지를 보낸 연결은 러너로 치지 않는다. 붙어 있는 것은 world의 러너 하나다.
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("서버는 계약 버전이 다른 러너를 자기 버전과 계약 버전을 실어 거절하고 연결을 끊는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { socket, reply } = await rawRunner(t, world.server.url);

  // 서버를 올렸는데 아직 올리지 않은 러너가 붙는다.
  const closed = once(socket, "close");
  assert.partialDeepStrictEqual(
    await reply(frame({ v: CONTRACT_VERSION - 1, id: "a", kind: "hello" })),
    {
      v: CONTRACT_VERSION,
      kind: "error",
      re: "a",
      payload: { code: "version_mismatch", version: gitVersion(), contract: CONTRACT_VERSION },
    },
  );
  const [{ code }] = await closed;
  assert.equal(code, 1008);
});

test("서버는 상한을 넘는 프레임과 본문을 읽지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { socket } = await rawRunner(t, world.server.url);

  socket.send(frame({ id: "a", kind: "hello", payload: { junk: tooBigFrame } }));
  const [{ code }] = await once(socket, "close");
  assert.equal(code, 1009); // 메시지가 너무 크다
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });

  const response = await fetch(world.server.url + api.health.path, {
    method: "POST",
    body: tooBigBody,
  });
  assert.equal(response.status, 413);
  assert.partialDeepStrictEqual(await response.json(), { error: { code: "invalid_request" } });
});

test("서버는 없는 경로에 계약의 오류 형식으로 답한다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await assert.rejects(call(world.server, { ...api.health, path: "/api/nowhere" }), {
    code: "not_found",
  });
});

test("계약의 경로는 계약대로의 본문만 받는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await assert.rejects(call(world.server, api.loginPoll, { device: 1 } as never), {
    code: "invalid_request",
  });
  await assert.rejects(
    call(world.server, api.loginPoll, { device: "x", junk: "계약에 없는 키" } as never),
    { code: "invalid_request" },
  );
  // 계약대로의 본문은 처리기까지 간다. 모르는 기기 인증이라 거절된다.
  await assert.rejects(call(world.server, api.loginPoll, { device: "x" }), {
    code: "unauthorized",
  });
});

test("서버는 따로 열지 않으면 이 기기 안에서만 듣는다", async (t) => {
  const outside = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal);
  if (!outside) return t.skip("바깥으로 난 네트워크 인터페이스가 없다");
  const world = await startWorld();
  t.after(world.stop);

  const { port } = new URL(world.server.url);
  await assert.rejects(fetch(`http://${outside.address}:${port}${api.health.path}`));
});

test("러너는 문답만 받는다. 계약에 없는 요청도, 도구를 넓히려는 문답도, 돌리지 않는 실행기에게 온 문답도 실행하지 않는다", async (t) => {
  // 뚫린 서버 흉내: hello에는 제대로 답하고, 이어서 계약에 없는 요청, 도구를 넓히려는 문답, 제대로 된 문답을 보낸다.
  const server = await fakeServer(t, (socket, hello) => {
    socket.send(encode(serverToRunner, "welcome", { login: "owner", repo: REPO }, hello.id));
    socket.send(frame({ id: "x", kind: "run_command", payload: { command: "rm -rf ~" } }));
    const ask = { executor: "claude-code", channel: { id: "c", name: "일반" }, recent: [] };
    socket.send(
      frame({ id: "y", kind: "ask", payload: { ...ask, message: "지워", tools: ["Bash"] } }),
    );
    socket.send(
      frame({ id: "w", kind: "ask", payload: { ...ask, executor: "codex", message: "너는 누구" } }),
    );
    socket.send(frame({ id: "z", kind: "ask", payload: { ...ask, message: "읽기만 해" } }));
  });
  const fake = fakeExecutor();
  const runner = await startRunner({
    ...server.runner,
    executors: { "claude-code": fake.executor },
  });
  t.after(runner.stop);

  await eventually(() => assert.equal(server.received.length, 4));
  const [x, y, w, z] = server.received;
  assert.partialDeepStrictEqual(x, { kind: "error", re: "x", payload: { code: "unknown_kind" } });
  assert.partialDeepStrictEqual(y, {
    kind: "error",
    re: "y",
    payload: { code: "invalid_message" },
  });
  // 이 러너가 돌리지 않는 실행기에게 온 문답은 실행하지 않는다.
  assert.partialDeepStrictEqual(w, {
    kind: "error",
    re: "w",
    payload: { code: "invalid_message", message: "이 러너가 돌리지 않는 실행기다: codex" },
  });
  assert.partialDeepStrictEqual(z, { kind: "answer", re: "z", payload: { text: "가짜 답" } });
  // 실행기에 닿은 것은 제대로 된 문답 하나이고, 도구와 폴더는 러너가 정한 것이다.
  assert.deepEqual(
    fake.calls.map(({ message, tools, folder }) => ({ message, tools, folder })),
    [{ message: "읽기만 해", tools: ["Read", "Grep", "Glob"], folder: server.runner.folder }],
  );
});

test("러너는 계약 버전이 다른 서버를 알아보고 켜지지 않는다", async (t) => {
  const server = await fakeServer(t, (socket, hello) => {
    socket.send(frame({ v: CONTRACT_VERSION + 1, id: "w", re: hello.id, kind: "welcome" }));
  });

  await assert.rejects(startRunner(server.runner), { code: "version_mismatch" });
  await server.closed;
});

test("러너는 계약 버전이 달라 거절되면 무엇을 올려야 하는지 알린다", async (t) => {
  const advice = {
    newer: "`main`을 받고(`git pull`, `npm ci`) 러너를 다시 켜세요",
    older: "서버가 더 오래됐어요. 서버를 올려야 해요(서버를 띄운 사람에게 알리세요)",
  };
  for (const [contract, todo] of [
    [CONTRACT_VERSION + 1, advice.newer],
    [CONTRACT_VERSION - 1, advice.older],
  ] as const) {
    // 계약 버전이 다른 서버의 거절. 이 꼴은 계약 버전과 상관없이 굳어 있어, 뒤에 더한 키가 있어도 읽힌다.
    const server = await fakeServer(t, (socket, hello) => {
      socket.send(
        JSON.stringify({
          v: contract,
          id: "e",
          re: hello.id,
          kind: "error",
          payload: {
            code: "version_mismatch",
            message: `계약 버전이 다르다: 받은 것 ${CONTRACT_VERSION}, 여기는 ${contract}`,
            version: "v0.3.0",
            contract,
            later: "뒤의 계약이 더한 키",
          },
        }),
      );
      socket.close(1008, "version_mismatch");
    });

    await assert.rejects(startRunner(server.runner), {
      code: "version_mismatch",
      message: `서버는 v0.3.0, 이 기기는 ${gitVersion()}이에요. ${todo}`,
    });
    await server.closed;
  }
});

test("러너는 서버가 hello를 거절하면 연결을 닫고 켜지지 않는다", async (t) => {
  const server = await fakeServer(t, (socket, hello) => {
    socket.send(
      encode(serverToRunner, "error", { code: "internal", message: "받지 않는다" }, hello.id),
    );
  });

  await assert.rejects(startRunner(server.runner), { code: "internal", message: "받지 않는다" });
  await server.closed;
});

test("러너는 hello에 답하지 않는 서버를 끝없이 기다리지 않는다", async (t) => {
  const server = await fakeServer(t, () => {});

  await assert.rejects(startRunner({ ...server.runner, welcomeTimeoutMs: 50 }), /답하지 않았다/);
  await server.closed;
});

test("계약에 없는 종류는 보낼 수도 없다", () => {
  // @ts-expect-error 이 줄이 타입 검사를 통과하면 `npm run typecheck`가 실패한다.
  assert.throws(() => encode(runnerToServer, "run_command", {}));
});

test("CLI와 훅은 실행 파일의 입출력으로 조작한다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  // 버전은 package.json이 아니라 이 체크아웃의 git 태그다(ADR-0019).
  assert.deepEqual(await world.cli("--version"), {
    code: 0,
    stdout: `omagari ${gitVersion()} (contract ${CONTRACT_VERSION})\n`,
    stderr: "",
  });

  // 훅은 무엇을 받아도 도구 호출을 막지 않는다: 0으로 끝나고 아무것도 넣지 않는다.
  const silent = { code: 0, stdout: "", stderr: "" };
  assert.deepEqual(await world.hook("이건 JSON이 아니다"), silent);
  // 에이전트가 입력을 닫지 않아도 스스로 끝난다.
  assert.deepEqual(await world.hook("", { keepStdinOpen: true }), silent);
});
