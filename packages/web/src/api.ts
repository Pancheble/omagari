import {
  type api,
  ContractFailure,
  type call,
  type ExecutorId,
  type ModelPick,
} from "@omagari/contract";

export type Me = Awaited<ReturnType<typeof call<typeof api.me>>>;

/** 웹이 부르는 서버. 화면과 같은 곳에서 API를 낸다(개발할 때는 Vite가 넘겨준다). */
export const server = (session?: string) => ({ url: location.origin, session });

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
