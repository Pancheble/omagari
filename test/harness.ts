// Frame for the test boundary. Starts a real server and a real runner on a temporary Git repo.
// Drive and check them only through the server API (`call`) and the input and output of the CLI and hook binaries.
// Fakes plug in at three outside places only: GitHub (server), the agent executor (runner), and the sandbox that confines check commands (runner).
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
import { type Executor, type Sandbox, type SandboxInput, startRunner } from "@omagari/runner";
import {
  type Account,
  type Giphy,
  type GitHub,
  type Pull,
  type RepoLabel,
  startServer,
} from "@omagari/server";

const executable = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const CLI = executable("../packages/cli/src/main.ts");
const HOOK = executable("../packages/hooks/src/main.ts");
const FAKE_CODEX = executable("./fake-codex.ts");
const FAKE_CLAUDE = executable("./fake-claude.ts");
const FAKE_SERVICE = executable("./fake-service.ts");

/** Puts a `name` command in the `bin` folder. Calling it runs a fake CLI script (`script`). */
const shim = (bin: string, name: string, script: string) =>
  writeFile(join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`, {
    mode: 0o755,
  });

// The Git that the runner and CLI call also doesn't read the machine's Git config (global gitignore and so on).
process.env.GIT_CONFIG_GLOBAL = devNull;
process.env.GIT_CONFIG_NOSYSTEM = "1";
// Even when tests run inside Claude Code, the CLI doesn't think it is inside Claude Code (same as CI).
delete process.env.CLAUDECODE;

/** The workspace's repo. The origin of `tempRepo` points to this repo. */
/** The sentence a status line carries (`text`), or undefined for a `files` line, which carries parts. */
export const textOf = (line: { source: string } | null | undefined) =>
  line && "text" in line ? (line.text as string) : undefined;

export const REPO = "omagari-test/space";
/** A second repo of the same account (ADR-0043). Uses PRs, issues, and labels in the fake GitHub alongside `REPO`. */
export const REPO2 = "omagari-test/other";
/** A repo of another account (ADR-0043). If the server takes both accounts, this becomes a different workspace from `REPO`. */
export const REPO3 = "other-team/code";
/** The repos in the fake GitHub. */
const REPOS = new Set([REPO, REPO2, REPO3]);

/** Runs one executable and returns the exit code and output. A non-zero exit is a result too. */
function run(
  file: string,
  args: string[],
  options: {
    cwd: string;
    stdin?: string;
    keepStdinOpen?: boolean;
    env?: object;
  },
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd: options.cwd, env: { ...process.env, ...options.env } },
      (error, stdout, stderr) => {
        if (child.exitCode === null)
          reject(error); // it didn't start, or it was killed by a signal
        else resolve({ code: child.exitCode, stdout, stderr });
      },
    );
    // Writing to an executable (git, etc.) that exits without reading its input gives EPIPE. That is not a failure.
    // With no listener it becomes an uncaught exception, which fails the test running at the time and skips that test's cleanup.
    child.stdin?.on("error", () => {});
    if (options.keepStdinOpen) child.stdin?.write(options.stdin ?? "");
    else child.stdin?.end(options.stdin ?? "");
  });
}

/** Starts an executable that doesn't end (like the runner). Waits for output, and ends it by sending a signal. */
function launch(file: string, args: string[], options: { cwd: string; env?: object }) {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exited = once(child, "exit").then(([code]) => ({
    code,
    stdout,
    stderr,
  }));
  return {
    /** Exit code and output when it ended by itself. */
    exited,
    /** Waits until `pattern` appears in stdout and returns the match. */
    output: (pattern: RegExp) =>
      eventually(() => {
        const match = pattern.exec(stdout);
        if (!match)
          throw new Error(`Hasn't appeared yet: ${pattern}\nstdout: ${stdout}\nstderr: ${stderr}`);
        return match;
      }),
    /** Sends a signal and waits for it to end. */
    stop: (signal: NodeJS.Signals = "SIGINT") => {
      if (child.exitCode === null) child.kill(signal);
      return exited;
    },
  };
}

/**
 * One entry in a channel as text: a message a person wrote as is, a public Q&A as "QA: <question>", an alert as "Alert: <two works>",
 * a decision PR line as "Decision <event>: <title>" (with " (<reason>)" after it if blocked).
 */
export const said = (m: ChannelMessage) =>
  m.kind === "text"
    ? m.text
    : m.kind === "qa"
      ? `QA: ${m.qa.question}`
      : m.kind === "decision"
        ? `Decision ${m.event}: ${m.decision.title}${m.reason ? ` (${m.reason})` : ""}`
        : `Alert: ${m.alert.works.map((w) => `${w.login}/${w.branch}`).join(" ")}`;

/** Repeats until `check` stops throwing. Use it to check things you have to wait for (connections, rechecks). */
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

/** Returns a function that writes files into a folder. Creates the folder if it's missing. */
export const writer = (folder: string) => async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), content);
};

/** Temp folder to hold worktrees linked from outside the repo. Removed when the test ends. Takes a name and returns the path inside it. */
export async function place(t: { after: (fn: () => Promise<void>) => void }) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "omagari-worktrees-")));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return (name: string) => join(folder, name);
}

