import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { type TestContext, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import {
  api,
  CONTRACT_VERSION,
  call,
  encode,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  RUNNER_SOCKET,
  runnerToServer,
  serverToRunner,
} from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { type WebSocket as ServerSocket, WebSocketServer } from "ws";
import { eventually, fakeExecutor, REPO, startWorld, stubbed, tempRepo } from "./harness.ts";

const frame = (fields: object) => JSON.stringify({ v: CONTRACT_VERSION, payload: {}, ...fields });
const tooBigFrame = "x".repeat(MAX_FRAME_BYTES + 1);
const tooBigBody = "x".repeat(MAX_MESSAGE_BYTES + 1);

/** Asks Git directly for this checkout's version. A clone without tags (CI's shallow clone) knows only the commit. */
function gitVersion() {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    return git("describe", "--tags");
  } catch {
    return `version unknown (commit ${git("rev-parse", "--short", "HEAD")})`;
  }
}

/** Asks Git directly for this checkout's branch. If it isn't a branch (CI's detached HEAD), the guidance is generic. */
function gitBranch() {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
  }).trim();
  return branch === "HEAD" ? "this clone's branch" : branch;
}

/** A bare connection that attaches to the server pretending to be a runner. It sends frames as they are, without going through the contract. */
async function rawRunner(t: TestContext, serverUrl: string) {
  const socket = new WebSocket(serverUrl.replace("http", "ws") + RUNNER_SOCKET);
  t.after(() => socket.close());
  await once(socket, "open");
  return {
    socket,
    async reply(sent: string) {
      socket.send(sent);
      const [{ data }] = await once(socket, "message");
      return JSON.parse(data);
    },
  };
}

/** Pretends to be a server. On receiving hello, it acts as `onHello` says. */
async function fakeServer(
  t: TestContext,
  onHello: (socket: ServerSocket, hello: { id: string }) => void,
) {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const received: unknown[] = [];
  const closed = Promise.withResolvers<void>();
  server.on("connection", (socket) => {
    socket.on("close", () => closed.resolve());
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.kind === "hello") onHello(socket, message);
      // The observations and check commands the runner sends on its own per connection aren't Q&A, so they aren't counted.
      else if (message.kind !== "observation" && message.kind !== "checkCommand")
        received.push(message);
    });
  });
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    server.close();
  });
  const repo = await tempRepo();
  t.after(repo.remove);
  return {
    /** Options for the runner that attaches to this server. */
    runner: {
      serverUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      folder: repo.folder,
      session: "session",
      ...stubbed(),
    },
    /** The messages the runner sent after hello (without observations and check commands). In order of arrival. */
    received,
    /** The connection to the runner closed. */
    closed: closed.promise,
  };
}

