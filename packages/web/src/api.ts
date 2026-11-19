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
 * The workspace picked now (`Workspace.id`). Switching workspaces redraws the app frame, so every API sends this as a header (ADR-0043).
 * For per-repo APIs, pass `repo` to call that repo.
 */
let workspace: string | undefined;
export const setWorkspace = (id: string) => {
  workspace = id;
};

/** The server the web calls. It serves the API from the same place as the screen (in development, Vite forwards it). */
export const server = (session?: string, repo?: string) => ({
  url: location.origin,
  session,
  workspace,
  repos: repo ? [repo] : undefined,
});

const KEY = "omagari.session";

/**
 * Keeps the session in this browser so you stay logged in after a refresh. In a browser that blocks storage (a private window, etc.),
 * you stay logged in only in this tab.
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

/** The model and effort picked in the DM, per member and per Agent (executor). Kept only in this browser (ADR-0020). */
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

/** Has the session ended or is it missing? Kept apart from not reaching the server. */
export const signedOut = (error: unknown) =>
  error instanceof ContractFailure && error.code === "unauthorized";

/** A small value kept on this device. In a browser that blocks storage, it isn't kept. */
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

/** A repo name (the name in `owner/name`). */
export const repoName = (repo: string) => repo.split("/")[1] ?? repo;

/** The last place seen per workspace (a repo name or "All"), and the last channel seen per place (the `#…` in the address). Kept on this device. */
export const placeKey = (workspace: string) => `omagari.place.${workspace}`;
export const lastKey = (workspace: string, place: string) =>
  `omagari.last-channel.${workspace}.${place}`;
