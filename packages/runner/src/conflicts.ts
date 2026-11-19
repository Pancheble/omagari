// Direct conflict: tries a 3-way merge on the files my Work and another member's Work both changed, and finds the lines that clash (ADR-0023).
// The ancestor is the version at the point where the two Works' base commits split. The other side's content is the observation received from the server, and mine is the current file in my work folder.
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Claim,
  ConflictPair,
  Definition,
  LineRange,
  SymbolPlace,
  Work,
  WorkView,
} from "@omagari/contract";
import { blobAt, gitIn, type Hunk, hasCommit, hunks } from "./nearby.ts";
import { uses } from "./observe.ts";

type Pair = Extract<ConflictPair, { kind: "direct" }>;

type Found = Pair["files"][number] | undefined;

/**
 * Kept so Git isn't called again every cycle. `files` holds results for the same input (the key is ancestor, path, and the hashes of both contents),
 * and only what was used in this calculation is passed on, so nothing piles up. `ancestors` is the split point of two base commits. Commits don't change, so only found ones are kept.
 */
export type Memo = { files: Map<string, Found>; ancestors: Map<string, string> };
export const newMemo = (): Memo => ({ files: new Map(), ancestors: new Map() });

const digest = (...parts: (string | Uint8Array)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
};

/**
 * For each file that `mine` (this runner's Work and its folder) and another Work in `works` both changed, checks whether they clash. Only the same Work (same branch of `login`) is skipped.
 * My other branches' Work is treated like other people's Work (ADR-0041).
 * Returns only pairs that have clashing lines or a file whose other-side content can't be read. It doesn't calculate for my Work if it's intent (no paths go to the server).
 */
