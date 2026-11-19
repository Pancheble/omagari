// 서버는 레포와 사람을 이름이 아니라 GitHub 숫자 id로 알아본다(#315). 이름이 다른 레포나 사람에게 넘어가도 옛 것이 이어지지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO2, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;

test("같은 이름으로 새로 만든 레포로는 옛 레포의 것이 보이지 않고, 뺀 뒤 다시 넣지도 못한다", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  const { owner } = world;
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });

  // 뺀 REPO2가 GitHub에서 지워지고 같은 이름으로 새로 생겼다. 그 Admin이 다시 넣어도 옛 REPO2의 것이 이어지지 않는다.
  await call(owner, api.removeRepo, { repo: REPO2 });
  world.github.recreate(REPO2);
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await assert.rejects(call(owner, api.addRepo, { repo: REPO2 }), refused("forbidden"));
  assert.deepEqual((await call(owner, api.me)).repos, [REPO]);

  // 워크스페이스에 든 REPO가 지워지고 같은 이름으로 새로 생겼다. 그 레포에 push 권한이 있어도 옛 REPO의 것은 보이지 않는다.
  world.github.grant("alice");
  const alice = await world.login("alice");
  assert.deepEqual((await call(alice, api.me)).repos, [REPO]);
  world.github.recreate(REPO);
  world.github.grant("alice");
  await eventually(async () => assert.rejects(call(alice, api.me), refused("unauthorized")));
  await assert.rejects(world.login("alice"), refused("forbidden"));
});

test("GitHub 이름을 바꾼 사람의 옛 이름을 가져간 다른 계정은 들어오지 못하고, 이름을 바꾼 사람은 새 이름으로 들어온다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  await world.login("alice");

  world.github.rename("alice", "alice-renamed");
  world.github.grant("alice");
  await assert.rejects(world.login("alice"), refused("forbidden"));
  assert.equal((await call(await world.login("alice-renamed"), api.me)).login, "alice-renamed");
});
