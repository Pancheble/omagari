// 서버의 계약이 더 새로워 거절당했을 때 깔린 클론을 받는다(ADR-0042). 관측하는 레포 폴더는 건드리지 않는다.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { checkoutBranch, checkoutRoot } from "@omagari/contract/version";

/** 받은 클론에서 다시 켠 러너에 주는 표. 같은 판으로 거듭 받지 않는다. */
export const UPDATED = "OMAGARI_UPDATED";

/** 실행 기록 한 줄(깔린 클론을 받음): 언제, 어느 브랜치가 어느 커밋에서 어느 커밋으로. */
export type UpdateRecord = { at: string; kind: "update"; branch: string; from: string; to: string };

/**
 * 깔린 클론에서 `git pull --ff-only`와 `npm ci`를 한다. 고친 파일이 있거나 빨리 감기가 안 되는 등
 * 받지 못하면 아무것도 바꾸지 않고 `todo`(사람이 할 일)를 돌려준다.
 */
export async function updateClone(): Promise<
  { record: Omit<UpdateRecord, "at" | "kind"> } | { todo: string }
> {
  const root = checkoutRoot();
  const branch = checkoutBranch();
  if (!root) return { todo: "이 체크아웃은 Git 클론이 아니다. 클론을 새로 받아라" };
  if (!branch) return { todo: "클론이 브랜치에 있지 않다. 브랜치로 옮겨 받아라" };
  const run = async (file: string, ...args: string[]) =>
    (await promisify(execFile)(file, args, { cwd: root })).stdout.trim();
  const fail = (what: string, error: unknown) => ({
    todo: `${what} (${root}): ${error instanceof Error ? error.message : error}`,
  });
  if (await run("git", "status", "--porcelain", "--untracked-files=no").catch(() => "?"))
    return {
      todo: `${root}에 고친 파일이 있다. 정리한 뒤 \`git pull\`, \`npm ci\`를 하고 러너를 다시 켜라`,
    };
  const from = await run("git", "rev-parse", "HEAD");
  try {
    await run("git", "pull", "--ff-only");
  } catch (error) {
    return fail("`git pull --ff-only`가 안 됐다. 직접 받아라", error);
  }
  const to = await run("git", "rev-parse", "HEAD");
  if (to === from) return { todo: `${branch}에 받을 새 커밋이 없다. 서버가 어느 판인지 확인하라` };
  try {
    await run("npm", "ci");
  } catch (error) {
    return fail(`${branch}는 받았지만 \`npm ci\`가 안 됐다. 직접 하고 러너를 다시 켜라`, error);
  }
  return { record: { branch, from, to } };
}

/** 같은 인자로 이 프로그램을 다시 띄우고 끝날 때까지 기다린다. 끄는 신호는 새 프로세스에 넘긴다. */
export function restart() {
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, [UPDATED]: "1" },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  return new Promise<number>((done) => child.on("exit", (code) => done(code ?? 1)));
}
