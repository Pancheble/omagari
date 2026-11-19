// 레포 먼저인 채널 패널(시안 101, 100-A, #288)이 서버에서 읽는 것. 이름 줄의 계정 아바타와 종류, 메뉴의 계정 묶음마다 "레포 넣기"와 빼기,
// 개인 계정의 레포도 넣어야만 들어오는 것, 멤버가 나 하나인지(멤버 수)를 본다. 패널 안에서 어느 채널이 어디에 서는지는 웹의 places.test.ts가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;
const A = "omagari-test";
const B = "other-team";
const NOTES = `${B}/notes`;

test("이름 줄은 계정의 종류와 아바타를 받고, 다른 계정 묶음의 레포 넣기와 빼기는 그 계정으로 부르며, 개인 레포도 넣어야만 들어오고, 멤버 수로 혼자인지 알고, 사람 이름과 사진은 GitHub을 따라간다", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3], recheckMs: 50 });
  t.after(world.stop);
  const { owner, github } = world;

  // B는 개인 계정이다. 종류와 아바타는 push 권한을 다시 읽을 때 GitHub에서 함께 온다. 읽기 전에는 아바타 없는 조직이다.
  github.account(B, { kind: "user", avatar: "https://avatars.example/b.png" });
  github.grant("owner", REPO3);
  await eventually(async () =>
    assert.deepEqual((await call(owner, api.workspaces)).workspaces, [
      { id: A, name: A, kind: "organization", avatar: null, repos: [REPO] },
      { id: B, name: B, kind: "user", avatar: "https://avatars.example/b.png", repos: [REPO3] },
    ]),
  );

  // 개인 계정의 레포도 GitHub에 있다고 들어오지 않는다. 메뉴의 B 묶음 "레포 넣기"는 B로 불러 B의 Admin 레포만 읽는다.
  github.create(NOTES);
  github.admin("owner", NOTES);
  github.grant("owner", NOTES);
  const inB = { ...owner, workspace: B };
  assert.deepEqual(
    (await call(owner, api.adminRepos)).repos.map((r) => r.name),
    [],
    "A로 부르면 B의 레포는 없다",
  );
  assert.deepEqual(await call(inB, api.adminRepos), {
    repos: [{ name: NOTES, private: true, pushers: 1, added: false }],
  });
  assert.deepEqual((await call(owner, api.me)).repos, [REPO, REPO3]);
  // 넣으면 B 워크스페이스에 레포가 둘이 된다("<계정> 전체" 줄이 생긴다). 고른 워크스페이스와 상관없이 넣는다.
  assert.deepEqual((await call(owner, api.addRepo, { repo: NOTES })).repos, [REPO, REPO3, NOTES]);
  assert.deepEqual((await call(owner, api.workspaces)).workspaces.find((w) => w.id === B)?.repos, [
    REPO3,
    NOTES,
  ]);
  assert.equal((await call(inB, api.adminRepos)).repos[0]?.added, true);
  // 레포 줄의 ⋯로 뺀다. 빼면 B에는 레포 하나가 남는다.
  assert.deepEqual((await call(owner, api.removeRepo, { repo: NOTES })).repos, [REPO, REPO3]);

  // 멤버가 나 하나면 혼자다(100-A). 계정 종류와 상관없이, 누가 push 권한을 받아 들어오면 그때부터 둘이다.
  const logins = async () => (await call(inB, api.members)).members.map((m) => m.login);
  assert.deepEqual(await logins(), ["owner"]);
  github.grant("carol", REPO3);
  await world.login("carol");
  assert.deepEqual(await logins(), ["carol", "owner"]);
  // A는 조직이어도 owner 혼자면 혼자다.
  assert.deepEqual(
    (await call(owner, api.members)).members.map((m) => m.login),
    ["owner"],
  );
  // 사람의 이름과 프로필 사진은 GitHub에서 바꾸면 10분마다의 다시 읽기에서 따라온다(여기서는 50ms).
  github.names.set("carol", "캐롤");
  github.avatars.set("carol", "https://avatars.example/carol.png");
  await eventually(async () => {
    const carolView = (await call(inB, api.members)).members.find((m) => m.login === "carol");
    assert.deepEqual(
      [carolView?.name, carolView?.avatar],
      ["캐롤", "https://avatars.example/carol.png"],
    );
  });
  // 들어가지 않은 계정으로는 레포 넣기 목록을 읽지 못한다.
  const carol = await world.login("carol");
  await assert.rejects(call({ ...carol, workspace: A }, api.adminRepos), refused("not_found"));
});
