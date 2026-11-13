// 실제 GitHub 손 점검(이슈 #124). 서버의 진짜 `GitHub`(`realGitHub`)가 실제 GitHub에서 결정 PR(#83)과
// 포스트 이슈(#122)에 필요한 일을 하는지 본다. 가짜 GitHub(`test/harness.ts`)는 우리가 생각한 GitHub이라 대신 못 한다.
// 시험용 레포에 대고 사람이 돌린다. 이름이 *.test.ts가 아니라 CI(`npm test`)는 돌리지 않는다.
// 돌리는 법과 읽는 법: docs/github-check.md
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { realGitHub } from "@omagari/server";

const USAGE = `쓰는 법: node test/real-github.ts --repo owner/name
필요한 것:
  --repo owner/name        점검에 쓸 시험용 레포. 브랜치, PR, 이슈를 만들고 머지한다. 쓰던 레포는 안 된다.
  토큰                     환경 변수 GITHUB_TOKEN, 없으면 \`gh auth token\`. 레포에 push할 수 있어야 한다.
  (선택) 환경 변수 GITHUB_REVIEWER_TOKEN  다른 계정의 토큰. 있으면 그 계정으로 변경 요청 리뷰를 단다.`;

const { values } = parseArgs({ options: { repo: { type: "string" } } });
const repo = values.repo ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error(`--repo owner/name이 필요하다.\n${USAGE}`);
  process.exit(2);
}

/** 토큰은 환경 변수, 없으면 gh. 값은 어디에도 찍지 않는다. */
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
  console.error(`토큰이 없다. GITHUB_TOKEN을 두거나 \`gh auth login\`을 하라.\n${USAGE}`);
  process.exit(2);
}
const reviewerToken = process.env.GITHUB_REVIEWER_TOKEN || undefined;

