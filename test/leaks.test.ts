// When one server has several workspaces (ADR-0043), refusal messages and rechecks don't give away another repo's name or access.
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ContractFailure, call } from "@omagari/contract";
import { callRunner, startRunner } from "@omagari/runner";
import { eventually, REPO, REPO2, REPO3, startWorld, tempRepo } from "./harness.ts";

const refused = (code: string) => (error: ContractFailure) => error.code === code;

test("refusal messages don't carry the server's repo names, and a repo you can't see is the same as a missing one even when you try to leave it out", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO3] });
  t.after(world.stop);

  // Someone with no push access anywhere isn't told the server's repo names.
  const error = await world.login("stranger").catch((e: ContractFailure) => e);
  assert.ok(error instanceof ContractFailure);
  assert.equal(error.code, "forbidden");
  assert.doesNotMatch(error.message, /omagari-test|other-team/);

  // alice sees only REPO. A folder not in the workspace and the folder of REPO3, which she has no access to, are refused the same way, and no repo name leaks.
  world.github.grant("alice");
  const alice = await world.login("alice");
  const messages: string[] = [];
  // Both remotes are under accepted accounts; a remote outside them never reaches the server (repo-sharing.test).
  for (const remote of ["omagari-test/elsewhere", REPO3]) {
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

  // You can't tell by leaving it out whether the repo is in another workspace, either.
  for (const repo of [REPO3, "other-team/none"])
    await assert.rejects(call(alice, api.removeRepo, { repo }), refused("not_found"));
});

test("a session whose GitHub name changed ends at the next recheck and doesn't keep using the old name's access", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // alice renamed on GitHub. That token now returns the new name.
  for (const [token, login] of world.github.tokens)
    if (login === "alice") world.github.tokens.set(token, "alice-renamed");
  await eventually(async () => assert.rejects(call(alice, api.members), refused("unauthorized")));
  assert.equal((await call(world.owner, api.me)).login, "owner");
});

test("a web connection that loses access while access is being re-read doesn't receive that repo's data", async (t) => {
  const world = await startWorld({ accept: [REPO, REPO2], recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  const watching = await world.live(alice);
  await eventually(() => watching.members());
  // The recheck stops at alice's second repo. Access to the first repo (REPO) is already removed, but the connection isn't cut yet.
  const release = world.github.hold("alice", REPO2);
  t.after(release);
  world.github.revoke("alice");
  await eventually(async () => assert.rejects(call(alice, api.members))); // alice's access was removed
  const before = watching.received.length;
  const { channel } = await call(world.owner, api.createChannel, {
    name: "Payments",
  });
  await call(world.owner, api.send, {
    channel: channel.id,
    text: "After Alice left",
  });
  await call(world.owner, api.createLabel, {
    name: "Secret",
    color: "ff0000",
    description: "",
  });
  await call(world.owner, api.send, { channel: channel.id, text: "One more" });
  //(before, watching.received.map((m) => m.kind));
  assert.equal(watching.received.length, before); // none of the member list, labels, or channel went out
});

test("a runner that loses access while access is being re-read doesn't receive that repo's situation", async (t) => {
  const world = await startWorld({
    accept: [REPO, REPO2],
    recheckMs: 50,
    observeMs: 50,
  });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk = await world.desk(alice);
  t.after(desk.remove);
  // The runner hands the situation it got from the server back to the CLI as is. It doesn't ask the server again, so it still sees it after losing access.
  const situation = async () =>
    JSON.stringify(await callRunner(desk.folder, "situation", { executor: "claude-code" }));

  // While access exists, owner's one-line status reaches alice's runner.
  await call(world.owner, api.setStatus, {
    branch: "main",
    text: "before revoke",
  });
  await eventually(async () => assert.match(await situation(), /before revoke/));

  // The recheck stops at alice's second repo, and only the first repo's (REPO) access is removed in the meantime.
  const release = world.github.hold("alice", REPO2);
  t.after(release);
  world.github.revoke("alice");
  await eventually(async () => assert.rejects(call(alice, api.members)));
  await call(world.owner, api.setStatus, {
    branch: "main",
    text: "after revoke",
  });
  await new Promise((done) => setTimeout(done, 300));
  assert.doesNotMatch(await situation(), /after revoke/);
});
