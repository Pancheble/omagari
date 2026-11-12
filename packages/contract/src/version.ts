// 이 체크아웃의 버전(ADR-0019). Git을 부르므로 Node에서만 쓴다. 웹이 읽는 index.ts와 따로 둔다.
import { execFileSync } from "node:child_process";

/** 이 체크아웃에서 Git을 부른다. 실패하면(Git이 없다, 클론이 아니다, 태그가 없다) 없다. */
function git(...args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: import.meta.dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * 이 체크아웃의 `git describe --tags`: 릴리즈한 커밋이면 `v0.1.0`, 그 뒤 커밋이면 `v0.1.0-3-gabc1234`.
 * 태그를 받지 못한 클론(얕은 클론 등)이면 버전을 모른다고 하고 커밋을 붙인다. package.json의 version은 읽지 않는다.
 */
export function checkoutVersion() {
  const tag = git("describe", "--tags");
  if (tag) return tag;
  const commit = git("rev-parse", "--short", "HEAD");
  return commit ? `버전 모름(커밋 ${commit})` : "버전 모름";
}
