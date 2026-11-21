// Daily visits and access requests older than 12 months are dropped (ADR-0054). An approved request stays, so its account stays accepted after a restart (#383).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, REPO3, startWorld } from "./harness.ts";

const TERMS = "https://example.org/terms";
const PRIVACY = "https://example.org/privacy";
/** The day (YYYY-MM-DD) in Seoul, as the server writes visits. */
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(Date.now());

test("visits and pending or denied requests older than the history window go; an approved account stays accepted after a restart", async (t) => {
  // The test clock: 12 months shortened to 60 seconds.
  const world = await startWorld({
    operators: ["Owner"],
    terms: TERMS,
    privacy: PRIVACY,
    followMs: 50,
    historyMs: 60_000,
  });
  t.after(world.stop);
  const team = REPO3.split("/")[0] as string;
  const carol = await world.login("carol");
  const erin = await world.login("erin");

  await call(carol, api.requestAccess, { account: team, agree: true });
  await call(carol, api.requestAccess, { account: "third-team", agree: true });
  await call(carol, api.requestAccess, { account: "fourth-team", agree: true });
  await call(erin, api.requestAccess, { account: "fifth-team", agree: true });
  const idOf = async (account: string) =>
    (await call(carol, api.myAccess)).requests.find((r) => r.account === account)?.id as number;
  await call(world.owner, api.decideAccess, { id: await idOf(team), approve: true });
  await call(world.owner, api.decideAccess, { id: await idOf("third-team"), approve: false });

  // Backdate carol's requests and add a visit from long ago next to today's, with the server stopped.
  await world.stopServer();
  const setup = new DatabaseSync(world.database);
  setup
    .prepare("UPDATE access_requests SET at = ? WHERE login = 'carol'")
    .run(Date.now() - 120_000);
  setup
    .prepare("INSERT INTO visits (day, workspace, login) VALUES ('2020-01-01', 'old', 'carol')")
    .run();
  setup
    .prepare("INSERT INTO visits (day, workspace, login) VALUES (?, 'old', 'carol')")
    .run(today());
  setup.close();

  await world.restartServer();
  const rows = (sql: string) => {
    const db = new DatabaseSync(world.database);
    try {
      return db
        .prepare(sql)
        .all()
        .map((row) => ({ ...row }));
    } finally {
      db.close();
    }
  };

  // The cleanup runs every followMs: the old visit and the old pending and denied requests go, today's visit and the fresh request stay.
  await eventually(() => assert.deepEqual(rows("SELECT day FROM visits"), [{ day: today() }]));
  assert.deepEqual(rows("SELECT account, login, state FROM access_requests ORDER BY id"), [
    { account: team, login: "carol", state: "approved" },
    { account: "fifth-team", login: "erin", state: "pending" },
  ]);

  // The approved account is still accepted after the cleanup and the restart.
  await eventually(async () =>
    assert.ok((await call(world.owner, api.accounts)).accounts.includes(team)),
  );
  assert.deepEqual((await call(carol, api.accounts)).accounts, [team]);
});
