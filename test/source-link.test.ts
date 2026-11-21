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

test("the settings window gets the terms and privacy links the server sets, and none otherwise", async (t) => {
  const plain = await startWorld();
  t.after(plain.stop);
  const none = await call(plain.owner, api.settings);
  assert.equal(none.terms, undefined);
  assert.equal(none.privacy, undefined);
  const world = await startWorld({
    terms: "https://example.com/t",
    privacy: "https://example.com/p",
  });
  t.after(world.stop);
  const got = await call(world.owner, api.settings);
  assert.equal(got.terms, "https://example.com/t");
  assert.equal(got.privacy, "https://example.com/p");
});
