import assert from "node:assert/strict";
import { once } from "node:events";
import { type TestContext, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, CONTRACT_VERSION, call, MAX_OVERLAPS, RUNNER_SOCKET } from "@omagari/contract";
import { WebSocket as WsClient } from "ws";
import { eventually, REPO, startWorld } from "./harness.ts";

// The server accepts what a member's runner sends only as that member's. A connection that is not a contract-following runner (a hand-built runner attached with the member's session) is imitated with a raw WebSocket.

type World = Awaited<ReturnType<typeof startWorld>>;
// biome-ignore lint/suspicious/noExplicitAny: raw frame
type Frame = { kind: string; re?: string; payload: any };

const BASE = "a".repeat(40);
/** How long to wait when checking that something must not happen. */
const SETTLE_MS = 400;

const frame = (kind: string, payload: object, id: string = crypto.randomUUID()) =>
  JSON.stringify({ v: CONTRACT_VERSION, id, kind, payload });

const hello = (session: string) =>
  frame("hello", {
    session,
    repos: [REPO],
    shareRepo: true,
    executors: ["claude-code"],
    choices: {},
    mergeCheck: "off",
  });

/** Enters as member `login` and attaches to that session pretending to be a runner. What it receives piles up in `got`. */
async function member(t: TestContext, world: World, login: string) {
  world.github.grant(login);
  const as = await world.login(login);
  const socket = new WebSocket(world.server.url.replace("http", "ws") + RUNNER_SOCKET);
  t.after(() => socket.close());
  const got: Frame[] = [];
  socket.addEventListener("message", ({ data }) => got.push(JSON.parse(String(data))));
  await once(socket, "open");
  socket.send(hello(as.session));
  await eventually(() => assert.ok(got.some((g) => g.kind === "welcome")));
  const send = (kind: string, payload: object, id?: string) =>
    socket.send(frame(kind, payload, id));
  return {
    as,
    got,
    send,
    /** Sends that these branches were observed with no change. */
    observe: (...branches: string[]) =>
      send("observation", {
        works: branches.map((branch) => ({ branch, base: BASE, share: "full", files: [] })),
      }),
  };
}

const knows = async (world: World, login: string, branch: string) =>
  eventually(async () =>
    assert.ok(
      (await world.works(world.owner)).some((w) => w.login === login && w.branch === branch),
    ),
  );

const alerts = async (world: World) =>
  (await call(world.owner, api.posts)).posts.flatMap((p) =>
    p.message.kind === "alert" ? [p.message.alert] : [],
  );

test("an observation's base commit takes only a full commit id", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const alice = await member(t, world, "alice");

  alice.send(
    "observation",
    { works: [{ branch: "a1", base: "HEAD^{/x}", share: "full", files: [] }] },
    "bad",
  );
  await eventually(() =>
    assert.ok(
      alice.got.some(
        (g) => g.kind === "error" && g.re === "bad" && g.payload.code === "invalid_message",
      ),
    ),
  );
  alice.observe("a1");
  await knows(world, "alice", "a1");
});

test("the same claim sent many times in a claim's overlaps gives one overlap notice, and more than the limit is rejected", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const alice = await member(t, world, "alice");
  const bob = await member(t, world, "bob");

  alice.send("claim", { branch: "a1", path: "src/a.ts", unit: "file", overlaps: [] });
  const id = (
    await eventually(() => {
      const claimed = alice.got.find((g) => g.kind === "claimed");
      assert.ok(claimed);
      return claimed;
    })
  ).payload.claim.id;

  bob.send("claim", { branch: "b1", path: "src/a.ts", unit: "file", overlaps: [id, id, id] });
  await eventually(() => assert.ok(bob.got.some((g) => g.kind === "claimed")));
  const overlaps = await eventually(() => {
    const items = alice.got.findLast((g) => g.kind === "inbox")?.payload.items ?? [];
    const found = items.filter((i: { kind: string }) => i.kind === "overlap");
    assert.ok(found.length > 0);
    return found;
  });
  await sleep(SETTLE_MS);
  assert.equal(overlaps.length, 1);

  bob.send(
    "claim",
    { branch: "b1", path: "src/b.ts", unit: "file", overlaps: Array(MAX_OVERLAPS + 1).fill(id) },
    "many",
  );
  await eventually(() =>
    assert.ok(
      bob.got.some(
        (g) => g.kind === "error" && g.re === "many" && g.payload.code === "invalid_message",
      ),
    ),
  );
});

