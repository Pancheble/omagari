import { api, ContractFailure, call } from "@omagari/contract";
import { Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { server, signedOut } from "./api.ts";
import { t } from "./i18n.ts";

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "code"; userCode: string; verificationUri: string }
  | { kind: "refused"; reason: string }
  | { kind: "ended" }
  | { kind: "failed"; reason: string };

function failure(error: unknown): Step {
  // push 권한이 없으면 서버가 누가 어느 레포에 권한이 없는지 적어 보낸다. 그것이 거절의 이유다.
  if (error instanceof ContractFailure && error.code === "forbidden") {
    return { kind: "refused", reason: error.message };
  }
  if (signedOut(error)) return { kind: "ended" };
  if (error instanceof ContractFailure) return { kind: "failed", reason: error.message };
  return { kind: "failed", reason: t.login.offline };
}

/**
 * GitHub 기기 인증으로 로그인한다. 러너와 같은 길이다(서버가 GitHub 토큰을 들고, 브라우저는 세션만 받는다).
 * 사람이 GitHub에서 코드를 넣는 동안 서버에 끝났는지 묻는다.
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
  /** 몇 번째 로그인인가. 취소하거나 화면을 떠나면 올려, 앞의 기다리기가 멈춘다. */
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
    try {
      const started = await call(server(), api.login);
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
      if (live()) setStep(failure(error));
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
      } catch {} // 복사가 막혀도 코드는 화면에 있다
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
        <div className="actions">
          <button type="button" className="button primary" onClick={start}>
            {t.login.again}
          </button>
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

/** 로그인처럼 앱 틀 바깥의 화면. 가운데 한 줄기로 둔다. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="centered">
      <div>{children}</div>
    </main>
  );
}