/**
 * Makes a real Git repo with one commit in a temp folder. Its origin points to `repo` (GitHub). It doesn't read the machine's Git config.
 * Like a cloned repo, the default branch main exists as the remote-tracking branch origin/main and origin/HEAD. A push is imitated with `git update-ref`.
 */
export async function tempRepo(repo = REPO) {
  // The temp folder on macOS is a symlink. Use the real path so it matches the top-level folder Git reports.
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
  return {
    folder,
    git,
    remove: () => rm(folder, { recursive: true, force: true }),
  };
}

/**
 * Fake GitHub. Device login is finished with `approve` instead of a person entering the code,
 * push access is given with `grant` and `revoke`. The GitHub tokens it hands out stay in `tokens`.
 * Only people listed in `names` have a profile name.
 * Open a branch's PR with `openPull`, and change the returned PR by editing it or with `merge`.
 * A repo's files are in `files` per branch. The default branch is main, and a commit uses the branch name as is.
 * PRs the server opened (decision PRs) also pile up in `pulls`, and the owner of the token that opened them is `author`. `block` blocks merging and `review` adds a review.
 * Issues the server opened (a post's issue) pile up in `issues`; what a person does on GitHub is editing the issue or adding a comment with `comment`.
 * To invalidate a token, remove it from `tokens`.
 * `app(lifetimeMs)` makes it act like a GitHub App (ADR-0053): tokens it hands out expire after `lifetimeMs` and come with a refresh token in `refreshTokens`.
 * A refresh token works once. To make GitHub reject it, remove it from `refreshTokens`.
 * `uninstall(account)` takes the App off an account: its repos are hidden from every token, like a repo that doesn't exist.
 */
