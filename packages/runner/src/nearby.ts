// Nearby work: other Work that's changing the file you're about to edit (including my other branches, ADR-0041), and the line ranges that person changed in that file (implementation doc section 4, stage 1 question A7).
// It reads only the situation received from the server. It works out the line ranges by comparing, with this machine's Git, that person's base commit version and the uploaded content.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LineRange, NearbyWork, WorkView } from "@omagari/contract";

const execFileAsync = promisify(execFile);

/** For each Work in `works` that changed `path` and isn't the same Work (`branch` of `login`), reads where it changed. */
export async function nearby(
  folder: string,
  works: WorkView[],
  me: { login: string; branch?: string },
  path: string,
): Promise<NearbyWork[]> {
  const found: NearbyWork[] = [];
  for (const work of works) {
    const same = work.login === me.login && work.branch === me.branch;
    const file = same ? undefined : work.files.find((f) => f.path === path);
    if (!file) continue;
    const change: NearbyWork["change"] =
      "deleted" in file
        ? { kind: "deleted" }
        : "omitted" in file
          ? { kind: "unknown", reason: file.omitted }
          : await changedLines(folder, work.base, path, file.content);
    found.push({ login: work.login, branch: work.branch, offlineSince: work.offlineSince, change });
  }
  return found;
}

/** This machine's Git. It writes nothing to the repo. */
export const gitIn =
  (folder: string) =>
  (...args: string[]) =>
    execFileAsync("git", ["-C", folder, ...args], {
      encoding: "buffer",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });

/** Whether the commit is on this machine. Not there if you haven't fetched someone else's base commit yet. */
export const hasCommit = (folder: string, commit: string) =>
  gitIn(folder)("cat-file", "-e", `${commit}^{commit}`).then(
    () => true,
    () => false,
  );

/** The version of `path` at `commit`. An empty version if the file didn't exist. */
export const blobAt = (folder: string, commit: string, path: string) =>
  gitIn(folder)("cat-file", "blob", `${commit}:${path}`).then(
    ({ stdout }) => stdout,
    () => Buffer.alloc(0),
  );

/**
 * One changed place. `before` is the lines changed in the earlier version (`[from, to)`, an empty range at the insert point if it only inserted),
 * and `after` is the changed place in the later version's line numbers (for a place with only deleted lines, the line before it).
 */
export type Hunk = { before: { from: number; to: number }; after: LineRange; size: number };

/** Compares two versions in a temp folder on this machine and returns the changed places. */
export async function hunks(
  folder: string,
  before: string | Uint8Array,
  after: string | Uint8Array,
): Promise<Hunk[]> {
  const scratch = await mkdtemp(join(tmpdir(), "omagari-diff-"));
  try {
    await Promise.all([
      writeFile(join(scratch, "before"), before),
      writeFile(join(scratch, "after"), after),
    ]);
    // If they differ it exits with 1. That's a result too.
    const diff = await gitIn(folder)(
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--no-color",
      "--text",
      "--unified=0",
      join(scratch, "before"),
      join(scratch, "after"),
    ).then(
      ({ stdout }) => stdout,
      (error) => {
        if (error.code === 1) return error.stdout as Buffer;
        throw error;
      },
    );
    return [...diff.toString().matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(
      ([, old = "0", oldCount = "1", start = "0", count = "1"]) => {
        // A place with only deletions (`+n,0`) and a place with only insertions (`-n,0`) are n lines later.
        const at = Number(oldCount) === 0 ? Number(old) + 1 : Number(old);
        const from = Math.max(Number(start), 1);
        return {
          before: { from: at, to: at + Number(oldCount) },
          after: { from, to: Math.max(from + Number(count) - 1, from) },
          size: Number(count),
        };
      },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Compares the base commit's version (an empty version if the file didn't exist) with `content` and returns the changed places in `content`'s line numbers. */
async function changedLines(
  folder: string,
  base: string,
  path: string,
  content: string,
): Promise<NearbyWork["change"]> {
  // If this machine hasn't fetched that person's base commit, there's no version to compare.
  if (!(await hasCommit(folder, base))) return { kind: "unknown", reason: "base" };
  const found = await hunks(folder, await blobAt(folder, base, path), content);
  return { kind: "lines", ranges: found.map((hunk) => hunk.after) };
}
