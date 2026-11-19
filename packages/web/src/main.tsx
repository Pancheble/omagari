import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./app.css";
import { api, call } from "@omagari/contract";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  lastKey,
  type Me,
  placeKey,
  remember,
  remembered,
  type Workspace as Space,
  savedSession,
  saveSession,
  server,
  setWorkspace,
  signedOut,
} from "./api.ts";
import { setLanguage, t, useLanguage } from "./i18n.ts";
import { Centered, Login } from "./login.tsx";
import { Tooltip } from "./tooltip.tsx";
import { Workspace } from "./workspace.tsx";

/** 이 기기에서 마지막에 고른 워크스페이스. */
const WORKSPACE_KEY = "omagari.workspace";

type State =
  | { kind: "checking" }
  | { kind: "out"; notice?: string }
  | { kind: "unreachable"; session: string }
  | { kind: "in"; session: string; me: Me; workspaces: Space[]; workspace: string };

function App() {
  const [state, setState] = useState<State>(() =>
    savedSession() ? { kind: "checking" } : { kind: "out" },
  );
  useLanguage(); // redraws every screen when the language changes

  /** 세션이 끝났다. 로그인으로 돌아가 그렇다고 알린다. */
  const expire = useCallback(() => {
    saveSession(undefined);
    setLanguage("en"); // before login it's always English (ADR-0045)
    setState({ kind: "out", notice: t.login.expired });
  }, []);

  /** 세션으로 나를 읽어 들어간다. 세션이 끝났으면 로그인으로, 서버에 닿지 않으면 세션을 둔 채 다시 시도를 보인다. */
  const enter = useCallback(
    async (session: string) => {
      try {
        const [me, { workspaces }] = await Promise.all([
          call(server(session), api.me),
          call(server(session), api.workspaces),
        ]);
        saveSession(session);
        // 지난번에 본 워크스페이스로 들어간다. 없어졌으면 첫째다.
        const saved = remembered(WORKSPACE_KEY);
        const workspace =
          workspaces.find((space) => space.id === saved)?.id ?? workspaces[0]?.id ?? "";
        setWorkspace(workspace);
        setLanguage(me.prefs.language);
        setState({ kind: "in", session, me, workspaces, workspace });
      } catch (error) {
        if (!signedOut(error)) return setState({ kind: "unreachable", session });
        expire();
      }
    },
    [expire],
  );

  useEffect(() => {
    const session = savedSession();
    if (session) void enter(session);
  }, [enter]);

  if (state.kind === "checking") return <main className="centered" aria-busy="true" />;
  if (state.kind === "out") return <Login notice={state.notice} onSession={enter} />;
  if (state.kind === "unreachable") {
    return (
      <Centered>
        <h1>{t.login.unreachableTitle}</h1>
        <p>{t.login.unreachableBody}</p>
        <div className="actions">
          <button type="button" className="button outline" onClick={() => enter(state.session)}>
            {t.tryAgain}
          </button>
        </div>
      </Centered>
    );
  }
  const { session } = state;
  const logout = () => {
    // 서버에 닿지 않아도 이 브라우저에서는 로그아웃한다. 화면을 먼저 닫아, 서버가 끝난 세션의
    // 실시간 길을 닫는 것을 "로그인이 끝났어요"로 잘못 알리지 않는다.
    saveSession(undefined);
    setLanguage("en");
    setState({ kind: "out" });
    void call(server(session), api.logout).catch(() => {});
  };
  /** 다른 계정의 곳(레포나 "전체")으로 간다. 앱 틀을 새로 그리고, 그곳에서 마지막에 본 채널로 간다(시안 101). */
  const switchTo = (workspace: string, place: string) => {
    remember(WORKSPACE_KEY, workspace);
    remember(placeKey(workspace), place);
    setWorkspace(workspace);
    history.replaceState(null, "", remembered(lastKey(workspace, place)) || location.pathname);
    setState({ ...state, workspace });
  };
  return (
    <Workspace
      key={state.workspace}
      me={state.me}
      session={session}
      workspaces={state.workspaces}
      workspace={state.workspace}
      onSwitch={switchTo}
      onRepos={(repos) =>
        setState((now) =>
          now.kind === "in"
            ? {
                ...now,
                workspaces: now.workspaces.map((space) => ({
                  ...space,
                  repos: repos.filter((repo) => repo.split("/")[0]?.toLowerCase() === space.id),
                })),
              }
            : now,
        )
      }
      onLogout={logout}
      onSignedOut={expire}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
    <Tooltip />
  </StrictMode>,
);