export function fakeGitHub() {
  /** Push access and Admin. `repo login`. */
  const pushers = new Set<string>();
  const gates = new Map<string, Promise<void>>();
  const admins = new Set<string>();
  /** Repos in this fake and the old names of moved repos (`move`). Like GitHub, an old name redirects to the new repo. */
  const known = new Set(REPOS);
  const moves = new Map<string, string>();
  const exists = (repo: string) => known.has(moves.get(repo) ?? repo);
  /** Accounts the GitHub App isn't installed on. GitHub hides their repos from the App's tokens. */
  const uninstalled = new Set<string>();
  const hidden = (repo: string) => uninstalled.has(repo.split("/")[0] as string);
  /** GitHub numeric ids of repos and people. Assigned when first seen, and they follow a move or rename (`move`, `rename`). */
  const ids = new Map<string, number>();
  let nextId = 1;
  const idOf = (key: string) => ids.get(key) ?? (ids.set(key, nextId++), nextId - 1);
  /** Account type and avatar (changed with `account`). Without it, it's an organization with no avatar. */
  const accounts = new Map<string, Account>();
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
  /** A repo's labels. Adding a label the issue doesn't have creates it, like GitHub. */
  const labels: RepoLabel[] = [];
  let labelId = 5000;
  const labelOf = (name: string) =>
    labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
  const ensureLabel = (name: string) => {
    if (!labelOf(name)) labels.push({ id: labelId++, name, color: "ededed", description: "" });
  };
  const issueOf = (number: number) => {
    const found = issues.find((issue) => issue.number === number);
    if (!found) throw new Error("HTTP 404 Not Found");
    return found;
  };
  const commits: {
    branch: string;
    message: string;
    author: string;
    paths: string[];
  }[] = [];
  let blocked: string | undefined;
  /** Each reviewer's last review state per PR number. */
  const reviews = new Map<number, Map<string, "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED">>();
  /** The owner if the token can write to this repo. Otherwise throws, like GitHub. */
  const owner = (token: string, repo: string) => {
    const login = tokens.get(token);
    if (!exists(repo) || !login) throw new Error("HTTP 401 Bad credentials");
    return login;
  };
  const tree = (ref: string) => {
    const found = files.get(ref);
    if (!found) throw new Error(`HTTP 404 No commit found for the ref ${ref}`);
    return found;
  };
  const devices = new Map<string, { userCode: string; login?: string }>();
  const tokens = new Map<string, string>();
  /** A GitHub App's token lifetime. None for an OAuth app, whose tokens don't expire. */
  let lifetimeMs: number | undefined;
  /** Refresh tokens and whose they are. */
  const refreshTokens = new Map<string, string>();
  /** How many times a token was refreshed. */
  let refreshes = 0;
  /** Hands `login` a token: a GitHub App's expires and comes with a refresh token. */
  const issue = (login: string) => {
    if (lifetimeMs === undefined) {
      const token = `gho_fake_${crypto.randomUUID()}`;
      tokens.set(token, login);
      return { token };
    }
    const token = `ghu_fake_${crypto.randomUUID()}`;
    const refreshToken = `ghr_fake_${crypto.randomUUID()}`;
    tokens.set(token, login);
    refreshTokens.set(refreshToken, login);
    setTimeout(() => tokens.delete(token), lifetimeMs).unref();
    return { token, refreshToken, expiresInMs: lifetimeMs };
  };
  const names = new Map<string, string>();
  /** URL of a person's GitHub profile picture. Only people listed have one. */
  const avatars = new Map<string, string>();
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
      return issue(login);
    },
    async refresh(refreshToken) {
      const login = refreshTokens.get(refreshToken);
      if (!login) return { error: "The refresh token passed is incorrect or expired." };
      refreshTokens.delete(refreshToken);
      refreshes++;
      return issue(login) as { token: string; refreshToken: string; expiresInMs: number };
    },
    async user(token) {
      const login = tokens.get(token);
      if (!login) throw new Error("Unknown token");
      return {
        id: idOf(`user ${login}`),
        login,
        name: names.get(login) ?? null,
        avatar: avatars.get(login) ?? null,
      };
    },
    async canPush(token, asked) {
      await gates.get(`${asked} ${tokens.get(token)}`);
      // Like GitHub, the old name of a moved repo redirects to the new repo.
      const repo = moves.get(asked) ?? asked;
      if (!known.has(repo) || hidden(repo)) return { push: false, name: asked };
      const owner = repo.split("/")[0] as string;
      return {
        push: pushers.has(`${repo} ${tokens.get(token)}`),
        name: repo,
        id: idOf(`repo ${repo}`),
        account: accounts.get(owner) ?? { kind: "organization", avatar: null },
      };
    },
    async canAdmin(token, repo) {
      return admins.has(`${moves.get(repo) ?? repo} ${tokens.get(token)}`);
    },
    async adminRepos(token, owner) {
      const login = tokens.get(token);
      return [...admins]
        .map((key) => key.split(" ") as [string, string])
        .filter(
          ([repo, who]) =>
            who === login &&
            repo.split("/")[0]?.toLowerCase() === owner.toLowerCase() &&
            !hidden(repo),
        )
        .map(([name]) => ({
          name,
          private: true,
          pushers: [...pushers].filter((key) => key.startsWith(`${name} `)).length,
        }));
    },
    async pulls(token, repo, branch) {
      if (!exists(repo) || !tokens.has(token)) return undefined;
      return pulls
        .filter((pull) => pull.branch === branch)
        .map(({ title, draft, open, mergedAt }) => ({
          title,
          draft,
          open,
          mergedAt,
        }));
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
      commits.push({
        branch,
        message,
        author,
        paths: changed.map((f) => f.path),
      });
    },
    async openPull(token, repo, { head, base, title, body }) {
      const author = owner(token, repo);
      tree(head);
      const number = pulls.length + 1;
      pulls.push({
        branch: head,
        base,
        title,
        body,
        author,
        number,
        draft: false,
        open: true,
      });
      return { number, url: `https://github.com/${REPO}/pull/${number}` };
    },
    async pull(token, repo, number) {
      if (!exists(repo) || !tokens.has(token)) return undefined;
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
      commits.push({
        branch,
        message,
        author,
        paths: changed.map((f) => f.path),
      });
    },
    async closePull(token, repo, number) {
      owner(token, repo);
      const found = pulls.find((pull) => pull.number === number && pull.open);
      if (!found) throw new Error("HTTP 422 Pull Request is not open");
      found.open = false;
    },
    async changesRequested(token, repo, number) {
      if (!exists(repo) || !tokens.has(token)) return undefined;
      return [...(reviews.get(number) ?? [])]
        .filter(([, state]) => state === "CHANGES_REQUESTED")
        .map(([login]) => login);
    },
    async merge(token, repo, number) {
      if (!exists(repo) || !tokens.has(token)) return { reason: "HTTP 401 Bad credentials" };
      if (blocked) return { reason: blocked };
      const found = pulls.find((pull) => pull.number === number && pull.open);
      if (!found) return { reason: "HTTP 405 Pull Request is not mergeable" };
      merge(found);
      return { merged: true };
    },
    async openIssue(token, repo, { title, body, labels }) {
      const author = owner(token, repo);
      // On GitHub, PRs and issues share numbers, but in the fake the PR numbers are hard-coded in tests, so issues are counted separately from 101.
      const number = 101 + issues.length;
      for (const label of labels) ensureLabel(label);
      issues.push({
        number,
        title,
        body,
        labels,
        open: true,
        author,
        comments: [],
      });
      return { number, url: `https://github.com/${REPO}/issues/${number}` };
    },
    async issue(token, repo, number) {
      if (!exists(repo) || !tokens.has(token)) return undefined;
      const found = issues.find((issue) => issue.number === number);
      return (
        found && {
          title: found.title,
          labels: [...found.labels],
          open: found.open,
        }
      );
    },
    async comments(token, repo, number) {
      if (!exists(repo) || !tokens.has(token)) return undefined;
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
    async addLabel(token, repo, number, label) {
      owner(token, repo);
      const found = issueOf(number);
      ensureLabel(label);
      if (!found.labels.includes(label)) found.labels.push(label);
    },
    async removeLabel(token, repo, number, label) {
      owner(token, repo);
      const found = issueOf(number);
      found.labels = found.labels.filter((l) => l !== label);
    },
    async labels(token, repo) {
      if (!exists(repo) || !tokens.has(token)) return undefined;
      return labels.map((label) => ({ ...label }));
    },
    async createLabel(token, repo, label) {
      owner(token, repo);
      if (labelOf(label.name)) throw new Error("HTTP 422 Validation Failed");
      const made = { id: labelId++, ...label };
      labels.push(made);
      return { ...made };
    },
    async updateLabel(token, repo, name, label) {
      owner(token, repo);
      const found = labelOf(name);
      if (!found) throw new Error("HTTP 404 Not Found");
      // Like GitHub, the name of the label on an issue changes too.
      for (const issue of issues)
        issue.labels = issue.labels.map((l) => (l === found.name ? label.name : l));
      Object.assign(found, label);
      return { ...found };
    },
  };
  /** Merges an open PR. If that branch has files, they go into main. */
  const merge = (pull: Pull & { branch?: string }) => {
    Object.assign(pull, { open: false, mergedAt: new Date().toISOString() });
    for (const [path, content] of files.get(pull.branch ?? "") ?? [])
      tree("main").set(path, content);
  };
  return {
    github,
    tokens,
    refreshTokens,
    /** How many times the server refreshed a token. */
    get refreshes() {
      return refreshes;
    },
    /** Acts like a GitHub App from now on: tokens expire after `ms` and come with a refresh token. */
    app(ms: number) {
      lifetimeMs = ms;
    },
    /** The GitHub App is taken off (or was never installed on) account `account`. */
    uninstall: (account: string) => uninstalled.add(account),
    names,
    avatars,
    /** A person entered `userCode` in the browser and approved it with the `login` account. */
    approve(userCode: string, login: string) {
      const device = [...devices.values()].find((d) => d.userCode === userCode);
      if (!device) throw new Error(`Unknown code: ${userCode}`);
      device.login = login;
    },
    /** A person moved repo `from` to `to` on GitHub (moved to another account, or renamed). Access follows and the old name redirects to the new repo. */
    move(from: string, to: string) {
      known.delete(from);
      known.add(to);
      moves.set(from, to);
      ids.set(`repo ${to}`, idOf(`repo ${from}`));
      ids.delete(`repo ${from}`);
      for (const set of [pushers, admins])
        for (const key of [...set])
          if (key.startsWith(`${from} `)) {
            set.delete(key);
            set.add(key.replace(from, to));
          }
    },
    /** Repo `repo` was deleted on GitHub and someone created a new one with the same name. It gets a new id, and there is no old access and no redirect from the old name. */
    recreate(repo: string) {
      known.add(repo);
      moves.delete(repo);
      ids.delete(`repo ${repo}`);
      for (const set of [pushers, admins])
        for (const key of [...set]) if (key.startsWith(`${repo} `)) set.delete(key);
    },
    /** A person renamed their GitHub name from `from` to `to`. The id, token, and access follow, and someone else can take the old name. */
    rename(from: string, to: string) {
      ids.set(`user ${to}`, idOf(`user ${from}`));
      ids.delete(`user ${from}`);
      for (const map of [tokens, refreshTokens])
        for (const [token, login] of map) if (login === from) map.set(token, to);
      for (const set of [pushers, admins])
        for (const key of [...set])
          if (key.endsWith(` ${from}`)) {
            set.delete(key);
            set.add(key.replace(/ [^ ]+$/, ` ${to}`));
          }
    },
    /** Holds the access check of `login` for `repo` until `release` is called. Creates the case where a recheck stops midway. */
    hold(login: string, repo: string) {
      const gate = Promise.withResolvers<void>();
      gates.set(`${repo} ${login}`, gate.promise);
      return () => gate.resolve();
    },
    grant: (login: string, repo = REPO) => pushers.add(`${repo} ${login}`),
    revoke: (login: string, repo = REPO) => pushers.delete(`${repo} ${login}`),
    /** Creates repo `repo` in GitHub (a repo before it is put into the workspace). */
    create: (repo: string) => known.add(repo),
    /** Sets the type and avatar of account `owner` (on GitHub, a personal account or an account with an avatar). */
    account: (owner: string, account: Account) => accounts.set(owner, account),
    /** Makes `login` an Admin of `repo`. */
    admin: (login: string, repo = REPO) => admins.add(`${repo} ${login}`),
    /** Opens a PR with `branch` as head. A draft by default. */
    openPull(branch: string, title: string, draft = true) {
      const pull = { branch, title, draft, open: true };
      pulls.push(pull);
      return pull;
    },
    /** Merges an open PR. Same as a person merging on GitHub. */
    merge,
    /** Closes an open PR without merging. */
    close(pull: Pull) {
      pull.open = false;
    },
    /** A repo's files. Path and content per branch name. */
    files,
    /** Commits the server made. */
    commits,
    /** All PRs, including those the server opened. */
    pulls,
    /** `login` adds a review to PR `number`: request changes, approve, or dismiss a change request. */
    review(number: number, login: string, state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED") {
      const found = reviews.get(number) ?? new Map();
      found.set(login, state);
      reviews.set(number, found);
    },
    /** Issues the server opened. Editing the title, labels, or open state is the same as a person editing on GitHub. */
    issues,
    /** A repo's labels. Editing, adding, or removing is the same as a person doing it on GitHub (names on issues are edited separately). */
    labels,
    /** A person creates a label on GitHub. */
    createLabel(name: string, color = "ededed", description = "") {
      const made = { id: labelId++, name, color, description };
      labels.push(made);
      return made;
    },
    /** `login` adds a comment to issue `number` on GitHub. */
    comment(number: number, login: string, body: string) {
      issueOf(number).comments.push({ id: commentId++, login, body });
    },
    /** GitHub blocks merging (required review, etc.). Without a reason, it doesn't block. */
    block(reason?: string) {
      blocked = reason;
    },
  };
}

