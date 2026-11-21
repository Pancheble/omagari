import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  api,
  CONTRACT_VERSION,
  ContractFailure,
  call,
  DEFAULT_PREFS,
  encode,
  RUNNER_SOCKET,
  runnerToServer,
} from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { WebSocket } from "ws";
import { eventually, fakeExecutor, REPO, startWorld, stubbed, tempRepo } from "./harness.ts";

test("an account with push access becomes a member on login without an invite", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");

  const alice = await world.login("alice");
  assert.deepEqual(await world.agents(alice), {
    alice: "offline",
    owner: "online",
  });
});

test("an account without push access can't read anything in the workspace", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await assert.rejects(world.login("stranger"), {
    code: "forbidden",
    message: /stranger can't join: no push access/,
  });
  await assert.rejects(call(world.server, api.members), {
    code: "unauthorized",
  });
  await assert.rejects(
    call({ url: world.server.url, session: "made-up-session", ...stubbed() }, api.members),
    {
      code: "unauthorized",
    },
  );
  const desk = await tempRepo(); // a folder where someone else got the repo
  t.after(desk.remove);
  await assert.rejects(
    startRunner({
      serverUrl: world.server.url,
      folder: desk.folder,
      session: "made-up-session",
    }),
    { code: "unauthorized" },
  );
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("a kept session reads me and the workspace again, and only the logged-out session ends", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "Alice");
  world.github.avatars.set("alice", "https://avatars.example/alice.png");
  const browser = await world.login("alice");
  const laptop = await world.login("alice"); // the same person in another browser

  assert.deepEqual(await call(browser, api.me), {
    login: "alice",
    name: "Alice",
    avatar: "https://avatars.example/alice.png",
    repo: REPO,
    repos: [REPO],
    giphy: null,
    prefs: DEFAULT_PREFS,
    connected: false,
    shared: [],
    operator: false,
  });
  // For a person who left the profile name empty, the login is the name.
  assert.deepEqual(await call(world.owner, api.me), {
    login: "owner",
    name: "owner",
    avatar: null,
    repo: REPO,
    repos: [REPO],
    giphy: null,
    prefs: DEFAULT_PREFS,
    connected: true,
    shared: [REPO],
    operator: false,
  });

  await call(browser, api.logout);
  await assert.rejects(call(browser, api.me), { code: "unauthorized" });
  assert.equal((await call(laptop, api.me)).login, "alice");
  assert.deepEqual(await world.agents(laptop), {
    alice: "offline",
    owner: "online",
  });

  // Logging out with the session the runner uses also disconnects that runner.
  await call(world.owner, api.logout);
  const reason = await world.runner.ended;
  assert.ok(reason instanceof ContractFailure);
  assert.equal(reason.code, "unauthorized");
  assert.deepEqual(await world.agents(laptop), { alice: "offline" });
});

test("a member who loses push access leaves the workspace after the next re-check, and their runner is disconnected too", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  world.github.revoke("owner");
  await eventually(async () => assert.deepEqual(await world.agents(alice), { alice: "offline" }));
  await assert.rejects(call(world.owner, api.members), {
    code: "unauthorized",
  });
  const reason = await world.runner.ended;
  assert.ok(reason instanceof ContractFailure);
  assert.equal(reason.code, "forbidden");
  assert.equal(
    reason.message,
    "owner was removed: no push permission on any workspace repo anymore",
  );
});

test("one command in the repo folder logs in and starts the runner. No GitHub token is left on the runner side", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // a folder where alice got the repo
  t.after(desk.remove);

  const runner = world.launchCliIn(desk.folder, "runner");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/enter code (\S+)/);
  world.github.approve(code, "alice"); // a person entered the code in the browser
  await runner.output(new RegExp(`Runner started: alice's agent, ${REPO} ↔ ${desk.folder}`));
  assert.equal((await world.agents(world.owner)).alice, "online");

  // If it stops, it is offline.
  const stopped = await runner.stop("SIGINT");
  assert.equal(stopped.code, 0);
  await eventually(async () => assert.equal((await world.agents(world.owner)).alice, "offline"));

  // The server received the GitHub token, but the runner side (the output and files the CLI left) has none.
  const files = await readdir(world.config, {
    recursive: true,
    withFileTypes: true,
  });
  const saved = files.filter((f) => f.isFile()).map((f) => join(f.parentPath, f.name));
  assert.ok(saved.length > 0);
  const runnerSide = [stopped.stdout, stopped.stderr];
  for (const file of saved) runnerSide.push(await readFile(file, "utf8"));
  assert.ok(world.github.tokens.size > 0);
  for (const token of world.github.tokens.keys()) {
    assert.ok(
      !runnerSide.some((text) => text.includes(token)),
      "the GitHub token was left on the runner side",
    );
  }

  // Starting again connects with the kept session. It doesn't log in again.
  const again = world.launchCliIn(desk.folder, "runner");
  t.after(() => again.stop("SIGKILL"));
  await again.output(/Runner started: alice/);
  assert.doesNotMatch((await again.stop()).stdout, /GitHub login/);
});

test("in a folder that is not a Git repo it says why before logging in and does not start", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const folder = await mkdtemp(join(tmpdir(), "omagari-not-git-"));
  t.after(() => rm(folder, { recursive: true, force: true }));

  const result = await world.cliIn(folder, "runner");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Not a Git repo folder/);
  assert.doesNotMatch(result.stdout, /GitHub login/);
});

test("in a folder that is not a workspace repo it says why and does not start", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  // Under the account the server accepts, but not in the workspace.
  const other = await tempRepo("omagari-test/elsewhere");
  t.after(other.remove);

  const runner = world.launchCliIn(other.folder, "runner");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/enter code (\S+)/);
  world.github.approve(code, "alice");
  const result = await runner.exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /This folder isn't a workspace repo visible to alice/);
  assert.equal((await world.agents(world.owner)).alice, "offline");
});

test("starting a second runner on the same repo says why and does not start. The runner started first keeps answering", async (t) => {
  const world = await startWorld({ executor: fakeExecutor().executor });
  t.after(world.stop);

  await assert.rejects(
    startRunner({
      serverUrl: world.server.url,
      folder: world.repo.folder,
      session: world.owner.session,
      ...stubbed(),
    }),
    /A runner for this repo is already on/,
  );
  assert.equal((await world.cli("runner", "ask", "Still there?")).stdout, "fake answer\n");
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("a runner connection that does not answer is cut, and its agent goes offline", async (t) => {
  const world = await startWorld({ heartbeatMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // Imitating a sleeping device: a bare connection that finishes hello but doesn't answer ping.
  const silent = new WebSocket(world.server.url.replace("http", "ws") + RUNNER_SOCKET, {
    autoPong: false,
  });
  t.after(() => silent.terminate());
  await once(silent, "open");
  silent.send(
    encode(runnerToServer, "hello", {
      session: alice.session,
      repos: [REPO],
      shareRepo: true,
      executors: ["claude-code"],
      choices: {},
      mergeCheck: "on",
    }),
  );
  const [welcome] = await once(silent, "message");
  assert.partialDeepStrictEqual(JSON.parse(String(welcome)), {
    v: CONTRACT_VERSION,
    kind: "welcome",
    payload: { login: "alice", repo: REPO },
  });

  await once(silent, "close");
  await eventually(async () =>
    assert.deepEqual(await world.agents(alice), {
      alice: "offline",
      owner: "online",
    }),
  );
});

test("when the server comes back up, the runner reconnects", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(await world.agents(world.owner), { owner: "online" }),
  );
});
