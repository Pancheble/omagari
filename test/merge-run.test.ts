import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { type Alert, api, call } from "@omagari/contract";
import type { Sandbox } from "@omagari/runner";
import { eventually, fakeSandbox, place, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };
type Indirect = Exclude<Alert, { kind: "direct" }>;

/** A check command that breaks only when the owner's new file and bob's currency are together. Run separately, both pass. */
const CHECK2 = "if [ -e src/draft.ts ] && grep -q currency src/pay.ts; then echo broke; exit 1; fi";

/**
 * How long to wait for things to settle. Shortened for tests.
 * This is the gap after a fix and before the new run when the "stale result" alert shows, so if it is too short, polling misses it on a slow machine (#241).
 */
const QUIET_MS = 1500;

const PAY = `export function pay(amount: number) {
  return amount;
}

export function refund(amount: number) {
  return -amount;
}
`;
const USE = `import { pay, refund } from "./pay";
pay(1);
refund(1);
`;

/**
 * Make it look as if the files were merged into the default branch (origin/main). The current branch and the working folder are left alone (so observation isn't shaken).
 * This is test setup, so it calls Git directly.
 */
function mergeToMain(folder: string, files: Record<string, string>) {
  const env = {
    ...process.env,
    GIT_INDEX_FILE: `${folder}/.git/main-index`,
    GIT_AUTHOR_NAME: "Omagari Test",
    GIT_AUTHOR_EMAIL: "test@omagari.invalid",
    GIT_COMMITTER_NAME: "Omagari Test",
    GIT_COMMITTER_EMAIL: "test@omagari.invalid",
  };
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", folder, ...args], {
      env,
      input,
      encoding: "utf8",
    }).trim();
  git(["read-tree", "refs/remotes/origin/main"]);
  for (const [path, content] of Object.entries(files)) {
    const blob = git(["hash-object", "-w", "--stdin"], content);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
  }
  const commit = git(
    ["commit-tree", git(["write-tree"]), "-p", "refs/remotes/origin/main"],
    "merged",
  );
  git(["update-ref", "refs/remotes/origin/main", commit]);
}

/** Put `files` on the base commit and push origin/main. The members start from the same base. */
async function base(world: World, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files))
    await writer(world.repo.folder)(path, content);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** Member `login`'s machine: start `branch` in another clone of the same repo. The runner is kept off while it fetches. */
async function member(
  world: World,
  login: string,
  branch: string,
  extra: {
    sandbox?: Sandbox;
    quietMs?: number;
    mergeCheck?: "on" | "off";
  } = {},
) {
  world.github.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, undefined, undefined, extra);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  await desk.start();
  return { as, desk };
}

/** Find indirect conflict (guessed) alerts by the other member of the two works. */
async function indirect(as: As) {
  const messages = (await call(as, api.posts)).posts.map((p) => p.message);
  return messages.flatMap((m) =>
    m.kind === "alert" && m.alert.kind === "indirect" ? [m.alert as Indirect] : [],
  );
}

/** Wait until one indirect conflict alert with `login` passes `check`. */
const alertWith = (as: As, login: string, check: (alert: Indirect) => void = () => {}) =>
  eventually(async () => {
    const found = (await indirect(as)).filter(
      (a) =>
        a.resolved === null &&
        a.works.some((w) => w.login === login) &&
        a.works.some((w) => w.login === "owner"),
    );
    assert.equal(found.length, 1, JSON.stringify(found));
    const [alert] = found as [Indirect];
    check(alert);
    return alert;
  }, 30_000);

/** Wait until an indirect conflict alert with `login` passes the merge run and closes as lifted. The passed check command remains. */
const closedWith = (as: As, login: string) =>
  eventually(async () => {
    const found = (await indirect(as)).filter(
      (a) => a.works.some((w) => w.login === login) && a.works.some((w) => w.login === "owner"),
    );
    const last = found.at(-1);
    assert.ok(last && last.resolved !== null, JSON.stringify(found));
    assert.equal(last.run?.verdict, "pass");
    assert.equal(last.run?.check, "sh check.sh");
    return last;
  }, 30_000);