type ExecutorInput = Parameters<Executor>[0];

/**
 * Fake sandbox. Records the received command, folder, environment variables, and blocking settings in `calls`, and runs the command as is without confining it (`sh -c`).
 * Putting a reason in `unavailable` makes it a machine where the sandbox can't be used. The real sandbox may not run in CI, so it is checked by hand (ADR-0033).
 */
/**
 * Fake GIPHY (ADR-0044): an HTTP server the real `realGiphy` asks. Piles the requested URLs in `asked` and returns the GIF list from `answer` in GIPHY's shape.
 * The real GIPHY is checked by hand.
 */
export async function fakeGiphy(t: { after: (fn: () => Promise<void>) => void }) {
  const asked: URL[] = [];
  const fake = {
    asked,
    url: "",
    /** The GIPHY `data` to give for a request. Overwrite it. */
    answer: (_url: URL): unknown[] => [],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://giphy.test");
    asked.push(url);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: fake.answer(url), meta: { status: 200 } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  return fake;
}

export function fakeSandbox() {
  const fake: {
    calls: SandboxInput[];
    unavailable?: string;
    /** Pretends to be a machine like Linux that blocks all Unix sockets. */
    blocksUnixSockets?: boolean;
    sandbox: Sandbox;
  } = {
    calls: [],
    sandbox: {
      get blocksUnixSockets() {
        return fake.blocksUnixSockets;
      },
      unavailable: async () => fake.unavailable,
      wrap: async (input) => {
        fake.calls.push(input);
        return ["/bin/sh", "-c", input.command];
      },
    },
  };
  return fake;
}

/** An unusable sandbox. Plugged into a runner that wasn't given a fake, in place of the real sandbox. Keeps tests from changing with this machine's sandbox tools. */
const noSandbox: Sandbox = {
  unavailable: async () => "No fake sandbox was passed",
  wrap: () => Promise.reject(new Error("No fake sandbox was passed")),
};

/**
 * What tests that call `startRunner` directly plug in: don't launch the real Claude Code or Codex to ask what to pick, and don't inspect the real sandbox.
 * Those are slow and take seconds under load, which causes timeouts.
 */
export const stubbed = () => ({
  executors: { "claude-code": noExecutor },
  sandbox: noSandbox,
});

/** An executor that always fails. Plugged into a runner that wasn't given a fake, in place of the real executor. Keeps results from changing with the Claude Code or Codex installed on this machine. */
const noExecutor: Executor = () => Promise.reject(new Error("No fake executor was passed"));

/**
 * Fake agent executor. Records the received input and options in `calls` and gives the answer `answer` decides.
 * If there is no session to continue, it starts a new one as `session-<call number>`.
 */
export function fakeExecutor(
  answer: (input: ExecutorInput) => string | Promise<string> = () => "fake answer",
) {
  const calls: ExecutorInput[] = [];
  const executor: Executor = async (input) => {
    calls.push(input);
    const session = input.resume ?? `session-${calls.length}`;
    return { answer: await answer(input), session };
  };
  return { executor, calls };
}

/** A fake executor that doesn't answer until each Q&A is released with `release(message)`. Counts the most turns that ran at once. */
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
    release: (message: string) => gate(message).resolve(`Answer: ${message}`),
    most: () => most,
  };
}

