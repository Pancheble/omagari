import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { eventually, startWorld, stubbed, tempRepo, writer } from "./harness.ts";

test("committed, uncommitted, and untracked new files go up as that work's changes whether pushed or not, and other members see them through the API", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // A file already on the default branch (pushed)
  await write("kept.ts", "base\n");
  await write("gone.ts", "bye\n");
  await git("add", ".");
  await git("commit", "--message=base");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  const base = await git("rev-parse", "HEAD");

  await git("switch", "--create", "feat");
  await write("pushed.ts", "pushed\n");
  await git("add", "pushed.ts");
  await git("commit", "--message=pushed");
  await git("update-ref", "refs/remotes/origin/feat", "HEAD"); // a pushed commit
  await write("committed.ts", "committed\n");
  await git("add", "committed.ts");
  await git("commit", "--message=committed"); // an unpushed commit
  await write("staged.ts", "staged\n");
  await git("add", "staged.ts");
  await write("kept.ts", "base\nchanged\n");
  await write("src/new.ts", "new\n");
  await rm(join(folder, "gone.ts"));

  await eventually(async () =>
    assert.deepEqual(await world.works(alice), [
      {
        login: "owner",
        branch: "feat",
        base,
        share: "full",
        // The path, content, and whether it was deleted come through. It's a file with no definitions, so there's no definition line.
        files: [
          { path: "committed.ts", content: "committed\n" },
          { path: "gone.ts", deleted: true },
          { path: "kept.ts", content: "base\nchanged\n" },
          { path: "pushed.ts", content: "pushed\n" },
          { path: "src/new.ts", content: "new\n" },
          { path: "staged.ts", content: "staged\n" },
        ],
        line: { source: "files", file: "committed.ts", more: 5 },
        offlineSince: null,
      },
    ]),
  );

  // A non-member can't see it.
  await assert.rejects(call(world.server, api.works), { code: "unauthorized" });
  await assert.rejects(call({ url: world.server.url, session: "made-up-session" }, api.works), {
    code: "unauthorized",
  });
});

test("the base commit is where it forked from the default branch (remote-tracking). Others' changes that landed on the default branch after that don't get mixed in", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  const forkPoint = await git("rev-parse", "origin/main");

  // A commit only on local main isn't on the default branch (remote-tracking), so it's a change in this work.
  await write("local.ts", "local\n");
  await git("add", "local.ts");
  await git("commit", "--message=local");
  await git("switch", "--create", "feat");
  await write("mine.ts", "mine\n");
  await git("add", "mine.ts");
  await git("commit", "--message=mine");
  // Someone else merged into the default branch and the owner got it with fetch.
  await git("switch", "--detach", forkPoint);
  await write("theirs.ts", "theirs\n");
  await git("add", "theirs.ts");
  await git("commit", "--message=theirs");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("switch", "feat");

  await eventually(async () =>
    assert.deepEqual(await world.works(world.owner), [
      {
        login: "owner",
        branch: "feat",
        base: forkPoint,
        share: "full",
        files: [
          { path: "local.ts", content: "local\n" },
          { path: "mine.ts", content: "mine\n" },
        ],
        line: { source: "files", file: "local.ts", more: 1 },
        offlineSince: null,
      },
    ]),
  );
});

test("gitignored files and .env, .env.* don't go up even if tracked. .env.example goes up", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);

  await write(".gitignore", "secret.txt\nbuild/\n");
  await write("secret.txt", "gitignored file\n");
  await write("build/out.js", "gitignored folder\n");
  await write(".env", "TOKEN=tracked\n");
  await git("add", ".env");
  await git("commit", "--message=env"); // the tracked .env
  await write(".env", "TOKEN=changed\n");
  await write(".env.local", "TOKEN=local\n");
  await write("config/.env.production", "TOKEN=prod\n");
  await write(".env.d/keys", "TOKEN=dir\n");
  await write(".env.example", "TOKEN=\n");

  await eventually(async () =>
    assert.deepEqual(await world.works(world.owner), [
      {
        login: "owner",
        branch: "main",
        base: await git("rev-parse", "origin/main"),
        share: "full",
        files: [
          { path: ".env.example", content: "TOKEN=\n" },
          { path: ".gitignore", content: "secret.txt\nbuild/\n" },
        ],
        line: { source: "files", file: ".env.example", more: 1 },
        offlineSince: null,
      },
    ]),
  );
});

