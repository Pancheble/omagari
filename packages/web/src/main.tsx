import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./app.css";
import { api, call } from "@omagari/contract";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Me, savedSession, saveSession, server, signedOut } from "./api.ts";
import { Centered, Login } from "./login.tsx";
import { Workspace } from "./workspace.tsx";

type State =
  | { kind: "checking" }
  | { kind: "out"; notice?: string }
  | { kind: "unreachable"; session: string }
  | { kind: "in"; session: string; me: Me };

function App() {
  const [state, setState] = useState<State>(() =>
    savedSession() ? { kind: "checking" } : { kind: "out" },
  );

  /** 세션이 끝났다. 로그인으로 돌아가 그렇다고 알린다. */
  const expire = useCallback(() => {
    saveSession(undefined);
    setState({ kind: "out", notice: "로그인이 끝났어요. 다시 로그인해 주세요." });
  }, []);

  /** 세션으로 나를 읽어 들어간다. 세션이 끝났으면 로그인으로, 서버에 닿지 않으면 세션을 둔 채 다시 시도를 보인다. */
  const enter = useCallback(
    async (session: string) => {
      try {
        const me = await call(server(session), api.me);
        saveSession(session);
        setState({ kind: "in", session, me });
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
        <h1>서버에 닿지 않아요</h1>
        <p>네트워크를 확인하고 다시 시도해 주세요. 로그인은 남아 있어요.</p>
        <div className="actions">
          <button type="button" className="button outline" onClick={() => enter(state.session)}>
            다시 시도
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
    setState({ kind: "out" });
    void call(server(session), api.logout).catch(() => {});
  };
  return <Workspace me={state.me} session={session} onLogout={logout} onSignedOut={expire} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
