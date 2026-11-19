// The server recognizes repos and people by their GitHub numeric id, not by name (#315). When a name passes to a different repo or person, the old one's data doesn't carry over.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO2, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;

test("a new repo with the same name doesn't show the old repo's data, and a removed repo can't be added back", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  const { owner } = world;
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });

  // The removed REPO2 was deleted on GitHub and a new one was created with the same name. Even if that Admin adds it again, the old REPO2's data doesn't carry over.
  await call(owner, api.removeRepo, { repo: REPO2 });
  world.github.recreate(REPO2);
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await assert.rejects(call(owner, api.addRepo, { repo: REPO2 }), refused("forbidden"));
  assert.deepEqual((await call(owner, api.me)).repos, [REPO]);

  // The REPO in the workspace was deleted and a new one was created with the same name. Even with push access to that repo, the old REPO's data isn't visible.
  world.github.grant("alice");
  const alice = await world.login("alice");
  assert.deepEqual((await call(alice, api.me)).repos, [REPO]);
  world.github.recreate(REPO);
  world.github.grant("alice");
  await eventually(async () => assert.rejects(call(alice, api.me), refused("unauthorized")));
  await assert.rejects(world.login("alice"), refused("forbidden"));
});

test("another account that took the old name of someone who renamed on GitHub can't get in, and the one who renamed gets in with the new name", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  await world.login("alice");

  world.github.rename("alice", "alice-renamed");
  world.github.grant("alice");
  await assert.rejects(world.login("alice"), refused("forbidden"));
  assert.equal((await call(await world.login("alice-renamed"), api.me)).login, "alice-renamed");
});
