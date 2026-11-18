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
 * 러너가 깔린 클론을 받는 것(ADR-0042)을 임시 원격과 깔린 클론으로 본다. 서버의 계약이 `contract`이고 모든 hello를 거절하는
 * 가짜 서버를 두고, 깔린 클론의 CLI를 관측하는 레포 폴더에서 켠다. 원격에는 클론을 받은 뒤 계약을 올린 커밋이 있다.
 * 가짜: 서버, 그리고 `npm ci`(내려받기가 필요해 CI에서 불안정하다. 불렸다는 표만 클론에 남긴다).
 */
type Hello = { v: number; id: string };
type Reply = (socket: WebSocket, hello: Hello, n: number) => void;

/** 모든 hello를 계약 `contract`의 서버처럼 거절한다. */
const refuse =
  (contract: number): Reply =>
  (socket, hello) => {
    socket.send(
      JSON.stringify({
        v: contract,
        id: "e",
        re: hello.id,
        kind: "error",
        payload: { code: "version_mismatch", message: "다르다", version: "v9.9.9", contract },
      }),
    );
    socket.close(1008, "version_mismatch");
  };

/** hello를 받아 주고(서버의 계약은 러너의 것과 같다) 붙어 있게 둔다. */
const welcome: Reply = (socket, hello) =>
  socket.send(
    JSON.stringify({
      v: hello.v,
      id: "w",
      re: hello.id,
      kind: "welcome",
      payload: { login: "owner", repo: REPO },
    }),
  );

async function setup(t: TestContext, reply: Reply) {
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

  // 원격: 지금 소스의 사본. 클론을 받은 뒤 계약을 올린 커밋을 더한다.
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
  const index = join(origin, "packages/contract/src/index.ts");
  await writeFile(
    index,
    (await readFile(index, "utf8")).replace(
      `CONTRACT_VERSION = ${CONTRACT_VERSION};`,
      `CONTRACT_VERSION = ${CONTRACT_VERSION + 1};`,
    ),
  );
  await git(origin, "commit", "-am", "계약을 올린다");
  // 깔린 클론의 의존성: 바깥 것을 가리키고, 작업 공간 패키지는 이 클론의 것을 가리킨다.
  await mkdir(join(installed, "node_modules/@omagari"), { recursive: true });
  for (const name of await readdir(join(root, "node_modules")))
    if (name !== "@omagari")
      await symlink(join(root, "node_modules", name), join(installed, "node_modules", name));
  for (const name of packages)
    await symlink(
      join(installed, "packages", name),
      join(installed, "node_modules/@omagari", name),
    );
  // 가짜 npm: 불린 인자를 클론에 남긴다.
  const bin = join(dir, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "npm"), '#!/bin/sh\necho "$@" > npm-called\n');
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
  await writeFile(join(dir, "config/omagari/sessions.json"), JSON.stringify({ [url]: "세션" }));

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
    return { code: result.code ?? 0, stdout: String(result.stdout), stderr: String(result.stderr) };
  };
  /** 원격의 계약을 `to`로 올린다. */
  const bump = async (to: number) => {
    await writeFile(
      index,
      (await readFile(index, "utf8")).replace(
        /CONTRACT_VERSION = \d+;/,
        `CONTRACT_VERSION = ${to};`,
      ),
    );
    await git(origin, "commit", "-am", `계약 ${to}`);
  };
  /** 러너를 켜 두고 `hellos`가 `count`개가 되기를 기다린 뒤 끈다. */
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
      await eventually(() => assert.ok(hellos.length >= count, `hello ${hellos.length}개`), 30_000);
    } finally {
      child.kill("SIGINT");
      await exited;
    }
  };
  return { git, origin, installed, observed, hellos, omagari, bump, keep };
}