test("binaries and files over the size caps (512KiB per file, 8MiB total) go up as paths only", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const write = writer(world.repo.folder);
  const KiB = 1024;

  await write("image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await write("latin1.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9])); // not UTF-8
  await write("utf16.txt", Buffer.from("hi", "utf16le")); // reads as UTF-8 but has NULs
  await write("bom.txt", "﻿First line\n"); // the BOM comes through as is
  await write("edge.txt", "e".repeat(512 * KiB)); // exactly the cap: content comes through
  await write("huge.txt", "h".repeat(512 * KiB + 1)); // over the cap
  // Total: edge.txt and part-01 to part-15 fit within 8MiB. part-16 and part-17 go over and are paths only, and the small small.txt after them gets in.
  const parts = Array.from({ length: 17 }, (_, i) => `part-${String(i + 1).padStart(2, "0")}.txt`);
  for (const part of parts) await write(part, "p".repeat(500 * KiB));
  await write("small.txt", "s\n");

  await eventually(async () => {
    const [work] = await world.works(world.owner);
    assert.deepEqual(work?.files, [
      { path: "bom.txt", content: "﻿First line\n" },
      { path: "edge.txt", content: "e".repeat(512 * KiB) },
      { path: "huge.txt", omitted: "too_large" },
      { path: "image.png", omitted: "binary" },
      { path: "latin1.txt", omitted: "binary" },
      ...parts.map((path, i) =>
        i < 15 ? { path, content: "p".repeat(500 * KiB) } : { path, omitted: "too_large" },
      ),
      { path: "small.txt", content: "s\n" },
      { path: "utf16.txt", omitted: "binary" },
    ]);
  });
});

// The observation interval is the runner's default (3s). Each step must follow within 5s, and there are five steps, so the time limit is extended.
test("when you edit a file, commit, or switch branches, the server's observation follows within a few seconds", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  const filesOf = async () =>
    Object.fromEntries((await world.works(world.owner)).map((work) => [work.branch, work.files]));
  const follows = (expected: object) =>
    eventually(async () => assert.deepEqual(await filesOf(), expected), 5000);

  await git("switch", "--create", "feat");
  await write("a.ts", "1\n");
  await follows({ feat: [{ path: "a.ts", content: "1\n" }] });
  await write("a.ts", "2\n");
  await follows({ feat: [{ path: "a.ts", content: "2\n" }] });

  // Making a commit that reverts a commit leaves no changes.
  await git("add", "a.ts");
  await git("commit", "--message=a");
  await git("revert", "--no-edit", "HEAD");
  await follows({ feat: [] });

  // Switching branches makes that branch the work.
  await git("switch", "--create", "other", "origin/main");
  await write("b.ts", "b\n");
  await follows({ other: [{ path: "b.ts", content: "b\n" }] });

  // If it isn't a branch (detached HEAD), there is no work.
  await git("switch", "--detach");
  await follows({});
});

