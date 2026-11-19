import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { eventually, startWorld, tempRepo, textOf, writer } from "./harness.ts";

// Starts and stops the runner five times with the CLI. Observation is sent right on attach, so it doesn't wait for the interval (3s), but there are many steps, so the time limit is extended.
test("the owner picks a share level per runner and it stays after turning on again. The default is full, declared uploads paths only, intent uploads the work only, and lowering it takes the uploaded content off the server", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // the folder where alice cloned the repo
  t.after(desk.remove);
  const { git, folder } = desk;
  const write = writer(folder);

  await write("gone.ts", "gone\n");
  await git("add", "gone.ts");
  await git("commit", "--message=gone");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  const base = await git("rev-parse", "HEAD");
  await git("switch", "--create", "feat");
  await write("committed.ts", "Committed content\n");
  await git("add", "committed.ts");
  await git("commit", "--message=committed");
  await write("draft.ts", "Uncommitted content\n");
  await write("image.png", new Uint8Array([0x89, 0x50, 0x00]));
  await write(".env.local", "TOKEN=secret\n"); // never goes out at any level
  await rm(join(folder, "gone.ts"));

  /** Turns on alice's runner with `omagari runner <args>`. If it's the first time, it logs in with device login. */
  const launch = async (...args: string[]) => {
    const runner = world.launchCliIn(folder, "runner", ...args);
    t.after(() => runner.stop("SIGKILL"));
    const [, code] = await runner.output(/enter code (\S+) at |Runner started/);
    if (code) {
      world.github.approve(code, "alice");
      await runner.output(/Runner started/);
    }
    return runner;
  };
  /** Alice's work as another member (owner) sees it through the API. The one-line status is seen without its written time. The runner is on, so she isn't offline. */
  const observed = (share: string, files: object[], line: object | null) =>
    eventually(async () =>
      assert.deepEqual(
        (await world.works(world.owner))
          .filter((work) => work.login === "alice")
          .map((work) => ({
            ...work,
            line:
              work.line &&
              (work.line.source === "files"
                ? work.line
                : { source: work.line.source, text: work.line.text }),
          })),
        [
          {
            login: "alice",
            branch: "feat",
            base,
            share,
            files,
            line,
            offlineSince: null,
          },
        ],
      ),
    );
  /** Alice's agent writes a one-line status with `omagari status set` in this folder. */
  const setStatus = async (text: string) => {
    const { code, stderr } = await world.cliIn(folder, "status", "set", text);
    assert.equal(code, 0, stderr);
    return { source: "agent", text };
  };

  // If you don't pick, it's full: content goes up too.
  let runner = await launch();
  await observed(
    "full",
    [
      { path: "committed.ts", content: "Committed content\n" },
      { path: "draft.ts", content: "Uncommitted content\n" },
      { path: "gone.ts", deleted: true },
      { path: "image.png", omitted: "binary" },
    ],
    { source: "files", file: "committed.ts", more: 3 },
  );
  let { stdout } = await runner.stop();
  assert.match(stdout, /Observation \(share level full\)/);

  // Lowering to declared leaves paths only (there are no claimed paths), and content already uploaded comes off the server. The content of claimed paths is checked in claims.test.
  runner = await launch("--share", "declared");
  const declared = [
    { path: "committed.ts", omitted: "share" },
    { path: "draft.ts", omitted: "share" },
    { path: "gone.ts", deleted: true },
    { path: "image.png", omitted: "share" },
  ];
  await observed("declared", declared, {
    source: "files",
    file: "committed.ts",
    more: 3,
  });
  ({ stdout } = await runner.stop());
  assert.match(
    stdout,
    /Observation \(share level declared\): .*the paths of the files changed since it split from the default branch go to the server, and members can see them\. Content goes only for files inside paths that branch has claimed \(omagari claim\)/,
  );

  // Turning it on again without picking keeps the picked level. Files written while it was off also go up as paths only.
  await write("later.ts", "Content written while off\n");
  runner = await launch();
  const later = [...declared, { path: "later.ts", omitted: "share" }];
  await observed("declared", later, { source: "files", file: "committed.ts", more: 4 });
  const fixing = await setStatus("Fixing the payment flow");
  await observed("declared", later, fixing);
  ({ stdout } = await runner.stop());
  assert.match(stdout, /Observation \(share level declared\)/);

  // Lowering to intent takes both paths and content down, leaving only the work (branch) and the one-line status.
  // Files just stop arriving; changes don't become 0, and the line the agent wrote isn't erased.
  runner = await launch("--share=intent");
  await observed("intent", [], fixing);
  await observed("intent", [], await setStatus("Moving on to the refund flow"));
  ({ stdout } = await runner.stop());
  assert.match(
    stdout,
    /Observation \(share level intent\): .*Neither the paths nor the content of changed files go/,
  );

  // A level that doesn't exist isn't accepted, and the runner isn't turned on either.
  const wrong = await world.cliIn(folder, "runner", "--share", "everything");
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /Share level must be one of full, declared, intent: everything/);

  // Raising it again uploads the content.
  runner = await launch("--share", "full");
  await observed(
    "full",
    [
      { path: "committed.ts", content: "Committed content\n" },
      { path: "draft.ts", content: "Uncommitted content\n" },
      { path: "gone.ts", deleted: true },
      { path: "image.png", omitted: "binary" },
      { path: "later.ts", content: "Content written while off\n" },
    ],
    { source: "agent", text: "Moving on to the refund flow" },
  );
  await runner.stop();
});
