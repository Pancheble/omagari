// 관측: 등록한 폴더와 그 연결된 워크트리의 Git 상태에서 작업마다 바꾼 파일과 그 내용을 읽는다(ADR-0002, ADR-0006, ADR-0007).
// 읽기만 한다. 작업 폴더의 어떤 파일도, Git이 덤으로 하는 인덱스 갱신도 쓰지 않는다.
import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ObservedFile, ShareLevel, Work } from "@omagari/contract";

const execFileAsync = promisify(execFile);

/** 파일 하나의 내용 상한. 넘으면 경로만 보낸다. Room의 값에서 시작한다(ADR-0007). */
export const FILE_LIMIT = 512 * 1024;
/** 한 번에 보내는 내용의 합계 상한. 워크트리를 모두 합해 센다. 넘는 몫은 경로만 보낸다. 보내는 꼴(JSON 문자열)의 바이트로 센다. */
export const TOTAL_LIMIT = 8 * 1024 * 1024;

const ALWAYS = `  커밋한 것, 커밋하지 않은 것, 추적하지 않는 새 파일이 모두 나간다. 푸시하지 않은 것도 나간다.
  나가지 않는 것: gitignore된 파일과 .env, .env.*(.env.example은 나간다).`;

/** 러너를 켤 때 주인에게 알리는 것: 이 공유 수준에서 무엇이 서버로 나가는가. */
export function observationNotice(share: ShareLevel) {
  const what = {
    full: `이 폴더와 연결된 워크트리의 브랜치마다, 기본 브랜치와 갈라진 뒤 바꾼 파일의 경로와 내용이 서버로 나가 멤버들이 본다.
${ALWAYS}
  경로만 나가는 것: 바이너리, ${FILE_LIMIT / 1024}KiB를 넘는 파일, 합계 ${TOTAL_LIMIT / 1024 / 1024}MiB를 넘는 몫.`,
    declared: `이 폴더와 연결된 워크트리의 브랜치마다, 기본 브랜치와 갈라진 뒤 바꾼 파일의 경로가 서버로 나가 멤버들이 본다. 파일 내용은 나가지 않는다.
${ALWAYS}`,
    intent: `이 폴더와 연결된 워크트리의 브랜치 이름과 기준 커밋, 에이전트가 쓴 상태 한 줄만 서버로 나간다. 바꾼 파일의 경로도 내용도 나가지 않는다.`,
  }[share];
  return `관측(공유 수준 ${share}): ${what}
  공유 수준은 omagari runner --share <full|declared|intent>로 고른다. 고른 것은 이 레포에 남는다.`;
}

/** 추적되더라도 늘 빼는 것: 경로의 어느 마디든 `.env`이거나 `.env.`로 시작한다. `.env.example`은 남긴다. */
const secret = (path: string) =>
  path
    .split("/")
    .some((part) => part === ".env" || (part.startsWith(".env.") && part !== ".env.example"));

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** 글이면 그 글을, 바이너리면(NUL이 있거나 UTF-8이 아니면) 없음을 돌려준다. */
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
      // 인덱스 갱신처럼 잠금이 필요한 덤의 쓰기를 하지 않는다.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;

/** 등록한 폴더와 그 연결된 워크트리의 폴더. 폴더가 없어진 것(prunable)과 작업 트리가 없는 것(bare)은 뺀다. */
async function worktrees(folder: string) {
  // -z: 줄 끝이 NUL, 워크트리 하나가 끝나면 NUL이 하나 더 온다. 경로에 줄바꿈이 있어도 그대로 읽는다.
  const list = await git(folder, "worktree", "list", "--porcelain", "-z");
  return list.split("\0\0").flatMap((record) => {
    const [first = "", ...attributes] = record.split("\0");
    const gone = attributes.some((line) => line === "bare" || line.startsWith("prunable"));
    return first.startsWith("worktree ") && !gone ? [first.slice("worktree ".length)] : [];
  });
}

/**
 * `folder`(등록한 폴더)와 그 연결된 워크트리마다 체크아웃된 작업을 공유 수준대로 읽는다. 브랜치가 아니면(detached HEAD) 작업이 없다.
 * 기준 커밋은 HEAD와 `remote`의 기본 브랜치(`refs/remotes/<remote>/HEAD`)가 갈라진 지점이다.
 * 읽지 못한 워크트리는 빼고 그 까닭을 `problems`에 담는다. 하나가 안 읽혀도 나머지는 올라간다.
 */
export async function observe(folder: string, remote: string, share: ShareLevel) {
  const works: Work[] = [];
  const problems: string[] = [];
  let total = 0;
  for (const tree of await worktrees(folder)) {
    try {
      const work = await observeTree(tree);
      if (work) works.push(work);
    } catch (error) {
      problems.push(`${tree}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { works, problems };

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
          `기준 커밋을 찾지 못했다: ${remote}의 기본 브랜치를 모르거나 ${branch}와 갈라진 지점이 없다. ` +
            `git remote set-head ${remote} --auto 로 기본 브랜치를 정하라`,
        );
      },
    );
    if (share === "intent") return { branch, base, share, files: [] };
    // 기준 커밋과 작업 트리의 차이(커밋한 것과 안 한 것)와, 추적하지 않는 새 파일(gitignore된 것은 빼고).
    const [changed, untracked] = await Promise.all([
      git(tree, "diff", "--name-only", "--no-renames", "-z", base, "--"),
      git(tree, "ls-files", "--others", "--exclude-standard", "-z"),
    ]);
    const paths = [...new Set(`${changed}${untracked}`.split("\0"))]
      .filter((path) => path && !secret(path))
      .sort();

    const files: ObservedFile[] = [];
    for (const path of paths) {
      const full = join(tree, path);
      const stat = await lstat(full).catch(() => undefined);
      if (!stat) {
        files.push({ path, deleted: true });
        continue;
      }
      if (share === "declared") {
        files.push({ path, omitted: "share" });
        continue;
      }
      if (stat.size > FILE_LIMIT) {
        files.push({ path, omitted: "too_large" });
        continue;
      }
      // 심볼릭 링크는 따라가 읽지 않는다. Git이 담는 것처럼 가리키는 경로가 내용이다.
      const bytes = stat.isSymbolicLink()
        ? await readlink(full, { encoding: "buffer" }).catch(() => undefined)
        : stat.isFile()
          ? await readFile(full).catch(() => undefined)
          : undefined; // 하위 모듈처럼 파일이 아닌 것
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
      files.push({ path, content });
    }
    return { branch, base, share, files };
  }
}