test("서버의 계약이 더 새로우면 깔린 클론이 빨리 감기되고 의존성을 깔고 다시 켜며, 받은 것이 기록에 남고 관측하는 폴더는 그대로다", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1));
  const before = await world.git(world.installed, "rev-parse", "HEAD");
  const observedStatus = await world.git(world.observed.folder, "status", "--porcelain");
  const observedHead = await world.git(world.observed.folder, "rev-parse", "HEAD");

  const started = await world.omagari(...runner);
  const after = await world.git(world.origin, "rev-parse", "HEAD");
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), after);
  assert.equal((await readFile(join(world.installed, "npm-called"), "utf8")).trim(), "ci");
  // 처음엔 옛 계약으로, 받은 뒤 다시 켠 러너는 새 계약으로 붙었다. 그래도 안 맞으면 거듭 받지 않고 멈춘다.
  assert.deepEqual(world.hellos, [CONTRACT_VERSION, CONTRACT_VERSION + 1]);
  assert.notEqual(started.code, 0);
  assert.match(started.stdout, /서버의 계약이 더 새로워 이 클론을 받는다/);
  assert.match(started.stdout, /dev를 .* 받았다/);
  // 안내 문구는 깔린 클론의 브랜치를 말한다.
  assert.match(started.stdout, /`dev`를 받고/);
  assert.doesNotMatch(started.stdout, /`main`/);

  const log = await world.omagari("runner", "log");
  assert.match(
    log.stdout,
    new RegExp(`러너가 클론을 받음 dev ${before.slice(0, 7)} → ${after.slice(0, 7)}`),
  );
  assert.equal(await world.git(world.observed.folder, "status", "--porcelain"), observedStatus);
  assert.equal(await world.git(world.observed.folder, "rev-parse", "HEAD"), observedHead);
});

test("깔린 클론에 고친 파일이 있으면 아무것도 바뀌지 않고 할 일이 보인다", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1));
  const before = await world.git(world.installed, "rev-parse", "HEAD");
  await writeFile(join(world.installed, "packages/cli/package.json"), "{}\n");

  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(started.stderr, /자동으로 받지 못했다.*고친 파일이 있다/s);
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);
  assert.deepEqual(world.hellos, [CONTRACT_VERSION]);
  await assert.rejects(readFile(join(world.installed, "npm-called")));
});

test("깔린 클론이 빨리 감기가 안 되면 아무것도 바뀌지 않고 할 일이 보인다", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION + 1));
  await world.git(world.installed, "commit", "--allow-empty", "-m", "내 커밋");
  const before = await world.git(world.installed, "rev-parse", "HEAD");

  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(started.stderr, /git pull --ff-only.*안 됐다/s);
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);
  await assert.rejects(readFile(join(world.installed, "npm-called")));
});

test("서버가 더 낡았으면 받지 않고 서버를 올리라고 알린다", async (t) => {
  const world = await setup(t, refuse(CONTRACT_VERSION - 1));
  const before = await world.git(world.installed, "rev-parse", "HEAD");

  const started = await world.omagari(...runner);
  assert.notEqual(started.code, 0);
  assert.match(started.stderr, /서버가 더 오래됐어요/);
  assert.equal(await world.git(world.installed, "rev-parse", "HEAD"), before);
  assert.deepEqual(world.hellos, [CONTRACT_VERSION]);
});

test("켜져서 붙어 있던 러너가 서버가 새 계약으로 다시 떠 거절당하면 깔린 클론을 받고 다시 켜서 붙는다", async (t) => {
  const N = CONTRACT_VERSION;
  // 붙었다가 끊기고(서버가 다시 뜬다), 다시 붙을 때 새 계약으로 거절한다. 받고 다시 켠 러너는 붙는다.
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

test("받고 다시 켠 러너가 잘 붙은 뒤 서버가 또 새 계약이 되면 다시 받는다", async (t) => {
  const N = CONTRACT_VERSION;
  let world: Awaited<ReturnType<typeof setup>>;
  world = await setup(t, (socket, hello, n) => {
    // 1: 켤 때 거절 → 받음. 2: 받은 러너가 붙는다. 3: 서버가 또 올라 거절 → 또 받음. 4: 붙는다.
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
