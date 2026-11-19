// Manual check against real GitHub (issue #124). Checks that the server's real `GitHub` (`realGitHub`) does what the decision PR (#83) and
// the post issue (#122) need on real GitHub. The fake GitHub (`test/harness.ts`) is the GitHub we imagined, so it can't stand in for this.
// A person runs it against a test repo. It isn't named *.test.ts, so CI (`npm test`) doesn't run it.
// How to run and read it: docs/github-check.md
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { realGitHub } from "@omagari/server";

const USAGE = `Usage: node test/real-github.ts --repo owner/name
What you need:
  --repo owner/name        A test repo for the check. It creates branches, PRs and issues and merges them. Don't use a repo you work in.
  token                    The GITHUB_TOKEN environment variable, or \`gh auth token\` if unset. It must be able to push to the repo.
  (optional) env GITHUB_REVIEWER_TOKEN  A token for another account. If set, that account posts a changes-requested review.`;

const { values } = parseArgs({ options: { repo: { type: "string" } } });
const repo = values.repo ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error(`--repo owner/name is required.\n${USAGE}`);
  process.exit(2);
}

/** The token comes from the environment variable, or gh if unset. The value is never printed anywhere. */
function ghToken() {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
const token = process.env.GITHUB_TOKEN || ghToken();
if (!token) {
  console.error(`No token. Set GITHUB_TOKEN or run \`gh auth login\`.\n${USAGE}`);
  process.exit(2);
}
const reviewerToken = process.env.GITHUB_REVIEWER_TOKEN || undefined;

const github = realGitHub(""); // the client id is used only for device auth
const id = randomBytes(3).toString("hex");
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const progress = (line: string) =>
  console.error(`${new Date().toISOString().slice(11, 19)} ${line}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Check = { name: string; status: "pass" | "fail" | "skip"; detail: string };
const checks: Check[] = [];

/** One check. If it throws, it is recorded as a failure and we move on. The text it returns is the detail. */
async function attempt<T>(name: string, run: () => Promise<{ detail: string; value?: T }>) {
  progress(`  ${name}`);
  try {
    const { detail, value } = await run();
    checks.push({ name, status: "pass", detail });
    return value;
  } catch (error) {
    checks.push({ name, status: "fail", detail: messageOf(error) });
    return undefined;
  }
}
const skip = (name: string, detail: string) => checks.push({ name, status: "skip", detail });
function expect(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
}
/** What was just written can take GitHub a moment to become readable, so look a few times. */
async function eventually<T>(read: () => Promise<T | undefined>, ok: (value: T) => boolean) {
  let last: T | undefined;
  for (let i = 0; i < 6; i++) {
    last = await read();
    if (last !== undefined && ok(last)) return last;
    await sleep(1000);
  }
  throw new Error(`not readable within 6 seconds: ${JSON.stringify(last)}`);
}

/** A raw request for things the interface doesn't have (reviews, deleting branches and labels). Used only for setup and cleanup of the check. */
const raw = (path: string, who: string, method: string, body?: object) =>
  fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${who}`,
      accept: "application/vnd.github+json",
      "user-agent": "omagari-check",
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });

const opened = {
  pulls: [] as number[],
  issues: [] as number[],
  branches: [] as string[],
};
const label = `omagari-check-${id}`;
const file = (n: number) => ({
  path: `omagari-check/${id}.txt`,
  content: `check ${id} version ${n}\n`,
});

progress(`${repo} check ${id}`);
const login = await attempt("user", async () => {
  const me = await github.user(token);
  expect(me.login, "no login name");
  return { detail: `${me.login}(name ${me.name ?? "none"})`, value: me.login };
});
await attempt("canPush", async () => {
  const found = await github.canPush(token, repo);
  expect(found?.push === true, `didn't answer that push access exists: ${JSON.stringify(found)}`);
  return { detail: `true(GitHub's name ${found?.name})` };
});
await attempt("canAdmin", async () => {
  const admin = await github.canAdmin(token, repo);
  expect(typeof admin === "boolean", `didn't answer whether Admin: ${admin}`);
  return { detail: String(admin) };
});
await attempt("adminRepos", async () => {
  const found = await github.adminRepos(token, repo.split("/")[0] as string);
  expect(Array.isArray(found), `couldn't read the Admin repos: ${found}`);
  return {
    detail: found?.map((r) => `${r.name}(${r.pushers})`).join(", ") || "none",
  };
});
const base = await attempt("defaultBranch", async () => {
  const b = await github.defaultBranch(token, repo);
  expect(
    b.name && /^[0-9a-f]{40}$/.test(b.sha),
    `the name or sha looks wrong: ${JSON.stringify(b)}`,
  );
  return { detail: `${b.name} ${b.sha.slice(0, 7)}`, value: b };
});

