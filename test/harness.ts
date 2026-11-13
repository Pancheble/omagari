// 테스트 경계의 틀. 실제 서버와 실제 러너를 임시 Git 레포 위에 띄운다.
// 조작과 확인은 서버 API(`call`)와 CLI·훅 실행 파일의 입출력으로만 한다.
// 가짜는 바깥 두 곳에만 꽂는다: GitHub(서버), 에이전트 실행기(러너).
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type {
  ChannelMessage,
  ExecutorId,
  Message,
  ModelPick,
  PresenceDuration,
  Qa,
  ShareLevel,
} from "@omagari/contract";
import {
  api,
  call,
  decode,
  encode,
  LIVE_SOCKET,
  serverToWeb,
  webToServer,
} from "@omagari/contract";
import { type Executor, startRunner } from "@omagari/runner";
import { type GitHub, type Pull, startServer } from "@omagari/server";

const executable = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CLI = executable("../packages/cli/src/main.ts");
const HOOK = executable("../packages/hooks/src/main.ts");
const FAKE_CODEX = executable("./fake-codex.ts");
const FAKE_CLAUDE = executable("./fake-claude.ts");

/** `bin` 폴더에 `name` 명령을 둔다. 부르면 가짜 CLI 스크립트(`script`)가 돈다. */
const shim = (bin: string, name: string, script: string) =>
  writeFile(join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, {
    mode: 0o755,
  });

// 러너와 CLI가 부르는 Git도 기기의 Git 설정(전역 gitignore 등)을 읽지 않는다.
process.env.GIT_CONFIG_GLOBAL = devNull;
process.env.GIT_CONFIG_NOSYSTEM = "1";

/** 워크스페이스의 레포. `tempRepo`의 origin이 이 레포를 가리킨다. */
export const REPO = "omagari-test/space";

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
    // 입력을 읽지 않고 먼저 끝나는 실행 파일(git 등)에 쓰면 EPIPE가 난다. 그것은 실패가 아니다.
    // 듣는 곳이 없으면 잡히지 않은 예외가 되어, 그때 돌던 테스트를 실패시키고 그 테스트의 정리를 건너뛴다.
    child.stdin?.on("error", () => {});
    if (options.keepStdinOpen) child.stdin?.write(options.stdin ?? "");
    else child.stdin?.end(options.stdin ?? "");
  });
}

/** 끝나지 않는 실행 파일(러너처럼)을 띄운다. 나온 글을 기다리고, 신호를 보내 끝낸다. */
function launch(file: string, args: string[], options: { cwd: string; env?: object }) {
  const child = spawn(file, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exited = once(child, "exit").then(([code]) => ({ code, stdout, stderr }));
  return {
    /** 스스로 끝났을 때의 종료 코드와 출력. */
    exited,
    /** stdout에 `pattern`이 나올 때까지 기다리고 맞은 것을 돌려준다. */
    output: (pattern: RegExp) =>
      eventually(() => {
        const match = pattern.exec(stdout);
        if (!match)
          throw new Error(`아직 나오지 않았다: ${pattern}\nstdout: ${stdout}\nstderr: ${stderr}`);
        return match;
      }),
    /** 신호를 보내고 끝나기를 기다린다. */
    stop: (signal: NodeJS.Signals = "SIGINT") => {
      if (child.exitCode === null) child.kill(signal);
      return exited;
    },
  };
}

/**
 * 채널에 선 것 하나를 글로: 사람이 쓴 글은 그대로, 공개된 문답은 "문답: <질문>", 알림은 "알림: <두 작업>",
 * 결정 PR의 줄은 "결정 <일>: <제목>"(막혔으면 뒤에 " (<까닭>)")이다.
 */
export const said = (m: ChannelMessage) =>
  m.kind === "text"
    ? m.text
    : m.kind === "qa"
      ? `문답: ${m.qa.question}`
      : m.kind === "decision"
        ? `결정 ${m.event}: ${m.decision.title}${m.reason ? ` (${m.reason})` : ""}`
        : `알림: ${m.alert.works.map((w) => `${w.login}/${w.branch}`).join(" ")}`;

/** `check`가 던지지 않을 때까지 되풀이한다. 기다려야 보이는 것(연결, 재확인)을 확인할 때 쓴다. */
export async function eventually<T>(check: () => T | Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(20);
    }
  }
}

