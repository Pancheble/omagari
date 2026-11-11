import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { ContractError, call, type Route } from "@omagari/contract";
import { createApp, mount } from "./http.ts";

// API 스키마의 틀: 경로 하나의 정의로 서버(`mount`)와 부르는 쪽(`call`)이 맞물린다.
const echo = {
  method: "POST",
  path: "/echo",
  body: ContractError,
  response: ContractError,
} satisfies Route;

test("계약의 경로는 계약대로의 본문만 받고, 오류는 계약의 오류 형식으로 낸다", async (t) => {
  const app = createApp();
  mount(app, echo, (body) => body);
  const server = serve({ fetch: app.fetch, port: 0 });
  await once(server, "listening");
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const body = { code: "internal", message: "그대로 돌아온다" } as const;
  assert.deepEqual(await call(url, echo, body), body);

  await assert.rejects(call(url, echo, { code: "계약에 없는 코드" } as never), {
    code: "invalid_request",
  });
  await assert.rejects(call(url, { ...echo, path: "/nowhere" }, body), { code: "not_found" });
});
