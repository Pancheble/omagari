// Work by the same person is seen as a conflict, like someone else's work, if the branches differ (ADR-0041). Only the same work (same person, same branch) is skipped.
// One person, owner, runs two worktrees (payment, refund) of the same repo with one runner.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { type Alert, api, type ContractFailure, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;

const BASE = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;
const MONEY = `export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { refund } from "./money";
export const total = refund(2);
`;

const PAYMENT = { login: "owner", name: "owner", branch: "payment" };
const REFUND = { login: "owner", name: "owner", branch: "refund" };

/** Puts the base commit, then owner starts payment in the main folder and refund in a linked worktree. Returns the refund folder. */
async function twoBranches(world: World) {
  const write = writer(world.repo.folder);
  await write("src/pay.ts", text(BASE));
  await write("src/money.ts", MONEY);
  await write("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await world.repo.git("switch", "--create", "payment");
  const tree = await world.worktree("refund");
  await eventually(async () => {
    const branches = (await world.works(world.owner)).map((w) => `${w.login}/${w.branch}`);
    assert.ok(branches.includes("owner/payment") && branches.includes("owner/refund"));
  });
  return tree;
}

/** The `kind` notifications that are not resolved yet. */
async function open(world: World, kind: Alert["kind"]) {
  const { posts } = await call(world.owner, api.posts);
  return posts.flatMap(({ message: m, channel }) =>
    m.kind === "alert" && m.alert.kind === kind && !m.alert.resolved
      ? [{ ...m.alert, channel }]
      : [],
  );
}

/** Runs the hook in `cwd` and returns the text it injected, or "" if it injected nothing. */
async function runHook(world: World, cwd: string, input: object) {
  const { code, stdout, stderr } = await world.hook(JSON.stringify({ cwd, ...input }), { cwd });
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  return stdout === "" ? "" : (JSON.parse(stdout).hookSpecificOutput.additionalContext as string);
}

/** The pre-edit hook just before the work session in `cwd` edits `path`. It is a session seen for the first time, so it always injects nearby work. */
const preEdit = (world: World, cwd: string, path: string) =>
  runHook(world, cwd, {
    session_id: crypto.randomUUID(),
    transcript_path: join(cwd, "transcript.jsonl"),
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(cwd, path), old_string: "a", new_string: "b" },
  });

/** The session-start hook of the work session started in `cwd`. */
const sessionStart = (world: World, cwd: string) =>
  runHook(world, cwd, {
    session_id: crypto.randomUUID(),
    transcript_path: join(cwd, "transcript.jsonl"),
    hook_event_name: "SessionStart",
    source: "startup",
  });

/** Only the work (member · branch) of the lines wrapped in `tag` in the injected text. */
const worksIn = (context: string, tag: string) =>
  (context.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0]?.split("\n") ?? []).map((line) =>
    line.split(" · ").slice(0, 2).join(" · "),
  );

test("when one person's two branches edit the same place, a direct conflict notification and post appear, and only my other branch goes into the two hooks as nearby work", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const refund = await twoBranches(world);

  // A file only payment edited has no nearby work (same work).
  await writer(world.repo.folder)("src/only.ts", "only\n");
  await writer(world.repo.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "payment")));
  await writer(refund)("src/pay.ts", text(BASE.toSpliced(2, 1, "refund")));

  const alert = await eventually(async () => {
    const found = await open(world, "direct");
    assert.equal(found.length, 1, JSON.stringify(found));
    return found[0] as Extract<Alert, { kind: "direct" }> & { channel: string };
  });
  assert.deepEqual(alert.works, [PAYMENT, REFUND]);
  assert.deepEqual(
    alert.files.map((f) => f.path),
    ["src/pay.ts"],
  );
  // One notification is one post.
  assert.ok(alert.channel);

  // Pre-edit hook: my other branch goes in as nearby work, and the branch I am editing does not.
  await eventually(async () =>
    assert.deepEqual(
      worksIn(await preEdit(world, world.repo.folder, "src/pay.ts"), "omagari-nearby"),
      [`- owner · branch "refund"`],
    ),
  );
  assert.deepEqual(worksIn(await preEdit(world, refund, "src/pay.ts"), "omagari-nearby"), [
    `- owner · branch "payment"`,
  ]);
  assert.deepEqual(
    worksIn(await preEdit(world, world.repo.folder, "src/only.ts"), "omagari-nearby"),
    [],
  );

  // Session-start hook: only the other side of each branch is shown.
  assert.deepEqual(worksIn(await sessionStart(world, world.repo.folder), "omagari-situation"), [
    `- owner · branch "refund"`,
  ]);
  assert.deepEqual(worksIn(await sessionStart(world, refund), "omagari-situation"), [
    `- owner · branch "payment"`,
  ]);
});