/** 폴더에 파일을 쓰는 함수를 돌려준다. 폴더가 없으면 만든다. */
export const writer = (folder: string) => async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), content);
};

/** 레포 밖에 연결된 워크트리를 둘 임시 폴더. 테스트가 끝나면 지운다. 이름을 받아 그 안의 경로를 돌려주는 함수를 준다. */
export async function place(t: { after: (fn: () => Promise<void>) => void }) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "omagari-worktrees-")));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return (name: string) => join(folder, name);
}

/**
 * 커밋 하나가 있는 실제 Git 레포를 임시 폴더에 만든다. origin은 `repo`(GitHub)를 가리킨다. 기기의 Git 설정은 읽지 않는다.
 * 받은(clone) 레포처럼 기본 브랜치 main이 원격 추적 브랜치 origin/main과 origin/HEAD로 있다. 푸시는 `git update-ref`로 흉내 낸다.
 */
export async function tempRepo(repo = REPO) {
  // macOS의 임시 폴더는 심볼릭 링크다. Git이 내는 최상위 폴더와 같게 실제 경로로 둔다.
  const folder = await realpath(await mkdtemp(join(tmpdir(), "omagari-")));
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
  await git("remote", "add", "origin", `https://github.com/${repo}.git`);
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return { folder, git, remove: () => rm(folder, { recursive: true, force: true }) };
}

/**
 * 가짜 GitHub. 기기 인증은 사람이 코드를 넣는 대신 `approve`로 끝내고,
 * push 권한은 `grant`와 `revoke`로 준다. 내준 GitHub 토큰은 `tokens`에 남는다.
 * 프로필 이름은 `names`에 적은 사람만 있다.
 * 브랜치의 PR은 `openPull`로 열고, 돌려받은 PR을 고치거나 `merge`해 바꾼다.
 * 레포의 파일은 브랜치마다 `files`에 있다. 기본 브랜치는 main이고, 커밋은 브랜치 이름을 그대로 쓴다.
 * 서버가 연 PR(결정 PR)도 `pulls`에 쌓이고, 연 토큰의 주인이 `author`다. `block`으로 머지를 막고, `review`로 리뷰를 단다.
 * 서버가 연 이슈(포스트의 이슈)는 `issues`에 쌓이고, 사람이 GitHub에서 하는 일은 그 이슈를 고치거나 `comment`로 댓글을 단다.
 * 토큰을 무효로 하려면 `tokens`에서 지운다.
 */