/** Only the news lines of the mailbox in the added text (the CLI's reply). */
const inboxLines = (output: string) =>
  output.split("<omagari-inbox>\n")[1]?.split("\n</omagari-inbox>")[0]?.split("\n") ?? [];

/** Run `omagari status` in `cwd` repeatedly and wait until a line starting with `prefix` is handed to the mailbox. */
async function receives(world: World, cwd: string, prefix: string) {
  await eventually(async () => {
    const lines = inboxLines((await world.cliIn(cwd, "status")).stdout);
    assert.ok(
      lines.some((line) => line.startsWith(prefix)),
      JSON.stringify(lines),
    );
  });
}

test("when a pair with a guessed indirect conflict settles, the user's runner merges the two works and runs the check command, and the verdict is attached to the alert and both mailboxes", {
  timeout: 150_000,
}, async (t) => {
  const fake = fakeSandbox();
  // Shorten the check command's limit so a failure with the gate unopened doesn't take long.
  const world = await startWorld({
    observeMs: 50,
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
    checkLimits: { checkMs: 20_000 },
  });
  t.after(world.stop);
  const gate = (await place(t))("gate");
  // Check command: write the merged folder's src, wait until the gate opens, and break if pay gained currency while the owner's new file calls pay(1).
  // So bob's work alone or the owner's work alone passes (the break in ADR-0035).
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": `ls src
while [ ! -e ${gate} ]; do sleep 0.05; done
if grep -q currency src/pay.ts && grep -qs "pay(1)" src/draft.ts; then echo "pay(1) is missing currency"; exit 1; fi
`,
  });
  // The owner uses pay and refund. There is an unpushed commit and an uncommitted new file.
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  await writer(folder)("src/committed.ts", "export const a = 1;\n");
  await git("add", ".");
  await git("commit", "--message=unpushed commit");
  const DRAFT = `import { pay } from "./pay";\npay(1);\n`;
  await writer(folder)("src/draft.ts", DRAFT);
  // bob changes pay's definition line and carol changes refund's, uncommitted. Their runners' settle time is long (2 minutes by default), so this test doesn't run them.
  const bob = await member(world, "bob", "currency");
  t.after(bob.desk.remove);
  const carol = await member(world, "carol", "reason");
  t.after(carol.desk.remove);
  await writer(bob.desk.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );
  await writer(bob.desk.folder)("src/bob.ts", "export const bob = 1;\n");
  await writer(carol.desk.folder)(
    "src/pay.ts",
    PAY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );

  // Right after the alert stands it hasn't settled yet, so it wasn't run.
  const fresh = await alertWith(world.owner, "bob");
  assert.equal(fresh.run, undefined);
  assert.equal(fake.calls.length, 0);
  await alertWith(world.owner, "carol");
  // Set aside that the alert first went in. After the verdict, see whether it goes in again.
  const OWNER_SEES = `- Indirect conflict (estimated): my Work and bob's branch "currency"`;
  const BOB_SEES = `- Indirect conflict (estimated): my Work and owner's branch "payment"`;
  await receives(world, folder, OWNER_SEES);
  await receives(world, bob.desk.folder, BOB_SEES);

  // Once settled it runs one pair. While running it's "running a merge run", and the runner runs only one at a time.
  const first = await eventually(async () => {
    const runs = (await indirect(world.owner)).flatMap((a) =>
      a.run && a.works.some((w) => w.login === "owner") ? [a] : [],
    );
    assert.equal(runs.length, 1);
    return runs[0] as Indirect;
  });
  assert.equal(first.run?.verdict, "running", JSON.stringify(first.run));
  assert.equal(first.run?.check, "sh check.sh");
  assert.equal(first.run?.login, "owner");
  assert.equal(first.run?.stale, false);
  assert.equal(first.confirmed, false);
  // "Running a merge run" goes up before the temporary worktree is prepared, so wait until it reaches the sandbox, then check that only one runs.
  await eventually(() => assert.equal(fake.calls.length, 1));
  await sleep(QUIET_MS * 2);
  assert.equal(fake.calls.length, 1);
  assert.equal((await indirect(world.owner)).filter((a) => a.run).length, 1);

  // Opening the gate gives the verdicts. The pair with bob breaks; run separately both pass, so it's Confirmed, and the end of the output is attached. The pair with carol passes and closes.
  await writeFile(gate, "");
  const broken = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "broken"));
  assert.equal(broken.confirmed, true);
  assert.equal(broken.run?.stale, false);
  assert.deepEqual(broken.run?.omitted, []);
  assert.equal(typeof broken.run?.ms, "number");
  // The merged one has all of bob's uncommitted changes and the owner's unpushed commit and uncommitted new file.
  assert.match(
    broken.run?.output ?? "",
    /bob\.ts\ncommitted\.ts\ndraft\.ts\npay\.ts\nuse\.ts\npay\(1\) is missing currency$/,
  );
  assert.equal(broken.run?.alone, undefined);
  const passed = await closedWith(world.owner, "carol");
  assert.equal(passed.confirmed, false);
  // Besides the two merged runs, two more were run separately, only for the broken one.
  assert.equal(fake.calls.length, 4);

  // When the verdict changes it goes into both works' mailboxes again and comes over in a CLI reply.
  // A break puts the verdict and the end of the output at the end of the alert line. The output is a JSON string, so line breaks stay as \n.
  // A mailbox is emptied once handed over, so look in the same check that receives the line with the verdict.
  await eventually(async () => {
    const line = inboxLines((await world.cliIn(folder, "status")).stdout).find((l) =>
      l.startsWith(OWNER_SEES),
    );
    assert.ok(line, "no news with the Broken verdict came");
    assert.match(
      line,
      /· Merge run verdict: Broken \(run by member owner, check command "sh check\.sh", \d+s\)\. End of output: "bob\.ts\\ncommitted\.ts\\ndraft\.ts\\npay\.ts\\nuse\.ts\\npay\(1\) is missing currency"$/,
    );
  });
  await receives(world, bob.desk.folder, BOB_SEES);

  // The same content isn't run again.
  await sleep(QUIET_MS * 2);
  assert.equal(fake.calls.length, 4);

  // Even if bob's runner goes off, it runs from the observation left on the server. When the owner fixes it, the old verdict becomes a stale result, and once settled it runs again and passes.
  await bob.desk.stop();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "bob" && w.offlineSince)),
  );
  // Close the gate during the re-run so the stale alert can be seen before it closes straight to pass (#153).
  await rm(gate);
  await writer(folder)("src/draft.ts", DRAFT.replace("pay(1);", 'pay(1, "krw");'));
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "broken");
    assert.equal(a.run?.stale, true);
    assert.equal(a.confirmed, true);
  });
  await writeFile(gate, "");
  const fixed = await closedWith(world.owner, "bob");
  assert.equal(fixed.run?.stale, false);
  assert.equal(fixed.confirmed, false);
  // The owner's fix makes carol's pair run again with the new fingerprint. The runner runs one at a time, so it can run after bob's verdict.
  // Waiting only for bob's pass reads the metrics before carol's new verdict reaches the server (#135). Wait until carol's alert, closed as passed, shows the verdict for the new fingerprint.
  await eventually(async () => {
    const found = (await indirect(world.owner)).filter(
      (a) => a.works.some((w) => w.login === "carol") && a.works.some((w) => w.login === "owner"),
    );
    const last = found.at(-1);
    assert.equal(last?.run?.verdict, "pass", JSON.stringify(found));
    assert.notEqual(last?.run?.fingerprint, passed.run?.fingerprint);
  }, 30_000);

  // The merged runs stay in the run log: two works, check command, verdict.
  const log = (await world.cli("runner", "log")).stdout;
  assert.match(
    log,
    /check command "sh check\.sh" {2}merge run payment \+ currency of bob {2}folder .+ {2}verdict Broken /,
  );
  assert.match(log, /merge run payment \+ reason of carol {2}folder .+ {2}verdict Pass /);
  assert.match(log, /merge run payment \+ currency of bob {2}folder .+ {2}verdict Pass /);

  // Metrics: four were run today. bob's break, carol's pass, and carol's and bob's passes re-run after the owner's fix. Running ones and re-posted ones (same fingerprint) aren't counted.
  await world.signInCli(world.owner);
  const shown = await world.cli("metrics", "--days", "1");
  assert.equal(shown.code, 0, shown.stderr);
  const [header, today] = shown.stdout.trimEnd().split("\n");
  assert.equal(
    header,
    "Date (Asia/Seoul)  Members joined  Q&As  Merge runs  Pass  Broken  Can't tell  Couldn't run  Debates opened  Ended (experiment)  Ended (evidence)  Ended (human)  Ended (expired)  Decision PRs",
  );
  assert.match(
    today ?? "",
    /^\d{4}-\d{2}-\d{2} {2}\d+ {2}\d+ {2}4 {2}3 {2}1 {2}0 {2}0(?: {2}\d+){6}$/,
  );
});