test("an indirect conflict (estimated) and a duplicate work notification also appear between one person's two branches", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const refund = await twoBranches(world);

  // payment changes the definition line of refund. checkout on the refund branch uses it. The two branches create a new function with the same name.
  await writer(world.repo.folder)(
    "src/money.ts",
    MONEY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );
  await writer(world.repo.folder)("src/a.ts", "export function audit() {}\n");
  await writer(refund)("src/b.ts", "export function audit() {}\n");

  await eventually(async () => {
    const [indirect] = await open(world, "indirect");
    assert.ok(indirect && indirect.kind !== "direct", "Indirect conflict does not exist yet");
    assert.deepEqual(indirect.works, [PAYMENT, REFUND]);
    assert.deepEqual(
      indirect.symbols.map((s) => s.name),
      ["refund"],
    );
  });
  await eventually(async () => {
    const [duplicate] = await open(world, "duplicate");
    assert.ok(duplicate && duplicate.kind !== "direct", "Duplicate work does not exist yet");
    assert.deepEqual(duplicate.works, [PAYMENT, REFUND]);
    assert.deepEqual(
      duplicate.symbols.map((s) => s.name),
      ["audit"],
    );
  });
});

test("a debate opens even for a conflict between one person's two works, each side splits that branch's work session and gives a stance, and a proxy cannot be called", async (t) => {
  const owner = fakeExecutor(({ folder }) =>
    JSON.stringify({
      claim: `inside ${folder}`,
      evidence: ["src/money.ts:1 definition of refund"],
    }),
  );
  owner.executor.recent = async (_folder, branch) => `work-${branch}`;
  // Cut to one round so no rebuttal round starts after the two stances are public.
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    debateRounds: 1,
    executor: owner.executor,
  });
  t.after(world.stop);
  await twoBranches(world);

  // payment declares it will change refund's signature. checkout on the refund branch uses it (payment's own use is left out because it is the same work).
  const claimed = await world.cli(
    "claim",
    "src/money.ts",
    "--symbol",
    "refund",
    "--plan",
    "signature",
    "--detail",
    "refund(amount, reason)",
  );
  assert.equal(claimed.code, 0, claimed.stderr);

  const post = await eventually(async () => {
    const found = (await call(world.owner, api.posts)).posts.find(
      (p) => p.message.kind === "alert" && p.message.alert.kind === "declared",
    );
    assert.ok(found?.debate?.revealed, JSON.stringify(found?.debate));
    return found;
  });
  const debate = post.debate;
  assert.ok(debate);
  assert.deepEqual(
    debate.seats.map((s) => [s.login, s.branch, s.state]),
    [
      ["owner", "payment", "submitted"],
      ["owner", "refund", "submitted"],
    ],
  );
  assert.equal(debate.options.length, 2);
  // The same runner split and started that branch's work session for each branch.
  assert.deepEqual(owner.calls.map((c) => [c.resume, c.fork]).sort(), [
    ["work-payment", true],
    ["work-refund", true],
  ]);

  // The owner is always present, so neither another member nor the owner can call a proxy.
  world.github.grant("alice");
  const alice = await world.login("alice");
  for (const as of [alice, world.owner]) {
    await assert.rejects(call(as, api.proxyDebate, { post: post.channel, seat: 0 }), (error) => {
      assert.equal((error as ContractFailure).code, "conflict");
      return true;
    });
  }
});

test("omagari impact shows my work on my other branch and does not show my work on the same branch", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const refund = await twoBranches(world);

  // payment changes the definition line of the refund function.
  await writer(world.repo.folder)(
    "src/money.ts",
    MONEY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );
  const works = (stdout: string) =>
    stdout
      .split("Other members' Work that is changing the definition line:\n")[1]
      ?.split("Other members' Claims")[0];
  await eventually(async () => {
    const mine = await world.cliIn(refund, "impact", "refund");
    assert.equal(mine.code, 0, mine.stderr);
    assert.match(works(mine.stdout) ?? "", /^ {2}owner · "payment" · "src\/money.ts":1 /);
  });
  // Asking from the same branch (payment) leaves my work out.
  const own = await world.cliIn(world.repo.folder, "impact", "refund");
  assert.equal(own.code, 0, own.stderr);
  assert.equal(works(own.stdout), "  none\n");
});