export function fakeGitHub() {
  const pushers = new Set<string>();
  const pulls: (Pull & {
    branch: string;
    number?: number;
    base?: string;
    body?: string;
    author?: string;
  })[] = [];
  const files = new Map([["main", new Map<string, string>()]]);
  const issues: {
    number: number;
    title: string;
    body: string;
    labels: string[];
    open: boolean;
    author: string;
    comments: { id: number; login: string; body: string }[];
  }[] = [];
  let commentId = 1000;
  const issueOf = (number: number) => {
    const found = issues.find((issue) => issue.number === number);
    if (!found) throw new Error("HTTP 404 Not Found");
    return found;
  };
  const commits: { branch: string; message: string; author: string; paths: string[] }[] = [];
  let blocked: string | undefined;
  /** PR 번호마다 리뷰어의 마지막 리뷰 상태. */
  const reviews = new Map<number, Map<string, "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED">>();
  /** 토큰이 이 레포에 쓸 수 있으면 그 주인. 아니면 GitHub처럼 던진다. */
  const owner = (token: string, repo: string) => {
    const login = tokens.get(token);
    if (repo !== REPO || !login) throw new Error("HTTP 401 Bad credentials");
    return login;
  };
  const tree = (ref: string) => {
    const found = files.get(ref);
    if (!found) throw new Error(`HTTP 404 No commit found for the ref ${ref}`);
    return found;
  };
  const devices = new Map<string, { userCode: string; login?: string }>();
  const tokens = new Map<string, string>();
  const names = new Map<string, string>();
  const github: GitHub = {
    async startDevice() {
      const deviceCode = crypto.randomUUID();
      const userCode = `${deviceCode.slice(0, 4)}-${deviceCode.slice(4, 8)}`.toUpperCase();
      devices.set(deviceCode, { userCode });
      return {
        deviceCode,
        userCode,
        verificationUri: "https://github.com/login/device",
        expiresInMs: 60_000,
        intervalMs: 5,
      };
    },
    async pollDevice(deviceCode) {
      const login = devices.get(deviceCode)?.login;
      if (!login) return { pending: true };
      devices.delete(deviceCode);
      const token = `gho_fake_${crypto.randomUUID()}`;
      tokens.set(token, login);
      return { token };
    },
    async user(token) {
      const login = tokens.get(token);
      if (!login) throw new Error("모르는 토큰이다");
      return { login, name: names.get(login) ?? null };
    },
    async canPush(token, repo) {
      return repo === REPO && pushers.has(tokens.get(token) ?? "");
    },
    async pulls(token, repo, branch) {
      if (repo !== REPO || !tokens.has(token)) return undefined;
      return pulls
        .filter((pull) => pull.branch === branch)
        .map(({ title, draft, open, mergedAt }) => ({ title, draft, open, mergedAt }));
    },
    async defaultBranch(token, repo) {
      owner(token, repo);
      return { name: "main", sha: "main" };
    },
    async read(token, repo, ref, path) {
      owner(token, repo);
      return tree(ref).get(path) ?? null;
    },
    async list(token, repo, ref, folder) {
      owner(token, repo);
      return [...tree(ref).keys()].flatMap((path) => {
        const name = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : "";
        return name && !name.includes("/") ? [name] : [];
      });
    },
    async commit(token, repo, { branch, base, message, files: changed }) {
      const author = owner(token, repo);
      if (files.has(branch)) throw new Error("HTTP 422 Reference already exists");
      files.set(
        branch,
        new Map([...tree(base), ...changed.map((f) => [f.path, f.content] as const)]),
      );
      commits.push({ branch, message, author, paths: changed.map((f) => f.path) });
    },
    async openPull(token, repo, { head, base, title, body }) {
      const author = owner(token, repo);
      tree(head);
      const number = pulls.length + 1;
      pulls.push({ branch: head, base, title, body, author, number, draft: false, open: true });
      return { number, url: `https://github.com/${REPO}/pull/${number}` };
    },
    async pull(token, repo, number) {
      if (repo !== REPO || !tokens.has(token)) return undefined;
      const found = pulls.find((pull) => pull.number === number);
      return (
        found && {
          title: found.title,
          draft: found.draft,
          open: found.open,
          mergedAt: found.mergedAt,
        }
      );
    },
    async addCommit(token, repo, { branch, message, files: changed }) {
      const author = owner(token, repo);
      const head = tree(branch);
      for (const f of changed) head.set(f.path, f.content);
      commits.push({ branch, message, author, paths: changed.map((f) => f.path) });
    },
    async closePull(token, repo, number) {
      owner(token, repo);
      const found = pulls.find((pull) => pull.number === number && pull.open);
      if (!found) throw new Error("HTTP 422 Pull Request is not open");
      found.open = false;
    },
    async changesRequested(token, repo, number) {
      if (repo !== REPO || !tokens.has(token)) return undefined;
      return [...(reviews.get(number) ?? [])]
        .filter(([, state]) => state === "CHANGES_REQUESTED")
        .map(([login]) => login);
    },
    async merge(token, repo, number) {
      if (repo !== REPO || !tokens.has(token)) return { reason: "HTTP 401 Bad credentials" };
      if (blocked) return { reason: blocked };
      const found = pulls.find((pull) => pull.number === number && pull.open);
      if (!found) return { reason: "HTTP 405 Pull Request is not mergeable" };
      merge(found);
      return { merged: true };
    },
    async openIssue(token, repo, { title, body, labels }) {
      const author = owner(token, repo);
      // GitHub은 PR과 이슈가 번호를 함께 쓰지만, 가짜는 PR 번호가 테스트에 박혀 있어 이슈를 101부터 따로 센다.
      const number = 101 + issues.length;
      issues.push({ number, title, body, labels, open: true, author, comments: [] });
      return { number, url: `https://github.com/${REPO}/issues/${number}` };
    },
    async issue(token, repo, number) {
      if (repo !== REPO || !tokens.has(token)) return undefined;
      const found = issues.find((issue) => issue.number === number);
      return found && { title: found.title, labels: [...found.labels], open: found.open };
    },
    async comments(token, repo, number) {
      if (repo !== REPO || !tokens.has(token)) return undefined;
      return issues.find((issue) => issue.number === number)?.comments.map((c) => ({ ...c }));
    },
    async comment(token, repo, number, body) {
      const login = owner(token, repo);
      const id = commentId++;
      issueOf(number).comments.push({ id, login, body });
      return { id };
    },
    async closeIssue(token, repo, number) {
      owner(token, repo);
      issueOf(number).open = false;
    },
  };
  /** 열린 PR을 머지한다. 그 브랜치의 파일이 있으면 main에 들어간다. */
  const merge = (pull: Pull & { branch?: string }) => {
    Object.assign(pull, { open: false, mergedAt: new Date().toISOString() });
    for (const [path, content] of files.get(pull.branch ?? "") ?? [])
      tree("main").set(path, content);
  };
  return {
    github,
    tokens,
    names,
    /** 사람이 브라우저에서 `userCode`를 넣고 `login` 계정으로 승인했다. */
    approve(userCode: string, login: string) {
      const device = [...devices.values()].find((d) => d.userCode === userCode);
      if (!device) throw new Error(`모르는 코드다: ${userCode}`);
      device.login = login;
    },
    grant: (login: string) => pushers.add(login),
    revoke: (login: string) => pushers.delete(login),
    /** `branch`를 head로 하는 PR을 연다. 기본은 초안이다. */
    openPull(branch: string, title: string, draft = true) {
      const pull = { branch, title, draft, open: true };
      pulls.push(pull);
      return pull;
    },
    /** 열린 PR을 머지한다. 사람이 GitHub에서 머지한 것과 같다. */
    merge,
    /** 열린 PR을 머지하지 않고 닫는다. */
    close(pull: Pull) {
      pull.open = false;
    },
    /** 레포의 파일. 브랜치 이름마다 경로와 내용이다. */
    files,
    /** 서버가 만든 커밋. */
    commits,
    /** 서버가 연 PR까지 모든 PR. */
    pulls,
    /** `login`이 PR `number`에 리뷰를 단다. 변경 요청, 승인, 또는 변경 요청의 해제다. */
    review(number: number, login: string, state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED") {
      const found = reviews.get(number) ?? new Map();
      found.set(login, state);
      reviews.set(number, found);
    },
    /** 서버가 연 이슈. 제목, 라벨, 열림을 고치면 사람이 GitHub에서 고친 것과 같다. */
    issues,
    /** `login`이 GitHub에서 이슈 `number`에 댓글을 단다. */
    comment(number: number, login: string, body: string) {
      issueOf(number).comments.push({ id: commentId++, login, body });
    },
    /** GitHub이 머지를 막는다(리뷰 필수 등). 까닭을 주지 않으면 막지 않는다. */
    block(reason?: string) {
      blocked = reason;
    },
  };
}

