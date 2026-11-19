import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call, type ShareLevel } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };

const PAY = `export function charge(amount: number) {
  return amount;
}

export function refund(amount: number) {
  return -amount;
}
`;
const NOTES = `${Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
const SESSION = "11111111-2222-3333-4444-555555555555";

/** Puts src/pay.ts and src/notes.txt on the base commit and pushes origin/main. Everyone starts from the same state. */
async function base(world: World) {
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)("src/notes.txt", NOTES);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** Member `login`'s device. Starts `branch` on my main, as if it had received my repo (same as conflicts.test). */
async function clone(world: World, login: string, branch: string, share?: ShareLevel) {
  world.github.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, share);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  await desk.start();
  // The runner must observe that branch before it puts a claim on it.
  await eventually(async () =>
    assert.ok(
      (await world.works(world.owner)).some((w) => w.login === login && w.branch === branch),
    ),
  );
  return { as, desk };
}

/** Waits until owner switches to the payment branch and the server sees it. */
async function payment(world: World) {
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
}

/** Runs `omagari <args>` in `cwd` (default: owner's repo) and returns the successful output. */
async function omagari(world: World, args: string[], cwd = world.repo.folder) {
  const { code, stdout, stderr } = await world.cliIn(cwd, ...args);
  assert.equal(code, 0, stderr);
  return stdout;
}

/** Claim news in the feed as "claimed/released login branch path". */
async function claimNews(as: As) {
  const { news } = await call(as, api.feed);
  return news.flatMap((n) =>
    "claim" in n
      ? [`claimed ${n.claim.login} ${n.claim.branch} ${n.claim.path}`]
      : "released" in n
        ? [`released ${n.released.login} ${n.released.branch} ${n.released.path}`]
        : [],
  );
}

/**
 * Runs the pre-edit hook (Edit) or the session-start hook and returns the text it injected. It always exits 0 and makes no decision to block the tool call.
 * With `agent`, it is a subagent's call, so it looks without memory.
 */
async function hook(world: World, options: { cwd?: string; path?: string; agent?: string } = {}) {
  const cwd = options.cwd ?? world.repo.folder;
  const input = options.path
    ? {
        session_id: SESSION,
        cwd,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: {
          file_path: `${cwd}/${options.path}`,
          old_string: "a",
          new_string: "b",
        },
        ...(options.agent && {
          agent_id: options.agent,
          agent_type: "Explore",
        }),
      }
    : {
        session_id: SESSION,
        cwd,
        hook_event_name: "SessionStart",
        source: "startup",
      };
  const { code, stdout, stderr } = await world.hook(JSON.stringify(input), {
    cwd,
  });
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  if (stdout === "") return "";
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.deepEqual(Object.keys(hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  return hookSpecificOutput.additionalContext as string;
}

/** The lines inside the `<tag>` block of the injected text. Empty if there is none. */
const block = (output: string, tag: string) =>
  output.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0]?.split("\n") ?? [];

test("claim by symbol, line range, folder, or whole new file. A claim that doesn't overlap stays only in other members' feeds", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  await payment(world);
  world.github.grant("alice");
  const alice = await world.login("alice");

  assert.match(
    await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"]),
    /^Claimed on payment: "refund" in "src\/pay.ts" lines 5-7\n/,
  );
  assert.match(
    await omagari(world, ["claim", "src/notes.txt", "--lines", "2-4"]),
    /^Claimed on payment: "src\/notes.txt" lines 2-4\n/,
  );
  assert.match(
    await omagari(world, ["claim", "src/refund/"]),
    /^Claimed on payment: folder "src\/refund\/"\n/,
  );
  // A new file that wasn't in the base commit gets the whole file claimed when you give just the path. A path given from a subfolder is also claimed as seen from the repo root.
  await writer(world.repo.folder)("src/new.ts", "export const a = 1;\n");
  assert.match(
    await omagari(world, ["claim", "new.ts"], `${world.repo.folder}/src`),
    /^Claimed on payment: "src\/new.ts" whole file\n/,
  );

  // For a file that was in the base commit, narrow the claim by symbol or line range. A symbol that doesn't exist isn't claimed.
  const whole = await world.cli("claim", "src/pay.ts");
  assert.equal(whole.code, 1);
  assert.match(
    whole.stderr,
    /claim a file that was in the base commit by symbol \(--symbol\) or line range \(--lines\)/,
  );
  const missing = await world.cli("claim", "src/pay.ts", "--symbol", "nope");
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /couldn't find the definition of nope in src\/pay.ts/);

  // Other members see it in the feed, not the inbox.
  await eventually(async () =>
    assert.deepEqual(await claimNews(alice), [
      "claimed owner payment src/new.ts",
      "claimed owner payment src/refund/",
      "claimed owner payment src/notes.txt",
      "claimed owner payment src/pay.ts",
    ]),
  );
  assert.deepEqual(await claimNews(world.owner), []); // mine isn't in my feed
});

test("omagari release lets go of one or all. What was released stays in other members' feeds", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  await payment(world);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"]);
  await omagari(world, ["claim", "src/notes.txt", "--lines", "2-4"]);

  assert.match(
    await omagari(world, ["release", "src/pay.ts", "--symbol", "refund"]),
    /^Released 1 Claim\(s\) on payment:\n {2}"refund" in "src\/pay.ts" lines 5-7\n/,
  );
  assert.match(
    await omagari(world, ["release"]),
    /^Released 1 Claim\(s\) on payment:\n {2}"src\/notes.txt" lines 2-4\n/,
  );
  assert.match(await omagari(world, ["release"]), /^payment has no Claims to release\n/);
  assert.deepEqual((await claimNews(alice)).slice(0, 2).sort(), [
    "released owner payment src/notes.txt",
    "released owner payment src/pay.ts",
  ]);
});

test("another member's claim is moved to lines in my copy and goes into the pre-edit hook, and if I have no claim it advises claiming. An overlapping claim is also placed and lands in both inboxes", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const { desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);

  // alice adds three lines above, so refund is lines 8-10 in alice's copy. In owner's copy it is lines 5-7.
  await writer(desk.folder)("src/pay.ts", `// a\n// b\n// c\n${PAY}`);
  await eventually(async () =>
    assert.ok(
      (await world.works(world.owner)).some(
        (w) =>
          w.branch === "refund" &&
          w.files.some((f) => "content" in f && f.content.startsWith("// a")),
      ),
    ),
  );
  assert.match(
    await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"], desk.folder),
    /^Claimed on refund: "refund" in "src\/pay.ts" lines 8-10\n/,
  );

  // When owner is about to edit that file, alice's claim goes into owner's lines, and since there is nearby work and owner has no claim, it advises claiming.
  const first = await eventually(async () => {
    const context = await hook(world, { path: "src/pay.ts" });
    assert.deepEqual(block(context, "omagari-claims"), [
      `- alice's branch "refund" · "refund" in "src/pay.ts" lines 5-7`,
    ]);
    return context;
  });
  assert.match(first, /rather than editing inside the claimed part\. It isn't blocked\./);
  assert.match(
    first,
    /my Work hasn't claimed "src\/pay.ts"\. Before editing, claim the part you'll change: omagari claim/,
  );
  // If nothing has changed, it is not injected again.
  assert.equal(await hook(world, { path: "src/pay.ts" }), "");

  // An overlap is also placed. Alice's overlapping claim shows together in owner's lines.
  const claimed = await omagari(world, ["claim", "src/pay.ts", "--lines", "6"]);
  assert.match(claimed, /^Claimed on payment: "src\/pay.ts" lines 6\n/);
  assert.match(
    claimed,
    /Overlapping Claims from other members.*\n {2}alice's branch "refund" · "refund" in "src\/pay.ts" lines 5-7\n/,
  );

  // The overlap goes into both works' inboxes. Lines are as of each one's own copy.
  await eventually(async () =>
    assert.deepEqual(block(await hook(world, { cwd: desk.folder }), "omagari-inbox"), [
      `- Claims overlap: my Claim "refund" in "src/pay.ts" lines 8-10 and owner's branch "payment"'s Claim "src/pay.ts" lines 6. Lines are from each side's own copy. Wait for the overlapping part, or ask the other side.`,
    ]),
  );
  // owner's may have been attached first at the end of the omagari claim response. Then it isn't injected into the hook again.
  const ownerSees = `- Claims overlap: my Claim "src/pay.ts" lines 6 and alice's branch "refund"'s Claim "refund" in "src/pay.ts" lines 8-10. Lines are from each side's own copy. Wait for the overlapping part, or ask the other side.`;
  await eventually(async () =>
    assert.ok(
      block(claimed, "omagari-inbox").includes(ownerSees) ||
        block(await hook(world, {}), "omagari-inbox").includes(ownerSees),
    ),
  );

  // Now owner has claimed that file too, so only the other member's claim is injected again, without the advice to claim.
  const after = await hook(world, { path: "src/pay.ts" });
  assert.deepEqual(block(after, "omagari-claims"), [
    `- alice's branch "refund" · "refund" in "src/pay.ts" lines 5-7`,
  ]);
  assert.doesNotMatch(after, /omagari claim/);

  // A folder claim is injected when you edit a file under it.
  await omagari(world, ["claim", "src/"], desk.folder);
  await eventually(async () =>
    assert.deepEqual(
      block(await hook(world, { path: "src/notes.txt", agent: "a1" }), "omagari-claims"),
      [`- alice's branch "refund" · folder "src/"`],
    ),
  );
});