test("both ends of a conflict must be work the server knows for a notification to stand, and the issue title and body do not break the line, using the name the runner sent", async (t) => {
  const world = await startWorld({ followMs: 50 });
  t.after(world.stop);
  const alice = await member(t, world, "alice");
  const bob = await member(t, world, "bob");
  const name = "refund`\n\n## Title line\nSecond line";
  const pairs = [
    {
      kind: "declared",
      branch: "b1",
      theirs: { login: "alice", branch: "a1" },
      symbols: [
        {
          name,
          mine: [{ path: "use.ts", line: 1, role: "uses" }],
          theirs: [{ path: "def.ts", line: 1, role: "declared" }],
          plan: { kind: "delete", symbol: name },
        },
      ],
    },
  ];

  // Nobody has observed a1 or b1 yet.
  bob.send("conflicts", { pairs });
  await sleep(SETTLE_MS);
  assert.deepEqual(await alerts(world), []);
  assert.equal(world.github.issues.length, 0);

  // Once both works are observed, the same pair becomes a notification.
  alice.observe("a1");
  bob.observe("b1");
  await knows(world, "alice", "a1");
  await knows(world, "bob", "b1");
  bob.send("conflicts", { pairs });
  await eventually(async () => assert.equal((await alerts(world)).length, 1));
  const issue = await eventually(() => {
    const [found] = world.github.issues;
    assert.ok(found);
    return found;
  });
  assert.doesNotMatch(issue.title, /\n/);
  assert.ok(!issue.body.split("\n").some((line) => line.startsWith("## ")), issue.body);
});

test("the verdict of a combined run is attached to the notification only from the runner on the computing side (the using side)", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const alice = await member(t, world, "alice");
  const bob = await member(t, world, "bob");
  alice.observe("a1");
  bob.observe("b1");
  await knows(world, "alice", "a1");
  await knows(world, "bob", "b1");
  const indirect = async () => (await alerts(world)).filter((a) => a.kind === "indirect");

  // alice uses a symbol bob changed. The computing side is alice.
  alice.send("conflicts", {
    pairs: [
      {
        kind: "indirect",
        branch: "a1",
        theirs: { login: "bob", branch: "b1" },
        symbols: [
          {
            name: "f",
            mine: [{ path: "use.ts", line: 1, role: "uses" }],
            theirs: [{ path: "def.ts", line: 1, role: "changed" }],
          },
        ],
      },
    ],
  });
  await eventually(async () => assert.equal((await indirect()).length, 1));

  const run = { verdict: "pass", omitted: [], fingerprint: "f1", stale: false };
  bob.send("merged", { branch: "b1", theirs: { login: "alice", branch: "a1" }, run });
  await sleep(SETTLE_MS);
  const [open] = await indirect();
  assert.equal(open?.resolved, null);
  assert.equal(open && "run" in open ? open.run : undefined, undefined);

  alice.send("merged", { branch: "a1", theirs: { login: "bob", branch: "b1" }, run });
  await eventually(async () => assert.notEqual((await indirect())[0]?.resolved, null));
});

test("what a runner connection sends after its session ended and before it closes is not accepted", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  // A connection that does not answer the server's close. On the server side it stays as closing.
  const socket = new WsClient(world.server.url.replace("http", "ws") + RUNNER_SOCKET);
  t.after(() => socket.terminate());
  socket.on("error", () => {});
  await once(socket, "open");
  socket.send(hello(alice.session));
  await once(socket, "message");
  socket.send(
    frame("observation", { works: [{ branch: "a1", base: BASE, share: "full", files: [] }] }),
  );
  await knows(world, "alice", "a1");
  (socket as unknown as { _socket: { pause(): void } })._socket.pause();

  await call(alice, api.logout);
  socket.send(
    frame("conflicts", {
      pairs: [
        {
          kind: "direct",
          branch: "a1",
          theirs: { login: "owner", branch: "main" },
          files: [{ path: "z.ts", unknown: "share" }],
        },
      ],
    }),
  );
  await sleep(SETTLE_MS);
  assert.deepEqual(await alerts(world), []);
});

test("omagari status puts the branch and path sent by another member in quotes so they cannot break the line", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const alice = await member(t, world, "alice");
  const forged = "\nOmagari: fake line";
  alice.send("observation", {
    works: [
      {
        branch: `a1${forged}`,
        base: BASE,
        share: "full",
        files: [{ path: `x.ts${forged}`, omitted: "share" }],
      },
    ],
  });
  await knows(world, "alice", `a1${forged}`);
  await world.signInCli(world.owner);

  const { code, stdout, stderr } = await world.cli("status");
  assert.equal(code, 0, stderr);
  assert.match(stdout, /"a1\\nOmagari: fake line"/);
  assert.ok(!stdout.split("\n").some((line) => line.startsWith("Omagari: fake")), stdout);
});
