// Self-serve deletion (ADR-0054): an account, a repo's data, and a workspace. Checked through the API and by reading the database file.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { api, type ContractFailure, call, isDeletedMember } from "@omagari/contract";
import { eventually, REPO, REPO2, REPO3, startWorld } from "./harness.ts";

type As = { url: string; session: string; login?: string; repos?: string[] };
const on = (as: As, repo: string) => ({ ...as, repos: [repo] });
const refused = (code: string) => (error: ContractFailure) => error.code === code;
const write = async (folder: string, path: string, content: string) => {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), content);
};

/** Every place in the database file where `text` is still written: `table.column`. */
const stored = (database: string, text: string) => {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const found: string[] = [];
    for (const { name } of db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[])
      for (const { name: column } of db
        .prepare("SELECT name FROM pragma_table_info(?)")
        .all(name) as { name: string }[])
        if (
          db
            .prepare(`SELECT 1 FROM "${name}" WHERE instr(CAST("${column}" AS TEXT), ?) > 0`)
            .get(text)
        )
          found.push(`${name}.${column}`);
    return found;
  } finally {
    db.close();
  }
};

test("deleting an account removes the person everywhere, keeps their messages as a deleted member's, and drops their runner and web", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk = await world.desk(alice);
  t.after(desk.remove);
  await desk.git("switch", "--create", "refund");
  await write(desk.folder, "pay.ts", "secret plan\n");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "alice")),
  );
  await call(alice, api.setStatusMessage, { message: "on leave", emoji: null });
  await call(alice, api.setPrefs, { language: "ko" });
  const channel = await world.channel(world.owner);
  const said = (await call(alice, api.send, { channel, text: "hello there" })).message;
  await call(world.owner, api.react, { message: said.id, emoji: "👍", on: true });
  await call(alice, api.react, { message: said.id, emoji: "🎉", on: true });
  const live = await world.live(alice);

  assert.deepEqual(await call(alice, api.deleteAccount), {});

  // Every session ends, and the live connection drops.
  await assert.rejects(call(alice, api.me), refused("unauthorized"));
  assert.equal(await live.closed, 1008);
  // The message stays under a stand-in, with the owner's reaction. alice's own reaction goes.
  const [kept] = (await call(world.owner, api.history, { channel })).messages;
  assert.ok(kept?.kind === "text" && kept.text === "hello there");
  assert.ok(isDeletedMember(kept.login) && kept.name === kept.login);
  assert.deepEqual(
    kept.reactions.map((r) => r.emoji),
    ["👍"],
  );
  // The work and the member are gone, and the runner doesn't bring them back.
  await eventually(async () => {
    assert.deepEqual(
      (await call(world.owner, api.members)).members.map((m) => m.login),
      ["owner"],
    );
    assert.ok(!(await world.works(world.owner)).some((w) => w.login === "alice"));
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(stored(world.database, "alice"), []);
  // No token columns are left for the person: the session rows, with `github_token`, `token_hash`, and `refresh_token`, are gone.
  const db = new DatabaseSync(world.database, { readOnly: true });
  t.after(() => db.close());
  assert.deepEqual(
    db
      .prepare("SELECT login FROM sessions")
      .all()
      .map((r) => r.login),
    ["owner"],
  );
  assert.deepEqual(stored(world.database, "secret plan"), []);
  assert.deepEqual(stored(world.database, "on leave"), []);
  // owner is untouched.
  assert.equal((await call(world.owner, api.me)).login, "owner");
});

test("removing a repo deletes its data and leaves the other repo alone, and only its Admin can", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2], observeMs: 50 });
  t.after(world.stop);
  const owner = world.owner;
  world.github.admin("owner", REPO2);
  world.github.grant("owner", REPO2);
  await call(owner, api.addRepo, { repo: REPO2 });
  world.github.grant("alice", REPO2);
  const alice = await world.login("alice");

  const keep = (await call(owner, api.createChannel, { name: "core", repo: REPO })).channel;
  const gone = (await call(on(owner, REPO2), api.createChannel, { name: "pay-room", repo: REPO2 }))
    .channel;
  await call(owner, api.send, { channel: keep.id, text: "core stays" });
  await call(owner, api.send, { channel: gone.id, text: "pay goes" });
  const desk = await world.desk(alice, undefined, undefined, { repo: REPO2 });
  t.after(desk.remove);
  await desk.git("switch", "--create", "pay-branch");
  await write(desk.folder, "pay.ts", "pay code\n");
  await eventually(async () => assert.ok((await world.works(on(owner, REPO2))).length > 0));

  // Push access isn't enough: alice isn't an Admin of REPO2.
  await assert.rejects(call(alice, api.removeRepo, { repo: REPO2 }), refused("forbidden"));
  assert.deepEqual(await call(owner, api.removeRepo, { repo: REPO2 }), { repos: [REPO] });

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(stored(world.database, "pay goes"), []);
  assert.deepEqual(stored(world.database, "pay code"), []);
  assert.deepEqual(stored(world.database, "pay-room"), []);
  // Only the GitHub id is kept, so a different repo with the same name can't come in (#315).
  assert.deepEqual(stored(world.database, REPO2), ["repo_ids.name"]);
  // The other repo keeps everything.
  assert.deepEqual(
    (await call(owner, api.history, { channel: keep.id })).messages.map(
      (m) => m.kind === "text" && m.text,
    ),
    ["core stays"],
  );
  // Adding it again starts empty.
  await call(owner, api.addRepo, { repo: REPO2 });
  assert.ok(!(await call(on(owner, REPO2), api.channels)).channels.some((c) => c.id === gone.id));
});

test("deleting a workspace needs Admin of every repo in it, deletes all of it, and leaves the other workspace alone", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3] });
  t.after(world.stop);
  world.github.grant("owner", REPO3);
  world.github.admin("owner", REPO3);
  // Signing in again reads the new access.
  const owner = await world.login("owner");
  world.github.grant("alice");
  const alice = await world.login("alice");
  const A = "omagari-test";
  const B = "other-team";
  const inA = { ...owner, workspace: A };
  const inB = { ...owner, workspace: B };
  const a = await world.channel(inA, "a-room");
  const b = await world.channel(inB, "b-room");
  await call(inA, api.send, { channel: a, text: "workspace a talk" });
  await call(inB, api.send, { channel: b, text: "workspace b talk" });

  // A member who isn't an Admin of every repo can't. Neither can anyone outside it.
  await assert.rejects(call(alice, api.deleteWorkspace, { workspace: A }), refused("forbidden"));
  await assert.rejects(call(alice, api.deleteWorkspace, { workspace: B }), refused("not_found"));
  await assert.rejects(call(owner, api.deleteWorkspace, { workspace: A }), refused("forbidden"));
  world.github.admin("owner", REPO);
  const live = await world.live(alice);
  assert.deepEqual(await call(owner, api.deleteWorkspace, { workspace: A }), {});

  assert.equal(await live.closed, 1008);
  assert.deepEqual(
    (await call(owner, api.workspaces)).workspaces.map((w) => w.id),
    [B],
  );
  assert.deepEqual(stored(world.database, "workspace a talk"), []);
  assert.deepEqual(stored(world.database, "a-room"), []);
  assert.deepEqual(
    (await call(inB, api.history, { channel: b })).messages.map((m) => m.kind === "text" && m.text),
    ["workspace b talk"],
  );
});