type ExecutorInput = Parameters<Executor>[0];

/** 늘 실패하는 실행기. 가짜를 넘기지 않은 러너에 실제 실행기 대신 꽂는다. 이 기기에 깔린 Claude Code나 Codex에 따라 결과가 바뀌지 않게 한다. */
const noExecutor: Executor = () => Promise.reject(new Error("가짜 실행기를 넘기지 않았다"));

/**
 * 가짜 에이전트 실행기. 받은 입력과 옵션을 `calls`에 적고 `answer`가 정한 답을 낸다.
 * 이어 갈 세션이 없으면 `session-<몇 번째 부름>`으로 새 세션을 띄운다.
 */
export function fakeExecutor(
  answer: (input: ExecutorInput) => string | Promise<string> = () => "가짜 답",
) {
  const calls: ExecutorInput[] = [];
  const executor: Executor = async (input) => {
    calls.push(input);
    const session = input.resume ?? `session-${calls.length}`;
    return { answer: await answer(input), session };
  };
  return { executor, calls };
}

/** 문답마다 `release(message)`로 풀어 줄 때까지 답하지 않는 가짜 실행기. 동시에 돈 턴의 최대 수를 센다. */
export function gatedExecutor() {
  const gates = new Map<string, PromiseWithResolvers<string>>();
  const gate = (message: string) => {
    if (!gates.has(message)) gates.set(message, Promise.withResolvers());
    return gates.get(message) as PromiseWithResolvers<string>;
  };
  let running = 0;
  let most = 0;
  const fake = fakeExecutor(async ({ message }) => {
    most = Math.max(most, ++running);
    try {
      return await gate(message).promise;
    } finally {
      running--;
    }
  });
  return {
    ...fake,
    release: (message: string) => gate(message).resolve(`답: ${message}`),
    most: () => most,
  };
}