test("a real server and a real runner connect over a temporary Git repo and exchange messages", async (t) => {
  const world = await startWorld(); // the runner turns on only after getting welcome for hello
  t.after(world.stop);

  assert.equal(await world.repo.git("rev-list", "--count", "HEAD"), "1");
  assert.deepEqual(await call(world.server, api.health), {
    contract: CONTRACT_VERSION,
  });
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("the server doesn't accept kinds, contents or keys that aren't in the contract", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  // A connection that didn't finish hello is refused and then closed, so each frame attaches anew.
  const reply = async (sent: string) => (await rawRunner(t, world.server.url)).reply(sent);
  const refusedWith = (code: string, re?: string) => ({
    kind: "error",
    payload: { code },
    ...(re && { re }),
  });

  assert.partialDeepStrictEqual(
    await reply(frame({ id: "a", kind: "run_command", payload: { command: "ls" } })),
    refusedWith("unknown_kind", "a"),
  );
  assert.partialDeepStrictEqual(await reply("this isn't JSON"), refusedWith("invalid_message"));
  assert.partialDeepStrictEqual(
    await reply(frame({ id: "b", kind: "hello", payload: "the content isn't an object" })),
    refusedWith("invalid_message", "b"),
  );
  assert.partialDeepStrictEqual(
    await reply(
      frame({
        id: "c",
        kind: "hello",
        payload: { junk: "a key not in the contract" },
      }),
    ),
    refusedWith("invalid_message", "c"),
  );
  assert.partialDeepStrictEqual(
    await reply(frame({ id: "d", kind: "hello", junk: "a key not in the envelope" })),
    refusedWith("invalid_message"),
  );

  // A connection that sent a message that wasn't accepted doesn't count as a runner. What is attached is the world's one runner.
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("the server refuses a runner with a different contract version, sending its own version and contract version, and drops the connection", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { socket, reply } = await rawRunner(t, world.server.url);

  // The server is up and a runner that hasn't been updated attaches.
  const closed = once(socket, "close");
  assert.partialDeepStrictEqual(
    await reply(frame({ v: CONTRACT_VERSION - 1, id: "a", kind: "hello" })),
    {
      v: CONTRACT_VERSION,
      kind: "error",
      re: "a",
      payload: {
        code: "version_mismatch",
        version: gitVersion(),
        contract: CONTRACT_VERSION,
      },
    },
  );
  const [{ code }] = await closed;
  assert.equal(code, 1008);
});

test("the server doesn't read frames and bodies over the limit", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { socket } = await rawRunner(t, world.server.url);

  socket.send(frame({ id: "a", kind: "hello", payload: { junk: tooBigFrame } }));
  const [{ code }] = await once(socket, "close");
  assert.equal(code, 1009); // the message is too big
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });

  const response = await fetch(world.server.url + api.health.path, {
    method: "POST",
    body: tooBigBody,
  });
  assert.equal(response.status, 413);
  assert.partialDeepStrictEqual(await response.json(), {
    error: { code: "invalid_request" },
  });
});

test("the server answers a path that doesn't exist in the contract's error format", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await assert.rejects(call(world.server, { ...api.health, path: "/api/nowhere" }), {
    code: "not_found",
  });
});

test("a contract path accepts only a body that follows the contract", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await assert.rejects(call(world.server, api.loginPoll, { device: 1 } as never), {
    code: "invalid_request",
  });
  await assert.rejects(
    call(world.server, api.loginPoll, {
      device: "x",
      junk: "a key not in the contract",
    } as never),
    { code: "invalid_request" },
  );
  // A body that follows the contract reaches the handler. It is refused as an unknown device auth.
  await assert.rejects(call(world.server, api.loginPoll, { device: "x" }), {
    code: "unauthorized",
  });
});

test("unless opened separately, the server listens only inside this device", async (t) => {
  const outside = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal);
  if (!outside) return t.skip("there's no network interface facing outside");
  const world = await startWorld();
  t.after(world.stop);

  const { port } = new URL(world.server.url);
  await assert.rejects(fetch(`http://${outside.address}:${port}${api.health.path}`));
});