test("when the other side's content can't be read, the lines get an approximation, and a long offline becomes stale and then is erased", async (t) => {
  // Cut 7 days down to 6 seconds. The "stale" window lasts forgetMs, so leave room so a slow hook under load doesn't miss it (#153).
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    forgetMs: 6000,
  });
  t.after(world.stop);
  await base(world);
  const { desk } = await clone(world, "bob", "docs", "intent");
  t.after(desk.remove);
  await payment(world);

  await omagari(world, ["claim", "src/notes.txt", "--lines", "2-3"], desk.folder);
  const seen = (context: string) => block(context, "omagari-claims");
  await eventually(async () =>
    assert.deepEqual(seen(await hook(world, { path: "src/notes.txt", agent: "a1" })), [
      `- bob's branch "docs" · "src/notes.txt" lines 2-3(approx, lines may have shifted)`,
    ]),
  );

  await desk.stop();
  await eventually(async () =>
    assert.deepEqual(seen(await hook(world, { path: "src/notes.txt", agent: "a2" })), [
      `- bob's branch "docs" · "src/notes.txt" lines 2-3(approx, lines may have shifted, stale, the owner has been offline for a long time)`,
    ]),
  );
  await eventually(async () =>
    assert.deepEqual(seen(await hook(world, { path: "src/notes.txt", agent: "a3" })), []),
  );
});

