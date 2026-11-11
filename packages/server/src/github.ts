/**
 * 서버의 바깥 경계: GitHub. 테스트는 여기에 가짜를 꽂는다.
 * 지금은 로그인(기기 인증)과 push 권한까지다. 초안 PR 제목과 머지 여부는 그것을 쓰는 이슈가 더한다.
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
  /** 토큰 주인의 GitHub 로그인. */
  login(token: string): Promise<string>;
  /** 토큰 주인이 `owner/name`에 push할 수 있나. GitHub이 답하지 못하면 `undefined`다. */
  canPush(token: string, repo: string): Promise<boolean | undefined>;
};

// 기기 인증: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// push 권한: GET /repos/{owner}/{repo}의 `permissions.push`(Room과 같은 방법).
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
    async login(token) {
      const response = await get("/user", token);
      if (!response.ok) throw new Error(`GitHub /user: HTTP ${response.status}`);
      return (await response.json()).login;
    },
    async canPush(token, repo) {
      const response = await get(`/repos/${repo}`, token).catch(() => undefined);
      // 401은 토큰이 끝났고, 404는 비공개 레포를 볼 수 없다. 403은 요청 한도일 수 있어 모른다고 한다.
      if (response?.status === 401 || response?.status === 404) return false;
      if (!response?.ok) return undefined;
      const push = (await response.json()).permissions?.push;
      return typeof push === "boolean" ? push : undefined;
    },
  };
}