test("the runner takes only Q&A. It doesn't run a request not in the contract, a Q&A that widens tools, or a Q&A sent to an executor it doesn't run", async (t) => {
  // Imitating a breached server: it answers hello properly, then sends a request not in the contract, a Q&A that widens tools, and a proper Q&A.
  const server = await fakeServer(t, (socket, hello) => {
    socket.send(
      encode(serverToRunner, "welcome", { login: "owner", repo: REPO, shared: true }, hello.id),
    );
    socket.send(frame({ id: "x", kind: "run_command", payload: { command: "rm -rf ~" } }));
    const ask = {
      executor: "claude-code",
      channel: { id: "c", name: "general" },
      recent: [],
    };
    socket.send(
      frame({
        id: "y",
        kind: "ask",
        payload: { ...ask, message: "delete it", tools: ["Bash"] },
      }),
    );
    socket.send(
      frame({
        id: "w",
        kind: "ask",
        payload: { ...ask, executor: "codex", message: "who are you" },
      }),
    );
    socket.send(
      frame({
        id: "z",
        kind: "ask",
        payload: { ...ask, message: "read only" },
      }),
    );
  });
  // The answer is late so the runner's first observation (the checkCommand sent once per connection) arrives first. The server doesn't count that message.
  const fake = fakeExecutor(async () => {
    await setTimeout(500);
    return "fake answer";
  });
  const runner = await startRunner({
    ...server.runner,
    executors: { "claude-code": fake.executor },
  });
  t.after(runner.stop);

  await eventually(() => assert.equal(server.received.length, 4));
  const [x, y, w, z] = server.received;
  assert.partialDeepStrictEqual(x, {
    kind: "error",
    re: "x",
    payload: { code: "unknown_kind" },
  });
  assert.partialDeepStrictEqual(y, {
    kind: "error",
    re: "y",
    payload: { code: "invalid_message" },
  });
  // A Q&A sent to an executor this runner doesn't run isn't run.
  assert.partialDeepStrictEqual(w, {
    kind: "error",
    re: "w",
    payload: {
      code: "invalid_message",
      message: "This is an executor the runner doesn't run: codex",
    },
  });
  assert.partialDeepStrictEqual(z, {
    kind: "answer",
    re: "z",
    payload: { text: "fake answer" },
  });
  // What reached the executor is the one proper Q&A, and the tools and folder are what the runner decided.
  assert.deepEqual(
    fake.calls.map(({ message, tools, folder }) => ({
      message,
      tools,
      folder,
    })),
    [
      {
        message: "read only",
        tools: ["Read", "Grep", "Glob"],
        folder: server.runner.folder,
      },
    ],
  );
});

test("the runner recognizes a server with a different contract version and doesn't turn on", async (t) => {
  const server = await fakeServer(t, (socket, hello) => {
    socket.send(
      frame({
        v: CONTRACT_VERSION + 1,
        id: "w",
        re: hello.id,
        kind: "welcome",
      }),
    );
  });

  await assert.rejects(startRunner(server.runner), {
    code: "version_mismatch",
  });
  await server.closed;
});

test("when refused for a different contract version, the runner says what to update", async (t) => {
  const advice = {
    newer: `Pull \`${gitBranch()}\` (\`git pull\`, \`npm ci\`) and turn the runner back on`,
    older: "The server is older. Update the server (tell whoever runs it)",
  };
  for (const [contract, todo] of [
    [CONTRACT_VERSION + 1, advice.newer],
    [CONTRACT_VERSION - 1, advice.older],
  ] as const) {
    // A refusal from a server with a different contract version. This shape is fixed regardless of the contract version, so it is read even with keys added later.
    const server = await fakeServer(t, (socket, hello) => {
      socket.send(
        JSON.stringify({
          v: contract,
          id: "e",
          re: hello.id,
          kind: "error",
          payload: {
            code: "version_mismatch",
            message: `contract version differs: received ${CONTRACT_VERSION}, here ${contract}`,
            version: "v0.3.0",
            contract,
            later: "a key added by a later contract",
          },
        }),
      );
      socket.close(1008, "version_mismatch");
    });

    await assert.rejects(startRunner(server.runner), {
      code: "version_mismatch",
      message: `The server is on v0.3.0, and this machine is on ${gitVersion()}. ${todo}`,
    });
    await server.closed;
  }
});

test("the runner closes the connection and doesn't turn on if the server refuses hello", async (t) => {
  const server = await fakeServer(t, (socket, hello) => {
    socket.send(
      encode(serverToRunner, "error", { code: "internal", message: "not accepted" }, hello.id),
    );
  });

  await assert.rejects(startRunner(server.runner), {
    code: "internal",
    message: "not accepted",
  });
  await server.closed;
});

test("the runner doesn't wait forever for a server that doesn't answer hello", async (t) => {
  const server = await fakeServer(t, () => {});

  await assert.rejects(
    startRunner({ ...server.runner, welcomeTimeoutMs: 50 }),
    /The server didn't answer/,
  );
  await server.closed;
});

test("a kind not in the contract can't even be sent", () => {
  // @ts-expect-error if this line passes the type check, `npm run typecheck` fails.
  assert.throws(() => encode(runnerToServer, "run_command", {}));
});

