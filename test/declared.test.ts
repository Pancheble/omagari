// Contract declaration (#87): a plan attached to a claim goes as a notice to work that uses the symbol, is replaced, and is cancelled if released without being done.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Alert, api, call } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };
type Declared = Exclude<Alert, { kind: "direct" }> & { id: number };

const PAY = `export function pay(amount: number) {
  return amount;
}
export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { pay, refund } from "./pay";
export const total = pay(1) + refund(2);
`;

/** Put src/pay.ts and src/checkout.ts on the base commit and push origin/main. */
async function base(world: World) {
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** alice's machine: start a refund branch on my main (same as conflicts.test). */
async function alice(world: World) {
  world.github.grant("alice");
  const as = await world.login("alice");
  const desk = await world.desk(as);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "refund");
  await desk.start();
  return desk;
}

/** Wait until the owner switches to the payment branch and the server sees it. */
async function payment(world: World) {
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
}

/** Run `omagari <args>` in the owner's repo and return the output of a success. */
async function omagari(world: World, args: string[], cwd = world.repo.folder) {
  const { code, stdout, stderr } = await world.cliIn(cwd, ...args);
  assert.equal(code, 0, stderr);
  return stdout;
}

/** The declared contract-change notices. */
async function declared(as: As): Promise<Declared[]> {
  const messages = (await call(as, api.posts)).posts.map((p) => p.message);
  return messages.flatMap((m) =>
    m.kind === "alert" && m.alert.kind === "declared" ? [{ id: m.id, ...m.alert } as Declared] : [],
  );
}

const inboxLines = (output: string) =>
  output.split("<omagari-inbox>\n")[1]?.split("\n</omagari-inbox>")[0]?.split("\n") ?? [];

/** Run `omagari status` in `cwd` repeatedly and wait until `line` is handed to the mailbox. Return all the lines handed over. */
async function receives(world: World, cwd: string, line: string, seen: string[] = []) {
  await eventually(async () => {
    seen.push(...inboxLines((await world.cliIn(cwd, "status")).stdout));
    assert.ok(seen.includes(line), JSON.stringify(seen));
  });
  return seen;
}

const OWNER = { login: "owner", name: "owner", branch: "payment" };
const ALICE = { login: "alice", name: "alice", branch: "refund" };
const USES = [
  { path: "src/checkout.ts", line: 1, role: "uses" },
  { path: "src/checkout.ts", line: 2, role: "uses" },
] as const;