test("with no check command, no usable sandbox, or lines that collide, it says not run with the reason; missing files are left out and noted; and below the full share level the output isn't uploaded", {
  timeout: 150_000,
}, async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({
    observeMs: 50,
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
    share: "declared",
  });
  t.after(world.stop);
  await base(world, { "src/pay.ts": PAY, "src/use.ts": USE });
  const bob = await member(world, "bob", "currency");
  t.after(bob.desk.remove);
  await writer(bob.desk.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)("src/draft.ts", "export const b = 1;\n");

  // The default branch has no check command.
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.match(a.run?.reason ?? "", /The default branch \(origin\/main\) has no \.omagari\.json/);
  });

  // It runs again once the check command is merged. If the sandbox is unusable, it isn't confined and isn't run.
  fake.unavailable = "sandbox tool is missing: bubblewrap";
  mergeToMain(world.repo.folder, {
    ".omagari.json": `${JSON.stringify({ check: CHECK2 })}\n`,
  });
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.equal(a.run?.reason, "sandbox tool is missing: bubblewrap");
    assert.equal(a.run?.check, CHECK2);
  });
  assert.equal(fake.calls.length, 0);

  // A file missing the other side's content (binary) is run without that file and noted. Such a verdict isn't Confirmed even if it breaks. The owner is declared, so the output isn't uploaded.
  fake.unavailable = undefined;
  await writer(bob.desk.folder)("logo.bin", Buffer.from([0, 1, 2, 0]));
  const broken = await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "broken");
    assert.deepEqual(a.run?.omitted, ["logo.bin"]);
  });
  assert.equal(broken.confirmed, false);
  assert.equal(broken.run?.output, undefined);
  assert.equal(fake.calls.length, 3);

  // With a missing file, it doesn't close even on a pass.
  await rm(join(world.repo.folder, "src/draft.ts"));
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "pass");
    assert.equal(a.run?.stale, false);
  });
  assert.equal(fake.calls.length, 4);

  // If two works change the same line and can't merge, it's not run, with the reason attached.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: string)"),
  );
  await alertWith(world.owner, "bob", (a) => {
    assert.equal(a.run?.verdict, "not_run");
    assert.equal(a.run?.reason, "Lines conflict, so it can't merge: src/pay.ts");
  });
  assert.equal(fake.calls.length, 4);
});