// Decision PR (#83)
/** Pushes one commit on a new branch and opens a PR. */
async function newPull(b: { name: string; sha: string }, suffix: string) {
  const branch = `check/${id}-${suffix}`;
  await github.commit(token, repo, {
    branch,
    base: b.sha,
    message: `check ${id} ${suffix}`,
    files: [file(1)],
  });
  opened.branches.push(branch);
  const pull = await github.openPull(token, repo, {
    head: branch,
    base: b.name,
    title: `check ${id} ${suffix}`,
    body: "A PR opened by omagari's real GitHub check (test/real-github.ts). It is closed when the check ends.",
  });
  opened.pulls.push(pull.number);
  return { branch, ...pull };
}

if (base) {
  const m = await attempt("commit + openPull", async () => {
    const pull = await newPull(base, "a");
    expect(
      pull.number > 0 && pull.url.startsWith("https://"),
      `the PR looks wrong: ${JSON.stringify(pull)}`,
    );
    return { detail: `#${pull.number} ${pull.url}`, value: pull };
  });
  if (m) {
    await attempt("pulls + pull", async () => {
      const list = await eventually(
        () => github.pulls(token, repo, m.branch),
        (pulls) => pulls.length === 1,
      );
      expect(
        list[0].open && !list[0].draft && !list[0].mergedAt,
        `it should be an open PR: ${JSON.stringify(list[0])}`,
      );
      const one = await github.pull(token, repo, m.number);
      expect(
        one?.title === `check ${id} a`,
        `the title read by number differs: ${JSON.stringify(one)}`,
      );
      return { detail: `1 by branch, title read by number "${one.title}"` };
    });
    await attempt("read + list", async () => {
      const f = file(1);
      const text = await github.read(token, repo, m.branch, f.path);
      expect(text === f.content, `the file content differs: ${JSON.stringify(text)}`);
      const names = await github.list(token, repo, m.branch, "omagari-check");
      expect(names.includes(`${id}.txt`), `not in the folder listing: ${JSON.stringify(names)}`);
      const none = await github.read(token, repo, m.branch, `omagari-check/missing-${id}.txt`);
      expect(none === null, `a missing file should be null: ${JSON.stringify(none)}`);
      return { detail: "file content, folder listing, missing file null" };
    });
    await attempt("addCommit", async () => {
      const f = file(2);
      await github.addCommit(token, repo, {
        branch: m.branch,
        message: `check ${id} a2`,
        files: [f],
      });
      const text = await github.read(token, repo, m.branch, f.path);
      expect(text === f.content, `the updated content can't be read: ${JSON.stringify(text)}`);
      return {
        detail: "added a commit at the branch tip and the content changed",
      };
    });
    await attempt("changesRequested (no review)", async () => {
      const who = await github.changesRequested(token, repo, m.number);
      expect(
        Array.isArray(who) && who.length === 0,
        `it should be an empty list: ${JSON.stringify(who)}`,
      );
      return { detail: "[]" };
    });
    if (reviewerToken && login) {
      await attempt("changesRequested (changes-requested review)", async () => {
        const reviewer = (await github.user(reviewerToken)).login;
        expect(
          reviewer !== login,
          "the second token is the same account. GitHub can't post a changes request on your own PR",
        );
        const response = await raw(
          `/repos/${repo}/pulls/${m.number}/reviews`,
          reviewerToken,
          "POST",
          { event: "REQUEST_CHANGES", body: "changes request for the check" },
        );
        expect(response.ok, `couldn't post the changes-requested review: HTTP ${response.status}`);
        const who = await eventually(
          () => github.changesRequested(token, repo, m.number),
          (list) => list.length > 0,
        );
        expect(
          who.length === 1 && who[0] === reviewer,
          `it should return ${reviewer}: ${JSON.stringify(who)}`,
        );
        return { detail: `returned ${reviewer}` };
      });
    } else {
      skip(
        "changesRequested (changes-requested review)",
        "no GITHUB_REVIEWER_TOKEN (another account's token). GitHub can't post a changes request on your own PR",
      );
    }
    await attempt("merge", async () => {
      // GitHub takes time to work out whether it can merge, so it may block at first. Retry a few times.
      let result = await github.merge(token, repo, m.number);
      for (let i = 0; i < 5 && "reason" in result; i++) {
        await sleep(2000);
        result = await github.merge(token, repo, m.number);
      }
      expect("merged" in result, `it wasn't merged: ${"reason" in result ? result.reason : ""}`);
      const one = await eventually(
        () => github.pull(token, repo, m.number),
        (pull) => !pull.open,
      );
      expect(one.mergedAt, `it was merged but there is no mergedAt: ${JSON.stringify(one)}`);
      return { detail: `merged, mergedAt ${one.mergedAt}` };
    });
  }

  const closing = await attempt("openPull (PR to close)", async () => {
    const pull = await newPull(base, "b");
    return { detail: `#${pull.number}`, value: pull };
  });
  if (closing) {
    await attempt("closePull", async () => {
      await github.closePull(token, repo, closing.number);
      const one = await eventually(
        () => github.pull(token, repo, closing.number),
        (pull) => !pull.open,
      );
      expect(!one.mergedAt, `it should be closed without a merge: ${JSON.stringify(one)}`);
      return { detail: "closed without a merge" };
    });
  }
}