/**
 * Puts a fake CLI (`script`) as the `name` command at the very front of this test file's PATH. Each test file is its own process, so other files don't know about it.
 * On each turn the fake writes the received args, input, and working folder to the file `callsEnv` points to. `calls()` reads that.
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
 * Puts the fake Codex CLI (`test/fake-codex.ts`) at the very front of PATH. The runner's real `codex` executor and the runner started by the CLI call this.
 * `calls()` is the args, input, and working folder `codex exec` received.
 */
export const fakeCodex = (t: { after: (fn: () => Promise<void>) => void }) =>
  fakeCli(t, "codex", FAKE_CODEX, "FAKE_CODEX_CALLS");

/**
 * Puts the fake Claude Code CLI (`test/fake-claude.ts`) at the very front of PATH. The runner's real `claudeCode` executor calls this.
 * `calls()` is the args, input, and working folder one turn (`claude -p`) received. It doesn't record the one that asks what to pick.
 */
export const fakeClaude = (t: { after: (fn: () => Promise<void>) => void }) =>
  fakeCli(t, "claude", FAKE_CLAUDE, "FAKE_CLAUDE_CALLS");

/**
 * One server, one repo, an `owner` with push access to that repo, and one runner for the owner.
 * If no fake executor is passed, an always-failing one is plugged in.
 */
