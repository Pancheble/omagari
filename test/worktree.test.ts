import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { eventually, place, startWorld, writer } from "./harness.ts";

// Each worktree calls Git many times and there are five steps, so this gets close to the default time limit (30 s) when run with other tests.
test("branches of the registered folder and its linked worktrees are each observed as work, and adding or removing a worktree is followed", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld({ observeMs: 20 });
  t.after(world.stop);
  const { git, folder } = world.repo;
  const tree = await place(t);
  const base = await git("rev-parse", "origin/main");

  await writer(folder)("main.ts", "main\n");
  // A worktree with no common point with the default branch (an orphan branch with no commits) can't be read. The rest still show up.
  await git("worktree", "add", "--detach", tree("pages"));
  await git("-C", tree("pages"), "switch", "--orphan", "pages");
  // A detached worktree (no branch) has no work.
  await git("worktree", "add", "--detach", tree("detached"));
  await git("worktree", "add", "-b", "feat-a", tree("a"));
  await writer(tree("a"))("a.ts", "a\n");
  await git("worktree", "add", "-b", "feat-b", tree("b"));
  await writer(tree("b"))("b.ts", "b\n");
  await git("-C", tree("b"), "add", "b.ts");
  await git("-C", tree("b"), "commit", "--message=b");

  await eventually(async () =>
    assert.deepEqual(await world.works(world.owner), [
      {
        login: "owner",
        branch: "feat-a",
        base,
        share: "full",
        files: [{ path: "a.ts", content: "a\n" }],
        line: { source: "files", file: "a.ts", more: 0 },
        offlineSince: null,
      },
      {
        login: "owner",
        branch: "feat-b",
        base,
        share: "full",
        files: [{ path: "b.ts", content: "b\n" }],
        line: { source: "files", file: "b.ts", more: 0 },
        offlineSince: null,
      },
      {
        login: "owner",
        branch: "main",
        base,
        share: "full",
        files: [{ path: "main.ts", content: "main\n" }],
        line: { source: "files", file: "main.ts", more: 0 },
        offlineSince: null,
      },
    ]),
  );

  const branches = async () => (await world.works(world.owner)).map((work) => work.branch);
  const follows = (expected: string[]) =>
    eventually(async () => assert.deepEqual(await branches(), expected));

  // Switching branches in a worktree makes that branch the work.
  await git("-C", tree("a"), "switch", "--create", "feat-c");
  await follows(["feat-b", "feat-c", "main"]);

  // Adding a worktree is followed.
  await git("worktree", "add", "-b", "feat-d", tree("d"));
  await follows(["feat-b", "feat-c", "feat-d", "main"]);

  // Removing it with git worktree remove is followed.
  await git("worktree", "remove", "--force", tree("a"));
  await follows(["feat-b", "feat-d", "main"]);

  // Deleting just the folder (Git keeps it as prunable) is followed too.
  await rm(tree("b"), { recursive: true, force: true });
  await follows(["feat-d", "main"]);
});

test("the content total limit (8MiB) counts all worktrees together", async (t) => {
  const world = await startWorld({ observeMs: 20 });
  t.after(world.stop);
  const { git, folder } = world.repo;
  const tree = await place(t);
  await git("worktree", "add", "-b", "feat", tree("feat"));

  // Ten 500KiB files each. Together up to sixteen fit in 8MiB. The registered folder is counted first.
  const parts = Array.from({ length: 10 }, (_, i) => `part-${String(i + 1).padStart(2, "0")}.txt`);
  const content = "p".repeat(500 * 1024);
  for (const part of parts) {
    await writer(folder)(part, content);
    await writer(tree("feat"))(part, content);
  }

  await eventually(async () => {
    const files = Object.fromEntries(
      (await world.works(world.owner)).map((work) => [work.branch, work.files]),
    );
    assert.deepEqual(files, {
      main: parts.map((path) => ({ path, content })),
      feat: parts.map((path, i) => (i < 6 ? { path, content } : { path, omitted: "too_large" })),
    });
  });
});
