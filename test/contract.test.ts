import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  api,
  CONTRACT_VERSION,
  call,
  encode,
  RUNNER_SOCKET,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { WebSocketServer } from "ws";
import { startWorld, tempRepo } from "./harness.ts";

const frame = (fields: object) => JSON.stringify({ v: CONTRACT_VERSION, payload: {}, ...fields });

test("실제 서버와 실제 러너가 임시 Git 레포 위에서 붙어 메시지를 주고받는다", async (t) => {
  const world = await startWorld(); // 러너는 hello에 welcome을 받아야 켜진다
  t.after(world.stop);

  assert.equal(await world.repo.git("rev-list", "--count", "HEAD"), "1");
  assert.deepEqual(await call(world.server.url, api.health), {
    contract: CONTRACT_VERSION,
    runners: 1,
  });
});

test("서버는 계약에 없는 종류의 메시지를 받지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const socket = new WebSocket(world.server.url.replace("http", "ws") + RUNNER_SOCKET);
  await once(socket, "open");
  const reply = async (sent: string) => {
    socket.send(sent);
    const [{ data }] = await once(socket, "message");
    return JSON.parse(data);
  };

  const unknown = await reply(frame({ id: "a", kind: "run_command", payload: { command: "ls" } }));
  assert.partialDeepStrictEqual(unknown, {
    kind: "error",
    re: "a",
    payload: { code: "unknown_kind" },
  });

  const garbage = await reply("이건 JSON이 아니다");
  assert.partialDeepStrictEqual(garbage, { kind: "error", payload: { code: "invalid_message" } });

  const malformed = await reply(frame({ id: "b", kind: "hello", payload: "내용이 객체가 아니다" }));
  assert.partialDeepStrictEqual(malformed, {
    kind: "error",
    re: "b",
    payload: { code: "invalid_message" },
  });

  // 받지 않은 메시지를 보낸 연결은 러너로 치지 않는다. 붙어 있는 것은 world의 러너 하나다.
  assert.equal((await call(world.server.url, api.health)).runners, 1);

  const closed = once(socket, "close");
  const mismatch = await reply(frame({ v: CONTRACT_VERSION + 1, id: "c", kind: "hello" }));
  assert.partialDeepStrictEqual(mismatch, {
    kind: "error",
    re: "c",
    payload: { code: "version_mismatch" },
  });
  await closed; // 버전이 다르면 서버가 연결을 끊는다
});

test("러너는 계약에 없는 종류의 메시지를 받지 않는다", async (t) => {
  // 뚫린 서버 흉내: hello에는 제대로 답하고, 이어서 계약에 없는 요청을 보낸다.
  const rogue = new WebSocketServer({ port: 0 });
  await once(rogue, "listening");
  const refused = Promise.withResolvers<unknown>();
  rogue.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.kind !== "hello") return refused.resolve(message);
      socket.send(encode(serverToRunner, "welcome", {}, message.id));
      socket.send(frame({ id: "x", kind: "run_command", payload: { command: "rm -rf ~" } }));
    });
  });
  const repo = await tempRepo();
  const runner = await startRunner({
    serverUrl: `http://127.0.0.1:${(rogue.address() as AddressInfo).port}`,
    folder: repo.folder,
  });
  t.after(async () => {
    runner.stop();
    for (const socket of rogue.clients) socket.terminate();
    rogue.close();
    await repo.remove();
  });

  assert.partialDeepStrictEqual(await refused.promise, {
    kind: "error",
    re: "x",
    payload: { code: "unknown_kind" },
  });
});

test("계약에 없는 종류는 보낼 수도 없다", () => {
  // @ts-expect-error 이 줄이 타입 검사를 통과하면 `npm run typecheck`가 실패한다.
  assert.throws(() => encode(runnerToServer, "run_command", {}));
});

test("CLI와 훅은 실행 파일의 입출력으로 조작한다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  const version = await world.cli("--version");
  assert.equal(version.code, 0);
  assert.match(version.stdout, new RegExp(`contract ${CONTRACT_VERSION}\\b`));

  // 훅은 무엇을 받아도 도구 호출을 막지 않는다: 0으로 끝나고 아무것도 넣지 않는다.
  assert.deepEqual(await world.hook("이건 JSON이 아니다"), { code: 0, stdout: "", stderr: "" });
});
