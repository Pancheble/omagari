// 근처 작업: 고치려는 파일을 바꾸고 있는 다른 멤버의 작업과, 그 사람이 그 파일에서 바꾼 줄 범위(구현 4장, 1단계 질문 A7).
// 서버에서 받아 둔 상황만 읽는다. 줄 범위는 그 사람의 기준 커밋에 있던 판과 올라온 내용을 이 기기의 Git으로 비교해 낸다.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LineRange, NearbyWork, WorkView } from "@omagari/contract";

const execFileAsync = promisify(execFile);

/** `works` 가운데 `login`이 아닌 멤버가 `path`를 바꾼 작업마다 바꾼 곳을 읽는다. */
export async function nearby(
  folder: string,
  works: WorkView[],
  login: string,
  path: string,
): Promise<NearbyWork[]> {
  const found: NearbyWork[] = [];
  for (const work of works) {
    const file = work.login === login ? undefined : work.files.find((f) => f.path === path);
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

/** 이 기기의 Git. 레포에는 아무것도 쓰지 않는다. */
export const gitIn =
  (folder: string) =>
  (...args: string[]) =>
    execFileAsync("git", ["-C", folder, ...args], {
      encoding: "buffer",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });

/** 커밋이 이 기기에 있는지. 남의 기준 커밋을 아직 받지 않았으면 없다. */
export const hasCommit = (folder: string, commit: string) =>
  gitIn(folder)("cat-file", "-e", `${commit}^{commit}`).then(
    () => true,
    () => false,
  );

/** `commit`에 있던 `path`의 판. 없던 파일이면 빈 판이다. */
export const blobAt = (folder: string, commit: string, path: string) =>
  gitIn(folder)("cat-file", "blob", `${commit}:${path}`).then(
    ({ stdout }) => stdout,
    () => Buffer.alloc(0),
  );

/**
 * 바꾼 곳 하나. `before`는 앞 판에서 바뀐 줄(`[from, to)`, 넣기만 했으면 넣은 자리의 빈 범위)이고,
 * `after`는 뒤 판의 줄 번호로 바꾼 곳이다(지운 줄만 있는 곳은 그 앞 줄).
 */
export type Hunk = { before: { from: number; to: number }; after: LineRange };

/** 두 판을 이 기기의 임시 폴더에서 비교해 바꾼 곳들을 낸다. */
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
    // 다르면 1로 끝난다. 그것도 결과다.
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
        // 지우기만 한 곳(`+n,0`)과 넣기만 한 곳(`-n,0`)은 n 줄 뒤다.
        const at = Number(oldCount) === 0 ? Number(old) + 1 : Number(old);
        const from = Math.max(Number(start), 1);
        return {
          before: { from: at, to: at + Number(oldCount) },
          after: { from, to: Math.max(from + Number(count) - 1, from) },
        };
      },
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** 기준 커밋의 판(없던 파일이면 빈 판)과 `content`를 비교해, `content`의 줄 번호로 바꾼 곳을 낸다. */
async function changedLines(
  folder: string,
  base: string,
  path: string,
  content: string,
): Promise<NearbyWork["change"]> {
  // 그 사람의 기준 커밋을 이 기기가 아직 받지 않았으면 비교할 판이 없다.
  if (!(await hasCommit(folder, base))) return { kind: "unknown", reason: "base" };
  const found = await hunks(folder, await blobAt(folder, base, path), content);
  return { kind: "lines", ranges: found.map((hunk) => hunk.after) };
}
