// Observation: for each Work, reads the changed files and their content from the Git state of the registered folder and its linked worktrees (ADR-0002, ADR-0006, ADR-0007).
// Read-only. It doesn't write any file in the work folder, nor the index refresh Git does on the side.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ObservedFile, ShareLevel, Work } from "@omagari/contract";
import { compare, parsable, usesIn } from "./symbols.ts";

const execFileAsync = promisify(execFile);

/** Upper limit on one file's content. Past it, only the path is sent. It starts from Room's value (ADR-0007). */
export const FILE_LIMIT = 512 * 1024;
/** Upper limit on the total content sent at once. Counted across all worktrees. What goes over is sent as paths only. Counted in bytes of the form that's sent (a JSON string). */
export const TOTAL_LIMIT = 8 * 1024 * 1024;

const ALWAYS = `  Committed changes, uncommitted changes, and new untracked files are all sent. Unpushed changes are sent too.
  Not sent: gitignored files and .env, .env.* (.env.example is sent).`;

/** What the owner is told when the runner starts: what goes to the server at this share level. */
export function observationNotice(share: ShareLevel) {
  const what = {
    full: `For each branch in this folder and its linked worktrees, the paths and content of the files changed since it split from the default branch go to the server, and members can see them.
${ALWAYS}
  Paths only: binaries, files over ${FILE_LIMIT / 1024}KiB, and whatever goes over the ${TOTAL_LIMIT / 1024 / 1024}MiB total.`,
    declared: `For each branch in this folder and its linked worktrees, the paths of the files changed since it split from the default branch go to the server, and members can see them. Content goes only for files inside paths that branch has claimed (omagari claim).
${ALWAYS}
  Paths only: files outside claimed paths, binaries, files over ${FILE_LIMIT / 1024}KiB, and whatever goes over the ${TOTAL_LIMIT / 1024 / 1024}MiB total.`,
    intent: `Only each branch's name and base commit in this folder and its linked worktrees, plus the status line the agent wrote, go to the server. Neither the paths nor the content of changed files go.`,
  }[share];
  return `Observation (share level ${share}): ${what}
  You pick the share level with omagari runner --share <full|declared|intent>. Your pick is kept in this repo.`;
}