test("the CLI and hooks are operated through the executable's input and output", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  // The version is this checkout's git tag, not package.json (ADR-0019).
  assert.deepEqual(await world.cli("--version"), {
    code: 0,
    stdout: `omagari ${gitVersion()} (contract ${CONTRACT_VERSION})\n`,
    stderr: "",
  });
  // --help is a request, not a mistake: usage on stdout, exit 0.
  const help = await world.cli("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage:/);

  // A hook never blocks a tool call whatever it receives: it ends with 0 and puts in nothing.
  const silent = { code: 0, stdout: "", stderr: "" };
  assert.deepEqual(await world.hook("this isn't JSON"), silent);
  // It ends by itself even if the agent doesn't close the input.
  assert.deepEqual(await world.hook("", { keepStdinOpen: true }), silent);
});

/** A bare request that starts a login pretending to be the `client` address. It adds Fly-Client-IP like Fly's front end. */
const startLogin = (url: string, client: string) =>
  fetch(new URL(api.login.path, url), {
    method: "POST",
    headers: { "fly-client-ip": client },
  });

test("on a server behind Fly, even if one address piles up unfinished logins all at once, only five are accepted, and it can't block other people's logins", async (t) => {
  const world = await startWorld({ behindFly: true });
  t.after(world.stop);
  // GitHub answers slowly, so the requests overlap while waiting on each other.
  const startDevice = world.github.github.startDevice;
  world.github.github.startDevice = async () => {
    await setTimeout(100);
    return startDevice();
  };
  const statuses = await Promise.all(
    Array.from({ length: 20 }, () =>
      startLogin(world.server.url, "192.0.2.1").then((r) => r.status),
    ),
  );
  assert.equal(statuses.filter((status) => status === 200).length, 5);
  // Another person logs in.
  world.github.grant("alice");
  await world.login("alice");
});

test("a server not behind Fly doesn't trust Fly-Client-IP, so even with a changing header it counts by the connection's one address", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  for (let i = 1; i <= 5; i++)
    assert.equal((await startLogin(world.server.url, `192.0.2.${i}`)).status, 200);
  assert.equal((await startLogin(world.server.url, "192.0.2.6")).status, 500);
});

test("a connection that didn't finish hello is dropped in time, and one that sends a big frame or a frame off the contract is dropped right away", async (t) => {
  const world = await startWorld({ helloMs: 200 });
  t.after(world.stop);
  const open = async (path: string) => {
    const socket = new WebSocket(world.server.url.replace("http", "ws") + path);
    t.after(() => socket.close());
    await once(socket, "open");
    const closed = once(socket, "close");
    return { socket, closed };
  };
  // A connection that sends nothing
  for (const path of [RUNNER_SOCKET, "/api/live"]) {
    const { closed } = await open(path);
    await closed;
  }
  // A first frame bigger than hello
  const big = await open(RUNNER_SOCKET);
  big.socket.send("x".repeat(65 * 1024));
  const [bigClose] = (await big.closed) as [CloseEvent];
  assert.equal(bigClose.code, 1009);
  // A first frame off the contract
  const junk = await open(RUNNER_SOCKET);
  junk.socket.send(frame({ id: "x", kind: "nope" }));
  const [junkClose] = (await junk.closed) as [CloseEvent];
  assert.equal(junkClose.code, 1008);
  // A runner that finished hello stays attached as time passes.
  await setTimeout(400);
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("the server sends HSTS only when a Fly front end says the request came over HTTPS (ADR-0052)", async (t) => {
  const world = await startWorld({ behindFly: true });
  t.after(world.stop);

  const plain = await fetch(world.server.url + api.health.path);
  assert.equal(plain.headers.get("strict-transport-security"), null);

  const secure = await fetch(world.server.url + api.health.path, {
    headers: { "x-forwarded-proto": "https" },
  });
  assert.equal(secure.headers.get("strict-transport-security"), "max-age=31536000");
});

test("off Fly, X-Forwarded-Proto can't turn HSTS on, since the server can't tell who set it", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  const response = await fetch(world.server.url + api.health.path, {
    headers: { "x-forwarded-proto": "https" },
  });
  assert.equal(response.headers.get("strict-transport-security"), null);
});
