/**
 * 서버의 바깥 경계: GitHub. 테스트는 여기에 가짜를 꽂는다.
 * 로그인(기기 인증), push 권한, 브랜치마다의 PR(초안 PR 제목과 머지 여부), 결정 PR(ADR-0025)을 열고, 고쳐 올리고, 리뷰를 읽고, 머지하고, 닫는 것,
 * 그리고 포스트의 이슈(ADR-0032)를 열고, 읽고, 댓글을 주고받고, 닫는 것까지다.
 * 결정 PR과 이슈에 쓰는 것은 GitHub이 받지 않으면(토큰이 무효, 권한 없음) 던진다. 메시지에 GitHub의 까닭이 있다.
 */
export type GitHub = {
  /** 기기 인증을 연다. `deviceCode`는 서버만 들고, 사람에게는 `userCode`를 보인다. */
  startDevice(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresInMs: number;
    intervalMs: number;
  }>;
  /** 기기 인증을 한 번 확인한다. 사람이 코드를 넣었으면 GitHub 토큰이 온다. */
  pollDevice(
    deviceCode: string,
  ): Promise<{ token: string } | { pending: true; intervalMs?: number } | { error: string }>;
  /** 토큰 주인의 GitHub 로그인, 프로필 이름, 프로필 사진 주소. 이름을 비워 두었으면 `name`이 null이다. */
  user(token: string): Promise<{ login: string; name: string | null; avatar: string | null }>;
  /**
   * 토큰 주인이 `owner/name`에 push할 수 있나와 GitHub이 지금 그 레포를 부르는 이름(`name`).
   * 레포가 옮겨지거나 이름이 바뀌었으면 GitHub이 옛 이름을 새 레포로 넘겨 주어 `name`이 새 이름이다(ADR-0043).
   * 볼 수 없으면 `name`은 물은 그대로다. GitHub이 답하지 못하면 `undefined`다.
   * 볼 수 있으면 레포 계정의 종류와 아바타(`account`)도 온다(워크스페이스의 이름 줄, 시안 101).
   */
  canPush(
    token: string,
    repo: string,
  ): Promise<{ push: boolean; name: string; account?: Account } | undefined>;
  /** 토큰 주인이 `owner/name`의 Admin인가(워크스페이스에 레포를 넣고 뺀다, ADR-0043). GitHub이 답하지 못하면 `undefined`다. */
  canAdmin(token: string, repo: string): Promise<boolean | undefined>;
  /**
   * 계정 `owner`의 레포 가운데 토큰 주인이 Admin인 것과 공개 여부, push 권한이 있는 사람 수(레포 넣기 목록, ADR-0043).
   * GitHub이 답하지 못하면 `undefined`다.
   */
  adminRepos(
    token: string,
    owner: string,
  ): Promise<{ name: string; private: boolean; pushers: number }[] | undefined>;
  /** `owner/name`에서 `branch`를 head로 하는 PR들(닫힌 것 포함). GitHub이 답하지 못하면 `undefined`다. */
  pulls(token: string, repo: string, branch: string): Promise<Pull[] | undefined>;
  /** 레포의 기본 브랜치 이름과 그 끝 커밋. */
  defaultBranch(token: string, repo: string): Promise<{ name: string; sha: string }>;
  /** 커밋 `ref`에서 파일 하나의 내용. 없으면 null이다. */
  read(token: string, repo: string, ref: string, path: string): Promise<string | null>;
  /** 커밋 `ref`에서 폴더 바로 아래의 이름들. 폴더가 없으면 비어 있다. */
  list(token: string, repo: string, ref: string, folder: string): Promise<string[]>;
  /** 커밋 `base` 위에 `files`를 쓴 커밋 하나를 만들고 그것을 새 브랜치 `branch`로 둔다. */
  commit(
    token: string,
    repo: string,
    change: {
      branch: string;
      base: string;
      message: string;
      files: { path: string; content: string }[];
    },
  ): Promise<void>;
  /** `head` 브랜치에서 `base` 브랜치로 PR을 연다. */
  openPull(
    token: string,
    repo: string,
    pull: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }>;
  /** 번호로 PR 하나. GitHub이 답하지 못하면 `undefined`다. */
  pull(token: string, repo: string, number: number): Promise<Pull | undefined>;
  /** 이미 있는 브랜치 `branch`의 끝에 `files`를 쓴 커밋 하나를 더한다. */
  addCommit(
    token: string,
    repo: string,
    change: { branch: string; message: string; files: { path: string; content: string }[] },
  ): Promise<void>;
  /** PR을 머지하지 않고 닫는다. */
  closePull(token: string, repo: string, number: number): Promise<void>;
  /**
   * PR에 변경 요청이 걸린 사람들: 리뷰어마다 마지막 리뷰(승인, 변경 요청, 해제)가 변경 요청인 사람의 로그인.
   * 의견만 단 리뷰는 셈하지 않는다. GitHub이 답하지 못하면 `undefined`다.
   */
  changesRequested(token: string, repo: string, number: number): Promise<string[] | undefined>;
  /** PR을 머지한다. GitHub이 막으면(리뷰 필수, 검사 실패, 충돌, 토큰 무효) 그 까닭을 돌려준다. */
  merge(
    token: string,
    repo: string,
    number: number,
  ): Promise<{ merged: true } | { reason: string }>;
  /** 이슈를 연다(포스트의 이슈, ADR-0032). 라벨은 push 권한이 있는 토큰일 때만 붙는다. */
  openIssue(
    token: string,
    repo: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<{ number: number; url: string }>;
  /** 번호로 이슈 하나의 제목, 라벨 이름, 열림. GitHub이 답하지 못하면 `undefined`다. */
  issue(token: string, repo: string, number: number): Promise<Issue | undefined>;
  /** 이슈의 댓글, 오래된 것부터. GitHub이 답하지 못하면 `undefined`다. */
  comments(token: string, repo: string, number: number): Promise<Comment[] | undefined>;
  /** 이슈에 댓글을 단다. 토큰 주인의 이름으로 달린다. */
  comment(token: string, repo: string, number: number, body: string): Promise<{ id: number }>;
  /** 이슈를 닫는다(끝남). */
  closeIssue(token: string, repo: string, number: number): Promise<void>;
  /** 이슈에 라벨을 붙인다. 이미 붙어 있어도 된다. 레포에 없는 라벨이면 GitHub이 만든다. */
  addLabel(token: string, repo: string, number: number, label: string): Promise<void>;
  /** 이슈에서 라벨을 뗀다. 붙어 있지 않아도 된다. */
  removeLabel(token: string, repo: string, number: number, label: string): Promise<void>;
  /** 레포의 라벨 전부(ADR-0039). GitHub이 답하지 못하면 `undefined`다. */
  labels(token: string, repo: string): Promise<RepoLabel[] | undefined>;
  /** 레포에 라벨을 만든다. 같은 이름이 있으면 GitHub이 받지 않는다. */
  createLabel(token: string, repo: string, label: Omit<RepoLabel, "id">): Promise<RepoLabel>;
  /** 레포의 라벨 `name`의 이름, 색, 설명을 고친다. 이슈에 붙은 라벨도 GitHub에서 함께 바뀐다. */
  updateLabel(
    token: string,
    repo: string,
    name: string,
    label: Omit<RepoLabel, "id">,
  ): Promise<RepoLabel>;
};

/** GitHub 계정의 종류와 아바타 주소. */
export type Account = { kind: "organization" | "user"; avatar: string | null };

/** 레포의 GitHub 라벨. `id`는 이름이 바뀌어도 그대로다. 색은 `#` 없는 16진수다. */
export type RepoLabel = { id: number; name: string; color: string; description: string };

const repoLabel = (label: RepoLabel): RepoLabel => ({
  id: label.id,
  name: label.name,
  color: label.color,
  description: label.description ?? "",
});

export type Issue = { title: string; labels: string[]; open: boolean };
export type Comment = { id: number; login: string; body: string };

export type Pull = {
  title: string;
  draft: boolean;
  open: boolean;
  /** 머지된 시각(ISO). 머지되지 않았으면 없다. */
  mergedAt?: string;
};

// 기기 인증: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// push 권한: GET /repos/{owner}/{repo}의 `permissions.push`(Room과 같은 방법).
// 브랜치의 PR: GET /repos/{owner}/{repo}/pulls?state=all&head={owner}:{branch}
// (https://docs.github.com/en/rest/pulls/pulls#list-pull-requests). 멤버는 push 권한이 있어 같은 레포에 브랜치를 올린다.
export function realGitHub(clientId: string): GitHub {
  const post = async (url: string, body: object) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub ${url}: HTTP ${response.status}`);
    return response.json();
  };
  const request = (path: string, token: string, method = "GET", body?: object) =>
    fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "omagari",
        ...(body && { "content-type": "application/json" }),
      },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  const get = (path: string, token: string) => request(path, token);
  /** 결정 PR의 요청. 2xx가 아니면 GitHub의 까닭을 실어 던진다. */
  const send = async (path: string, token: string, method = "GET", body?: object) => {
    const response = await request(path, token, method, body);
    const json = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${json?.message ?? ""}`.trim());
    return json;
  };
  /** 커밋 `ref`에서 경로 하나의 contents. 없으면 undefined다. */
  const contents = async (token: string, repo: string, ref: string, path: string) => {
    const response = await request(
      `/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
      token,
    );
    if (response.status === 404) return undefined;
    const json = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${json?.message ?? ""}`.trim());
    return json;
  };
  /** 레포에서 토큰 주인의 권한 하나(GitHub이 돌려주는 것에 팀으로 받은 몫이 들어 있다, ADR-0043). */
  // 옮겨지거나 이름이 바뀐 레포는 옛 이름으로 물으면 301로 새 레포(`/repositories/{id}`)를 가리키고, fetch가 따라가 `full_name`이 새 이름이다
  // (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects).
  const permission = async (token: string, repo: string, kind: "push" | "admin") => {
    const response = await get(`/repos/${repo}`, token).catch(() => undefined);
    // 401은 토큰이 끝났고, 404는 비공개 레포를 볼 수 없다. 403은 요청 한도일 수 있어 모른다고 한다.
    if (response?.status === 401 || response?.status === 404) return { can: false, name: repo };
    if (!response?.ok) return undefined;
    const json = await response.json();
    const can = json.permissions?.[kind];
    if (typeof can !== "boolean") return undefined;
    // 레포의 owner는 계정(조직이나 개인)이다: `type`이 "Organization"이나 "User", `avatar_url`이 아바타다.
    const owner = json.owner as { type?: unknown; avatar_url?: unknown } | undefined;
    const account: Account | undefined = owner && {
      kind: owner.type === "User" ? "user" : "organization",
      avatar: typeof owner.avatar_url === "string" ? owner.avatar_url : null,
    };
    return { can, name: typeof json.full_name === "string" ? json.full_name : repo, account };
  };

  return {
    async startDevice() {
      // 비공개 레포의 권한을 읽으려면 OAuth 앱에는 repo 범위가 필요하다. GitHub 앱이면 범위는 무시된다.
      const b = await post("https://github.com/login/device/code", { scope: "repo" });
      if (typeof b.device_code !== "string") {
        throw new Error(`GitHub 기기 인증을 열지 못했다: ${b.error_description ?? b.error}`);
      }
      return {
        deviceCode: b.device_code,
        userCode: b.user_code,
        verificationUri: b.verification_uri,
        expiresInMs: b.expires_in * 1000,
        intervalMs: b.interval * 1000,
      };
    },
    async pollDevice(deviceCode) {
      const b = await post("https://github.com/login/oauth/access_token", {
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      if (typeof b.access_token === "string") return { token: b.access_token };
      if (b.error === "authorization_pending") return { pending: true };
      if (b.error === "slow_down") return { pending: true, intervalMs: b.interval * 1000 };
      return { error: b.error_description ?? b.error ?? "GitHub이 토큰을 주지 않았다" };
    },
    async user(token) {
      const response = await get("/user", token);
      if (!response.ok) throw new Error(`GitHub /user: HTTP ${response.status}`);
      const { login, name, avatar_url } = await response.json();
      return {
        login,
        name: name || null,
        avatar: typeof avatar_url === "string" ? avatar_url : null,
      };
    },
    async canPush(token, repo) {
      const found = await permission(token, repo, "push");
      return found && { push: found.can, name: found.name, account: found.account };
    },
    canAdmin: async (token, repo) => (await permission(token, repo, "admin"))?.can,
    // 내 레포: GET /user/repos(https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user)의 `permissions.admin`.
    // push 권한이 있는 사람: GET /repos/{owner}/{repo}/collaborators?permission=push(팀으로 받은 사람도 든다).
    // ponytail: 둘 다 첫 100개만 읽는다. 계정의 레포나 한 레포의 사람이 100을 넘으면 Link 머리말로 다음 쪽을 읽는다.
    async adminRepos(token, owner) {
      const response = await get("/user/repos?per_page=100&sort=full_name", token).catch(
        () => undefined,
      );
      if (!response?.ok) return undefined;
      const mine = (
        (await response.json()) as {
          full_name: string;
          private: boolean;
          owner: { login: string };
          permissions?: { admin?: boolean };
        }[]
      ).filter(
        (repo) => repo.owner.login.toLowerCase() === owner.toLowerCase() && repo.permissions?.admin,
      );
      const counted = await Promise.all(
        mine.map(async (repo) => {
          const people = await get(
            `/repos/${repo.full_name}/collaborators?permission=push&per_page=100`,
            token,
          ).catch(() => undefined);
          if (!people?.ok) return undefined;
          return {
            name: repo.full_name,
            private: repo.private,
            pushers: ((await people.json()) as unknown[]).length,
          };
        }),
      );
      return counted.every((repo) => repo !== undefined) ? counted : undefined;
    },
    async pulls(token, repo, branch) {
      const head = encodeURIComponent(`${repo.split("/")[0]}:${branch}`);
      const response = await get(
        `/repos/${repo}/pulls?state=all&head=${head}&per_page=100`,
        token,
      ).catch(() => undefined);
      if (!response?.ok) return undefined;
      const pulls: { title: string; draft?: boolean; state: string; merged_at: string | null }[] =
        await response.json();
      return pulls.map((pull) => ({
        title: pull.title,
        draft: pull.draft === true,
        open: pull.state === "open",
        mergedAt: pull.merged_at ?? undefined,
      }));
    },
    // 결정 PR: https://docs.github.com/en/rest/repos/contents, https://docs.github.com/en/rest/git (트리, 커밋, 참조),
    // https://docs.github.com/en/rest/pulls/pulls (열기, 읽기, 머지).
    async defaultBranch(token, repo) {
      const { default_branch: name } = await send(`/repos/${repo}`, token);
      const ref = await send(`/repos/${repo}/git/ref/heads/${encodeURIComponent(name)}`, token);
      return { name, sha: ref.object.sha };
    },
    async read(token, repo, ref, path) {
      const file = await contents(token, repo, ref, path);
      if (!file || Array.isArray(file) || typeof file.content !== "string") return null;
      return Buffer.from(file.content, "base64").toString("utf8");
    },
    async list(token, repo, ref, folder) {
      const items = await contents(token, repo, ref, folder);
      return Array.isArray(items) ? items.map((item: { name: string }) => item.name) : [];
    },
    async commit(token, repo, { branch, base, message, files }) {
      // 파일 여럿을 커밋 하나로: 기준 커밋의 트리 위에 새 트리, 그 트리의 커밋, 그 커밋을 가리키는 새 브랜치.
      const parent = await send(`/repos/${repo}/git/commits/${base}`, token);
      const tree = await send(`/repos/${repo}/git/trees`, token, "POST", {
        base_tree: parent.tree.sha,
        tree: files.map(({ path, content }) => ({ path, mode: "100644", type: "blob", content })),
      });
      const commit = await send(`/repos/${repo}/git/commits`, token, "POST", {
        message,
        tree: tree.sha,
        parents: [base],
      });
      await send(`/repos/${repo}/git/refs`, token, "POST", {
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
    },
    async openPull(token, repo, pull) {
      const opened = await send(`/repos/${repo}/pulls`, token, "POST", pull);
      return { number: opened.number, url: opened.html_url };
    },
    async pull(token, repo, number) {
      const response = await get(`/repos/${repo}/pulls/${number}`, token).catch(() => undefined);
      if (!response?.ok) return undefined;
      const pull = await response.json();
      return {
        title: pull.title,
        draft: pull.draft === true,
        open: pull.state === "open",
        mergedAt: pull.merged_at ?? undefined,
      };
    },
    async addCommit(token, repo, { branch, message, files }) {
      const ref = await send(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
      const parent = await send(`/repos/${repo}/git/commits/${ref.object.sha}`, token);
      const tree = await send(`/repos/${repo}/git/trees`, token, "POST", {
        base_tree: parent.tree.sha,
        tree: files.map(({ path, content }) => ({ path, mode: "100644", type: "blob", content })),
      });
      const commit = await send(`/repos/${repo}/git/commits`, token, "POST", {
        message,
        tree: tree.sha,
        parents: [ref.object.sha],
      });
      await send(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, "PATCH", {
        sha: commit.sha,
      });
    },
    async closePull(token, repo, number) {
      await send(`/repos/${repo}/pulls/${number}`, token, "PATCH", { state: "closed" });
    },
    // 리뷰: https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request (오래된 것부터 온다).
    // ponytail: 첫 100개만 읽는다. 결정 PR에 리뷰가 그보다 많아지면 쪽을 넘긴다.
    async changesRequested(token, repo, number) {
      const response = await get(
        `/repos/${repo}/pulls/${number}/reviews?per_page=100`,
        token,
      ).catch(() => undefined);
      if (!response?.ok) return undefined;
      const reviews: { user: { login: string } | null; state: string }[] = await response.json();
      const last = new Map<string, string>();
      for (const { user, state } of reviews)
        if (user && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state))
          last.set(user.login, state);
      return [...last].filter(([, state]) => state === "CHANGES_REQUESTED").map(([login]) => login);
    },
    async merge(token, repo, number) {
      // 레포가 허용하지 않는 머지 방법이면 405와 "not allowed"가 온다. 그때만 다음 방법을 해 본다.
      let reason = "";
      for (const method of ["merge", "squash", "rebase"]) {
        const response = await request(`/repos/${repo}/pulls/${number}/merge`, token, "PUT", {
          merge_method: method,
        }).catch((error: Error) => error);
        if (response instanceof Error) return { reason: response.message };
        if (response.ok) return { merged: true };
        const json = await response.json().catch(() => undefined);
        reason = `HTTP ${response.status} ${json?.message ?? ""}`.trim();
        if (!(response.status === 405 && /not allowed/i.test(reason))) break;
      }
      return { reason };
    },
    // 이슈: https://docs.github.com/en/rest/issues/issues, https://docs.github.com/en/rest/issues/comments
    async openIssue(token, repo, issue) {
      const opened = await send(`/repos/${repo}/issues`, token, "POST", issue);
      return { number: opened.number, url: opened.html_url };
    },
    async issue(token, repo, number) {
      const response = await get(`/repos/${repo}/issues/${number}`, token).catch(() => undefined);
      if (!response?.ok) return undefined;
      const issue = await response.json();
      return {
        title: issue.title,
        labels: issue.labels.map((label: { name: string } | string) =>
          typeof label === "string" ? label : label.name,
        ),
        open: issue.state === "open",
      };
    },
    // ponytail: 첫 100개만 읽는다. 한 포스트에 댓글이 그보다 많아지면 `since`나 쪽 넘기기로 읽는다.
    async comments(token, repo, number) {
      const response = await get(
        `/repos/${repo}/issues/${number}/comments?per_page=100`,
        token,
      ).catch(() => undefined);
      if (!response?.ok) return undefined;
      const comments: { id: number; user: { login: string } | null; body?: string }[] =
        await response.json();
      return comments.map((c) => ({
        id: c.id,
        login: c.user?.login ?? "ghost",
        body: c.body ?? "",
      }));
    },
    async comment(token, repo, number, body) {
      const made = await send(`/repos/${repo}/issues/${number}/comments`, token, "POST", { body });
      return { id: made.id };
    },
    async closeIssue(token, repo, number) {
      await send(`/repos/${repo}/issues/${number}`, token, "PATCH", {
        state: "closed",
        state_reason: "completed",
      });
    },
    // 라벨: https://docs.github.com/en/rest/issues/labels (붙이기는 POST, 떼기는 DELETE이고 붙어 있지 않으면 404다)
    async addLabel(token, repo, number, label) {
      await send(`/repos/${repo}/issues/${number}/labels`, token, "POST", { labels: [label] });
    },
    async removeLabel(token, repo, number, label) {
      const response = await request(
        `/repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
        token,
        "DELETE",
      );
      if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
    },
    // ponytail: 첫 100개만 읽는다. 레포의 라벨이 그보다 많아지면 쪽을 넘긴다.
    async labels(token, repo) {
      const response = await get(`/repos/${repo}/labels?per_page=100`, token).catch(
        () => undefined,
      );
      if (!response?.ok) return undefined;
      const labels: RepoLabel[] = await response.json();
      return labels.map(repoLabel);
    },
    async createLabel(token, repo, label) {
      return repoLabel(await send(`/repos/${repo}/labels`, token, "POST", label));
    },
    async updateLabel(token, repo, name, { name: newName, ...rest }) {
      return repoLabel(
        await send(`/repos/${repo}/labels/${encodeURIComponent(name)}`, token, "PATCH", {
          new_name: newName,
          ...rest,
        }),
      );
    },
  };
}