/**
 * 가짜 CLI(`script`)를 `name` 명령으로 이 테스트 파일의 PATH 맨 앞에 둔다. 테스트 파일마다 프로세스가 따로라 다른 파일은 모른다.
 * 가짜는 한 턴마다 받은 인자, 입력, 작업 폴더를 `callsEnv`가 가리키는 파일에 적는다. `calls()`가 그것이다.
 */
async function fakeCli(
  t: { after: (fn: () => Promise<void>) => void },
  name: string,
  script: string,
  callsEnv: string,
) {
  const bin = await realpath(await mkdtemp(join(tmpdir(), `omagari-${name}-`)));
  t.after(() => rm(bin, { recursive: true, force: true }));
  await shim(bin, name, script);
  const calls = join(bin, "calls.jsonl");
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env[callsEnv] = calls;
  return {
    calls: async (): Promise<{ args: string[]; input: string; cwd: string }[]> =>
      (await readFile(calls, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

/**
 * 가짜 Codex CLI(`test/fake-codex.ts`)를 PATH 맨 앞에 둔다. 러너의 실제 `codex` 실행기와 CLI가 띄운 러너가 이것을 부른다.
 * `calls()`는 `codex exec`가 받은 인자, 입력, 작업 폴더다.
 */
export const fakeCodex = (t: { after: (fn: () => Promise<void>) => void }) =>
  fakeCli(t, "codex", FAKE_CODEX, "FAKE_CODEX_CALLS");

/**
 * 가짜 Claude Code CLI(`test/fake-claude.ts`)를 PATH 맨 앞에 둔다. 러너의 실제 `claudeCode` 실행기가 이것을 부른다.
 * `calls()`는 한 턴(`claude -p`)이 받은 인자, 입력, 작업 폴더다. 고를 거리를 묻는 것은 적지 않는다.
 */
export const fakeClaude = (t: { after: (fn: () => Promise<void>) => void }) =>
  fakeCli(t, "claude", FAKE_CLAUDE, "FAKE_CLAUDE_CALLS");

/**
 * 서버 하나, 레포 하나, 그 레포에 push 권한이 있는 `owner`와 owner의 러너 하나.
 * 가짜 실행기를 넘기지 않으면 늘 실패하는 것이 꽂힌다.
 */
export async function startWorld(
  options: {
    /** owner 러너의 Claude Code 실행기 */
    executor?: Executor;
    /** owner 러너의 실행기들. 주면 `executor` 대신 이것을 쓴다. */
    executors?: Partial<Record<ExecutorId, Executor>>;
    recheckMs?: number;
    heartbeatMs?: number;
    turnTimeoutMs?: number;
    observeMs?: number;
    share?: ShareLevel;
    followMs?: number;
    forgetMs?: number;
    /** 편지함의 소식을 남겨 두는 시간. 줄여서 만료를 본다. 만료는 `followMs`마다 치운다. */
    inboxMs?: number;
    /** 고른 접속 상태가 온라인으로 돌아오기까지의 시간. 줄여서 만료를 본다. */
    presenceDurations?: Partial<Record<PresenceDuration, number>>;
    /** 결정 PR의 이의 창에서 한 시간의 길이. 줄여서 창이 닫히는 것을 본다. */
    hourMs?: number;
    /** 서버가 처음 뜨기 전에 DB에 넣을 SQL. 예전 판이 만든 DB로 띄울 때 쓴다. */
    seed?: string;
  } = {},
) {
  const repo = await tempRepo();
  const data = await mkdtemp(join(tmpdir(), "omagari-server-")); // 서버의 DB와 CLI의 설정
  const cleanup = () => Promise.all([repo.remove(), rm(data, { recursive: true, force: true })]);
  const fake = fakeGitHub();
  const database = join(data, "omagari.db");
  if (options.seed) {
    const db = new DatabaseSync(database);
    db.exec(options.seed);
    db.close();
  }
  const serverOptions = {
    repo: REPO,
    github: fake.github,
    database,
    recheckMs: options.recheckMs,
    heartbeatMs: options.heartbeatMs,
    followMs: options.followMs,
    forgetMs: options.forgetMs,
    inboxMs: options.inboxMs,
    presenceDurations: options.presenceDurations,
    hourMs: options.hourMs,
  };
  let server = await startServer(serverOptions).catch(async (error) => {
    await cleanup();
    throw error;
  });
  /** `stopServer`로 서버만 꺼 둔 채다. */
  let serverDown = false;

  /** API로 기기 인증을 마치고 그 계정의 세션으로 부를 상대를 돌려준다. */
  const login = async (name: string) => {
    const started = await call(server, api.login);
    fake.approve(started.userCode, name);
    for (;;) {
      await sleep(started.intervalMs);
      const polled = await call(server, api.loginPoll, { device: started.device });
      if ("session" in polled) return { url: server.url, session: polled.session, login: name };
    }
  };

  fake.grant("owner");
  const owner = await login("owner").catch(async (error) => {
    await server.stop();
    await cleanup();
    throw error;
  });
  const runner = await startRunner({
    serverUrl: server.url,
    folder: repo.folder,
    session: owner.session,
    // 넘긴 가짜가 없으면 실제 실행기 대신 늘 실패하는 것을 꽂는다.
    executors: options.executors ?? { "claude-code": options.executor ?? noExecutor },
    turnTimeoutMs: options.turnTimeoutMs,
    observeMs: options.observeMs,
    share: options.share,
  }).catch(async (error) => {
    await server.stop();
    await cleanup();
    throw error;
  });
  // CLI가 깔거나 읽는 Claude Code와 Codex의 사용자 설정도 임시 폴더에 둔다. 테스트가 이 기기의 ~/.claude, ~/.codex를 건드리지 않는다.
  // CLI로 켠 러너도 이 Codex 설정을 읽어, 로그인이 없으니 Codex를 붙이지 않는다.
  // CLI로 켠 러너는 실제 Claude Code 실행기를 쓰고 켤 때 고를 거리를 묻는다. 이 기기의 claude 대신 가짜를 부르게 PATH 앞에 둔다.
  const bin = join(data, "bin");
  await mkdir(bin);
  await shim(bin, "claude", FAKE_CLAUDE);
  const cliEnv = () => ({
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OMAGARI_SERVER: server.url,
    XDG_CONFIG_HOME: join(data, "config"),
    CLAUDE_CONFIG_DIR: join(data, "claude"),
    CODEX_HOME: join(data, "codex"),
  });

  return {
    repo,
    get server() {
      return server;
    },
    github: fake,
    owner,
    runner,
    login,
    /** CLI가 세션을 남기는 폴더. */
    config: join(data, "config"),
    /** 이 기기의 Claude Code 사용자 설정 폴더(`~/.claude` 자리). `omagari install`이 여기에 깐다. */
    claude: join(data, "claude"),
    /** 이 기기의 Codex 사용자 설정 폴더(`~/.codex` 자리). `omagari install`이 여기에 깐다. */
    codex: join(data, "codex"),
    /** 이 기기의 CLI가 `as`로 로그인해 둔 것처럼 세션을 남긴다. CLI로 로그인하는 흐름은 login.test가 본다. */
    async signInCli(as: { session: string }) {
      await mkdir(join(data, "config", "omagari"), { recursive: true });
      await writeFile(
        join(data, "config", "omagari", "sessions.json"),
        JSON.stringify({ [server.url]: as.session }),
      );
    },
    /**
     * 멤버 `as`의 눈으로 본 멤버마다의 에이전트 상태 하나. 붙은 에이전트가 있으면 그 상태,
     * 없으면(러너를 켠 적이 없어 에이전트가 없어도) offline이다.
     */
    agents: async (as: { url: string; session: string }) =>
      Object.fromEntries(
        (await call(as, api.members)).members.map((member) => [
          member.login,
          member.agents.find((agent) => agent.state !== "offline")?.state ?? "offline",
        ]),
      ),
    /** `as`가 채팅 채널을 만들고 그 id를 돌려준다. */
    channel: async (as: { url: string; session: string }, name = "일반") =>
      (await call(as, api.createChannel, { name })).channel.id,
    /**
     * `as`가 채널에서 자기 에이전트(기본은 Claude Code)에게 DM으로 묻는다. 답을 기다리는 문답이 돌아온다.
     * `pick`은 고른 모델과 effort다. 주지 않으면 "기본"이다.
     */
    ask: async (
      as: { url: string; session: string; login: string },
      channel: string,
      message: string,
      executor: ExecutorId = "claude-code",
      pick: ModelPick = {},
    ) => (await call(as, api.ask, { agent: as.login, executor, channel, message, ...pick })).qa,
    /** `as`의 DM에서 문답 `qa`에 답이 오거나 실패할 때까지 기다리고 그 문답을 돌려준다. */
    settled: (as: { url: string; session: string }, qa: Qa, timeoutMs?: number) =>
      eventually(async () => {
        const { qas } = await call(as, api.dms, { channel: qa.channel });
        const found = qas.find((other) => other.id === qa.id);
        assert.ok(found && found.answer.state !== "pending", "아직 답을 기다린다");
        return found;
      }, timeoutMs),
    /** 멤버 `as`의 눈으로 본 작업마다의 관측. */
    works: async (as: { url: string; session: string }) => (await call(as, api.works)).works,
    /**
     * 웹이 하듯 `as`의 세션으로 실시간 연결을 열고 hello를 보낸다. 서버가 처음 보낸 것(welcome이나 거절)을 받으면 돌려준다.
     * `after`를 주면 그 번호 뒤의 메시지를 이어 받는다. 받은 것은 모두 `received`에 쌓인다.
     */
    async live(as: { session: string }, after?: number) {
      const url = new URL(LIVE_SOCKET, server.url);
      url.protocol = "ws:";
      const socket = new WebSocket(url);
      const received: Message<typeof serverToWeb>[] = [];
      const closed = Promise.withResolvers<number>();
      socket.addEventListener("open", () =>
        socket.send(encode(webToServer, "hello", { session: as.session, after })),
      );
      socket.addEventListener("message", ({ data }) => {
        const decoded = decode(serverToWeb, data);
        if ("error" in decoded)
          throw new Error(`계약과 다른 것을 받았다: ${decoded.error.message}`);
        received.push(decoded.message);
      });
      socket.addEventListener("close", ({ code }) => closed.resolve(code));
      await eventually(() => assert(received.length > 0 || socket.readyState === WebSocket.CLOSED));
      return {
        received,
        /** 받은 채널 메시지만, 받은 순서대로. */
        messages: () => received.flatMap((m) => (m.kind === "message" ? [m.payload] : [])),
        /** 마지막으로 받은 멤버 목록. 아직 없으면 던진다. `eventually`로 기다린다. */
        members() {
          const last = received.findLast((m) => m.kind === "members");
          if (!last) throw new Error("아직 받은 멤버 목록이 없다");
          return last.payload.members;
        },
        /** 닫힌 코드. 서버가 거절하면 1008이다. */
        closed: closed.promise,
        close() {
          socket.close();
          return closed.promise;
        },
      };
    },
    /** 서버만 끈다. 러너들은 켜진 채 다시 붙으려 한다. `restartServer`로 다시 띄운다. */
    async stopServer() {
      serverDown = true;
      await server.stop();
    },
    /** 서버를 끄고 같은 포트, 같은 DB로 다시 띄운다. 배포로 서버가 다시 뜨는 것과 같다. */
    async restartServer() {
      const { port } = new URL(server.url);
      if (!serverDown) await server.stop();
      server = await startServer({ ...serverOptions, port: Number(port) });
      serverDown = false;
    },
    /**
     * 멤버 `as`의 레포 폴더 하나와 그 폴더에서 켠 러너. 멤버마다 기기가 따로다. 관측은 짧게 돈다.
     * `executors`를 주지 않으면 늘 실패하는 Claude Code 실행기가 꽂힌다.
     */
    async desk(
      as: { session: string },
      share?: ShareLevel,
      executors: Partial<Record<ExecutorId, Executor>> = { "claude-code": noExecutor },
    ) {
      const repo = await tempRepo();
      const options = {
        serverUrl: server.url,
        folder: repo.folder,
        session: as.session,
        executors,
        observeMs: 50,
        share,
      };
      let runner = await startRunner(options);
      return {
        ...repo,
        stop: () => runner.stop(),
        async start() {
          runner = await startRunner(options);
        },
        async remove() {
          await runner.stop();
          await repo.remove();
        },
      };
    },
    /** `omagari <args>`를 레포 폴더에서 돌린다. */
    cli: (...args: string[]) =>
      run(process.execPath, [CLI, ...args], { cwd: repo.folder, env: cliEnv() }),
    /** `omagari <args>`를 `cwd`에서 돌린다. */
    cliIn: (cwd: string, ...args: string[]) =>
      run(process.execPath, [CLI, ...args], { cwd, env: cliEnv() }),
    /** 끝나지 않는 `omagari <args>`(러너)를 `cwd`에서 띄운다. */
    launchCliIn: (cwd: string, ...args: string[]) =>
      launch(process.execPath, [CLI, ...args], { cwd, env: cliEnv() }),
    /** 에이전트가 하듯 설정에 적힌 훅 명령 한 줄을 `sh -c`로 `cwd`에서 돌리고 입력(JSON)을 넣는다. */
    shell: (command: string, stdin: string, cwd = repo.folder) =>
      run("sh", ["-c", command], { cwd, stdin }),
    /** 실행기(기본은 Claude Code)에 깔린 훅 실행 파일에 에이전트가 주는 입력(JSON)을 넣어 돌린다. */
    hook: (
      stdin: string,
      options: { keepStdinOpen?: boolean; executor?: ExecutorId; cwd?: string } = {},
    ) =>
      run(process.execPath, [HOOK, options.executor ?? "claude-code"], {
        cwd: options.cwd ?? repo.folder,
        stdin,
        keepStdinOpen: options.keepStdinOpen,
      }),
    async stop() {
      await runner.stop();
      if (!serverDown) await server.stop();
      await cleanup();
    },
  };
}
