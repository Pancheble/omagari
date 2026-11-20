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
import { setAppearance } from "./theme.ts";
import { Tooltip } from "./tooltip.tsx";
import { Workspace } from "./workspace.tsx";

/** The workspace last picked on this device. */
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

  /** The session ended. Go back to login and say so. */
  const expire = useCallback(() => {
    saveSession(undefined);
    setLanguage("en"); // before login it's always English (ADR-0045)
    setAppearance("system");
    setState({ kind: "out", notice: t.login.expired });
  }, []);

  /** Load me from the session. If the session ended, go to login; if the server can't be reached, keep the session and show Try again. */
  const enter = useCallback(
    async (session: string) => {
      try {
        const [me, { workspaces }] = await Promise.all([
          call(server(session), api.me),
          call(server(session), api.workspaces),
        ]);
        // No workspace left (the last one was deleted): back to the sign-in screen.
        if (!workspaces.length) {
          saveSession(undefined);
          return setState({ kind: "out" });
        }
        saveSession(session);
        // Enter the workspace seen last time. If it's gone, the first one.
        const saved = remembered(WORKSPACE_KEY);
        const workspace =
          workspaces.find((space) => space.id === saved)?.id ?? workspaces[0]?.id ?? "";
        setWorkspace(workspace);
        setLanguage(me.prefs.language);
        setAppearance(me.prefs.appearance);
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
    // Log out in this browser even if the server can't be reached. Close the screen first, so the server closing the ended session's
    // live connection isn't wrongly announced as "Your login ended".
    saveSession(undefined);
    setLanguage("en");
    setAppearance("system");
    setState({ kind: "out" });
    void call(server(session), api.logout).catch(() => {});
  };
  /** Go to another account's place (a repo or "All"). Redraws the app frame and goes to the channel last seen there (mockup 101). */
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
      onReload={() => void enter(session)}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
    <Tooltip />
  </StrictMode>,
);
