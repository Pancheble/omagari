// Claims (ADR-0008): finds the place to claim in my copy, maps other people's Claims to lines in my copy, and checks overlap.
// Mapping lines works like Room: by the line difference between the claimer's version and mine. If the other version can't be read, it's "approximate" with the other person's lines as they are.
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Claim, LineRange, SeenClaim, WorkView } from "@omagari/contract";
import { blobAt, gitIn, type Hunk, hasCommit, hunks } from "./nearby.ts";
import { symbolRange } from "./symbols.ts";

/** Whether the Claim covers that path (file). A folder Claim covers everything under it. */
export const covers = (claim: Pick<Claim, "path" | "unit">, path: string) =>
  claim.unit === "folder" ? path.startsWith(claim.path) : claim.path === path;

/** Whether two Claims (lines in the same copy) overlap. A whole file or a folder overlaps with anything inside it. */
export function overlap(
  a: Pick<Claim, "path" | "unit" | "lines">,
  b: Pick<Claim, "path" | "unit" | "lines">,
) {
  if (a.unit === "folder") return covers(a, b.path) || (b.unit === "folder" && covers(b, a.path));
  if (b.unit === "folder") return covers(b, a.path);
  if (a.path !== b.path) return false;
  if (!a.lines || !b.lines) return true;
  return a.lines.from <= b.lines.to && b.lines.from <= a.lines.to;
}

/** Maps one line of the earlier version to a line of the later version. If it's inside a changed place, it's that place's spot in the later version (the end for `end`, otherwise the start). */
function shift(found: Hunk[], line: number, end: boolean) {
  let delta = 0;
  for (const hunk of found) {
    if (line < hunk.before.from) break;
    if (line < hunk.before.to) return end ? hunk.after.to : hunk.after.from;
    delta += hunk.size - (hunk.before.to - hunk.before.from);
  }
  return line + delta;
}

const readText = (full: string) =>
  lstat(full).then(
    (stat) => (stat.isFile() ? readFile(full) : undefined),
    () => undefined,
  );

/**
 * Maps someone else's Claim to lines in my copy (`tree`). The other version is the content uploaded to the server, or the other person's base commit version if they didn't change that file.
 * If the other version or my file can't be read, it's `approx` with the other person's lines as they are. A Claim with no lines (a whole file, a folder) has nothing to map.
 */
export async function see(
  repo: string,
  tree: string,
  works: WorkView[],
  claim: Claim,
): Promise<SeenClaim> {
  const approx = { ...claim, approx: true };
  if (!claim.lines) return { ...claim, approx: false };
  const work = works.find((w) => w.login === claim.login && w.branch === claim.branch);
  if (!work || work.share === "intent") return approx;
  const file = work.files.find((f) => f.path === claim.path);
  let theirs: string | Uint8Array;
  if (file && "content" in file) theirs = file.content;
  else if (!file && (await hasCommit(repo, work.base)))
    theirs = await blobAt(repo, work.base, claim.path);
  else return approx;
  const mine = await readText(join(tree, claim.path));
  if (!mine) return approx;
  const found = await hunks(repo, theirs, mine);
  const lines: LineRange = {
    from: shift(found, claim.lines.from, false),
    to: shift(found, claim.lines.to, true),
  };
  return { ...claim, lines, approx: false };
}

/** Decides the place to claim in this copy. If it can't be claimed, it throws with the reason. */
export async function resolve(
  tree: string,
  base: string,
  target: { path: string; symbol?: string; lines?: LineRange },
): Promise<Pick<Claim, "path" | "unit" | "symbol" | "lines">> {
  const { symbol, lines } = target;
  const path = target.path.replace(/^\.\//, "");
  if (symbol !== undefined && lines !== undefined)
    throw new Error("give either a symbol or a line range, not both");
  const stat = await lstat(join(tree, path)).catch(() => undefined);
  if (path.endsWith("/") || stat?.isDirectory()) {
    if (symbol !== undefined || lines !== undefined)
      throw new Error(`don't give a symbol or line range for a folder: ${path}`);
    return { path: path.endsWith("/") ? path : `${path}/`, unit: "folder" };
  }
  if (symbol !== undefined) {
    const content = await readText(join(tree, path));
    const range = content && (await symbolRange(path, content.toString(), symbol));
    if (!range) throw new Error(`couldn't find the definition of ${symbol} in ${path}`);
    return { path, unit: "symbol", symbol, lines: range };
  }
  if (lines !== undefined) {
    if (lines.from < 1 || lines.to < lines.from)
      throw new Error(
        `the line range starts at 1 and the start can't be greater than the end: ${lines.from}-${lines.to}`,
      );
    return { path, unit: "lines", lines };
  }
  // Only a new file that wasn't in the base commit can be claimed as a whole file. A file that was there is claimed by narrowing to the place to edit (same as Room).
  const existed = await gitIn(tree)("cat-file", "-e", `${base}:${path}`).then(
    () => true,
    () => false,
  );
  if (existed)
    throw new Error(
      `claim a file that was in the base commit by symbol (--symbol) or line range (--lines): ${path}`,
    );
  return { path, unit: "file" };
}
