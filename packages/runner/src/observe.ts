// 관측: 등록한 폴더와 그 연결된 워크트리의 Git 상태에서 작업마다 바꾼 파일과 그 내용을 읽는다(ADR-0002, ADR-0006, ADR-0007).
// 읽기만 한다. 작업 폴더의 어떤 파일도, Git이 덤으로 하는 인덱스 갱신도 쓰지 않는다.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ObservedFile, ShareLevel, Work } from "@omagari/contract";
import { compare, parsable, usesIn } from "./symbols.ts";

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
 * full이 아니면 내용 없이 경로만 읽는다. intent의 경로는 서버로 나가지 않는다(러너가 뺀다).
 * 기준 커밋은 HEAD와 `remote`의 기본 브랜치(`refs/remotes/<remote>/HEAD`)가 갈라진 지점이다.
 * 읽지 못한 워크트리는 빼고 그 까닭을 `problems`에 담는다. 하나가 안 읽혀도 나머지는 올라간다.
 * `folders`는 작업(브랜치)마다 체크아웃된 폴더다. 브랜치 하나는 워크트리 하나에만 체크아웃된다.
 */
/** 견준 정의 줄. 기준 커밋, 경로, 내용이 같으면 다시 읽지 않는다. 가장 오래 넣은 것부터 버린다. */
const compared = new Map<string, ReturnType<typeof compare>>();
const COMPARED_LIMIT = 2000;

export async function observe(folder: string, remote: string, share: ShareLevel) {
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
          `기준 커밋을 찾지 못했다: ${remote}의 기본 브랜치를 모르거나 ${branch}와 갈라진 지점이 없다. ` +
            `git remote set-head ${remote} --auto 로 기본 브랜치를 정하라`,
        );
      },
    );
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
        const definitions = share === "full" ? await changedDefinitions(path) : undefined;
        files.push({ path, deleted: true, ...(definitions?.length && { definitions }) });
        continue;
      }
      // intent도 경로는 읽는다. 러너가 서버로 보낼 때 뺀다(이 기기의 훅이 내 작업의 경로를 쓴다).
      if (share !== "full") {
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
      const definitions = stat.isFile() ? await changedDefinitions(path, content) : undefined;
      files.push({ path, content, ...(definitions?.length && { definitions }) });
    }
    return { branch, base, share, files };

    /** 기준 커밋의 판과 견준 정의 줄(ADR-0026). 내용을 올리는 파일만 부른다. 읽을 수 없는 언어면 없음이다. */
    async function changedDefinitions(path: string, content?: string) {
      if (!parsable(path)) return;
      const hash =
        content === undefined ? "deleted" : createHash("sha1").update(content).digest("hex");
      const key = `${base}\0${path}\0${hash}`;
      let found = compared.get(key);
      if (!found) {
        const before = await git(tree, "cat-file", "blob", `${base}:${path}`).catch(() => ""); // 없던 새 파일
        found = compare(path, before, content);
        compared.set(key, found);
        if (compared.size > COMPARED_LIMIT) compared.delete(compared.keys().next().value as string);
      }
      return found;
    }
  }
}

/**
 * 러너의 사본(등록한 폴더)에서 `symbol`을 쓰는 곳. 추적하는 파일과 추적하지 않는 새 파일 가운데 읽을 수 있는 언어의 것만 본다.
 * 관측처럼 gitignore된 파일과 .env 계열, 파일 하나의 상한을 넘는 것은 읽지 않는다.
 */
// ponytail: 물을 때마다 사본을 처음부터 읽는다(이름이 들어 있는 파일만 파싱한다). 자주 물으면 색인을 남겨 두고 바뀐 파일만 다시 읽는다.
export async function uses(folder: string, symbol: string) {
  const listed = await git(folder, "ls-files", "--cached", "--others", "--exclude-standard", "-z");
  const paths = [...new Set(listed.split("\0"))]
    .filter((p) => p && parsable(p) && !secret(p))
    .sort();
  const found: { path: string; line: number }[] = [];
  for (const path of paths) {
    const full = join(folder, path);
    const stat = await lstat(full).catch(() => undefined);
    if (!stat?.isFile() || stat.size > FILE_LIMIT) continue; // 지운 파일, 링크, 큰 파일
    const content = asText(await readFile(full));
    if (content === undefined) continue;
    for (const line of (await usesIn(path, content, symbol)) ?? []) found.push({ path, line });
  }
  return found;
}
