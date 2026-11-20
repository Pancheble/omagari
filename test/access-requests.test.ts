// Access requests approved by an operator (ADR-0052). A person without a workspace requests an account, an operator approves or denies it,
// and an approved account takes in repos like one in OMAGARI_REPO, also after a restart.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, REPO, REPO3, startWorld } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;
const TERMS = "https://example.org/terms";
const PRIVACY = "https://example.org/privacy";

test("a person without a workspace requests an account, an operator approves it, and their repo comes in with no restart", async (t) => {
  const world = await startWorld({ operators: ["Owner"], terms: TERMS, privacy: PRIVACY });
  t.after(world.stop);
  const team = REPO3.split("/")[0] as string; // other-team
  world.github.admin("carol", REPO3);
  world.github.grant("carol", REPO3);

  // carol has no push access to any workspace repo, but this server takes requests, so she gets in with no workspace.
  const carol = await world.login("carol");
  assert.deepEqual(await call(carol, api.workspaces), { workspaces: [] });
  assert.equal((await call(carol, api.me)).operator, false);
  assert.deepEqual(await call(carol, api.myAccess), {
    open: true,
    terms: TERMS,
    privacy: PRIVACY,
    requests: [],
  });
  // Nothing about the server's workspaces shows: not its accounts, not its repos.
  assert.deepEqual(await call(carol, api.accounts), { accounts: [] });
  await assert.rejects(call(carol, api.members), refused("not_found"));
  await assert.rejects(call(carol, api.addRepo, { repo: REPO3 }), refused("forbidden"));

  // Requesting needs agreeing to the terms and privacy policy.
  await assert.rejects(
    call(carol, api.requestAccess, { account: team, agree: false }),
    refused("invalid_request"),
  );
  const asked = await call(carol, api.requestAccess, { account: "Other-Team", agree: true });
  assert.deepEqual(
    asked.requests.map(({ account, state }) => ({ account, state })),
    [{ account: team, state: "pending" }],
  );
  // The same request again isn't made twice.
  await call(carol, api.requestAccess, { account: team, agree: true });
  assert.equal((await call(carol, api.myAccess)).requests.length, 1);

  // Only an operator lists and decides.
  await assert.rejects(call(carol, api.accessRequests), refused("forbidden"));
  const id = asked.requests[0]?.id as number;
  await assert.rejects(call(carol, api.decideAccess, { id, approve: true }), refused("forbidden"));
  assert.equal((await call(world.owner, api.me)).operator, true);
  const { requests } = await call(world.owner, api.accessRequests);
  assert.deepEqual(
    requests.map(({ account, login, state }) => ({ account, login, state })),
    [{ account: team, login: "carol", state: "pending" }],
  );
  assert.deepEqual(await call(world.owner, api.decideAccess, { id, approve: true }), {
    requests: [],
  });
  await assert.rejects(
    call(world.owner, api.decideAccess, { id, approve: false }),
    refused("not_found"),
  );

  // carol sees it approved, lists her Admin repos of that account, and adds one. The workspace appears.
  assert.equal((await call(carol, api.myAccess)).requests[0]?.state, "approved");
  assert.deepEqual(await call(carol, api.accounts), { accounts: [team] });
  assert.deepEqual(
    (await call({ ...carol, workspace: team }, api.adminRepos)).repos.map((repo) => repo.name),
    [REPO3],
  );
  assert.deepEqual(await call(carol, api.addRepo, { repo: REPO3 }), { repos: [REPO3] });
  assert.deepEqual(
    (await call(carol, api.workspaces)).workspaces.map(({ id, repos }) => ({ id, repos })),
    [{ id: team, repos: [REPO3] }],
  );
  // Workspaces still don't mix: the owner isn't in carol's, carol isn't in the owner's.
  assert.deepEqual(
    (await call(world.owner, api.workspaces)).workspaces.map(({ id }) => id),
    [REPO.split("/")[0]],
  );
});

test("an approved account stays accepted after a restart", async (t) => {
  const world = await startWorld({ operators: ["owner"] });
  t.after(world.stop);
  world.github.admin("carol", REPO3);
  world.github.grant("carol", REPO3);
  const carol = await world.login("carol");
  // Without legal links, agreeing isn't needed.
  const { requests } = await call(carol, api.requestAccess, {
    account: "other-team",
    agree: false,
  });
  await call(world.owner, api.decideAccess, { id: requests[0]?.id as number, approve: true });

  await world.restartServer();
  // The connection to the stopped server stays broken, so the first request may fail.
  await eventually(() => call(carol, api.myAccess));
  assert.deepEqual(await call(carol, api.addRepo, { repo: REPO3 }), { repos: [REPO3] });
});

test("a denied request shows denied, and asking about an accepted account reveals nothing about it", async (t) => {
  const world = await startWorld({ operators: ["owner"] });
  t.after(world.stop);
  const dave = await world.login("dave");
  const { requests } = await call(dave, api.requestAccess, { account: "dave", agree: false });
  await call(world.owner, api.decideAccess, { id: requests[0]?.id as number, approve: false });
  assert.deepEqual(
    (await call(dave, api.myAccess)).requests.map(({ account, state }) => ({ account, state })),
    [{ account: "dave", state: "denied" }],
  );

  // A request for an account this server already accepts looks like any other: it waits.
  const owner = REPO.split("/")[0] as string;
  const asked = await call(dave, api.requestAccess, { account: owner, agree: false });
  assert.equal(asked.requests[0]?.state, "pending");
  // dave sees only his own requests, never another person's.
  const erin = await world.login("erin");
  await call(erin, api.requestAccess, { account: "erin", agree: false });
  assert.deepEqual(
    (await call(dave, api.myAccess)).requests.map(({ account }) => account),
    [owner, "dave"],
  );
  assert.deepEqual(await call(dave, api.workspaces), { workspaces: [] });

  // Deleting the account takes its requests with it (ADR-0054): the operator no longer sees dave's waiting one.
  await call(dave, api.deleteAccount);
  assert.deepEqual(
    (await call(world.owner, api.accessRequests)).requests.map(({ login }) => login),
    ["erin"],
  );
});

test("with no operators the server takes no requests and OMAGARI_REPO works as before", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  await assert.rejects(world.login("carol"), refused("forbidden"));
  assert.deepEqual(await call(world.owner, api.myAccess), { open: false, requests: [] });
  await assert.rejects(
    call(world.owner, api.requestAccess, { account: "other-team", agree: true }),
    refused("forbidden"),
  );
  await assert.rejects(call(world.owner, api.accessRequests), refused("forbidden"));
  assert.equal((await call(world.owner, api.me)).operator, false);
});
