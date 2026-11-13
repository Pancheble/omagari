/**
 * 서버의 바깥 경계: GitHub. 테스트는 여기에 가짜를 꽂는다.
 * 로그인(기기 인증), push 권한, 브랜치마다의 PR(초안 PR 제목과 머지 여부), 그리고 결정 PR(ADR-0025)을 여는 것과 머지하는 것까지다.
 * 결정 PR의 것은 GitHub이 받지 않으면(토큰이 무효, 권한 없음) 던진다. 메시지에 GitHub의 까닭이 있다.
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
  /** 토큰 주인의 GitHub 로그인과 프로필 이름. 이름을 비워 두었으면 `name`이 null이다. */
  user(token: string): Promise<{ login: string; name: string | null }>;
  /** 토큰 주인이 `owner/name`에 push할 수 있나. GitHub이 답하지 못하면 `undefined`다. */
  canPush(token: string, repo: string): Promise<boolean | undefined>;
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
  /** PR을 머지한다. GitHub이 막으면(리뷰 필수, 검사 실패, 충돌, 토큰 무효) 그 까닭을 돌려준다. */
  merge(
    token: string,
    repo: string,
    number: number,
  ): Promise<{ merged: true } | { reason: string }>;
};

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
      const { login, name } = await response.json();
      return { login, name: name || null };
    },
    async canPush(token, repo) {
      const response = await get(`/repos/${repo}`, token).catch(() => undefined);
      // 401은 토큰이 끝났고, 404는 비공개 레포를 볼 수 없다. 403은 요청 한도일 수 있어 모른다고 한다.
      if (response?.status === 401 || response?.status === 404) return false;
      if (!response?.ok) return undefined;
      const push = (await response.json()).permissions?.push;
      return typeof push === "boolean" ? push : undefined;
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
  };
}
