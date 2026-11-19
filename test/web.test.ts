import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, CONTRACT_VERSION, call } from "@omagari/contract";
import { startWorld, stubbed } from "./harness.ts";

test("the server serves the built web screen at the same address as the API, and sends a missing path to the first file", async (t) => {
  const web = await mkdtemp(join(tmpdir(), "omagari-web-"));
  t.after(() => rm(web, { recursive: true, force: true }));
  await writeFile(join(web, "index.html"), "<!doctype html><title>Omagari</title>");
  await writeFile(join(web, "app.js"), "console.log(1)");
  const world = await startWorld({ webDir: web });
  t.after(world.stop);
  const url = world.server.url;

  assert.match(await (await fetch(`${url}/`)).text(), /<title>Omagari/);
  assert.equal(await (await fetch(`${url}/app.js`)).text(), "console.log(1)");
  // A route inside the screen opens even on refresh.
  assert.match(await (await fetch(`${url}/forum/42`)).text(), /<title>Omagari/);
  // An API that doesn't exist is a contract error, not the screen.
  const missing = await fetch(`${url}/api/nope`);
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "not_found");
  // Health check
  assert.deepEqual(await call({ url, session: "", ...stubbed() }, api.health), {
    contract: CONTRACT_VERSION,
  });
});
