// Repo sharing and the accepted-accounts filter (ADR-0049): the background runner sends nothing about a repo outside the server's accounts,
// and observes a workspace repo only once the member shares it.
import assert from "node:assert/strict";
import { subscribe } from "node:diagnostics_channel";
import { access, readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { WebSocket as ServerSocket } from "ws";
import { eventually, REPO, startWorld, stubbed, tempRepo, writer } from "./harness.ts";

// Everything the server receives: each HTTP request's path and headers, and each WebSocket message. The server runs in this process.
const seen: string[] = [];
subscribe("http.server.request.start", (message) => {
  const { request } = message as { request: IncomingMessage };
  seen.push(`${request.url} ${JSON.stringify(request.headers)}`);
});
const emit = ServerSocket.prototype.emit;
ServerSocket.prototype.emit = function (this: ServerSocket, event: string, ...args: unknown[]) {
  if (event === "message") seen.push(String(args[0]));
  return emit.call(this, event, ...args);
} as typeof emit;

const sessionStart = (cwd: string) =>
  JSON.stringify({
    session_id: "11111111-2222-3333-4444-555555555555",
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    hook_event_name: "SessionStart",
    source: "startup",
  });

test("a repo under an account the server doesn't accept sends nothing to the server, not even its name, and the hook stays quiet there", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  await world.signInCli(world.owner);
  const background = world.launchCliIn(world.repo.folder, "runner", "background");
  t.after(() => background.stop("SIGTERM"));
  await background.output(/Background runner on/);
  const secret = await tempRepo("someone-else/secret-plans");
  t.after(secret.remove);

  const hook = await world.hook(sessionStart(secret.folder), { cwd: secret.folder });
  assert.deepEqual({ code: hook.code, stdout: hook.stdout }, { code: 0, stdout: "" });
  await background.output(/Not watching .+: its remotes aren't under the server's accounts/);
  const status = await world.cliIn(secret.folder, "status");
  assert.equal(status.code, 1);
  assert.match(status.stderr, /aren't under an account this server accepts/);
  const share = await world.cliIn(secret.folder, "share", "on");
  assert.equal(share.code, 1);

  // The recording works: the workspace repo's runner named its repo.
  assert.ok(seen.some((line) => line.includes(REPO)));
  assert.deepEqual(
    seen.filter((line) => /secret-plans|someone-else/i.test(line)),
    [],
  );
  // No runner was welcomed there, so the hooks stay quiet in that repo for good (ADR-0016).
  await assert.rejects(access(join(secret.folder, ".git", "omagari")));
});

test("an unshared workspace repo isn't observed and the hook says how to share; share on makes it observed, share off stops it", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  // Alice's machine: her CLI session and a clone where she never started a runner by hand.
  await world.signInCli(alice);
  const desk = await tempRepo();
  t.after(desk.remove);
  await desk.git("switch", "--create", "refund");
  await writer(desk.folder)("refund.ts", "export const refund = 1;\n");
  const background = world.launchCliIn(desk.folder, "runner", "background");
  t.after(() => background.stop("SIGTERM"));
  await background.output(/Background runner on/);
  // The first session start only tells the background runner about this folder. The hook waits just 1 second for the repo's runner to be welcomed (the welcome creates .git/omagari), which takes longer on a loaded machine, so wait for it before the hook that must answer.
  await world.hook(sessionStart(desk.folder), { cwd: desk.folder });
  await eventually(() => access(join(desk.folder, ".git", "omagari")));

  const hook = await world.hook(sessionStart(desk.folder), { cwd: desk.folder });
  assert.equal(hook.code, 0);
  assert.match(hook.stdout, /this person hasn't shared it yet/);
  assert.match(hook.stdout, /omagari share on/);
  // Where it goes (ADR-0054): the server's address, on hosted and self-hosted alike, and the three share levels.
  assert.ok(hook.stdout.includes(`the content of changed files goes to ${world.server.url}.`));
  assert.ok(
    hook.stdout.includes(`declared: only the paths of changed files go to ${world.server.url}.`),
  );
  assert.ok(hook.stdout.includes(`intent: only the status line goes to ${world.server.url}.`));
  await eventually(async () => assert.equal((await world.agents(world.owner)).alice, "online"));
  // Connected but not observing: give it more than one observation interval (3 seconds).
  await sleep(3500);
  const aliceWorks = async () =>
    (await world.works(world.owner)).filter((work) => work.login === "alice");
  assert.deepEqual(await aliceWorks(), []);

  const on = await world.cliIn(desk.folder, "share", "on");
  assert.equal(on.code, 0, on.stderr);
  assert.match(on.stdout, new RegExp(`Shared ${REPO}`));
  assert.ok(on.stdout.includes(`the content of changed files goes to ${world.server.url}.`));
  assert.ok(on.stdout.includes(`intent: only the status line goes to ${world.server.url}.`));
  await eventually(async () => {
    const [work] = await aliceWorks();
    assert.equal(work?.branch, "refund");
    assert.deepEqual(
      work?.files.map((file) => file.path),
      ["refund.ts"],
    );
  });
  const shared = await world.hook(sessionStart(desk.folder), { cwd: desk.folder });
  assert.doesNotMatch(shared.stdout, /hasn't shared/);

  const off = await world.cliIn(desk.folder, "share", "off");
  assert.equal(off.code, 0, off.stderr);
  assert.match(off.stdout, new RegExp(`Stopped sharing ${REPO}`));
  assert.deepEqual(await aliceWorks(), []);
  // It stays gone: her runner stopped observing.
  await sleep(3500);
  assert.deepEqual(await aliceWorks(), []);
});

test("the web's Share button (api.share) starts observation, and api.me says when a runner has connected and which repos are shared", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  // Before any runner: "Connect your computer" shows, and nothing is shared.
  const before = await call(alice, api.me);
  assert.deepEqual([before.connected, before.shared], [false, []]);
  const desk = await tempRepo();
  t.after(desk.remove);
  await desk.git("switch", "--create", "refund");
  await writer(desk.folder)("refund.ts", "export const refund = 1;\n");
  // Started the way the background runner starts it: not a yes to share.
  const runner = await startRunner({
    serverUrl: world.server.url,
    folder: desk.folder,
    session: alice.session,
    observeMs: 50,
    shareRepo: false,
    ...stubbed(),
  });
  t.after(runner.stop);
  await eventually(async () => assert.equal((await call(alice, api.me)).connected, true));
  assert.deepEqual((await call(alice, api.me)).shared, []);
  await sleep(300);
  const aliceWorks = async () =>
    (await world.works(world.owner)).filter((work) => work.login === "alice");
  assert.deepEqual(await aliceWorks(), []);

  assert.deepEqual(await call(alice, api.share, { on: true }), { repo: REPO, shared: true });
  assert.deepEqual((await call(alice, api.me)).shared, [REPO]);
  await eventually(async () => assert.equal((await aliceWorks())[0]?.branch, "refund"));
});

test("a member who already observed a repo before sharing existed counts as shared, and one who didn't doesn't", async (t) => {
  // In this older DB alice has a work in REPO; bob has none.
  const world = await startWorld({
    seed: await readFile(new URL("./contract47.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  const observedBy = async (name: string) => {
    world.github.grant(name);
    const as = await world.login(name);
    const desk = await tempRepo();
    t.after(desk.remove);
    await desk.git("switch", "--create", `${name}-branch`);
    // Started the way the background runner starts it: not a yes to share.
    const runner = await startRunner({
      serverUrl: world.server.url,
      folder: desk.folder,
      session: as.session,
      observeMs: 50,
      shareRepo: false,
      ...stubbed(),
    });
    t.after(runner.stop);
    return async () =>
      (await world.works(world.owner)).some((work) => work.branch === `${name}-branch`);
  };
  const alice = await observedBy("alice");
  await eventually(async () => assert.equal(await alice(), true));
  const bob = await observedBy("bob");
  await sleep(500); // ten observation intervals
  assert.equal(await bob(), false);
});