test("a pair with only a direct conflict and the side that changed the definition aren't run, and a runner with merge runs turned off doesn't run either", {
  timeout: 60_000,
}, async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({
    observeMs: 50,
    sandbox: fake.sandbox,
    quietMs: 0,
  });
  t.after(world.stop);
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    "notes.txt": "a\nb\n",
    ".omagari.json": `${JSON.stringify({ check: "true" })}\n`,
  });
  // carol and the owner change the same line, so only a direct conflict is raised.
  const carol = await member(world, "carol", "notes");
  t.after(carol.desk.remove);
  await writer(carol.desk.folder)("notes.txt", "carol\nb\n");
  // bob uses pay and the owner changes pay's definition line. The runner of bob, the user, has merge runs turned off.
  const bobSandbox = fakeSandbox();
  const bob = await member(world, "bob", "more", {
    sandbox: bobSandbox.sandbox,
    quietMs: 0,
    mergeCheck: "off",
  });
  t.after(bob.desk.remove);
  await writer(bob.desk.folder)("src/use.ts", `${USE}pay(2);\n`);
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)("notes.txt", "owner\nb\n");
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );

  await alertWith(world.owner, "bob");
  await eventually(async () => {
    const messages = (await call(world.owner, api.posts)).posts.map((p) => p.message);
    assert.ok(messages.some((m) => m.kind === "alert" && m.alert.kind === "direct"));
  });
  await sleep(1500);
  assert.equal((await alertWith(world.owner, "bob")).run, undefined);
  assert.equal(fake.calls.length, 0);
  assert.equal(bobSandbox.calls.length, 0);
});