const github = realGitHub(""); // 클라이언트 id는 기기 인증에만 쓴다
const id = randomBytes(3).toString("hex");
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const progress = (line: string) =>
  console.error(`${new Date().toISOString().slice(11, 19)} ${line}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Check = { name: string; status: "pass" | "fail" | "skip"; detail: string };
const checks: Check[] = [];

/** 점검 하나. 던지면 실패로 적고 다음으로 간다. 돌려준 글이 자세한 내용이다. */
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
/** 방금 쓴 것이 읽히기까지 GitHub이 조금 걸릴 수 있어 몇 번 다시 본다. */
async function eventually<T>(read: () => Promise<T | undefined>, ok: (value: T) => boolean) {
  let last: T | undefined;
  for (let i = 0; i < 6; i++) {
    last = await read();
    if (last !== undefined && ok(last)) return last;
    await sleep(1000);
  }
  throw new Error(`6초 안에 읽히지 않았다: ${JSON.stringify(last)}`);
}

/** 인터페이스에 없는 일(리뷰, 브랜치와 라벨 지우기)을 위한 날 요청. 점검 준비와 정리에만 쓴다. */
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

const opened = { pulls: [] as number[], issues: [] as number[], branches: [] as string[] };
const label = `omagari-check-${id}`;
const file = (n: number) => ({ path: `omagari-check/${id}.txt`, content: `점검 ${id} 판 ${n}\n` });

progress(`${repo} 점검 ${id}`);
const login = await attempt("user", async () => {
  const me = await github.user(token);
  expect(me.login, "로그인 이름이 없다");
  return { detail: `${me.login}(이름 ${me.name ?? "없음"})`, value: me.login };
});
await attempt("canPush", async () => {
  const push = await github.canPush(token, repo);
  expect(push === true, `push 권한이 있다고 답하지 않았다: ${push}`);
  return { detail: "true" };
});
const base = await attempt("defaultBranch", async () => {
  const b = await github.defaultBranch(token, repo);
  expect(b.name && /^[0-9a-f]{40}$/.test(b.sha), `이름이나 sha가 이상하다: ${JSON.stringify(b)}`);
  return { detail: `${b.name} ${b.sha.slice(0, 7)}`, value: b };
});

// 결정 PR(#83)
/** 새 브랜치에 커밋 하나를 올리고 PR을 연다. */
async function newPull(b: { name: string; sha: string }, suffix: string) {
  const branch = `check/${id}-${suffix}`;
  await github.commit(token, repo, {
    branch,
    base: b.sha,
    message: `점검 ${id} ${suffix}`,
    files: [file(1)],
  });
  opened.branches.push(branch);
  const pull = await github.openPull(token, repo, {
    head: branch,
    base: b.name,
    title: `점검 ${id} ${suffix}`,
    body: "omagari의 실제 GitHub 점검(test/real-github.ts)이 연 PR이다. 점검이 끝나면 닫힌다.",
  });
  opened.pulls.push(pull.number);
  return { branch, ...pull };
}

if (base) {
  const m = await attempt("commit + openPull", async () => {
    const pull = await newPull(base, "a");
    expect(
      pull.number > 0 && pull.url.startsWith("https://"),
      `PR이 이상하다: ${JSON.stringify(pull)}`,
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
        `열린 PR이어야 한다: ${JSON.stringify(list[0])}`,
      );
      const one = await github.pull(token, repo, m.number);
      expect(one?.title === `점검 ${id} a`, `번호로 읽은 제목이 다르다: ${JSON.stringify(one)}`);
      return { detail: `브랜치로 1개, 번호로 읽은 제목 "${one.title}"` };
    });
    await attempt("read + list", async () => {
      const f = file(1);
      const text = await github.read(token, repo, m.branch, f.path);
      expect(text === f.content, `파일 내용이 다르다: ${JSON.stringify(text)}`);
      const names = await github.list(token, repo, m.branch, "omagari-check");
      expect(names.includes(`${id}.txt`), `폴더 목록에 없다: ${JSON.stringify(names)}`);
      const none = await github.read(token, repo, m.branch, `omagari-check/없는-${id}.txt`);
      expect(none === null, `없는 파일은 null이어야 한다: ${JSON.stringify(none)}`);
      return { detail: "파일 내용, 폴더 목록, 없는 파일 null" };
    });
    await attempt("addCommit", async () => {
      const f = file(2);
      await github.addCommit(token, repo, {
        branch: m.branch,
        message: `점검 ${id} a2`,
        files: [f],
      });
      const text = await github.read(token, repo, m.branch, f.path);
      expect(text === f.content, `고쳐 올린 내용이 읽히지 않는다: ${JSON.stringify(text)}`);
      return { detail: "브랜치 끝에 커밋을 더해 내용이 바뀌었다" };
    });
    await attempt("changesRequested (리뷰 없음)", async () => {
      const who = await github.changesRequested(token, repo, m.number);
      expect(Array.isArray(who) && who.length === 0, `빈 목록이어야 한다: ${JSON.stringify(who)}`);
      return { detail: "[]" };
    });
    if (reviewerToken && login) {
      await attempt("changesRequested (변경 요청 리뷰)", async () => {
        const reviewer = (await github.user(reviewerToken)).login;
        expect(
          reviewer !== login,
          "두 번째 토큰이 같은 계정이다. GitHub은 자기 PR에 변경 요청을 못 단다",
        );
        const response = await raw(
          `/repos/${repo}/pulls/${m.number}/reviews`,
          reviewerToken,
          "POST",
          { event: "REQUEST_CHANGES", body: "점검용 변경 요청" },
        );
        expect(response.ok, `변경 요청 리뷰를 달지 못했다: HTTP ${response.status}`);
        const who = await eventually(
          () => github.changesRequested(token, repo, m.number),
          (list) => list.length > 0,
        );
        expect(
          who.length === 1 && who[0] === reviewer,
          `${reviewer}를 돌려줘야 한다: ${JSON.stringify(who)}`,
        );
        return { detail: `${reviewer}를 돌려줬다` };
      });
    } else {
      skip(
        "changesRequested (변경 요청 리뷰)",
        "GITHUB_REVIEWER_TOKEN(다른 계정의 토큰)이 없다. GitHub은 자기 PR에 변경 요청을 못 단다",
      );
    }
    await attempt("merge", async () => {
      // GitHub이 머지 가능 여부를 계산하는 데 시간이 걸려 먼저 막힐 수 있다. 몇 번 다시 한다.
      let result = await github.merge(token, repo, m.number);
      for (let i = 0; i < 5 && "reason" in result; i++) {
        await sleep(2000);
        result = await github.merge(token, repo, m.number);
      }
      expect("merged" in result, `머지되지 않았다: ${"reason" in result ? result.reason : ""}`);
      const one = await eventually(
        () => github.pull(token, repo, m.number),
        (pull) => !pull.open,
      );
      expect(one.mergedAt, `머지됐는데 mergedAt이 없다: ${JSON.stringify(one)}`);
      return { detail: `merged, mergedAt ${one.mergedAt}` };
    });
  }

  const closing = await attempt("openPull (닫을 PR)", async () => {
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
      expect(!one.mergedAt, `머지 없이 닫혀야 한다: ${JSON.stringify(one)}`);
      return { detail: "머지 없이 닫혔다" };
    });
  }
}

// 포스트 이슈(#122)
const issue = await attempt("openIssue (레포에 없는 라벨)", async () => {
  const made = await github.openIssue(token, repo, {
    title: `점검 ${id}`,
    body: "omagari의 실제 GitHub 점검이 연 이슈다. 점검이 끝나면 닫힌다.",
    labels: [label],
  });
  opened.issues.push(made.number);
  expect(
    made.number > 0 && made.url.startsWith("https://"),
    `이슈가 이상하다: ${JSON.stringify(made)}`,
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
      one.title === `점검 ${id}` && one.open,
      `제목이나 열림이 다르다: ${JSON.stringify(one)}`,
    );
    expect(one.labels.includes(label), `없던 라벨이 붙지 않았다: ${JSON.stringify(one.labels)}`);
    return { detail: `제목 "${one.title}", 라벨 ${JSON.stringify(one.labels)}, 열림` };
  });
  await attempt("comment + comments", async () => {
    const body = `점검 댓글 ${id}`;
    const made = await github.comment(token, repo, issue.number, body);
    const list = await eventually(
      () => github.comments(token, repo, issue.number),
      (comments) => comments.some((c) => c.id === made.id),
    );
    const mine = list.find((c) => c.id === made.id);
    expect(mine?.body === body && mine.login === login, `댓글이 다르다: ${JSON.stringify(mine)}`);
    return { detail: `댓글 ${made.id}, 쓴 사람 ${mine.login}` };
  });
  await attempt("closeIssue + issue", async () => {
    await github.closeIssue(token, repo, issue.number);
    const one = await eventually(
      () => github.issue(token, repo, issue.number),
      (i) => !i.open,
    );
    return { detail: `닫혔다(제목 "${one.title}")` };
  });
}

// 정리: 아직 열린 PR과 이슈를 닫고, 점검이 만든 브랜치와 라벨을 지운다.
progress("  정리");
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
      .catch((e) => leftovers.push(`이슈 #${number}: ${messageOf(e)}`));
}
for (const branch of opened.branches) {
  const path = `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const response = await raw(path, token, "DELETE").catch(() => undefined);
  if (!response?.ok && response?.status !== 422)
    leftovers.push(`브랜치 ${branch}: HTTP ${response?.status ?? "응답 없음"}`);
}
// 없는 라벨로 연 이슈는 GitHub이 라벨을 만들어 둔다. 점검이 만든 것이니 지운다.
await raw(`/repos/${repo}/labels/${encodeURIComponent(label)}`, token, "DELETE").catch(
  () => undefined,
);

const failed = checks.some((c) => c.status === "fail");
const mark = { pass: "x", fail: " ", skip: "-" } as const;
console.log(
  [
    `#### 실제 GitHub 손 점검 (${new Date().toISOString().slice(0, 10)})`,
    "",
    `\`node test/real-github.ts --repo ${repo}\`. 점검 ${id}, Node ${process.version}. 두 번째 계정: ${reviewerToken ? "있음" : "없음"}.`,
    "",
    ...checks.map((c) =>
      c.status === "skip"
        ? `- [-] ${c.name}(건너뜀): ${c.detail}`
        : `- [${mark[c.status]}] ${c.name}${c.status === "fail" ? "(실패)" : ""}: ${c.detail}`,
    ),
    "",
    leftovers.length > 0
      ? `정리하지 못한 것이 있다. 손으로 지워라:\n${leftovers.map((l) => `- ${l}`).join("\n")}`
      : "만든 PR과 이슈는 닫았고, 점검이 만든 브랜치와 라벨은 지웠다. 머지한 PR의 커밋은 기본 브랜치에 남는다.",
  ].join("\n"),
);
process.exit(failed ? 1 : 0);