test("attaching a plan to a claim notifies work that uses the code before it changes; a new plan replaces the old one; releasing without doing it sends cancelled", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const desk = await alice(world);
  t.after(desk.remove);
  await payment(world);

  // Declare a signature change to refund and leave the code alone. If the notice is up quickly, the owner's mailbox news is attached to the end of this command's reply.
  const claimed = await omagari(world, [
    "claim",
    "src/pay.ts",
    "--symbol",
    "refund",
    "--plan",
    "signature",
    "--detail",
    "refund(amount, reason)",
  ]);
  assert.match(
    claimed,
    /^Claimed on payment: "refund" in "src\/pay.ts" lines 4-6 · plan: Signature change "refund" "refund\(amount, reason\)"\n/,
  );
  const signature = {
    kind: "signature",
    symbol: "refund",
    detail: "refund(amount, reason)",
  };
  const first = await eventually(async () => {
    const found = await declared(world.owner);
    assert.equal(found.length, 1, JSON.stringify(found));
    return found[0] as Declared;
  });
  assert.deepEqual(first, {
    id: first.id,
    kind: "declared",
    works: [ALICE, OWNER],
    symbols: [
      {
        name: "refund",
        places: [USES, [{ path: "src/pay.ts", line: 4, role: "declared" }]],
        plan: signature,
      },
    ],
    more: 0,
    resolved: null,
  });
  // It goes into the mailboxes of both the user and the changer.
  await receives(
    world,
    desk.folder,
    `- Declared Contract change: my Work and owner's branch "payment". One side declared in its Claim that it will change the symbol (the code may not have changed yet), and the other side uses that name. "refund" (me: Uses "src/checkout.ts":1, "src/checkout.ts":2 / them: Declared a change "src/pay.ts":4 / plan: Signature change "refund" "refund(amount, reason)")`,
  );
  await receives(
    world,
    world.repo.folder,
    `- Declared Contract change: my Work and alice's branch "refund". One side declared in its Claim that it will change the symbol (the code may not have changed yet), and the other side uses that name. "refund" (me: Declared a change "src/pay.ts":4 / them: Uses "src/checkout.ts":1, "src/checkout.ts":2 / plan: Signature change "refund" "refund(amount, reason)")`,
    inboxLines(claimed),
  );

  // The user's omagari impact shows the attached plan.
  assert.match(
    await omagari(world, ["impact", "refund"], desk.folder),
    /Other members' Claims that declare a change \(with a plan attached\):\n {2}owner's branch "payment" · "refund" in "src\/pay.ts" lines 4-6 · plan: Signature change "refund" "refund\(amount, reason\)"\n/,
  );

  // A new plan on the same symbol at another place (line range) replaces the old plan, and the same notice is updated to the new plan.
  await omagari(world, ["claim", "src/pay.ts", "--lines", "4-6", "--plan", "rename:refund"]);
  await eventually(async () => {
    const found = await declared(world.owner);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.id, first.id);
    assert.deepEqual(
      found[0]?.symbols.map((s) => s.plan),
      [{ kind: "rename", symbol: "refund" }],
    );
  });

  // Releasing a plan without doing it sends cancelled to the work that got the notice, and the notice is lifted.
  // Every omagari command hands over the mailbox at the end of its reply, so the owner also saw the release reply.
  const released = inboxLines(await omagari(world, ["release"]));
  const seen = await receives(
    world,
    desk.folder,
    `- Declared Contract change cancelled: owner's branch "payment" released the Claim on "refund" (plan: Rename) without carrying out the plan. If you changed anything to fit that plan, undo it or ask them.`,
  );
  await receives(
    world,
    desk.folder,
    `- Resolved: my Work and owner's branch "payment"'s Declared contract change`,
    seen,
  );
  assert.notEqual((await declared(world.owner))[0]?.resolved, null);
  // The changer doesn't get cancelled.
  const own = await receives(
    world,
    world.repo.folder,
    `- Resolved: my Work and alice's branch "refund"'s Declared contract change`,
    released,
  );
  assert.ok(!own.some((line) => line.includes("cancelled")), JSON.stringify(own));
});

test("releasing after changing the definition line as planned doesn't send cancelled", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const desk = await alice(world);
  t.after(desk.remove);
  await payment(world);

  await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund", "--plan", "signature"]);
  await eventually(async () => assert.equal((await declared(world.owner)).length, 1));
  // Change the signature as planned, and wait until the server sees that definition line.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );
  await eventually(async () => {
    const work = (await world.works(world.owner)).find((w) => w.branch === "payment");
    const file = work?.files.find((f) => f.path === "src/pay.ts");
    assert.ok(
      file && "definitions" in file && file.definitions?.some((d) => d.change === "changed"),
    );
  });
  await omagari(world, ["release"]);
  const seen = await receives(
    world,
    desk.folder,
    `- Resolved: my Work and owner's branch "payment"'s Declared contract change`,
  );
  assert.ok(!seen.some((line) => line.includes("cancelled")), JSON.stringify(seen));
});

test("--plan needs the right kind and an existing symbol, and isn't given to release", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  await payment(world);
  for (const args of [
    ["claim", "src/pay.ts", "--symbol", "refund", "--plan", "move"],
    ["claim", "src/pay.ts", "--lines", "4-6", "--plan", "delete"],
    ["claim", "src/pay.ts", "--symbol", "refund", "--detail", "x"],
    ["release", "--plan", "delete:refund"],
  ]) {
    const { code, stderr } = await world.cli(...args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /--plan|--detail/, args.join(" "));
  }
});
