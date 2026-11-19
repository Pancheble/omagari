// 서버 하나에 워크스페이스가 여럿일 때(ADR-0043) 거절 메시지와 다시 확인이 남의 레포 이름이나 권한을 내주지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ContractFailure, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { eventually, REPO, REPO3, startWorld, tempRepo } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;

test("거절 메시지에 서버의 레포 이름이 실리지 않고, 보이지 않는 레포는 빼려 해도 없는 레포와 같다", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3] });
  t.after(world.stop);

  // 어디에도 push 권한이 없는 사람에게 서버의 레포 이름을 알려 주지 않는다.
  const error = await world.login("stranger").catch((e: ContractFailure) => e);
  assert.ok(error instanceof ContractFailure);
  assert.equal(error.code, "forbidden");
  assert.doesNotMatch(error.message, /omagari-test|other-team/);

  // alice는 REPO만 본다. 워크스페이스에 없는 폴더도, 권한 없는 REPO3의 폴더도 같게 거절되고 레포 이름이 새지 않는다.
  world.github.grant("alice");
  const alice = await world.login("alice");
  const messages: string[] = [];
  for (const remote of ["someone/elsewhere", REPO3]) {
    const desk = await tempRepo(remote);
    t.after(desk.remove);
    const failed = await startRunner({
      serverUrl: world.server.url,
      folder: desk.folder,
      session: alice.session,
    }).catch((e: ContractFailure) => e);
    assert.ok(failed instanceof ContractFailure);
    messages.push(failed.message.replace(remote, "<remote>"));
    assert.doesNotMatch(failed.message.replace(remote, ""), /omagari-test|other-team/);
  }
  assert.equal(messages[0], messages[1]);

  // 다른 워크스페이스에 들어 있는 레포인지도 빼기로 알 수 없다.
  for (const repo of [REPO3, "other-team/none"])
    await assert.rejects(call(alice, api.removeRepo, { repo }), refused("not_found"));
});

test("GitHub 이름이 바뀐 토큰의 세션은 다시 확인할 때 끝나 옛 이름의 권한을 이어 쓰지 않는다", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // alice가 GitHub 이름을 바꿨다. 그 토큰은 이제 새 이름을 돌려준다.
  for (const [token, login] of world.github.tokens)
    if (login === "alice") world.github.tokens.set(token, "alice-renamed");
  await eventually(async () => assert.rejects(call(alice, api.members), refused("unauthorized")));
  assert.equal((await call(world.owner, api.me)).login, "owner");
});
