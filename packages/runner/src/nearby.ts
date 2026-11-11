// 근처 작업: 고치려는 파일을 바꾸고 있는 다른 멤버의 작업과, 그 사람이 그 파일에서 바꾼 줄 범위(구현 4장, 1단계 질문 A7).
// 서버에서 받아 둔 상황만 읽는다. 줄 범위는 그 사람의 기준 커밋에 있던 판과 올라온 내용을 이 기기의 Git으로 비교해 낸다.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { NearbyWork, WorkView } from "@omagari/contract";

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

/** 기준 커밋의 판(없던 파일이면 빈 판)과 `content`를 비교해, `content`의 줄 번호로 바꾼 곳을 낸다. */
async function changedLines(
  folder: string,
  base: string,
  path: string,
  content: string,
): Promise<NearbyWork["change"]> {
  const git = (...args: string[]) =>
    execFileAsync("git", ["-C", folder, ...args], {
      encoding: "buffer",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });
  // 그 사람의 기준 커밋을 이 기기가 아직 받지 않았으면 비교할 판이 없다.
  const known = await git("cat-file", "-e", `${base}^{commit}`).then(
    () => true,
    () => false,
  );
  if (!known) return { kind: "unknown", reason: "base" };
  const before = await git("cat-file", "blob", `${base}:${path}`).then(
    ({ stdout }) => stdout,
    () => Buffer.alloc(0), // 기준 커밋에 없던 새 파일
  );
  // 비교는 이 기기의 임시 폴더에서 한다. 레포에는 아무것도 쓰지 않는다.
  const scratch = await mkdtemp(join(tmpdir(), "omagari-nearby-"));
  try {
    await Promise.all([
      writeFile(join(scratch, "before"), before),
      writeFile(join(scratch, "after"), content),
    ]);
    // 다르면 1로 끝난다. 그것도 결과다.
    const diff = await git(
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
    const ranges = [...diff.toString().matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)].map(
      ([, start = "0", count = "1"]) => {
        const from = Math.max(Number(start), 1);
        return { from, to: Math.max(from + Number(count) - 1, from) };
      },
    );
    return { kind: "lines", ranges };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
