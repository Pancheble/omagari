/**
 * 서버의 바깥 경계: GitHub. 테스트는 여기에 가짜를 꽂는다.
 * 로그인(기기 인증), push 권한, 그리고 브랜치마다의 PR(초안 PR 제목과 머지 여부)까지다.
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
  const get = (path: string, token: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "omagari",
      },
      signal: AbortSignal.timeout(10_000),
    });

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
  };
}
