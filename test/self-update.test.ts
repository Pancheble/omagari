import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { promisify } from "node:util";
import { CONTRACT_VERSION } from "@omagari/contract";
import { type WebSocket, WebSocketServer } from "ws";
import { eventually, REPO, tempRepo } from "./harness.ts";

const runner = ["runner", "--share", "full", "--merge-check", "off"];
const root = join(import.meta.dirname, "..");
const exec = promisify(execFile);

/**
 * Looks at the runner pulling an installed clone (ADR-0042) with a temporary remote and an installed clone. There is a fake server whose contract is `contract` and which refuses every hello,
 * and the installed clone's CLI is started in the observed repo folder. The remote has a commit that raised the contract after the clone was taken.
 * With `npm`, the installed folder is an npm install (package.json with a dist-tag) instead, which updates by `npm i -g omagari@next` (ADR-0048).
 * Fakes: the server, `npm ci` and `npm i -g` (they need a download and are unstable in CI. They leave only a mark in the installed folder that they were called;
 * the fake `npm i -g` also raises the installed contract and version the way the new package would, or fails with a permission error).
 */
type Hello = { v: number; id: string };
type Reply = (socket: WebSocket, hello: Hello, n: number) => void;

/** Refuses every hello like a server whose contract is `contract`. */
const refuse =
  (contract: number): Reply =>
  (socket, hello) => {
    socket.send(
      JSON.stringify({
        v: contract,
        id: "e",
        re: hello.id,
        kind: "error",
        payload: {
          code: "version_mismatch",
          message: "different",
          version: "v9.9.9",
          contract,
        },
      }),
    );
    socket.close(1008, "version_mismatch");
  };

/** Accepts hello (the server's contract is the same as the runner's) and leaves it attached. */
const welcome: Reply = (socket, hello) =>
  socket.send(
    JSON.stringify({
      v: hello.v,
      id: "w",
      re: hello.id,
      kind: "welcome",
      payload: { login: "owner", repo: REPO, shared: true },
    }),
  );