// Post issue (#122)
const issue = await attempt("openIssue (label not in the repo)", async () => {
  const made = await github.openIssue(token, repo, {
    title: `check ${id}`,
    body: "An issue opened by omagari's real GitHub check. It is closed when the check ends.",
    labels: [label],
  });
  opened.issues.push(made.number);
  expect(
    made.number > 0 && made.url.startsWith("https://"),
    `the issue looks wrong: ${JSON.stringify(made)}`,
  );
  return { detail: `#${made.number} ${made.url}`, value: made };
});
if (issue) {
  await attempt("issue", async () => {
    const one = await eventually(
      () => github.issue(token, repo, issue.number),
      () => true,
    );
    expect(
      one.title === `check ${id}` && one.open,
      `the title or open state differs: ${JSON.stringify(one)}`,
    );
    expect(
      one.labels.includes(label),
      `the label that wasn't there was not added: ${JSON.stringify(one.labels)}`,
    );
    return {
      detail: `title "${one.title}", labels ${JSON.stringify(one.labels)}, open`,
    };
  });
  await attempt("comment + comments", async () => {
    const body = `check comment ${id}`;
    const made = await github.comment(token, repo, issue.number, body);
    const list = await eventually(
      () => github.comments(token, repo, issue.number),
      (comments) => comments.some((c) => c.id === made.id),
    );
    const mine = list.find((c) => c.id === made.id);
    expect(
      mine?.body === body && mine.login === login,
      `the comment differs: ${JSON.stringify(mine)}`,
    );
    return { detail: `comment ${made.id}, written by ${mine.login}` };
  });
  // Matching the verdict (#134): adding and removing the "Confirmed" label the server uses. It must not throw even when repeated.
  await attempt("addLabel + removeLabel (Confirmed, repeated)", async () => {
    const names = async (want: boolean) =>
      (
        await eventually(
          () => github.issue(token, repo, issue.number),
          (one) => one.labels.includes("Confirmed") === want,
        )
      ).labels;
    await github.addLabel(token, repo, issue.number, "Confirmed");
    await github.addLabel(token, repo, issue.number, "Confirmed");
    const added = await names(true);
    await github.removeLabel(token, repo, issue.number, "Confirmed");
    await github.removeLabel(token, repo, issue.number, "Confirmed");
    const removed = await names(false);
    return {
      detail: `added ${JSON.stringify(added)}, removed ${JSON.stringify(removed)}`,
    };
  });
  await attempt("closeIssue + issue", async () => {
    await github.closeIssue(token, repo, issue.number);
    const one = await eventually(
      () => github.issue(token, repo, issue.number),
      (i) => !i.open,
    );
    return { detail: `closed (title "${one.title}")` };
  });
}

