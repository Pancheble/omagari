// Source link (AGPL-3.0 section 13): the settings window shows where the server's source is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { startWorld } from "./harness.ts";

test("the settings window gets Omagari's repo by default", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  assert.equal(
    (await call(world.owner, api.settings)).sourceUrl,
    "https://github.com/omagari-dev/omagari",
  );
});

test("the settings window gets the fork URL the server operator configured", async (t) => {
  const fork = "https://example.com/my-fork";
  const world = await startWorld({ sourceUrl: fork });
  t.after(world.stop);
  assert.equal((await call(world.owner, api.settings)).sourceUrl, fork);
});