async function setup(t: TestContext, reply: Reply, npm?: "ok" | "fail") {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "omagari-update-")));
  const env = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Omagari Test",
    GIT_AUTHOR_EMAIL: "test@omagari.invalid",
    GIT_COMMITTER_NAME: "Omagari Test",
    GIT_COMMITTER_EMAIL: "test@omagari.invalid",
  };
  const git = async (cwd: string, ...args: string[]) =>
    (await exec("git", args, { cwd, env: { ...process.env, ...env } })).stdout.trim();

  // The remote: a copy of the current source. Add a commit that raised the contract after the clone was taken.
  const origin = join(dir, "origin");
  const packages = ["contract", "runner", "cli"];
  for (const name of packages)
    await cp(join(root, "packages", name), join(origin, "packages", name), {
      recursive: true,
      filter: (file) => !file.includes("node_modules"),
    });
  await writeFile(join(origin, "package.json"), '{"private":true,"type":"module"}');
  await git(origin, "init", "--initial-branch=dev");
  await git(origin, "add", "-A");
  await git(origin, "commit", "-m", "init");
  const installed = join(dir, "installed");
  await git(dir, "clone", origin, installed);
  if (npm)
    await writeFile(
      join(installed, "package.json"),
      '{"private":true,"type":"module","version":"0.0.0-dev.1","publishConfig":{"tag":"next"}}',
    );
  const index = join(origin, "packages/contract/src/index.ts");
  await writeFile(
    index,
    (await readFile(index, "utf8")).replace(
      `CONTRACT_VERSION = ${CONTRACT_VERSION};`,
      `CONTRACT_VERSION = ${CONTRACT_VERSION + 1};`,
    ),
  );
  await git(origin, "commit", "-am", "raise the contract");
  // The installed clone's dependencies: point outside, and workspace packages point to this clone's own.
  await mkdir(join(installed, "node_modules/@omagari"), { recursive: true });
  for (const name of await readdir(join(root, "node_modules")))
    if (name !== "@omagari")
      await symlink(join(root, "node_modules", name), join(installed, "node_modules", name));
  for (const name of packages)
    await symlink(
      join(installed, "packages", name),
      join(installed, "node_modules/@omagari", name),
    );
  // Fake npm: leaves the arguments it was called with in the clone.
  const bin = join(dir, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "npm"),
    npm
      ? `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const installed = ${JSON.stringify(installed)};
appendFileSync(installed + "/npm-called", process.argv.slice(2).join(" ") + "\\n");
if (${JSON.stringify(npm)} === "fail") {
  console.error("EACCES: permission denied, mkdir '/usr/local/lib/node_modules/omagari'");
  process.exit(243);
}
const index = installed + "/packages/contract/src/index.ts";
writeFileSync(index, readFileSync(index, "utf8").replace(/CONTRACT_VERSION = \\d+;/, "CONTRACT_VERSION = ${CONTRACT_VERSION + 1};"));
const pkg = installed + "/package.json";
writeFileSync(pkg, readFileSync(pkg, "utf8").replace("0.0.0-dev.1", "0.0.0-dev.2"));
`
      : '#!/bin/sh\necho "$@" > npm-called\n',
  );
  await chmod(join(bin, "npm"), 0o755);

  const hellos: number[] = [];
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  server.on("connection", (socket) =>
    socket.on("message", (data) => {
      const hello: Hello & { kind: string } = JSON.parse(String(data));
      if (hello.kind !== "hello") return;
      hellos.push(hello.v);
      reply(socket, hello, hellos.length);
    }),
  );
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await mkdir(join(dir, "config/omagari"), { recursive: true });
  await writeFile(join(dir, "config/omagari/sessions.json"), JSON.stringify({ [url]: "session" }));

  const observed = await tempRepo();
  t.after(observed.remove);
  const cliEnv = {
    OMAGARI_SERVER: url,
    XDG_CONFIG_HOME: join(dir, "config"),
    PATH: `${bin}:${process.env.PATH}`,
  };
  const omagari = async (...args: string[]) => {
    const result = await exec(
      process.execPath,
      [join(installed, "packages/cli/src/main.ts"), ...args],
      {
        cwd: observed.folder,
        env: { ...process.env, ...cliEnv },
      },
    ).catch((error) => error);
    return {
      code: result.code ?? 0,
      stdout: String(result.stdout),
      stderr: String(result.stderr),
    };
  };
  /** Raises the remote's contract to `to`. */
  const bump = async (to: number) => {
    await writeFile(
      index,
      (await readFile(index, "utf8")).replace(
        /CONTRACT_VERSION = \d+;/,
        `CONTRACT_VERSION = ${to};`,
      ),
    );
    await git(origin, "commit", "-am", `contract ${to}`);
  };
  /** Starts the runner, waits until `hellos` has `count` entries, then stops it. */
  const keep = async (count: number) => {
    const child = spawn(
      process.execPath,
      [join(installed, "packages/cli/src/main.ts"), ...runner],
      {
        cwd: observed.folder,
        env: { ...process.env, ...cliEnv },
        stdio: "ignore",
      },
    );
    const exited = once(child, "exit");
    try {
      await eventually(() => assert.ok(hellos.length >= count, `${hellos.length} hellos`), 30_000);
    } finally {
      child.kill("SIGINT");
      await exited;
    }
  };
  return { git, origin, installed, observed, hellos, omagari, bump, keep };
}

test("when the server's contract is newer, the installed clone is fast-forwarded, dependencies are installed and it restarts, what was pulled is recorded and the observed folder is untouched", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1));
  const before = await world.git(world.installed, "rev-parse", "HEAD");
  const observedStatus = await world.git(world.observed.folder, "status", "--porcelain");
  const observedHead = await world.git(world.observed.folder, "rev-parse", "HEAD");

  const started = await world.omagari(...runner);
  const after = await world.git(world.origin, "rev-parse", "HEAD");
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), after);
  assert.equal((await readFile(join(world.installed, "npm-called"), "utf8")).trim(), "ci");
  // First it connected with the old contract; the runner restarted after pulling connected with the new one. If it still doesn't match, it stops without pulling again and again.
  assert.deepEqual(world.hellos, [CONTRACT_VERSION, CONTRACT_VERSION + 1]);
  assert.notEqual(started.code, 0);
  assert.match(started.stdout, /The server's contract is newer, so this clone will be updated/);
  assert.match(started.stdout, /Updated dev from .* to .*/);
  // The notice talks about the installed clone's branch.
  assert.match(started.stdout, /Pull `dev`/);
  assert.doesNotMatch(started.stdout, /`main`/);

  const log = await world.omagari("runner", "log");
  assert.match(
    log.stdout,
    new RegExp(`Runner updated its clone dev ${before.slice(0, 7)} → ${after.slice(0, 7)}`),
  );
  assert.equal(await world.git(world.observed.folder, "status", "--porcelain"), observedStatus);
  assert.equal(await world.git(world.observed.folder, "rev-parse", "HEAD"), observedHead);
});

