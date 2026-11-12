// 직접 충돌: 내 작업과 다른 멤버의 작업이 함께 바꾼 파일을 3-way로 합쳐 보고, 줄이 부딪히는 것을 찾는다(ADR-0023).
// 조상은 두 작업의 기준 커밋이 갈라진 지점의 판이다. 상대 내용은 서버에서 받아 둔 관측이고, 내 내용은 내 작업 폴더의 지금 파일이다.
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LineRange, ConflictPair as Pair, Work, WorkView } from "@omagari/contract";
import { blobAt, gitIn, type Hunk, hasCommit, hunks } from "./nearby.ts";

type Found = Pair["files"][number] | undefined;

/**
 * 주기마다 Git을 다시 부르지 않게 둔 것. `files`는 같은 입력의 결과이고(키는 조상, 경로, 두 내용의 해시),
 * 이번 계산에서 쓰인 것만 다음으로 넘겨 쌓이지 않는다. `ancestors`는 두 기준 커밋의 갈림점이다. 커밋은 바뀌지 않으니 찾은 것만 둔다.
 */
export type Memo = { files: Map<string, Found>; ancestors: Map<string, string> };
export const newMemo = (): Memo => ({ files: new Map(), ancestors: new Map() });

const digest = (...parts: (string | Uint8Array)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
};

/**
 * `mine`(이 러너의 작업과 그 폴더)과 `works` 가운데 `login`이 아닌 멤버의 작업이 함께 바꾼 파일마다 부딪히는지 본다.
 * 줄이 부딪히거나 상대 내용을 읽을 수 없는 파일이 있는 쌍만 돌려준다. intent인 내 작업은 계산하지 않는다(서버로 경로가 나가지 않는다).
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
  // 합쳐 볼 파일이 있을 때만 임시 폴더를 만든다. 주기마다 도는 것이라 함께 바꾼 파일이 없으면 Git도 부르지 않는다.
  let scratch: string | undefined;
  try {
    for (const { work, folder } of mine) {
      if (work.share === "intent") continue;
      const paths = new Set(work.files.map((file) => file.path));
      for (const theirs of works) {
        if (theirs.login === login) continue;
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

/** 두 기준 커밋의 갈림점. 상대의 기준 커밋이 이 기기에 없으면 빈 글이다(다음 주기에 다시 본다). */
async function ancestorOf(repo: string, mine: string, theirs: string, known: Map<string, string>) {
  const key = `${mine} ${theirs}`;
  const found = known.get(key);
  if (found) return found;
  if (!(await hasCommit(repo, theirs))) return "";
  // 갈림점이 없는 두 커밋(이어지지 않은 역사)도 합쳐 볼 판이 없다.
  const ancestor = await gitIn(repo)("merge-base", mine, theirs).then(
    ({ stdout }) => stdout.toString().trim(),
    () => "",
  );
  if (!ancestor) return "";
  known.set(key, ancestor);
  return ancestor;
}

/** 내 작업 폴더의 지금 파일. 없으면(지웠으면) 없음이다. 심볼릭 링크는 Git이 담는 것처럼 가리키는 경로가 내용이다. */
async function readMine(full: string) {
  const stat = await lstat(full).catch(() => undefined);
  if (!stat) return undefined;
  return stat.isSymbolicLink() ? readlink(full, { encoding: "buffer" }) : readFile(full);
}

/**
 * 파일 하나를 `git merge-file`로 합쳐 본다. 깨끗하면 없음, 부딪히면 두 사본의 부딪히는 줄이다.
 * 한쪽이 지우고 다른 쪽이 조상과 다르게 고쳤으면 줄 없이 부딪힌다. 합치지 못하는 것(바이너리)은 읽을 수 없는 것으로 둔다.
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
    // 둘 다 지웠거나, 남은 쪽이 조상 그대로면 부딪히지 않는다.
    if (kept === undefined || Buffer.compare(kept, base) === 0) return undefined;
    return { path, mine: [], theirs: [] };
  }
  const [o, b, t] = ["ours", "base", "theirs"].map((name) => join(scratch, name)) as [
    string,
    string,
    string,
  ];
  await Promise.all([writeFile(o, ours), writeFile(b, base), writeFile(t, theirs)]);
  // 부딪힌 곳의 수로 끝나고(0이면 깨끗하다), 합치지 못하면 음수(255)로 끝난다.
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
 * `hunks` 가운데 조상의 줄에서 `others`와 겹치거나 맞닿는 것의 줄 범위. Git은 맞닿은 고침도 부딪힘으로 본다.
 * 부딪힘 여부는 `git merge-file`이 정하고, 이것은 어디인지를 적을 뿐이다.
 */
// ponytail: 부딪힌 곳의 줄을 두 diff에서 다시 찾는다. merge-file의 출력에서 곧바로 줄을 읽어야 할 만큼 어긋나면 그때 바꾼다.
function touching(hunks: Hunk[], others: Hunk[]): LineRange[] {
  return hunks
    .filter(({ before: a }) => others.some(({ before: b }) => a.from <= b.to && b.from <= a.to))
    .map((hunk) => hunk.after);
}