export async function startWorld(
  options: {
    /** The owner runner's Claude Code executor */
    executor?: Executor;
    /** The owner runner's executors. If given, used instead of `executor`. */
    executors?: Partial<Record<ExecutorId, Executor>>;
    recheckMs?: number;
    heartbeatMs?: number;
    turnTimeoutMs?: number;
    observeMs?: number;
    share?: ShareLevel;
    followMs?: number;
    forgetMs?: number;
    /** Shortens the 30 days that changed-file content and debate patches are kept. */
    contentMs?: number;
    /** How long to keep inbox news. Shorten it to see expiry. Expiry is cleared every `followMs`. */
    inboxMs?: number;
    /** Time until a chosen presence returns to online. Shorten it to see expiry. */
    presenceDurations?: Partial<Record<PresenceDuration, number>>;
    /** Length of one hour in a decision PR's objection window. Shorten it to see the window close. */
    hourMs?: number;
    /** Number of debate rounds. If not given, the server's default (three rounds). */
    debateRounds?: number;
    /** Time until a debate expires. Shorten it to see expiry. Expiry is checked every `followMs`. */
    debateMs?: number;
    /** `OMAGARI_TOKEN_KEY`. If not given, the server makes a key file next to the database. */
    tokenKey?: string;
    /** SQL to put into the DB before the server first starts. Used to start from a DB an older version made. */
    seed?: string;
    /** The owner runner's sandbox. If not given, an unusable one is plugged in. */
    sandbox?: Sandbox;
    /** Cap on the owner runner's check command. Shorten it to see it cut off. */
    checkLimits?: { checkMs?: number; setupMs?: number; outputBytes?: number };
    /** The quiet time the owner runner waits before a merge run. Shorten it to see it. */
    quietMs?: number;
    /** The owner runner's merge run. On by default. */
    mergeCheck?: "on" | "off";
    /** The built web screen folder the server serves at the same address as the API. */
    webDir?: string;
    /** Time to finish hello. Shorten it to see it cut off. */
    helloMs?: number;
    /** The source link the settings window shows. If not given, the server's default (Omagari's repo). */
    sourceUrl?: string;
    /** Pretends to be a server running on Fly (trusts Fly-Client-IP). */
    behindFly?: boolean;
    /** Accounts the server accepts and repos to put in at startup (`OMAGARI_REPO`). If not given, just `REPO`. */
    accept?: string[];
    /** GIF search. If not given, a server with no GIPHY key. Tests plug the real `realGiphy` in against the fake GIPHY (`fakeGiphy`). */
    giphy?: Giphy;
    /** The GitHub App's slug: the server signs in through a GitHub App and says to install it (ADR-0053). Not given for an OAuth app. */
    githubApp?: string;
    /** The server's limits (ADR-0052). If not given, none. */
    limits?: Parameters<typeof startServer>[0]["limits"];
    /** Fills the fake GitHub before the server first starts (labels and issues an older server left behind). */
    setup?: (github: ReturnType<typeof fakeGitHub>) => void;
  } = {},
) {
  const repo = await tempRepo();
  const data = await mkdtemp(join(tmpdir(), "omagari-server-")); // the server's DB and the CLI's config
  const cleanup = () => Promise.all([repo.remove(), rm(data, { recursive: true, force: true })]);
  const fake = fakeGitHub();
  options.setup?.(fake);
  const database = join(data, "omagari.db");
  if (options.seed) {
    const db = new DatabaseSync(database);
    db.exec(options.seed);
    db.close();
  }
  const serverOptions = {
    accept: options.accept ?? [REPO],
    github: fake.github,
    giphy: options.giphy,
    database,
    tokenKey: options.tokenKey,
    recheckMs: options.recheckMs,
    heartbeatMs: options.heartbeatMs,
    followMs: options.followMs,
    forgetMs: options.forgetMs,
    contentMs: options.contentMs,
    inboxMs: options.inboxMs,
    presenceDurations: options.presenceDurations,
    hourMs: options.hourMs,
    debateRounds: options.debateRounds,
    debateMs: options.debateMs,
    webDir: options.webDir,
    helloMs: options.helloMs,
    behindFly: options.behindFly,
    sourceUrl: options.sourceUrl,
    githubApp: options.githubApp,
    limits: options.limits,
  };
  let server = await startServer(serverOptions).catch(async (error) => {
    await cleanup();
    throw error;
  });
  /** Only the server was shut down with `stopServer`. */
  let serverDown = false;

  /** Finishes device login through the API and returns a peer to call with that account's session. */
  const login = async (name: string) => {
    const started = await call(server, api.login);
    fake.approve(started.userCode, name);
    for (;;) {
      await sleep(started.intervalMs);
      const polled = await call(server, api.loginPoll, {
        device: started.device,
      });
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
    // If no fake was passed, plug in an always-failing one instead of the real executor.
    executors: options.executors ?? {
      "claude-code": options.executor ?? noExecutor,
    },
    turnTimeoutMs: options.turnTimeoutMs,
    observeMs: options.observeMs,
    share: options.share,
    sandbox: options.sandbox ?? noSandbox,
    checkLimits: options.checkLimits,
    quietMs: options.quietMs,
    mergeCheck: options.mergeCheck,
  }).catch(async (error) => {
    await server.stop();
    await cleanup();
    throw error;
  });
  // The user settings of Claude Code and Codex that the CLI installs or reads are also put in a temp folder. Tests don't touch this machine's ~/.claude and ~/.codex.
  // A runner started by the CLI also reads this Codex config, and with no login it doesn't attach Codex.
  // A runner started by the CLI uses the real Claude Code executor and asks what to pick when it starts. Put a fake at the front of PATH so it calls that instead of this machine's claude.
  const bin = join(data, "bin");
  await mkdir(bin);
  await shim(bin, "claude", FAKE_CLAUDE);
  // `omagari setup` registers the background runner with launchd or systemd. Fakes stand in for both, and the plist goes to a temp home (ADR-0050).
  for (const name of ["launchctl", "systemctl"])
    await writeFile(
      join(bin, name),
      `#!/bin/sh\nexec '${process.execPath}' '${FAKE_SERVICE}' ${name} "$@"\n`,
      { mode: 0o755 },
    );
  const home = join(data, "home");
  const serviceCalls = join(data, "service-calls.jsonl");
  const cliEnv = () => ({
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    HOME: home,
    FAKE_SERVICE_CALLS: serviceCalls,
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
    /** The server's SQLite file. */
    database,
    owner,
    runner,
    login,
    /** Folder where the CLI keeps sessions. */
    config: join(data, "config"),
    /** This machine's Claude Code user config folder (where `~/.claude` would be). `omagari setup` installs here. */
    claude: join(data, "claude"),
    /** This machine's Codex user config folder (where `~/.codex` would be). `omagari setup` installs here. */
    codex: join(data, "codex"),
    /** This machine's home folder for the CLI. The launchd plist goes under it. */
    home,
    /** The launchctl and systemctl commands the CLI ran, each as `[command, ...args]`. */
    serviceCalls: async (): Promise<string[][]> =>
      (await readFile(serviceCalls, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    /** Runs `omagari setup` as if this machine's CLI had logged in as owner. The login flow is covered by login.test. */
    async setup(...args: string[]) {
      await this.signInCli(owner);
      return this.cli("setup", ...args);
    },
    /** Keeps a session as if this machine's CLI had logged in as `as`. The flow of logging in through the CLI is covered by login.test. */
    async signInCli(as: { session: string }) {
      await mkdir(join(data, "config", "omagari"), { recursive: true });
      await writeFile(
        join(data, "config", "omagari", "sessions.json"),
        JSON.stringify({ [server.url]: as.session }),
      );
    },
    /**
     * One agent state per member, as seen by member `as`. If an agent is attached, its state;
     * if not (even if the runner was never started so there is no agent), offline.
     */
    agents: async (as: { url: string; session: string }) =>
      Object.fromEntries(
        (await call(as, api.members)).members.map((member) => [
          member.login,
          member.agents.find((agent) => agent.state !== "offline")?.state ?? "offline",
        ]),
      ),
    /** `as` creates a chat channel and returns its id. */
    channel: async (as: { url: string; session: string }, name = "일반") =>
      (await call(as, api.createChannel, { name })).channel.id,
    /**
     * `as` asks their own agent (Claude Code by default) by DM in a channel. Returns the Q&A that is waiting for an answer.
     * `pick` is the chosen model and effort. If not given, it's "default".
     */
    ask: async (
      as: { url: string; session: string; login: string },
      channel: string,
      message: string,
      executor: ExecutorId = "claude-code",
      pick: ModelPick = {},
    ) =>
      (
        await call(as, api.ask, {
          agent: as.login,
          executor,
          channel,
          message,
          ...pick,
        })
      ).qa,
    /** Waits until the Q&A `qa` in `as`'s DM gets an answer or fails, and returns that Q&A. */
    settled: (as: { url: string; session: string }, qa: Qa, timeoutMs?: number) =>
      eventually(async () => {
        const { qas } = await call(as, api.dms, { channel: qa.channel });
        const found = qas.find((other) => other.id === qa.id);
        assert.ok(found && found.answer.state !== "pending", "Still waiting for an answer");
        return found;
      }, timeoutMs),
    /** Observations per work, as seen by member `as`. */
    works: async (as: { url: string; session: string }) => (await call(as, api.works)).works,
    /**
     * Opens a live connection with `as`'s session as the web does and sends hello. Returns the first thing the server sent (welcome or a refusal).
     * With `after`, it continues receiving messages after that number. `on` is the workspace or repo to receive (the first workspace if not given).
     * Everything received piles up in `received`.
     */
    async live(
      as: { session: string },
      after?: number,
      on: { workspace?: string; repo?: string } = {},
    ) {
      const url = new URL(LIVE_SOCKET, server.url);
      url.protocol = "ws:";
      const socket = new WebSocket(url);
      const received: Message<typeof serverToWeb>[] = [];
      const closed = Promise.withResolvers<number>();
      socket.addEventListener("open", () =>
        socket.send(encode(webToServer, "hello", { session: as.session, after, ...on })),
      );
      socket.addEventListener("message", ({ data }) => {
        const decoded = decode(serverToWeb, data);
        if ("error" in decoded)
          throw new Error(
            `Received something that differs from the contract: ${decoded.error.message}`,
          );
        received.push(decoded.message);
      });
      socket.addEventListener("close", ({ code }) => closed.resolve(code));
      await eventually(() => assert(received.length > 0 || socket.readyState === WebSocket.CLOSED));
      return {
        received,
        /** Only channel messages received, in the order received. */
        messages: () => received.flatMap((m) => (m.kind === "message" ? [m.payload] : [])),
        /** The last member list received. Throws if none yet. Wait for it with `eventually`. */
        members() {
          const last = received.findLast((m) => m.kind === "members");
          if (!last) throw new Error("No member list received yet");
          return last.payload.members;
        },
        /** The closed code. 1008 if the server refuses. */
        closed: closed.promise,
        close() {
          socket.close();
          return closed.promise;
        },
      };
    },
    /** Shuts down only the server. Runners stay on and try to reconnect. Restart with `restartServer`. */
    async stopServer() {
      serverDown = true;
      await server.stop();
    },
    /** Shuts down the server and restarts it on the same port with the same DB. Same as the server restarting on a deploy. */
    async restartServer(override: { contentMs?: number; tokenKey?: string } = {}) {
      const { port } = new URL(server.url);
      if (!serverDown) await server.stop();
      server = await startServer({ ...serverOptions, ...override, port: Number(port) });
      serverDown = false;
    },
    /**
     * One repo folder of member `as` and the runner started in that folder. Each member has their own machine. Observation runs briefly.
     * If `executors` isn't given, an always-failing Claude Code executor is plugged in. `extra` is what else to pass to the runner (sandbox, quiet time) and the folder's remote repo.
     */
    async desk(
      as: { session: string },
      share?: ShareLevel,
      executors: Partial<Record<ExecutorId, Executor>> = {
        "claude-code": noExecutor,
      },
      {
        repo: on,
        ...extra
      }: {
        sandbox?: Sandbox;
        quietMs?: number;
        mergeCheck?: "on" | "off";
        /** The folder's remote repo. If not given, `REPO`. */
        repo?: string;
      } = {},
    ) {
      const repo = await tempRepo(on);
      const options = {
        serverUrl: server.url,
        folder: repo.folder,
        session: as.session,
        executors,
        observeMs: 50,
        share,
        sandbox: noSandbox,
        ...extra,
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
    /**
     * Makes one more linked worktree of the owner repo with a new `branch`, and returns that folder. One of the owner's runners observes along with it.
     * It's one person running a separate session per branch (ADR-0041). Put inside the server's temp folder so it's removed with it.
     */
    async worktree(branch: string) {
      const folder = join(await realpath(data), "trees", branch);
      await repo.git("worktree", "add", "-b", branch, folder);
      return folder;
    },
    /** Runs `omagari <args>` in the repo folder. */
    cli: (...args: string[]) =>
      run(process.execPath, [CLI, ...args], {
        cwd: repo.folder,
        env: cliEnv(),
      }),
    /** Runs `omagari <args>` in `cwd`. */
    cliIn: (cwd: string, ...args: string[]) =>
      run(process.execPath, [CLI, ...args], { cwd, env: cliEnv() }),
    /** Runs `omagari <args>` in the repo folder without OMAGARI_SERVER. It finds the server only through the saved server address. */
    cliBare: (...args: string[]) =>
      run(process.execPath, [CLI, ...args], {
        cwd: repo.folder,
        env: { ...cliEnv(), OMAGARI_SERVER: undefined },
      }),
    /** Starts `omagari <args>` without OMAGARI_SERVER when its output must be read before it ends (the login in setup). */
    launchBare: (...args: string[]) =>
      launch(process.execPath, [CLI, ...args], {
        cwd: repo.folder,
        env: { ...cliEnv(), OMAGARI_SERVER: undefined },
      }),
    /** Starts `omagari <args>` (the runner), which doesn't end, in `cwd`. */
    launchCliIn: (cwd: string, ...args: string[]) =>
      launch(process.execPath, [CLI, ...args], { cwd, env: cliEnv() }),
    /** Like an agent does, runs one hook command line written in the config with `sh -c` in `cwd` and feeds it input (JSON). */
    // Hooks get this machine's config folder too, so they talk to this test's background runner, not the one of the person running the tests.
    shell: (command: string, stdin: string, cwd = repo.folder) =>
      run("sh", ["-c", command], { cwd, stdin, env: cliEnv() }),
    /** Feeds the input (JSON) an agent gives to the installed hook executable of the executor (Claude Code by default) and runs it. */
    hook: (
      stdin: string,
      options: {
        keepStdinOpen?: boolean;
        executor?: ExecutorId;
        cwd?: string;
      } = {},
    ) =>
      run(process.execPath, [HOOK, options.executor ?? "claude-code"], {
        cwd: options.cwd ?? repo.folder,
        stdin,
        keepStdinOpen: options.keepStdinOpen,
        env: cliEnv(),
      }),
    async stop() {
      await runner.stop();
      if (!serverDown) await server.stop();
      await cleanup();
    },
  };
}