test("when the installed clone has edited files, nothing changes and what to do is shown", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1));
  const before = await world.git(world.installed, "rev-parse", "HEAD");
  await writeFile(join(world.installed, "packages/cli/package.json"), "{}\n");

  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(started.stderr, /Could not update automatically.*has modified files/s);
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);
  assert.deepEqual(world.hellos, [CONTRACT_VERSION]);
  await assert.rejects(readFile(join(world.installed, "npm-called")));
});

test("when the installed clone can't be fast-forwarded, nothing changes and what to do is shown", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1));
  await world.git(world.installed, "commit", "--allow-empty", "-m", "my commit");
  const before = await world.git(world.installed, "rev-parse", "HEAD");

  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(started.stderr, /`git pull --ff-only` failed/);
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);
  await assert.rejects(readFile(join(world.installed, "npm-called")));
});

test("when the server is older, it doesn't pull and tells you to raise the server", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION - 1));
  const before = await world.git(world.installed, "rev-parse", "HEAD");

  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(started.stderr, /The server is older/);
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);
  assert.deepEqual(world.hellos, [CONTRACT_VERSION]);
});

test("when a running, attached runner is refused because the server came back up with a new contract, it pulls the installed clone, restarts and attaches", async (t) => {
  const N = CONTRACT_VERSION;
  // It attached, then dropped (the server comes back up), and on reattaching it refuses with the new contract. The runner that pulled and restarted attaches.
  const world = await setup(t, (socket, hello, n) => {
    if (n === 1) {
      welcome(socket, hello, n);
      setTimeout(() => socket.close(), 200);
    } else if (n === 2) refuse(N + 1)(socket, hello, n);
    else welcome(socket, hello, n);
  });
  await world.keep(3);
  assert.deepEqual(world.hellos, [N, N, N + 1]);
  assert.equal(
    await world.git(world.installed, "rev-parse", "HEAD"),
    await world.git(world.origin, "rev-parse", "HEAD"),
  );
  assert.equal((await readFile(join(world.installed, "npm-called"), "utf8")).trim(), "ci");
});

test("when, after a runner that pulled and restarted attaches well, the server gets a new contract again, it pulls again", async (t) => {
  const N = CONTRACT_VERSION;
  let world: Awaited<ReturnType<typeof setup>>;
  world = await setup(t, (socket, hello, n) => {
    // 1: refused on start → pulled. 2: the pulled runner attaches. 3: the server rises again and refuses → pulled again. 4: attaches.
    if (n === 1) refuse(N + 1)(socket, hello, n);
    else if (n === 2) {
      welcome(socket, hello, n);
      void world.bump(N + 2).then(() => socket.close());
    } else if (n === 3) refuse(N + 2)(socket, hello, n);
    else welcome(socket, hello, n);
  });
  await world.keep(4);
  assert.deepEqual(world.hellos, [N, N + 1, N + 1, N + 2]);
  assert.equal(
    await world.git(world.installed, "rev-parse", "HEAD"),
    await world.git(world.origin, "rev-parse", "HEAD"),
  );
});

test("an npm-installed runner rejected by a newer contract installs its dist-tag, restarts and logs the versions", async (t) => {
  const N = CONTRACT_VERSION;
  const world = await setup(
    t,
    (socket, hello, n) => (n === 1 ? refuse(N + 1) : welcome)(socket, hello, n),
    "ok",
  );
  // Not pulled: the remote's new commit is not in the installed folder.
  const before = await world.git(world.installed, "rev-parse", "HEAD");
  await world.keep(2);
  assert.deepEqual(world.hellos, [N, N + 1]);
  assert.equal(
    (await readFile(join(world.installed, "npm-called"), "utf8")).trim(),
    "i -g omagari@next",
  );
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);

  const log = await world.omagari("runner", "log");
  assert.match(log.stdout, /Runner updated omagari@next 0\.0\.0-dev\.1 → 0\.0\.0-dev\.2/);
});

test("when the npm install fails, nothing changes and what to run is shown", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1), "fail");
  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(
    started.stderr,
    /Could not update automatically.*`npm i -g omagari@next` failed.*not with sudo.*EACCES/s,
  );
  assert.deepEqual(world.hellos, [CONTRACT_VERSION]);
  assert.match(await readFile(join(world.installed, "package.json"), "utf8"), /0\.0\.0-dev\.1/);
  assert.equal(
    (await world.omagari("runner", "log")).stdout.trim(),
    "The runner hasn't run anything yet",
  );
});
