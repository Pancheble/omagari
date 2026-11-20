/**
 * The server's outer boundary: GitHub. Tests plug a fake in here.
 * Sign-in (device flow), push permission, the PR per branch (draft PR title and merge state), and opening, updating, reading reviews on, merging, and closing decision PRs (ADR-0025),
 * plus opening, reading, commenting on, and closing post issues (ADR-0032).
 * Writes to decision PRs and issues throw if GitHub refuses them (invalid token, no permission). The message carries GitHub's reason.
 */
export type GitHub = {
  /** Starts device flow. Only the server keeps `deviceCode`; people see `userCode`. */
  startDevice(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresInMs: number;
    intervalMs: number;
  }>;
  /**
   * Checks device flow once. If the person entered the code, a GitHub token comes back.
   * A GitHub App's token expires: it comes with `expiresInMs` and the `refreshToken` that gets the next one (ADR-0053). An OAuth app's token has neither.
   */
  pollDevice(
    deviceCode: string,
  ): Promise<Grant | { pending: true; intervalMs?: number } | { error: string }>;
  /** Swaps a GitHub App's refresh token for a new token and refresh token. `error` if GitHub rejects it (expired or used); throws if GitHub can't answer. */
  refresh(refreshToken: string): Promise<Required<Grant> | { error: string }>;
  /**
   * The token owner's GitHub numeric id, login, profile name, and avatar URL. `name` is null if they left the name blank.
   * Logins change and someone else can take them, but `id` stays with the account (#315).
   */
  user(
    token: string,
  ): Promise<{ id: number; login: string; name: string | null; avatar: string | null }>;
  /**
   * Whether the token owner can push to `owner/name`, and the name GitHub calls that repo now (`name`).
   * If the repo was moved or renamed, GitHub redirects the old name to the new repo and `name` is the new name (ADR-0043).
   * If it can't be seen, `name` is the name you asked about. If GitHub can't answer, it's `undefined`.
   * If it can be seen, you also get the repo's GitHub numeric id (`id`: the same after a move or rename, different if re-created under the same name, #315)
   * and the repo account's kind and avatar (`account`) (the workspace's name line, draft 101).
   */
  canPush(
    token: string,
    repo: string,
  ): Promise<{ push: boolean; name: string; id?: number; account?: Account } | undefined>;
  /** Whether the token owner is an Admin of `owner/name` (adding and removing repos in the workspace, ADR-0043). If GitHub can't answer, `undefined`. */
  canAdmin(token: string, repo: string): Promise<boolean | undefined>;
  /**
   * The repos of account `owner` where the token owner is an Admin, with whether each is public and how many people can push (the add-repo list, ADR-0043).
   * If GitHub can't answer, `undefined`.
   */
  adminRepos(
    token: string,
    owner: string,
  ): Promise<{ name: string; private: boolean; pushers: number }[] | undefined>;
  /** PRs in `owner/name` whose head is `branch` (closed ones included). If GitHub can't answer, `undefined`. */
  pulls(token: string, repo: string, branch: string): Promise<Pull[] | undefined>;
  /** The repo's default branch name and its tip commit. */
  defaultBranch(token: string, repo: string): Promise<{ name: string; sha: string }>;
  /** One file's content at commit `ref`. null if it doesn't exist. */
  read(token: string, repo: string, ref: string, path: string): Promise<string | null>;
  /** The names directly under a folder at commit `ref`. Empty if the folder doesn't exist. */
  list(token: string, repo: string, ref: string, folder: string): Promise<string[]>;
  /** Makes one commit that writes `files` on top of commit `base` and points the new branch `branch` at it. */
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
  /** Opens a PR from branch `head` into branch `base`. */
  openPull(
    token: string,
    repo: string,
    pull: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }>;
  /** One PR by number. If GitHub can't answer, `undefined`. */
  pull(token: string, repo: string, number: number): Promise<Pull | undefined>;
  /** Adds one commit that writes `files` to the tip of the existing branch `branch`. */
  addCommit(
    token: string,
    repo: string,
    change: { branch: string; message: string; files: { path: string; content: string }[] },
  ): Promise<void>;
  /** Closes the PR without merging. */
  closePull(token: string, repo: string, number: number): Promise<void>;
  /**
   * People with changes requested on the PR: the logins whose latest review (approve, request changes, dismiss) is a request for changes.
   * Comment-only reviews don't count. If GitHub can't answer, `undefined`.
   */
  changesRequested(token: string, repo: string, number: number): Promise<string[] | undefined>;
  /** Merges the PR. If GitHub blocks it (review required, failed check, conflict, invalid token), returns the reason. */
  merge(
    token: string,
    repo: string,
    number: number,
  ): Promise<{ merged: true } | { reason: string }>;
  /** Opens an issue (a post's issue, ADR-0032). Labels are only applied with a token that can push. */
  openIssue(
    token: string,
    repo: string,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<{ number: number; url: string }>;
  /** One issue by number: its title, label names, and whether it's open. If GitHub can't answer, `undefined`. */
  issue(token: string, repo: string, number: number): Promise<Issue | undefined>;
  /** The issue's comments, oldest first. If GitHub can't answer, `undefined`. */
  comments(token: string, repo: string, number: number): Promise<Comment[] | undefined>;
  /** Comments on the issue as the token owner. */
  comment(token: string, repo: string, number: number, body: string): Promise<{ id: number }>;
  /** Closes the issue (done). */
  closeIssue(token: string, repo: string, number: number): Promise<void>;
  /** Adds a label to the issue. It's fine if it's already there. If the repo doesn't have the label, GitHub creates it. */
  addLabel(token: string, repo: string, number: number, label: string): Promise<void>;
  /** Removes a label from the issue. It's fine if it isn't there. */
  removeLabel(token: string, repo: string, number: number, label: string): Promise<void>;
  /** All of the repo's labels (ADR-0039). If GitHub can't answer, `undefined`. */
  labels(token: string, repo: string): Promise<RepoLabel[] | undefined>;
  /** Creates a label in the repo. GitHub refuses if the name already exists. */
  createLabel(token: string, repo: string, label: Omit<RepoLabel, "id">): Promise<RepoLabel>;
  /** Changes the name, color, and description of the repo's label `name`. Issues carrying the label change on GitHub too. */
  updateLabel(
    token: string,
    repo: string,
    name: string,
    label: Omit<RepoLabel, "id">,
  ): Promise<RepoLabel>;
};

/** A token from GitHub. `refreshToken` and `expiresInMs` only come with a GitHub App's expiring token. */
export type Grant = { token: string; refreshToken?: string; expiresInMs?: number };

/** A GitHub account's kind and avatar URL. */
export type Account = { kind: "organization" | "user"; avatar: string | null };

/** A GitHub label in the repo. `id` stays the same when the name changes. The color is hex without `#`. */
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
  /** When it was merged (ISO). Absent if it wasn't merged. */
  mergedAt?: string;
};

