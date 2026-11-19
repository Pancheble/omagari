// Personal settings (ADR-0045, #303): everyone starts in English, and a member's language follows them, not others.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, startWorld } from "./harness.ts";

test("picking Korean reaches the same member's other connections and the next login, not other members", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const owner = world.owner;
  const alice = await world.login("alice");
  assert.deepEqual((await call(owner, api.me)).prefs, { language: "en" });

  const otherTab = await world.live(owner);
  const aliceLive = await world.live(alice);
  assert.deepEqual(await call(owner, api.setPrefs, { language: "ko" }), { language: "ko" });

  await eventually(() =>
    assert.ok(
      otherTab.received.some((m) => m.kind === "prefs" && m.payload.language === "ko"),
      "the other tab hasn't heard yet",
    ),
  );
  // A second device logs in later and gets it from `me`.
  const otherDevice = await world.login(owner.login);
  assert.equal((await call(otherDevice, api.me)).prefs.language, "ko");
  assert.equal((await call(alice, api.me)).prefs.language, "en");
  assert.ok(!aliceLive.received.some((m) => m.kind === "prefs"));

  // It stays across a server restart, and an empty change keeps it.
  await world.restartServer();
  // The connection to the stopped server may linger, so the first request can fail.
  assert.deepEqual(await eventually(() => call(owner, api.setPrefs, {})), { language: "ko" });

  await assert.rejects(
    call(owner, api.setPrefs, { language: "fr" as "en" }),
    (error: ContractFailure) => error.code === "invalid_request",
  );
});