export async function conflicts(
  repo: string,
  mine: { work: Work; folder: string }[],
  works: WorkView[],
  login: string,
  memo: Memo,
): Promise<{ pairs: Pair[]; memo: Memo }> {
  const next: Memo = { files: new Map(), ancestors: memo.ancestors };
  const pairs: Pair[] = [];
  // Makes the temp folder only when there are files to merge. This runs every cycle, so if no file was changed by both, it doesn't call Git either.
  let scratch: string | undefined;
  try {
    for (const { work, folder } of mine) {
      if (work.share === "intent") continue;
      const paths = new Set(work.files.map((file) => file.path));
      for (const theirs of works) {
        if (sameWork(theirs, login, work.branch)) continue;
        const shared = theirs.files.filter((file) => paths.has(file.path));
        if (shared.length === 0) continue;
        const ancestor = await ancestorOf(repo, work.base, theirs.base, memo.ancestors);
        const files: Pair["files"] = [];
        for (const file of shared) {
          let found: Found;
          if ("omitted" in file) found = { path: file.path, unknown: file.omitted };
          else if (!ancestor) found = { path: file.path, unknown: "base" };
          else {
            const ours = await readMine(join(folder, file.path));
            const their = "deleted" in file ? undefined : file.content;
            const key = digest(ancestor, file.path, ours ?? "\0deleted", their ?? "\0deleted");
            if (memo.files.has(key)) found = memo.files.get(key);
            else {
              scratch ??= await mkdtemp(join(tmpdir(), "omagari-merge-"));
              found = await merge(repo, scratch, ancestor, file.path, ours, their);
            }
            next.files.set(key, found);
          }
          if (found) files.push(found);
        }
        if (files.length > 0) {
          pairs.push({
            kind: "direct",
            branch: work.branch,
            theirs: { login: theirs.login, branch: theirs.branch },
            files,
          });
        }
      }
    }
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
  return { pairs, memo: next };
}

/** Same Work: the same branch of the same person (ADR-0041). Even the same person's different branch is a different Work. */
export const sameWork = (
  other: { login: string; branch: string },
  login: string,
  branch?: string,
) => other.login === login && other.branch === branch;

/** The split point of two base commits. An empty string if the other side's base commit isn't on this machine (it looks again next cycle). */
async function ancestorOf(repo: string, mine: string, theirs: string, known: Map<string, string>) {
  const key = `${mine} ${theirs}`;
  const found = known.get(key);
  if (found) return found;
  if (!(await hasCommit(repo, theirs))) return "";
  // Two commits with no split point (unconnected history) have no version to try merging either.
  const ancestor = await gitIn(repo)("merge-base", mine, theirs).then(
    ({ stdout }) => stdout.toString().trim(),
    () => "",
  );
  if (!ancestor) return "";
  known.set(key, ancestor);
  return ancestor;
}

/** The current file in my work folder. None if it's gone (deleted). A symbolic link's content is the path it points to, as Git stores it. */
async function readMine(full: string) {
  const stat = await lstat(full).catch(() => undefined);
  if (!stat) return undefined;
  return stat.isSymbolicLink() ? readlink(full, { encoding: "buffer" }) : readFile(full);
}

/**
 * Tries to merge one file with `git merge-file`. None if it's clean, or the clashing lines of the two copies if it clashes.
 * If one side deleted it and the other changed it differently from the ancestor, it clashes without lines. What can't be merged (binary) is treated as unreadable.
 */
async function merge(
  repo: string,
  scratch: string,
  ancestor: string,
  path: string,
  ours: Uint8Array | undefined,
  theirs: string | undefined,
): Promise<Found> {
  const base = await blobAt(repo, ancestor, path);
  if (ours === undefined || theirs === undefined) {
    const kept = ours ?? (theirs === undefined ? undefined : Buffer.from(theirs));
    // If both deleted it, or the remaining side is the same as the ancestor, there's no clash.
    if (kept === undefined || Buffer.compare(kept, base) === 0) return undefined;
    return { path, mine: [], theirs: [] };
  }
  const [o, b, t] = ["ours", "base", "theirs"].map((name) => join(scratch, name)) as [
    string,
    string,
    string,
  ];
  await Promise.all([writeFile(o, ours), writeFile(b, base), writeFile(t, theirs)]);
  // It exits with the number of clashing places (0 means clean), and with a negative number (255) if it can't merge.
  const code = await gitIn(repo)("merge-file", "-p", "--quiet", o, b, t).then(
    () => 0,
    (error) => (typeof error.code === "number" ? error.code : 255),
  );
  if (code === 0) return undefined;
  if (code >= 128) return { path, unknown: "binary" };
  const [mine, their] = await Promise.all([hunks(repo, base, ours), hunks(repo, base, theirs)]);
  return { path, mine: touching(mine, their), theirs: touching(their, mine) };
}

/**
 * The line range of the ancestor's lines in `hunks` that overlap or touch `others`. Git counts touching edits as a clash too.
 * Whether they clash is decided by `git merge-file`; this only writes down where.
 */
// ponytail: finds the clashing lines again in the two diffs. If it drifts so far that lines must be read straight from merge-file's output, change it then.
function touching(hunks: Hunk[], others: Hunk[]): LineRange[] {
  return hunks
    .filter(({ before: a }) => others.some(({ before: b }) => a.from <= b.to && b.from <= a.to))
    .map((hunk) => hunk.after);
}

type SymbolPair = Extract<ConflictPair, { kind: "indirect" | "duplicate" | "declared" }>;

/** Where the definition lines that are `changes` in a Work's changed files are collected, per name. */
function defined(work: Work | WorkView, changes: Definition["change"][]) {
  const found = new Map<string, SymbolPlace[]>();
  for (const file of work.files) {
    for (const d of "definitions" in file ? (file.definitions ?? []) : []) {
      if (!d.change || !changes.includes(d.change)) continue;
      found.set(d.name, [
        ...(found.get(d.name) ?? []),
        { path: file.path, line: d.line, role: d.change },
      ]);
    }
  }
  return found;
}

/**
 * Estimated clashes on definition lines (ADR-0023, ADR-0026). Checks `mine` (this runner's Work and its folder) against each Work in `works` that isn't the same Work (ADR-0041).
 * - Indirect conflict (estimated): finds, by name in my Work's copy, a symbol whose definition line the other side changed or removed. If it's used, it's included.
 *   The opposite direction (the other side using what I changed) is calculated by the other runner on its own copy.
 * - Duplicate work: a new definition with the same name appeared in both Works. My definition lines exist only at the level that uploads content (full), so it's calculated only then (ADR-0026).
 * - Declared Contract change: finds, by name in my Work's copy, a symbol in the plan attached to another Work's Claim (`claims`). It's included even if the code hasn't changed yet.
 * If my Work is intent, it doesn't calculate (no paths go to the server). It returns only pairs and kinds that have at least one symbol.
 */
export async function symbolConflicts(
  mine: { work: Work; folder: string }[],
  works: WorkView[],
  login: string,
  claims: Claim[] = [],
): Promise<SymbolPair[]> {
  const pairs: SymbolPair[] = [];
  for (const { work, folder } of mine) {
    if (work.share === "intent") continue;
    const others = works.filter((theirs) => !sameWork(theirs, login, work.branch));
    const added = defined(work, ["added"]);
    const changing = others.map((theirs) => ({
      theirs,
      defs: defined(theirs, ["changed", "removed"]),
    }));
    const planned = claims.filter((c) => !sameWork(c, login, work.branch) && c.plan);
    // Reads my copy once: collects all the names the others changed and planned, and looks them up.
    const used = await uses(folder, [
      ...new Set([
        ...changing.flatMap(({ defs }) => [...defs.keys()]),
        ...planned.map((c) => c.plan?.symbol ?? ""),
      ]),
    ]);
    for (const { theirs, defs } of changing) {
      const ends = { branch: work.branch, theirs: { login: theirs.login, branch: theirs.branch } };
      const indirect = [...defs].flatMap(([name, places]) => {
        const at = used.get(name) ?? [];
        if (at.length === 0) return [];
        return [{ name, mine: at.map((u) => ({ ...u, role: "uses" as const })), theirs: places }];
      });
      if (indirect.length > 0) pairs.push({ kind: "indirect", ...ends, symbols: indirect });
      const duplicate = [...defined(theirs, ["added"])].flatMap(([name, places]) => {
        const ours = added.get(name);
        return ours ? [{ name, mine: ours, theirs: places }] : [];
      });
      if (duplicate.length > 0) pairs.push({ kind: "duplicate", ...ends, symbols: duplicate });
    }
    // A plan exists for each Claim. Plans from the same other Work are grouped into one pair.
    const declared = new Map<string, SymbolPair>();
    for (const c of planned) {
      const plan = c.plan;
      const at = plan ? (used.get(plan.symbol) ?? []) : [];
      if (!plan || at.length === 0) continue;
      const key = JSON.stringify([c.login, c.branch]);
      const pair = declared.get(key) ?? {
        kind: "declared" as const,
        branch: work.branch,
        theirs: { login: c.login, branch: c.branch },
        symbols: [],
      };
      declared.set(key, pair);
      pair.symbols.push({
        name: plan.symbol,
        mine: at.map((u) => ({ ...u, role: "uses" as const })),
        theirs: [{ path: c.path, line: c.lines?.from ?? 1, role: "declared" }],
        plan,
      });
    }
    pairs.push(...declared.values());
  }
  return pairs;
}
