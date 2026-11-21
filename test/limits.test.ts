// The server's limits (ADR-0052): requests per person a minute, repos, and stored size per workspace.
// Each hit is one error shape (`limited` with the limit's name and number) that the web and CLI turn into a sentence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { REPO, REPO2, REPO3, startWorld } from "./harness.ts";

const A = "omagari-test";
const B = "other-team";
const hit = (name: string, max: number) => (error: ContractFailure) =>
  error.code === "limited" && error.limit?.name === name && error.limit.max === max;

test("with no limit settings, nothing is limited", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);

  for (let i = 0; i < 30; i++) await call(world.owner, api.me);
  await call(world.owner, api.addRepo, { repo: REPO2 });
  const { channel } = await call(world.owner, api.createChannel, { name: "general" });
  await call(world.owner, api.send, { channel: channel.id, text: "x".repeat(4000) });
});

test("a person past the requests a minute is refused, and another person isn't", async (t) => {
  const world = await startWorld({ limits: { requests: 5 } });
  t.after(world.stop);
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  const bob = await world.login("bob");

  await world.signInCli(alice); // the CLI uses alice's session too

  // Use up alice's minute. The refusal names the limit and its number.
  let refused: unknown;
  for (let i = 0; i <= 5 && !refused; i++)
    await call(alice, api.me).catch((error) => {
      refused = error;
    });
  assert.ok(refused && hit("requests", 5)(refused as ContractFailure), String(refused));
  await call(bob, api.me);

  // The CLI says the same sentence.
  const status = await world.cli("status");
  assert.notEqual(status.code, 0);
  assert.match(status.stderr, /Hit the limit of 5 requests a minute/);
});

test("a workspace at its repo limit can't add another, but its repos can be added again", async (t) => {
  const world = await startWorld({ limits: { repos: 1 } });
  t.after(world.stop);
  world.github.admin("owner", REPO);
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);

  await assert.rejects(call(world.owner, api.addRepo, { repo: REPO2 }), hit("repos", 1));
  assert.deepEqual(await call(world.owner, api.addRepo, { repo: REPO }), { repos: [REPO] });
});

test("a workspace over its stored size can't write more, and another workspace still can", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3], limits: { storage: 0.01 } }); // 10 KB
  t.after(world.stop);
  world.github.grant("owner", REPO3);
  const owner = await world.login("owner"); // signs in again so the server reads the new access
  const inA = { ...owner, workspace: A };
  const inB = { ...owner, workspace: B };
  const a = (await call(inA, api.createChannel, { name: "general" })).channel.id;
  const b = (await call(inB, api.createChannel, { name: "general" })).channel.id;

  await call(inA, api.send, { channel: a, text: "가".repeat(4000) }); // 12 KB: the size is in bytes
  await assert.rejects(call(inA, api.send, { channel: a, text: "hi" }), hit("storage", 0.01));
  await call(inB, api.send, { channel: b, text: "hi" });
});