test("when a branch is merged or deleted, that work's claims are released on their own", async (t) => {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  await base(world);
  const alice = await clone(world, "alice", "refund");
  t.after(alice.desk.remove);
  await payment(world);

  await omagari(world, ["claim", "src/pay.ts", "--symbol", "charge"]);
  await omagari(world, ["claim", "src/notes.txt", "--lines", "1"], alice.desk.folder);
  await eventually(async () =>
    assert.deepEqual(await claimNews(alice.as), ["claimed owner payment src/pay.ts"]),
  );

  // When payment is merged, owner's claim is released.
  world.github.merge(world.github.openPull("payment", "Payment", false));
  await eventually(async () =>
    assert.deepEqual(await claimNews(alice.as), [
      "released owner payment src/pay.ts",
      "claimed owner payment src/pay.ts",
    ]),
  );

  // When refund is deleted, alice's claim is released.
  await alice.desk.git("switch", "main");
  await alice.desk.git("branch", "-D", "refund");
  await eventually(async () =>
    assert.deepEqual((await claimNews(world.owner))[0], "released alice refund src/notes.txt"),
  );
});

test("share level declared uploads content only for changed files inside claimed paths, and uploads only the path outside them", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const { desk } = await clone(world, "alice", "refund", "declared");
  t.after(desk.remove);
  await writer(desk.folder)("src/pay.ts", PAY.replace("-amount", "0 - amount"));
  await writer(desk.folder)("src/notes.txt", NOTES.replace("line 1", "alice"));
  const files = async () =>
    Object.fromEntries(
      ((await world.works(world.owner)).find((w) => w.login === "alice")?.files ?? []).map((f) => [
        f.path,
        "content" in f ? "content" : "omitted" in f ? f.omitted : "deleted",
      ]),
    );
  await eventually(async () =>
    assert.deepEqual(await files(), {
      "src/notes.txt": "share",
      "src/pay.ts": "share",
    }),
  );

  await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"], desk.folder);
  await eventually(async () =>
    assert.deepEqual(await files(), {
      "src/notes.txt": "share",
      "src/pay.ts": "content",
    }),
  );
});

test("it also comes up with a DB built from #82's inbox table, and news not handed over passes through as is", async (t) => {
  const works = JSON.stringify([
    { login: "alice", name: "alice", branch: "refund" },
    { login: "owner", name: "owner", branch: "main" },
  ]);
  const files = JSON.stringify([
    { path: "a.ts", lines: [[{ from: 1, to: 1 }], [{ from: 2, to: 2 }]] },
  ]);
  const world = await startWorld({
    seed: `
      CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, works TEXT NOT NULL,
        files TEXT NOT NULL, resolved INTEGER, updated INTEGER NOT NULL) STRICT;
      INSERT INTO alerts VALUES (1, 'pair', '${works}', '${files}', ${Date.now()}, ${Date.now()});
      CREATE TABLE inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, branch TEXT NOT NULL,
        alert INTEGER NOT NULL REFERENCES alerts (id), at INTEGER NOT NULL, UNIQUE (login, branch, alert)) STRICT;
      INSERT INTO inbox VALUES (7, 'owner', 'main', 1, ${Date.now()});`,
  });
  t.after(world.stop);
  await eventually(async () =>
    assert.deepEqual(block(await hook(world), "omagari-inbox"), [
      `- Resolved: my Work and alice's branch "refund"'s Direct conflict`,
    ]),
  );
});
