import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, fakeSandbox, startWorld, tempRepo, writer } from "./harness.ts";

/** 사람은 포럼을 만들지 못한다. 알림을 올릴 포럼을 바꾸는 것을 보려고 DB에 포럼 "설계"를 하나 더 둔다. 표는 서버가 이어 만든다. */
const SECOND_FORUM = `CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  alert INTEGER, kind TEXT NOT NULL DEFAULT 'chat') STRICT;
INSERT INTO channels (id, name, kind) VALUES ('design', '설계', 'forum');`;

test("설정은 내 스위치, 내 에이전트가 답한 수와 마지막 질문, 알림을 올릴 포럼을 읽는다", async (t) => {
  const world = await startWorld({ seed: SECOND_FORUM });
  t.after(world.stop);
  world.github.grant("bob");
  const bob = await world.login("bob");
  const fake = fakeExecutor((input) => `bob의 답 ${input.message.length}`);
  const desk = await world.desk(bob, undefined, { "claude-code": fake.executor });
  t.after(desk.remove);

  // 처음에는 켜짐이고, 답한 것이 없고, 알림은 "부딪힘" 포럼에 간다.
  const first = await call(bob, api.settings);
  assert.equal(first.askSwitch, true);
  assert.deepEqual(first.answered, { count: 0, last: null });
  const forum = (await call(bob, api.channels)).channels.find((c) => c.id === first.alertChannel);
  assert.deepEqual(forum && { name: forum.name, kind: forum.kind }, {
    name: "부딪힘",
    kind: "forum",
  });

  // owner가 두 번 물어 bob의 에이전트가 답하면 bob에게 세어지고, 마지막 질문이 보인다. 묻은 쪽에는 세지 않는다.
  for (const question of ["charge()에 재시도를 넣나요?", "calcRefund()는 누가 부르나요?"]) {
    const asked = await world.cli("ask", "bob", question);
    assert.equal(asked.code, 0, asked.stderr);
  }
  const answered = await eventually(async () => {
    const { answered } = await call(bob, api.settings);
    assert.equal(answered.count, 2);
    return answered;
  });
  assert.equal(answered.last?.login, "owner");
  assert.equal(answered.last?.name, "owner"); // 프로필 이름이 없으면 로그인
  assert.equal(answered.last?.text, "calcRefund()는 누가 부르나요?");
  assert.deepEqual((await call(world.owner, api.settings)).answered, { count: 0, last: null });

  // 스위치는 내 것만 바뀌고 새로 읽어도 남는다.
  await call(bob, api.setAskSwitch, { on: false });
  assert.equal((await call(bob, api.settings)).askSwitch, false);
  assert.equal((await call(world.owner, api.settings)).askSwitch, true);

  // 알림을 올릴 포럼을 바꾸면 모든 멤버에게 같다.
  await call(world.owner, api.setAlertChannel, { channel: "design" });
  assert.equal((await call(bob, api.settings)).alertChannel, "design");
});

test("설정은 레포의 검사 명령과 내 러너의 합쳐 돌려 보기를 읽고, 러너를 끄고 켜거나 러너에서 끈 것을 따른다. 웹으로는 켜고 끌 수 없다", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld({ sandbox: fakeSandbox().sandbox, observeMs: 50 });
  t.after(world.stop);
  const mergeCheck = async (as: { url: string; session: string }) =>
    (await call(as, api.settings)).mergeCheck;

  // 샌드박스가 있는 owner의 러너는 켜짐이고, 기본 브랜치에 설정 파일이 없다.
  await eventually(async () =>
    assert.deepEqual(await mergeCheck(world.owner), {
      runner: "on",
      check: { problem: "missing" },
    }),
  );

  // 샌드박스 도구가 없는 bob의 러너. 러너를 끄면 꺼짐이고, 다시 켜면 돌아온다.
  world.github.grant("bob");
  const bob = await world.login("bob");
  const desk = await world.desk(bob);
  t.after(desk.remove);
  assert.equal((await mergeCheck(bob)).runner, "no_sandbox");
  await desk.stop();
  assert.equal((await mergeCheck(bob)).runner, "offline");
  await desk.start();
  assert.equal((await mergeCheck(bob)).runner, "no_sandbox");
  assert.equal((await mergeCheck(world.owner)).runner, "on"); // 내 러너의 것만 본다

  // alice가 러너에서 끄면(omagari runner --merge-check off) 꺼 둠이다.
  world.github.grant("alice");
  const aliceDesk = await tempRepo();
  t.after(aliceDesk.remove);
  const runner = world.launchCliIn(aliceDesk.folder, "runner", "--merge-check", "off");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/코드 (\S+) /);
  world.github.approve(code as string, "alice");
  await runner.output(/러너가 켜졌다/);
  const alice = await world.login("alice");
  assert.equal((await mergeCheck(alice)).runner, "off");
  await runner.stop();
  assert.equal((await mergeCheck(alice)).runner, "offline");

  // 설정 파일을 기본 브랜치에 머지하면 러너가 다음 관측에서 읽어 알린다. 꼴이 틀리면 그 까닭이다.
  const merge = async (content: string) => {
    await writer(world.repo.folder)(".omagari.json", content);
    await world.repo.git("add", "--all");
    await world.repo.git("commit", "--message=merged");
    await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  };
  await merge('{"chek": "npm test"}');
  await eventually(async () =>
    assert.deepEqual((await mergeCheck(bob)).check, { problem: "invalid" }),
  );
  await merge('{"check": "npm test", "setup": "npm ci"}');
  await eventually(async () =>
    assert.deepEqual((await mergeCheck(bob)).check, {
      config: { check: "npm test", setup: "npm ci" },
    }),
  );

  // 웹 API에는 합쳐 돌려 보기를 켜고 끄는 길이 없다(ADR-0034).
  assert.deepEqual(
    Object.values(api).filter((route) => /merge|check/i.test(route.path)),
    [],
  );
});
