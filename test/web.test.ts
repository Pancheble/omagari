import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, CONTRACT_VERSION, call } from "@omagari/contract";
import { startWorld, stubbed } from "./harness.ts";

test("서버가 빌드한 웹 화면을 API와 같은 주소에서 내고, 없는 경로는 첫 파일로 보낸다", async (t) => {
  const web = await mkdtemp(join(tmpdir(), "omagari-web-"));
  t.after(() => rm(web, { recursive: true, force: true }));
  await writeFile(join(web, "index.html"), "<!doctype html><title>Omagari</title>");
  await writeFile(join(web, "app.js"), "console.log(1)");
  const world = await startWorld({ webDir: web });
  t.after(world.stop);
  const url = world.server.url;

  assert.match(await (await fetch(`${url}/`)).text(), /<title>Omagari/);
  assert.equal(await (await fetch(`${url}/app.js`)).text(), "console.log(1)");
  // 화면 안의 길은 새로 고쳐도 열린다.
  assert.match(await (await fetch(`${url}/forum/42`)).text(), /<title>Omagari/);
  // 없는 API는 화면이 아니라 계약의 오류다.
  const missing = await fetch(`${url}/api/nope`);
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "not_found");
  // 건강 확인
  assert.deepEqual(await call({ url, session: "", ...stubbed() }, api.health), {
    contract: CONTRACT_VERSION,
  });
});