// Repo labels (#191): create, read from the list, and edit name, color, and description. The edited label is deleted in cleanup.
const renamedLabel = `${label}-edited`;
const repoLabel = await attempt("createLabel + labels", async () => {
  const made = await github.createLabel(token, repo, {
    name: `${label}-made`,
    color: "ff0000",
    description: "check",
  });
  const list = await eventually(
    () => github.labels(token, repo),
    (labels) => labels.some((l) => l.id === made.id),
  );
  const mine = list.find((l) => l.id === made.id);
  expect(
    mine?.name === `${label}-made` && mine.color === "ff0000" && mine.description === "check",
    `the label differs: ${JSON.stringify(mine)}`,
  );
  return {
    detail: `${made.name} (id ${made.id}), ${list.length} repo labels`,
    value: made,
  };
});
if (repoLabel) {
  await attempt("updateLabel", async () => {
    const changed = await github.updateLabel(token, repo, repoLabel.name, {
      name: renamedLabel,
      color: "000000",
      description: "edited",
    });
    expect(
      changed.id === repoLabel.id && changed.name === renamedLabel && changed.color === "000000",
      `the edited label differs: ${JSON.stringify(changed)}`,
    );
    return { detail: `${repoLabel.name} → ${changed.name}, same id` };
  });
}

// Cleanup: close PRs and issues still open, and delete the branches and labels the check made.
progress("  cleanup");
const leftovers: string[] = [];
for (const number of opened.pulls) {
  const one = await github.pull(token, repo, number).catch(() => undefined);
  if (one?.open)
    await github
      .closePull(token, repo, number)
      .catch((e) => leftovers.push(`PR #${number}: ${messageOf(e)}`));
}
for (const number of opened.issues) {
  const one = await github.issue(token, repo, number).catch(() => undefined);
  if (one?.open)
    await github
      .closeIssue(token, repo, number)
      .catch((e) => leftovers.push(`issue #${number}: ${messageOf(e)}`));
}
for (const branch of opened.branches) {
  const path = `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const response = await raw(path, token, "DELETE").catch(() => undefined);
  if (!response?.ok && response?.status !== 422)
    leftovers.push(`branch ${branch}: HTTP ${response?.status ?? "no response"}`);
}
// An issue opened with a label that isn't there makes GitHub create the label. The check made it, so delete it.
for (const name of [label, `${label}-made`, renamedLabel])
  await raw(`/repos/${repo}/labels/${encodeURIComponent(name)}`, token, "DELETE").catch(
    () => undefined,
  );

const failed = checks.some((c) => c.status === "fail");
const mark = { pass: "x", fail: " ", skip: "-" } as const;
console.log(
  [
    `#### Real GitHub manual check (${new Date().toISOString().slice(0, 10)})`,
    "",
    `\`node test/real-github.ts --repo ${repo}\`. check ${id}, Node ${process.version}. Second account: ${reviewerToken ? "yes" : "no"}.`,
    "",
    ...checks.map((c) =>
      c.status === "skip"
        ? `- [-] ${c.name}(skipped): ${c.detail}`
        : `- [${mark[c.status]}] ${c.name}${c.status === "fail" ? "(failed)" : ""}: ${c.detail}`,
    ),
    "",
    leftovers.length > 0
      ? `Some things were not cleaned up. Delete them by hand:\n${leftovers.map((l) => `- ${l}`).join("\n")}`
      : "The PRs and issues it made are closed, and the branches and labels the check made are deleted. The merged PR's commit stays on the default branch.",
  ].join("\n"),
);
process.exit(failed ? 1 : 0);
