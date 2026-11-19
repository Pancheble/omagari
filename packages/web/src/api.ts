import {
  type api,
  ContractFailure,
  type call,
  type ExecutorId,
  type ModelPick,
} from "@omagari/contract";

export type Me = Awaited<ReturnType<typeof call<typeof api.me>>>;

export type Workspace = Awaited<
  ReturnType<typeof call<typeof api.workspaces>>
>["workspaces"][number];

/**
 * 지금 고른 워크스페이스(`Workspace.id`). 워크스페이스를 바꾸면 앱 틀을 새로 그리므로, 모든 API가 이것을 머리말로 싣는다(ADR-0043).
 * 레포마다인 API는 `repo`를 주면 그 레포로 부른다.
 */
let workspace: string | undefined;
export const setWorkspace = (id: string) => {
  workspace = id;
};

/** 웹이 부르는 서버. 화면과 같은 곳에서 API를 낸다(개발할 때는 Vite가 넘겨준다). */
export const server = (session?: string, repo?: string) => ({
  url: location.origin,
  session,
  workspace,
  repos: repo ? [repo] : undefined,
});

const KEY = "omagari.session";

/**
 * 새로 고쳐도 로그인이 남게 세션을 이 브라우저에 둔다. 저장소를 막아 둔 브라우저(사생활 보호 창 등)에서는
 * 이 탭에서만 로그인이 남는다.
 */
export function savedSession() {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(session: string | undefined) {
  try {
    if (session) localStorage.setItem(KEY, session);
    else localStorage.removeItem(KEY);
  } catch {}
}

/** 멤버마다, 에이전트(실행기)마다 DM에서 고른 모델과 effort. 이 브라우저에만 남는다(ADR-0020). */
const picksKey = (login: string) => `omagari.picks.${login}`;

export function savedPicks(login: string): Partial<Record<ExecutorId, ModelPick>> {
  try {
    const saved = JSON.parse(localStorage.getItem(picksKey(login)) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function savePicks(login: string, picks: Partial<Record<ExecutorId, ModelPick>>) {
  try {
    localStorage.setItem(picksKey(login), JSON.stringify(picks));
  } catch {}
}

/** 세션이 끝났거나 없는 것인가. 서버에 닿지 않은 것과 가른다. */
export const signedOut = (error: unknown) =>
  error instanceof ContractFailure && error.code === "unauthorized";

/** 이 기기에 남기는 작은 값. 저장소를 막아 둔 브라우저에서는 남지 않는다. */
export function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** 레포 이름(`owner/name`의 name). */
export const repoName = (repo: string) => repo.split("/")[1] ?? repo;

/** 워크스페이스마다 마지막에 본 곳(레포 이름이나 "전체"), 곳마다 마지막에 본 채널(주소의 `#…`). 이 기기에 남는다. */
export const placeKey = (workspace: string) => `omagari.place.${workspace}`;
export const lastKey = (workspace: string, place: string) =>
  `omagari.last-channel.${workspace}.${place}`;