/** Always left out even if tracked: any path segment that is `.env` or starts with `.env.`. `.env.example` stays. */
export const secret = (path: string) =>
  path
    .split("/")
    .some((part) => part === ".env" || (part.startsWith(".env.") && part !== ".env.example"));

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** The text if it's text, or none if it's binary (it has a NUL or isn't UTF-8). */
function asText(bytes: Buffer) {
  if (bytes.includes(0)) return;
  try {
    return utf8.decode(bytes);
  } catch {
    return;
  }
}

const git = async (folder: string, ...args: string[]) =>
  (
    await execFileAsync("git", ["-C", folder, ...args], {
      // Doesn't do side writes that need a lock, like the index refresh.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;

/** The registered folder and the folders of its linked worktrees. Leaves out ones whose folder is gone (prunable) and ones with no working tree (bare). */
async function worktrees(folder: string) {
  // -z: lines end with NUL, and one more NUL comes after each worktree. Paths with newlines are read as they are.
  const list = await git(folder, "worktree", "list", "--porcelain", "-z");
  return list.split("\0\0").flatMap((record) => {
    const [first = "", ...attributes] = record.split("\0");
    const gone = attributes.some((line) => line === "bare" || line.startsWith("prunable"));
    return first.startsWith("worktree ") && !gone ? [first.slice("worktree ".length)] : [];
  });
}

/**
 * Reads the Work checked out in `folder` (the registered folder) and each of its linked worktrees, at the share level. If it isn't a branch (detached HEAD), there's no Work.
 * full reads content. declared reads content only inside the paths that Work has claimed (`claimed`) and only paths for the rest. intent's paths don't go to the server (the runner removes them).
 * The base commit is where HEAD and the default branch of `remote` (`refs/remotes/<remote>/HEAD`) split.
 * A worktree it can't read is left out and the reason goes in `problems`. If one can't be read, the rest still go up.
 * `folders` is the folder checked out for each Work (branch). One branch is checked out in only one worktree.
 */
/** Compared definition lines. If the base commit, path, and content are the same, it doesn't read again. The oldest entries are dropped first. */
const compared = new Map<string, ReturnType<typeof compare>>();
const COMPARED_LIMIT = 2000;

export async function observe(
  folder: string,
  remote: string,
  share: ShareLevel,
  claimed: (branch: string, path: string) => boolean = () => false,
) {
  const works: Work[] = [];
  const problems: string[] = [];
  const folders = new Map<string, string>();
  let total = 0;
  for (const tree of await worktrees(folder)) {
    try {
      const work = await observeTree(tree);
      if (work) {
        works.push(work);
        folders.set(work.branch, tree);
      }
    } catch (error) {
      problems.push(`${tree}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { works, problems, folders };

  async function observeTree(tree: string): Promise<Work | undefined> {
    const branch = await git(tree, "symbolic-ref", "--quiet", "--short", "HEAD").then(
      (out) => out.trim(),
      () => undefined,
    );
    if (!branch) return;
    const base = await git(tree, "merge-base", "HEAD", `refs/remotes/${remote}/HEAD`).then(
      (out) => out.trim(),
      () => {
        throw new Error(
          `couldn't find the base commit: the default branch of ${remote} is unknown or has no split point with ${branch}. ` +
            `set the default branch with git remote set-head ${remote} --auto`,
        );
      },
    );
    // The difference between the base commit and the working tree (committed and not), and new untracked files (leaving out gitignored ones).
    // For a path Git sees as deleted, it doesn't look at the disk again. This is so it doesn't read a file that was untracked and gitignored, or a file beyond a folder that turned into a link.
    const [changed, removed, untracked] = await Promise.all([
      git(tree, "diff", "--name-only", "--no-renames", "-z", base, "--"),
      git(tree, "diff", "--name-only", "--no-renames", "--diff-filter=D", "-z", base, "--"),
      git(tree, "ls-files", "--others", "--exclude-standard", "-z"),
    ]);
    const fresh = new Set(untracked.split("\0"));
    const gone = new Set(removed.split("\0").filter((path) => !fresh.has(path)));
    const paths = [...new Set(`${changed}${untracked}`.split("\0"))]
      .filter((path) => path && !secret(path))
      .sort();

    const files: ObservedFile[] = [];
    for (const path of paths) {
      const full = join(tree, path);
      const stat = gone.has(path) ? undefined : await lstat(full).catch(() => undefined);
      const open = share === "full" || (share === "declared" && claimed(branch, path));
      if (!stat) {
        const definitions = open ? await changedDefinitions(path) : undefined;
        files.push({ path, deleted: true, ...(definitions?.length && { definitions }) });
        continue;
      }
      // intent reads paths too. The runner removes them when it sends to the server (this machine's hook uses my Work's paths).
      if (!open) {
        files.push({ path, omitted: "share" });
        continue;
      }
      if (stat.size > FILE_LIMIT) {
        files.push({ path, omitted: "too_large" });
        continue;
      }
      // Doesn't follow symbolic links. As Git stores them, the path it points to is the content.
      const bytes = stat.isSymbolicLink()
        ? await readlink(full, { encoding: "buffer" }).catch(() => undefined)
        : stat.isFile()
          ? await readFile(full).catch(() => undefined)
          : undefined; // something that isn't a file, like a submodule
      const content = bytes && asText(bytes);
      if (content === undefined) {
        files.push({ path, omitted: "binary" });
        continue;
      }
      const size = Buffer.byteLength(JSON.stringify(content));
      if (total + size > TOTAL_LIMIT) {
        files.push({ path, omitted: "too_large" });
        continue;
      }
      total += size;
      const definitions = stat.isFile() ? await changedDefinitions(path, content) : undefined;
      files.push({ path, content, ...(definitions?.length && { definitions }) });
    }
    return { branch, base, share, files };

    /** The base commit's version and the compared definition lines (ADR-0026). Only called for files whose content is uploaded. None for a language it can't read. */
    async function changedDefinitions(path: string, content?: string) {
      if (!parsable(path)) return;
      const hash =
        content === undefined ? "deleted" : createHash("sha1").update(content).digest("hex");
      const key = `${base}\0${path}\0${hash}`;
      let found = compared.get(key);
      if (!found) {
        const before = await git(tree, "cat-file", "blob", `${base}:${path}`).catch(() => ""); // a new file that didn't exist
        found = compare(path, before, content);
        compared.set(key, found);
        if (compared.size > COMPARED_LIMIT) compared.delete(compared.keys().next().value as string);
      }
      return found;
    }
  }
}

/** The result of finding where something is used. If the file's path, size, modified time, and name are the same, it doesn't read again. The oldest entries are dropped first. */
const used = new Map<string, number[]>();
const USED_LIMIT = 20_000;

/**
 * For each name in `symbols`, where it's used in the copy (`folder`). Looks only at tracked files and new untracked files in a language it can read.
 * Like observation, it doesn't read gitignored files, .env files, or files over the one-file limit. `omagari impact` and indirect conflicts use it.
 */
// ponytail: every time it's asked, it gets the copy's file list again and reuses the last result for files whose size and modified time are unchanged. If it gets heavy on a big repo, switch to a file watcher and re-read only changed files.
export async function uses(folder: string, symbols: string[]) {
  const found = new Map(symbols.map((symbol) => [symbol, [] as { path: string; line: number }[]]));
  if (symbols.length === 0) return found;
  const listed = await git(folder, "ls-files", "--cached", "--others", "--exclude-standard", "-z");
  const paths = [...new Set(listed.split("\0"))]
    .filter((p) => p && parsable(p) && !secret(p))
    .sort();
  for (const path of paths) {
    const full = join(folder, path);
    const stat = await lstat(full).catch(() => undefined);
    if (!stat?.isFile() || stat.size > FILE_LIMIT) continue; // deleted file, link, big file
    let content: string | undefined | null = null; // not read yet
    for (const symbol of symbols) {
      const key = `${full}\0${stat.size}\0${stat.mtimeMs}\0${symbol}`;
      let lines = used.get(key);
      if (!lines) {
        if (content === null) content = asText(await readFile(full));
        lines = (content !== undefined && (await usesIn(path, content, symbol))) || [];
        used.set(key, lines);
        if (used.size > USED_LIMIT) used.delete(used.keys().next().value as string);
      }
      for (const line of lines) found.get(symbol)?.push({ path, line });
    }
  }
  return found;
}