/** Whether the member list shows the "breaks when merged" mark on `login`'s `branch` work. */
async function brokenMark(world: World, login: string, branch: string) {
  const { members } = await call(world.owner, api.members);
  return members.find((m) => m.login === login)?.works.find((w) => w.branch === branch)?.broken;
}

test("when the merge breaks, the two works are run separately to sort it out: it's Confirmed only if both pass; on a pass the alert closes and doesn't stand again until the re-run verdict comes", {
  timeout: 240_000,
}, async (t) => {
  const fake = fakeSandbox();
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
  });
  t.after(world.stop);
  fake.blocksUnixSockets = true; // like Linux
  const hold = (await place(t))("hold");
  // The merged one breaks if bob's currency and the owner's pay(1) are together. The side with a marker file breaks even alone. While `hold` exists it waits.
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": `while [ -e ${hold} ]; do sleep 0.05; done
if [ -e src/owner-oops ]; then echo "Error: listen EPERM: operation not permitted /tmp/x.sock"; exit 1; fi
if [ -e src/bob-oops ]; then echo breaks even alone; exit 1; fi
if grep -q currency src/pay.ts && grep -qs "pay(1)" src/draft.ts; then echo breaks when merged; exit 1; fi
`,
  });
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  const DRAFT = `import { pay } from "./pay";\npay(1);\n`;
  const write = writer(folder);
  await write("src/draft.ts", DRAFT);
  await write("src/owner-oops", "");
  const bob = await member(world, "bob", "currency");
  t.after(bob.desk.remove);
  const bobWrite = writer(bob.desk.folder);
  await bobWrite(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );

  // The owner's work breaks even alone: it can't be sorted out and stays a guess.
  const mine = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "unclear"));
  assert.deepEqual(mine.run?.alone, ["mine"]);
  assert.equal(mine.confirmed, false);
  assert.equal(fake.calls.length, 3);
  // It broke from the socket block, so the reason is attached (#163). It isn't attached to bob's, which broke regardless of sockets.
  assert.match(mine.run?.reason ?? "", /On this machine \(Linux\) the sandbox blocks Unix sockets/);

  // bob's work breaks even alone: it can't be sorted out and that side is noted.
  await rm(join(folder, "src/owner-oops"));
  await bobWrite("src/bob-oops", "");
  const theirs = await alertWith(world.owner, "bob", (a) =>
    assert.deepEqual(a.run?.alone, ["theirs"]),
  );
  assert.equal(theirs.run?.verdict, "unclear");
  assert.equal(theirs.run?.reason, undefined);
  assert.equal(theirs.confirmed, false);
  assert.equal(fake.calls.length, 6);
  assert.equal(await brokenMark(world, "owner", "payment"), false);
  // While it's a guess, the post is a reference with only the kind label, so it shows in the "Reference" forum and has no issue.
  const forums = Object.fromEntries(
    (await call(world.owner, api.channels)).channels.map((c) => [c.name, c.id]),
  );
  const guessed = (await call(world.owner, api.posts)).posts[0];
  assert.deepEqual(guessed?.labels, ["Indirect conflict"]);
  assert.equal(guessed?.importance, "reference");
  assert.deepEqual(guessed?.forums, [forums.FYI]);
  assert.equal(guessed?.issue, null);
  assert.equal(guessed?.debate, null); // no debate opens on a guess (ADR-0040)
  assert.equal(world.github.issues.length, 0);

  // When bob fixes it, both pass alone, so it breaks and is Confirmed. Both works have the same content as the earlier solo runs (the owner's just before, bob's first), so they aren't run separately.
  await rm(join(bob.desk.folder, "src/bob-oops"));
  const broken = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "broken"));
  assert.equal(broken.confirmed, true);
  assert.equal(broken.run?.alone, undefined);
  assert.equal(fake.calls.length, 7);
  // Once Confirmed and discussed, the issue with the post's label opens and one verdict comment is added. The same verdict coming repeatedly doesn't add more, and the comment doesn't come in as the post's text.
  const issue = await eventually(() => {
    const [opened] = world.github.issues;
    assert.ok(opened);
    assert.deepEqual(opened.labels, ["Indirect conflict", "Confirmed"]);
    assert.equal(opened.comments.length, 1);
    return opened;
  });
  assert.match(issue.comments[0]?.body ?? "", /The merge run broke/);
  assert.match(issue.comments[0]?.body ?? "", /`sh check\.sh`/);
  assert.match(issue.comments[0]?.body ?? "", /```\nbreaks when merged\n```/);
  await sleep(300);
  assert.equal(issue.comments.length, 1);
  const [post] = (await call(world.owner, api.posts)).posts;
  assert.ok(post?.issue?.labels.includes("Confirmed"));
  assert.deepEqual(post?.labels, ["Indirect conflict", "Confirmed"]);
  assert.equal(post?.importance, "discuss");
  // Once discussed it leaves the "Reference" forum and shows in the "Discuss" forum (ADR-0039).
  assert.deepEqual(post?.forums, [forums.Discuss]);
  // Once Confirmed, a debate opens with the two works' owner agents (ADR-0040).
  assert.deepEqual(post?.debate?.seats.map((seat) => seat.login).sort(), ["bob", "owner"]);
  const thread = await call(world.owner, api.history, {
    channel: post?.message.channel ?? "",
  });
  assert.ok(!thread.messages.some((m) => "github" in m && m.github));
  // The member list mark goes on the two broken works.
  await eventually(async () => {
    assert.equal(await brokenMark(world, "owner", "payment"), true);
    assert.equal(await brokenMark(world, "bob", "currency"), true);
  });

  // When the owner fixes it, the merged one passes and isn't run separately. The alert closes as lifted and goes into both mailboxes, and the mark goes away.
  await write("src/draft.ts", DRAFT.replace("pay(1);", 'pay(1, "krw");'));
  await closedWith(world.owner, "bob");
  assert.equal(fake.calls.length, 8);
  // On a pass the label is removed, the issue closes, and the passed check command is left in the comment.
  await eventually(() => {
    assert.ok(!issue.labels.includes("Confirmed"));
    assert.equal(issue.open, false);
    assert.equal(issue.comments.length, 2);
  });
  assert.match(issue.comments[1]?.body ?? "", /The merge run passed[\s\S]*`sh check\.sh`/);
  // It closed that alert without making a new one.
  const withBob = async () =>
    (await indirect(world.owner)).filter((a) => a.works.some((w) => w.login === "bob")).length;
  assert.equal(await withBob(), 1);
  await receives(
    world,
    folder,
    `- Resolved: my Work and bob's branch "currency"'s Indirect conflict (guessed)`,
  );
  await receives(
    world,
    bob.desk.folder,
    `- Resolved: my Work and owner's branch "payment"'s Indirect conflict (guessed)`,
  );
  await eventually(async () => {
    assert.equal(await brokenMark(world, "owner", "payment"), false);
    assert.equal(await brokenMark(world, "bob", "currency"), false);
  });
  // While the content stays the same it doesn't stand again.
  await sleep(QUIET_MS * 2);
  const open = async () => (await indirect(world.owner)).filter((a) => a.resolved === null);
  assert.deepEqual(await open(), []);

  // Even if the content changes it doesn't stand until the re-run verdict comes. If the re-run breaks, a new Confirmed alert stands.
  await writeFile(hold, "");
  await write("src/draft.ts", `${DRAFT}pay(2);\n`);
  await eventually(() => assert.equal(fake.calls.length, 9), 30_000);
  await sleep(QUIET_MS);
  assert.deepEqual(await open(), []);
  await rm(hold);
  const again = await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "broken"));
  assert.equal(await withBob(), 2);
  assert.equal(again.confirmed, true);
  // Only the owner ran once more. What only bob ran was run before with the same content.
  assert.equal(fake.calls.length, 10);
  const reopened = await eventually(() => {
    const opened = world.github.issues[1];
    assert.ok(opened?.labels.includes("Confirmed"));
    return opened;
  });

  // If Confirmed is lifted (can't be sorted out) and it drops to reference, the issue isn't closed while an alert remains. Confirmed is removed from the post and the issue.
  await write("src/owner-oops", "");
  await alertWith(world.owner, "bob", (a) => assert.equal(a.run?.verdict, "unclear"));
  await eventually(async () => {
    const now = (await call(world.owner, api.posts)).posts.at(-1);
    assert.deepEqual(now?.labels, ["Indirect conflict"]);
    assert.equal(now?.importance, "reference");
    assert.ok(!reopened.labels.includes("Confirmed"));
  });
  assert.equal(reopened.open, true);
  await rm(join(folder, "src/owner-oops"));

  // After closing on a pass again, if cannot-tell comes up, a new guessed alert stands. Both were run before with the same content, so the old verdicts are reused.
  await write("src/draft.ts", DRAFT.replace("pay(1);", 'pay(1, "krw");'));
  await closedWith(world.owner, "bob");
  await write("src/draft.ts", DRAFT);
  await write("src/owner-oops", "");
  const unclear = await alertWith(world.owner, "bob", (a) =>
    assert.equal(a.run?.verdict, "unclear"),
  );
  assert.equal(await withBob(), 3);
  assert.equal(unclear.confirmed, false);

  // Metrics: only verdicts with different fingerprints are counted. One pass, two breaks, three cannot-tell. Old-content verdicts reused aren't counted.
  await world.signInCli(world.owner);
  const shown = await world.cli("metrics", "--days", "1");
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(
    shown.stdout.trimEnd().split("\n")[1] ?? "",
    /^\d{4}-\d{2}-\d{2} {2}\d+ {2}\d+ {2}6 {2}1 {2}2 {2}3 {2}0(?: {2}\d+){6}$/,
  );
});

test("a verdict of the same content that another runner posted is on the server, so it isn't run", {
  timeout: 120_000,
}, async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world, {
    "src/pay.ts": PAY,
    "src/use.ts": USE,
    ".omagari.json": `${JSON.stringify({ check: "sh check.sh" })}\n`,
    "check.sh": "exit 0\n",
  });
  // bob uses pay, so bob's runner runs it. The owner changes pay's definition line.
  const fake = fakeSandbox();
  const bob = await member(world, "bob", "more", {
    sandbox: fake.sandbox,
    quietMs: QUIET_MS,
  });
  t.after(bob.desk.remove);
  await writer(bob.desk.folder)("src/draft.ts", `import { pay } from "./pay";\npay(1);\n`);
  await world.repo.git("switch", "--create", "payment");
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: number, currency: string)"),
  );
  await closedWith(world.owner, "bob");
  assert.equal(fake.calls.length, 1);

  // When bob's runner is back on, it has no memory, but it takes the same-fingerprint verdict attached on the server and doesn't run again.
  await bob.desk.stop();
  await bob.desk.start();
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.login === "bob" && !w.offlineSince)),
  );
  await sleep(QUIET_MS * 4);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(
    (await indirect(world.owner)).filter((a) => a.resolved === null),
    [],
  );
});
