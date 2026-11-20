// GitHub tokens are encrypted at rest (ADR-0053): the database file holds no plain token, the same key keeps people
// signed in, a wrong key signs them out, and plain tokens an older server left are encrypted on start.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { startWorld } from "./harness.ts";

/** Every byte of the database file, plus its write-ahead log if there is one. */
const dump = async (database: string) =>
  Buffer.concat([
    await readFile(database),
    await readFile(`${database}-wal`).catch(() => Buffer.alloc(0)),
  ]);

test("the database file holds no plain token, and a restart with the same key (file or setting) keeps people signed in", async (t) => {
  for (const tokenKey of [undefined, "a-long-random-secret"]) {
    const world = await startWorld({ githubApp: "omagari-test", tokenKey });
    t.after(world.stop);
    const tokens = [...world.github.tokens.keys()]; // what the fake GitHub handed out
    assert.ok(tokens.length > 0);
    await world.restartServer();
    assert.equal((await call(world.owner, api.me)).login, "owner");
    const bytes = await dump(world.database);
    for (const token of tokens) assert.ok(!bytes.includes(token), "a plain token is in the DB");
  }
});

test("a wrong key signs people out instead of crashing", async (t) => {
  const world = await startWorld({ tokenKey: "first-secret" });
  t.after(world.stop);
  await world.restartServer({ tokenKey: "another-secret" });
  await assert.rejects(call(world.owner, api.me), { code: "unauthorized" });
});

test("plain tokens in an existing database are encrypted on start, and their sessions keep working", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  await world.stopServer();
  const db = new DatabaseSync(world.database);
  const row = db.prepare("SELECT github_token FROM sessions LIMIT 1").get() as {
    github_token: string;
  };
  // Make it look like an older server: the plain token, and no hash.
  const plain = [...world.github.tokens.keys()].at(-1) as string;
  db.prepare("UPDATE sessions SET github_token = ?, token_hash = NULL").run(plain);
  db.close();
  assert.ok(row.github_token.startsWith("enc1:"));
  await world.restartServer();
  assert.equal((await call(world.owner, api.me)).login, "owner");
  assert.ok(!(await dump(world.database)).includes(plain));
});
