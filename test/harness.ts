// 테스트 경계의 틀. 실제 서버와 실제 러너를 임시 Git 레포 위에 띄운다.
// 조작과 확인은 서버 API(`call`)와 CLI·훅 실행 파일의 입출력으로만 한다.
// 가짜는 바깥 두 곳에만 꽂는다: GitHub(서버), 에이전트 실행기(러너).
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Executor, startRunner } from "@omagari/runner";
import { type GitHub, startServer } from "@omagari/server";

const executable = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CLI = executable("../packages/cli/src/main.ts");
const HOOK = executable("../packages/hooks/src/main.ts");

/** 실행 파일 하나를 돌리고 종료 코드와 출력을 돌려준다. 0이 아닌 종료도 결과다. */
function run(
  file: string,
  args: string[],
  options: { cwd: string; stdin?: string; keepStdinOpen?: boolean; env?: object },
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd: options.cwd, env: { ...process.env, ...options.env } },
      (error, stdout, stderr) => {
        if (child.exitCode === null)
          reject(error); // 뜨지 못했거나 신호로 죽었다
        else resolve({ code: child.exitCode, stdout, stderr });
      },
    );
    if (options.keepStdinOpen) child.stdin?.write(options.stdin ?? "");
    else child.stdin?.end(options.stdin ?? "");
  });
}

/** 커밋 하나가 있는 실제 Git 레포를 임시 폴더에 만든다. 기기의 Git 설정은 읽지 않는다. */
export async function tempRepo() {
  const folder = await mkdtemp(join(tmpdir(), "omagari-"));
  const env = {
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Omagari Test",
    GIT_AUTHOR_EMAIL: "test@omagari.invalid",
    GIT_COMMITTER_NAME: "Omagari Test",
    GIT_COMMITTER_EMAIL: "test@omagari.invalid",
  };
  const git = async (...args: string[]) => {
    const result = await run("git", args, { cwd: folder, env });
    if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await git("init", "--initial-branch=main");
  await git("commit", "--allow-empty", "--message=init");
  return { folder, git, remove: () => rm(folder, { recursive: true, force: true }) };
}

/** 서버 하나, 러너 하나, 레포 하나. 가짜를 넘기지 않으면 빈 것이 꽂힌다. */
export async function startWorld(fakes: { github?: GitHub; executor?: Executor } = {}) {
  const repo = await tempRepo();
  const server = await startServer({ github: fakes.github }).catch(async (error) => {
    await repo.remove();
    throw error;
  });
  const runner = await startRunner({
    serverUrl: server.url,
    folder: repo.folder,
    executor: fakes.executor,
  }).catch(async (error) => {
    await server.stop();
    await repo.remove();
    throw error;
  });
  return {
    repo,
    server,
    runner,
    /** `omagari <args>`를 레포 폴더에서 돌린다. */
    cli: (...args: string[]) => run(process.execPath, [CLI, ...args], { cwd: repo.folder }),
    /** 훅 실행 파일에 에이전트가 주는 입력(JSON)을 넣어 돌린다. */
    hook: (stdin: string, options: { keepStdinOpen?: boolean } = {}) =>
      run(process.execPath, [HOOK], { cwd: repo.folder, stdin, ...options }),
    async stop() {
      runner.stop();
      await server.stop();
      await repo.remove();
    },
  };
}