// Device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// Push permission: `permissions.push` of GET /repos/{owner}/{repo} (same method as Room).
// A branch's PRs: GET /repos/{owner}/{repo}/pulls?state=all&head={owner}:{branch}
// (https://docs.github.com/en/rest/pulls/pulls#list-pull-requests). Members can push, so they put branches in the same repo.
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
  /** A decision PR request. If it isn't 2xx, throws with GitHub's reason attached. */
  const send = async (path: string, token: string, method = "GET", body?: object) => {
    const response = await request(path, token, method, body);
    const json = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${json?.message ?? ""}`.trim());
    return json;
  };
  /** The contents of one path at commit `ref`. undefined if it doesn't exist. */
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
  /** One of the token owner's permissions on a repo (what GitHub returns includes what they get through teams, ADR-0043). */
  // Asking for a moved or renamed repo by its old name gets a 301 to the new repo (`/repositories/{id}`), and fetch follows it, so `full_name` is the new name
  // (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects).
  const permission = async (token: string, repo: string, kind: "push" | "admin") => {
    const response = await get(`/repos/${repo}`, token).catch(() => undefined);
    // 401 means the token ended, 404 means a private repo can't be seen. 403 may be a rate limit, so we say we don't know.
    if (response?.status === 401 || response?.status === 404) return { can: false, name: repo };
    if (!response?.ok) return undefined;
    const json = await response.json();
    const can = json.permissions?.[kind];
    if (typeof can !== "boolean") return undefined;
    // The repo's owner is an account (org or person): `type` is "Organization" or "User", `avatar_url` is the avatar.
    const owner = json.owner as { type?: unknown; avatar_url?: unknown } | undefined;
    const account: Account | undefined = owner && {
      kind: owner.type === "User" ? "user" : "organization",
      avatar: typeof owner.avatar_url === "string" ? owner.avatar_url : null,
    };
    return {
      can,
      name: typeof json.full_name === "string" ? json.full_name : repo,
      id: typeof json.id === "number" ? json.id : undefined,
      account,
    };
  };

  /** GitHub's token answer. `expires_in` and `refresh_token` are there only for a GitHub App with expiring tokens. */
  const grant = (b: { access_token: string; refresh_token?: unknown; expires_in?: unknown }) => ({
    token: b.access_token,
    ...(typeof b.refresh_token === "string" &&
      typeof b.expires_in === "number" && {
        refreshToken: b.refresh_token,
        expiresInMs: b.expires_in * 1000,
      }),
  });

  return {
    async startDevice() {
      // Reading permissions on private repos needs the repo scope for an OAuth app. For a GitHub App, the scope is ignored.
      const b = await post("https://github.com/login/device/code", { scope: "repo" });
      if (typeof b.device_code !== "string") {
        throw new Error(`Couldn't open GitHub device flow: ${b.error_description ?? b.error}`);
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
      if (typeof b.access_token === "string") return grant(b);
      if (b.error === "authorization_pending") return { pending: true };
      if (b.error === "slow_down") return { pending: true, intervalMs: b.interval * 1000 };
      return { error: b.error_description ?? b.error ?? "GitHub didn't give a token" };
    },
    // https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
    // A device-flow token refreshes without a client secret (ADR-0053).
    async refresh(refreshToken) {
      const b = await post("https://github.com/login/oauth/access_token", {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const got = typeof b.access_token === "string" ? grant(b) : undefined;
      if (got?.refreshToken && got.expiresInMs) return got as Required<Grant>;
      return { error: b.error_description ?? b.error ?? "GitHub didn't give a token" };
    },
    async user(token) {
      const response = await get("/user", token);
      if (!response.ok) throw new Error(`GitHub /user: HTTP ${response.status}`);
      const { id, login, name, avatar_url } = await response.json();
      return {
        id,
        login,
        name: name || null,
        avatar: typeof avatar_url === "string" ? avatar_url : null,
      };
    },
    async canPush(token, repo) {
      const found = await permission(token, repo, "push");
      return found && { push: found.can, name: found.name, id: found.id, account: found.account };
    },
    canAdmin: async (token, repo) => (await permission(token, repo, "admin"))?.can,
    // My repos: `permissions.admin` of GET /user/repos (https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).
    // People who can push: GET /repos/{owner}/{repo}/collaborators?permission=push (includes people who get it through teams).
    // ponytail: reads only the first 100 of each. If an account has more than 100 repos or a repo has more than 100 people, read the next page from the Link header.
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
    // Decision PRs: https://docs.github.com/en/rest/repos/contents, https://docs.github.com/en/rest/git (trees, commits, refs),
    // https://docs.github.com/en/rest/pulls/pulls (open, read, merge).
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
      // Several files in one commit: a new tree on the base commit's tree, a commit of that tree, and a new branch pointing at that commit.
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
    // Reviews: https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request (oldest first).
    // ponytail: reads only the first 100. If a decision PR gets more reviews than that, page through.
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
      // If the repo doesn't allow a merge method, you get 405 and "not allowed". Only then, try the next method.
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
    // Issues: https://docs.github.com/en/rest/issues/issues, https://docs.github.com/en/rest/issues/comments
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
    // ponytail: reads only the first 100. If a post gets more comments than that, read with `since` or paging.
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
    // Labels: https://docs.github.com/en/rest/issues/labels (add is POST, remove is DELETE, and 404 if it isn't there)
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
    // ponytail: reads only the first 100. If the repo has more labels than that, page through.
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
