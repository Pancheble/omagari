// 예외로 둔 테스트다. 동작 테스트는 `test/harness.ts`의 틀로 쓴다(AGENTS.md).
// 본문을 받는 경로가 아직 계약에 없어, 틀(`mount`)의 본문 검사만 여기서 안쪽을 직접 띄워 확인한다.
// 본문을 받는 첫 경로가 생기면 이 확인을 `test/`로 옮기고 이 파일을 지운다.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { ContractError, call, type Route } from "@omagari/contract";
import { createApp, mount } from "./http.ts";

const echo = {
  method: "POST",
  path: "/echo",
  body: ContractError,
  response: ContractError,
} satisfies Route;

test("계약의 경로는 계약대로의 본문만 받는다", async (t) => {
  const app = createApp();
  mount(app, echo, (body) => body);
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const body = { code: "internal", message: "그대로 돌아온다" } as const;
  assert.deepEqual(await call(url, echo, body), body);

  await assert.rejects(call(url, echo, { code: "계약에 없는 코드" } as never), {
    code: "invalid_request",
  });
  await assert.rejects(call(url, echo, { ...body, junk: "계약에 없는 키" } as never), {
    code: "invalid_request",
  });
});
