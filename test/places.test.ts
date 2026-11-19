// What the repo-first channel panel (mockups 101, 100-A, #288) reads from the server: the account avatar and kind on the name row, "Add repo" and remove for each account group in the menu,
// a personal account's repos coming in only once added, and whether I am the only member (member count). Which channel sits where inside the panel is covered by the web's places.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;
const A = "omagari-test";
const B = "other-team";
const NOTES = `${B}/notes`;

test("the name row gets the account kind and avatar, add and remove repo for another account group are called as that account, a personal repo comes in only once added, the member count says whether you are alone, and a person's name and photo follow GitHub", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3], recheckMs: 50 });
  t.after(world.stop);
  const { owner, github } = world;

  // B is a personal account. Its kind and avatar come from GitHub along with the push-access re-read. Before the re-read it is an organization with no avatar.
  github.account(B, { kind: "user", avatar: "https://avatars.example/b.png" });
  github.grant("owner", REPO3);
  await eventually(async () =>
    assert.deepEqual((await call(owner, api.workspaces)).workspaces, [
      { id: A, name: A, kind: "organization", avatar: null, repos: [REPO] },
      {
        id: B,
        name: B,
        kind: "user",
        avatar: "https://avatars.example/b.png",
        repos: [REPO3],
      },
    ]),
  );

  // A personal account's repos don't come in just because they exist on GitHub. The menu's B group "Add repo" is called as B and reads only B's Admin repos.
  github.create(NOTES);
  github.admin("owner", NOTES);
  github.grant("owner", NOTES);
  const inB = { ...owner, workspace: B };
  assert.deepEqual(
    (await call(owner, api.adminRepos)).repos.map((r) => r.name),
    [],
    "called as A, B's repos are not there",
  );
  assert.deepEqual(await call(inB, api.adminRepos), {
    repos: [{ name: NOTES, private: true, pushers: 1, added: false }],
  });
  assert.deepEqual((await call(owner, api.me)).repos, [REPO, REPO3]);
  // Once added, B's workspace has two repos (an "All of <account>" row appears). It is added regardless of the selected workspace.
  assert.deepEqual((await call(owner, api.addRepo, { repo: NOTES })).repos, [REPO, REPO3, NOTES]);
  assert.deepEqual((await call(owner, api.workspaces)).workspaces.find((w) => w.id === B)?.repos, [
    REPO3,
    NOTES,
  ]);
  assert.equal((await call(inB, api.adminRepos)).repos[0]?.added, true);
  // Remove it with the repo row's ⋯. After removing, B is left with one repo.
  assert.deepEqual((await call(owner, api.removeRepo, { repo: NOTES })).repos, [REPO, REPO3]);

  // With one member you are alone (100-A). Regardless of account kind, once someone gets push access and joins, there are two.
  const logins = async () => (await call(inB, api.members)).members.map((m) => m.login);
  assert.deepEqual(await logins(), ["owner"]);
  github.grant("carol", REPO3);
  await world.login("carol");
  assert.deepEqual(await logins(), ["carol", "owner"]);
  // Even if A is an organization, owner alone is alone.
  assert.deepEqual(
    (await call(owner, api.members)).members.map((m) => m.login),
    ["owner"],
  );
  // If a person's name and profile photo change on GitHub, they follow on the re-read every 10 minutes (50ms here).
  github.names.set("carol", "Carol");
  github.avatars.set("carol", "https://avatars.example/carol.png");
  await eventually(async () => {
    const carolView = (await call(inB, api.members)).members.find((m) => m.login === "carol");
    assert.deepEqual(
      [carolView?.name, carolView?.avatar],
      ["Carol", "https://avatars.example/carol.png"],
    );
  });
  // An account you haven't joined can't read the add-repo list.
  const carol = await world.login("carol");
  await assert.rejects(call({ ...carol, workspace: A }, api.adminRepos), refused("not_found"));
});
