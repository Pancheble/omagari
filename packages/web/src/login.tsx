import { api, ContractFailure, call } from "@omagari/contract";
import { Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { server, signedOut } from "./api.ts";
import { t } from "./i18n.ts";

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "code"; userCode: string; verificationUri: string }
  | { kind: "refused"; reason: string; install?: string }
  | { kind: "ended" }
  | { kind: "failed"; reason: string };

function failure(error: unknown, install?: string): Step {
  // Without push access, the server sends who lacks access to which repo. That is the reason for the refusal.
  // On a GitHub App server, the repo may only be hidden because the App isn't installed (ADR-0053).
  if (error instanceof ContractFailure && error.code === "forbidden") {
    return { kind: "refused", reason: error.message, install };
  }
  if (signedOut(error)) return { kind: "ended" };
  if (error instanceof ContractFailure) return { kind: "failed", reason: error.message };
  return { kind: "failed", reason: t.login.offline };
}

/**
 * Logs in with GitHub device authorization, the same path as the Runner (the server holds the GitHub token, and the browser gets only a session).
 * While the person enters the code on GitHub, it asks the server whether it's done.
 */
export function Login({
  notice,
  onSession,
}: {
  notice?: string;
  onSession: (session: string) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  /** Which login attempt this is. Cancelling or leaving the screen raises it, which stops the earlier wait. */
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );

  const start = async () => {
    const mine = ++attempt.current;
    const live = () => attempt.current === mine;
    setStep({ kind: "starting" });
    setCopied(false);
    let install: string | undefined;
    try {
      const started = await call(server(), api.login);
      install = started.install;
      if (!live()) return;
      setStep({ kind: "code", ...started });
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, started.intervalMs));
        if (!live()) return;
        const polled = await call(server(), api.loginPoll, { device: started.device });
        if (!live()) return;
        if ("session" in polled) return onSession(polled.session);
      }
    } catch (error) {
      if (live()) setStep(failure(error, install));
    }
  };

  const cancel = () => {
    attempt.current++;
    setStep({ kind: "idle" });
  };

  if (step.kind === "code") {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(step.userCode);
        setCopied(true);
      } catch {} // Even if copying is blocked, the code is on screen
    };
    return (
      <Centered>
        <h1>{t.login.codeTitle}</h1>
        <p>{t.login.codeBody}</p>
        <output className="device-code" aria-label={t.login.codeLabel}>
          {step.userCode}
        </output>
        <div className="actions">
          <a
            className="button primary"
            href={step.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            {t.login.openGithub}
            <ExternalLink size={16} aria-hidden />
          </a>
          <button type="button" className="button outline" onClick={copy}>
            <Copy size={16} aria-hidden />
            {t.login.copy}
          </button>
          <button type="button" className="button quiet" onClick={cancel}>
            {t.login.cancel}
          </button>
        </div>
        <p className="hint" role="status">
          {copied ? t.login.copied : t.login.waiting}
        </p>
      </Centered>
    );
  }

  if (step.kind === "refused") {
    return (
      <Centered>
        <h1>{t.login.refusedTitle}</h1>
        <div className="banner error" role="alert">
          {step.reason}
        </div>
        <p>{t.login.refusedBody}</p>
        {step.install && <p>{t.login.installBody}</p>}
        <div className="actions">
          <button type="button" className="button primary" onClick={start}>
            {t.login.again}
          </button>
          {step.install && (
            <a className="button outline" href={step.install} target="_blank" rel="noreferrer">
              {t.login.install}
              <ExternalLink size={16} aria-hidden />
            </a>
          )}
        </div>
      </Centered>
    );
  }

  if (step.kind === "ended" || step.kind === "failed") {
    return (
      <Centered>
        <h1>{t.login.failedTitle}</h1>
        <div className="banner error" role="alert">
          {step.kind === "ended" ? t.login.ended : step.reason}
        </div>
        <div className="actions">
          <button type="button" className="button primary" onClick={start}>
            {t.login.again}
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      {notice && (
        <div className="banner info notice" role="status">
          {notice}
        </div>
      )}
      <h1>{t.login.title}</h1>
      <p>{t.login.body}</p>
      <div className="actions">
        <button
          type="button"
          className="button primary"
          onClick={start}
          disabled={step.kind === "starting"}
          aria-busy={step.kind === "starting"}
        >
          {step.kind === "starting" ? t.login.starting : t.login.start}
        </button>
      </div>
    </Centered>
  );
}

/** A screen outside the app frame, like login. Laid out in one centered column. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="centered">
      <div>{children}</div>
    </main>
  );
}
