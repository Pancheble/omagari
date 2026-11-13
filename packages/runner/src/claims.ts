// 선점(ADR-0008): 걸 곳을 내 사본에서 찾고, 남의 선점을 내 사본의 줄로 옮기고, 겹침을 본다.
// 줄 옮기기는 Room처럼 선점한 사람의 판과 내 판의 줄 차이로 한다. 상대의 판을 읽을 수 없으면 상대의 줄 그대로 "대략"이다.
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Claim, LineRange, SeenClaim, WorkView } from "@omagari/contract";
import { blobAt, gitIn, type Hunk, hasCommit, hunks } from "./nearby.ts";
import { symbolRange } from "./symbols.ts";

/** 선점이 그 경로(파일)를 덮는가. 폴더 선점은 그 아래 모두를 덮는다. */
export const covers = (claim: Pick<Claim, "path" | "unit">, path: string) =>
  claim.unit === "folder" ? path.startsWith(claim.path) : claim.path === path;

/** 두 선점(같은 사본의 줄)이 겹치는가. 파일 전체나 폴더는 그 안의 무엇과도 겹친다. */
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

/** 앞 판의 줄 하나를 뒤 판의 줄로 옮긴다. 바뀐 곳 안이면 그 바뀐 곳의 뒤 판 자리(`end`면 끝, 아니면 시작)다. */
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
 * 남의 선점을 내 사본(`tree`)의 줄로 옮긴다. 상대의 판은 서버에 올라온 내용, 그 파일을 바꾸지 않았으면 상대의 기준 커밋의 판이다.
 * 상대의 판이나 내 파일을 읽을 수 없으면 상대의 줄 그대로 `approx`다. 줄이 없는 선점(파일 전체, 폴더)은 옮길 것이 없다.
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

/** 이 사본에서 선점을 걸 곳을 정한다. 걸 수 없으면 까닭을 들어 던진다. */
export async function resolve(
  tree: string,
  base: string,
  target: { path: string; symbol?: string; lines?: LineRange },
): Promise<Pick<Claim, "path" | "unit" | "symbol" | "lines">> {
  const { symbol, lines } = target;
  const path = target.path.replace(/^\.\//, "");
  if (symbol !== undefined && lines !== undefined) throw new Error("심볼과 줄 범위는 하나만 준다");
  const stat = await lstat(join(tree, path)).catch(() => undefined);
  if (path.endsWith("/") || stat?.isDirectory()) {
    if (symbol !== undefined || lines !== undefined)
      throw new Error(`폴더에는 심볼이나 줄 범위를 주지 않는다: ${path}`);
    return { path: path.endsWith("/") ? path : `${path}/`, unit: "folder" };
  }
  if (symbol !== undefined) {
    const content = await readText(join(tree, path));
    const range = content && (await symbolRange(path, content.toString(), symbol));
    if (!range) throw new Error(`${path}에서 ${symbol}의 정의를 찾지 못했다`);
    return { path, unit: "symbol", symbol, lines: range };
  }
  if (lines !== undefined) {
    if (lines.from < 1 || lines.to < lines.from)
      throw new Error(`줄 범위는 1부터, 시작이 끝보다 크지 않게 준다: ${lines.from}-${lines.to}`);
    return { path, unit: "lines", lines };
  }
  // 기준 커밋에 없던 새 파일만 파일 전체를 잡는다. 있던 파일은 고칠 곳을 좁혀 건다(Room과 같다).
  const existed = await gitIn(tree)("cat-file", "-e", `${base}:${path}`).then(
    () => true,
    () => false,
  );
  if (existed)
    throw new Error(`기준 커밋에 있던 파일은 심볼(--symbol)이나 줄 범위(--lines)로 건다: ${path}`);
  return { path, unit: "file" };
}