test("the runner doesn't change any file in the working folder", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk = await tempRepo(); // the folder where alice cloned the repo. The runner hasn't seen it yet.
  t.after(desk.remove);
  const { git, folder } = desk;
  const write = writer(folder);

  await write("tracked.ts", "tracked\n");
  await git("add", "tracked.ts");
  await git("commit", "--message=tracked");
  await write("staged.ts", "staged\n");
  await git("add", "staged.ts");
  await write("untracked.ts", "untracked\n");
  // A file whose content is the same and only the time changed. With git status, that's a state where the index gets rewritten as a bonus.
  const later = new Date(Date.now() + 60_000);
  await utimes(join(folder, "tracked.ts"), later, later);

  /** Path, content, and modified time of every file in the folder (.git included). Leaves out the run log spot the runner keeps (.git/omagari). */
  const snapshot = async () => {
    const entries = await readdir(folder, {
      recursive: true,
      withFileTypes: true,
    });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !relative(folder, path).startsWith(join(".git", "omagari")))
      .sort();
    return Promise.all(
      files.map(async (path) => [
        relative(folder, path),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        (await stat(path)).mtimeMs,
      ]),
    );
  };
  const before = await snapshot();

  const runner = await startRunner({
    serverUrl: world.server.url,
    folder,
    session: alice.session,
    observeMs: 20,
    ...stubbed(),
  });
  t.after(runner.stop);
  await eventually(async () => {
    const [work] = (await world.works(alice)).filter((w) => w.login === "alice");
    assert.equal(work?.files.length, 3);
  });
  await sleep(200); // observation runs several times
  await runner.stop();
  assert.deepEqual(await snapshot(), before);
});

test("when turning on the runner, it tells the owner what goes to the server before logging in", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // the folder where alice cloned the repo
  t.after(desk.remove);
  await writer(desk.folder)("hello.ts", "hello\n");

  const runner = world.launchCliIn(desk.folder, "runner");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/enter code (\S+) at/);
  world.github.approve(code, "alice");
  await runner.output(/Runner started/);
  await eventually(async () =>
    assert.deepEqual(
      (await world.works(world.owner)).filter((work) => work.login === "alice"),
      [
        {
          login: "alice",
          branch: "main",
          base: await desk.git("rev-parse", "origin/main"),
          share: "full",
          files: [{ path: "hello.ts", content: "hello\n" }],
          line: { source: "files", file: "hello.ts", more: 0 },
          offlineSince: null,
        },
      ],
    ),
  );

  const { stdout } = await runner.stop();
  const notice = stdout.slice(0, stdout.indexOf("GitHub login"));
  assert.match(
    notice,
    /the paths and content of the files changed since it split from the default branch go to the server/,
  );
  assert.match(
    notice,
    /Committed changes, uncommitted changes, and new untracked files are all sent/,
  );
  assert.match(
    notice,
    /Not sent: gitignored files and \.env, \.env\.\* \(\.env\.example is sent\)/,
  );
  assert.match(
    notice,
    /Paths only: binaries, files over 512KiB, and whatever goes over the 8MiB total/,
  );
});

test("a path Git sees as deleted isn't read from disk again: both a file that was untracked and gitignored and a file beyond a folder turned into a link go up only as deleted", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // Two files that were on the default branch
  await write("config/local.json", "{}\n");
  await write("docs/notes.md", "notes\n");
  await git("add", ".");
  await git("commit", "--message=base");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("switch", "--create", "feat");

  // After untracking and gitignoring, put a secret in the local version.
  await git("rm", "--cached", "--quiet", "config/local.json");
  await write(".gitignore", "config/local.json\n");
  await write("config/local.json", "IGNORED-SECRET\n");
  // Change a folder that was tracked into a link pointing outside the repo.
  const outside = await realpath(await mkdtemp(join(tmpdir(), "omagari-outside-")));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writer(outside)("notes.md", "OUTSIDE-REPO\n");
  await rm(join(folder, "docs"), { recursive: true });
  await symlink(outside, join(folder, "docs"));

  const files = await eventually(async () => {
    const [work] = await world.works(alice);
    assert.ok(work?.files.some((f) => f.path === ".gitignore"));
    return work.files;
  });
  assert.deepEqual(
    files.filter((f) => f.path === "config/local.json" || f.path === "docs/notes.md"),
    [
      { path: "config/local.json", deleted: true },
      { path: "docs/notes.md", deleted: true },
    ],
  );
  assert.doesNotMatch(JSON.stringify(files), /IGNORED-SECRET|OUTSIDE-REPO/);
});
