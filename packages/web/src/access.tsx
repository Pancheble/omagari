import { type AccessStatus, api, call, type PendingAccess } from "@omagari/contract";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type Me, server, signedOut } from "./api.ts";
import { type AdminRepo, RepoDialog } from "./channels.tsx";
import { ago, t } from "./i18n.ts";
import { Centered } from "./login.tsx";

/** How often the waiting screen asks whether the request was decided. */
const POLL_MS = 30_000;

/**
 * The screen of a signed-in person with no workspace (ADR-0052): request an account, wait for an operator, and once it's approved add its first repo.
 * Only the newest request decides what shows; a denied one shows above the form so they can ask for another account.
 */
export function Access({
  session,
  me,
  onEnter,
  onLogout,
  onSignedOut,
}: {
  session: string;
  me: Me;
  /** A repo came in: load the workspaces again. */
  onEnter: () => void;
  onLogout: () => void;
  onSignedOut: () => void;
}) {
  const [status, setStatus] = useState<AccessStatus | "error">();
  const [account, setAccount] = useState(me.login);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [repos, setRepos] = useState<AdminRepo[] | "error">();
  const [install, setInstall] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useId();

  const check = useCallback(
    (error: unknown) => {
      if (signedOut(error)) onSignedOut();
    },
    [onSignedOut],
  );
  const load = useCallback(
    () =>
      call(server(session), api.myAccess)
        .then(setStatus)
        .catch((error) => {
          check(error);
          setStatus((now) => now ?? "error");
        }),
    [session, check],
  );
  useEffect(() => void load(), [load]);

  const latest = typeof status === "object" ? status.requests[0] : undefined;
  useEffect(() => {
    if (latest?.state !== "pending") return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [latest?.state, load]);

  if (status === undefined) return <main className="centered" aria-busy="true" />;
  if (status === "error") {
    return (
      <Centered>
        <h1>{t.login.unreachableTitle}</h1>
        <p>{t.login.unreachableBody}</p>
        <div className="actions">
          <button type="button" className="button outline" onClick={load}>
            {t.tryAgain}
          </button>
        </div>
      </Centered>
    );
  }
  const logout = (
    <button type="button" className="button quiet" onClick={onLogout}>
      {t.profile.menu.logout}
    </button>
  );
  if (!status.open) {
    return (
      <Centered>
        <h1>{t.access.closedTitle}</h1>
        <p>{t.access.closedBody}</p>
        <div className="actions">{logout}</div>
      </Centered>
    );
  }

  if (latest?.state === "pending") {
    return (
      <Centered>
        <h1>{t.access.waitingTitle}</h1>
        <p>{t.access.waitingBody(latest.account)}</p>
        <p className="hint">{t.access.waitingNote}</p>
        <div className="actions">{logout}</div>
      </Centered>
    );
  }

  if (latest?.state === "approved") {
    const space = { id: latest.account, name: latest.account, kind: "organization" as const };
    const open = () => {
      dialog.current?.showModal();
      setRepos(undefined);
      call({ ...server(session), workspace: latest.account }, api.adminRepos)
        .then((found) => {
          setRepos(found.repos);
          setInstall(found.install);
        })
        .catch((error) => {
          check(error);
          setRepos("error");
        });
    };
    return (
      <Centered>
        <h1>{t.access.approvedTitle(latest.account)}</h1>
        <p>{t.access.approvedBody}</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={open}>
            {t.channels.addRepo.title}
          </button>
          {logout}
        </div>
        <RepoDialog
          dialog={dialog}
          account={{ ...space, avatar: null, repos: [] }}
          repos={repos}
          install={install}
          onAdd={async (repo) => {
            await call(server(session), api.addRepo, { repo });
            dialog.current?.close();
            onEnter();
          }}
        />
      </Centered>
    );
  }

  const legal = status.terms || status.privacy;
  const send = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setStatus(await call(server(session), api.requestAccess, { account: account.trim(), agree }));
    } catch (error) {
      check(error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      {latest?.state === "denied" && (
        <div className="banner info notice" role="status">
          <div>
            <strong>{t.access.deniedTitle(latest.account)}</strong>
            <br />
            {t.access.deniedBody}
          </div>
        </div>
      )}
      <h1>{t.access.title}</h1>
      <p>{t.access.body}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="field">
          <label htmlFor={field}>{t.access.account}</label>
          <input
            id={field}
            className="text-input"
            value={account}
            required
            pattern="[A-Za-z0-9][A-Za-z0-9\-]{0,38}"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setAccount(event.target.value)}
          />
        </div>
        {legal && (
          <label className="also-send access-agree">
            <input
              type="checkbox"
              required
              checked={agree}
              onChange={(event) => setAgree(event.target.checked)}
            />
            <span>
              {t.access.agreeLead}
              {status.terms && (
                <a className="settings-link" href={status.terms} target="_blank" rel="noreferrer">
                  {t.access.terms}
                </a>
              )}
              {status.terms && status.privacy && t.access.and}
              {status.privacy && (
                <a className="settings-link" href={status.privacy} target="_blank" rel="noreferrer">
                  {t.access.privacy}
                </a>
              )}
              {t.access.agreeTail}
            </span>
          </label>
        )}
        {failed && (
          <p className="help error" role="alert">
            {t.access.failed}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button primary" disabled={busy} aria-busy={busy}>
            {busy ? t.access.requesting : t.access.request}
          </button>
          {logout}
        </div>
      </form>
    </Centered>
  );
}

/** Settings → Server → Access requests (ADR-0052): the requests waiting for an operator, oldest first. Only operators see this page. */
export function AccessRequestsPage({
  session,
  check,
}: {
  session: string;
  check: (error: unknown) => void;
}) {
  const [requests, setRequests] = useState<PendingAccess[] | "error">();
  const [busy, setBusy] = useState<number>();
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once when the page opens
  useEffect(() => {
    call(server(session), api.accessRequests)
      .then(({ requests }) => setRequests(requests))
      .catch((error) => {
        check(error);
        setRequests("error");
      });
  }, []);
  const decide = async (id: number, approve: boolean) => {
    setBusy(id);
    setFailed(false);
    try {
      setRequests((await call(server(session), api.decideAccess, { id, approve })).requests);
    } catch (error) {
      check(error);
      setFailed(true);
    } finally {
      setBusy(undefined);
    }
  };
  const words = t.settings.access;
  if (requests === undefined) return <div className="settings-group settings-loading" aria-busy />;
  if (requests === "error")
    return (
      <div className="empty">
        <h2>{t.settings.loadFailedTitle}</h2>
        <p>{t.settings.loadFailedBody}</p>
      </div>
    );
  if (requests.length === 0) return <p className="help access-empty">{words.empty}</p>;
  return (
    <>
      <div className="settings-group">
        {requests.map((request) => (
          <div key={request.id} className="settings-row">
            <span className="settings-text">
              <span>{request.account}</span>
              <small>{words.by(request.login, ago(request.at))}</small>
            </span>
            <span className="access-actions">
              <button
                type="button"
                className="button outline small"
                disabled={busy !== undefined}
                onClick={() => void decide(request.id, true)}
              >
                {words.approve}
              </button>
              <button
                type="button"
                className="button quiet small"
                disabled={busy !== undefined}
                onClick={() => void decide(request.id, false)}
              >
                {words.deny}
              </button>
            </span>
          </div>
        ))}
      </div>
      {failed && (
        <p className="help error" role="alert">
          {words.failed}
        </p>
      )}
    </>
  );
}
