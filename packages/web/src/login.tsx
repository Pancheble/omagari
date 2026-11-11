import { api, ContractFailure, call } from "@omagari/contract";
import { Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { server, signedOut } from "./api.ts";

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
  return { kind: "failed", reason: "서버에 닿지 않아요. 네트워크를 확인하고 다시 시도해 주세요." };
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
        <h1>GitHub에서 이 코드를 넣어 주세요</h1>
        <p>GitHub에서 코드를 넣고 승인하면 이 화면이 저절로 워크스페이스로 넘어가요.</p>
        <output className="device-code" aria-label="GitHub에 넣을 코드">
          {step.userCode}
        </output>
        <div className="actions">
          <a
            className="button primary"
            href={step.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            GitHub 열기
            <ExternalLink size={16} aria-hidden />
          </a>
          <button type="button" className="button outline" onClick={copy}>
            <Copy size={16} aria-hidden />
            코드 복사
          </button>
          <button type="button" className="button quiet" onClick={cancel}>
            취소
          </button>
        </div>
        <p className="hint" role="status">
          {copied ? "코드를 복사했어요." : "GitHub에서 승인하기를 기다리는 중…"}
        </p>
      </Centered>
    );
  }

  if (step.kind === "refused") {
    return (
      <Centered>
        <h1>이 워크스페이스에 들어올 수 없어요</h1>
        <div className="banner error" role="alert">
          {step.reason}
        </div>
        <p>
          워크스페이스에는 레포에 push 권한이 있는 계정만 들어와요. 레포 관리자에게 권한을 받거나,
          GitHub에서 다른 계정으로 바꾼 뒤 다시 로그인해 주세요.
        </p>
        <div className="actions">
          <button type="button" className="button primary" onClick={start}>
            다시 로그인
          </button>
        </div>
      </Centered>
    );
  }

  if (step.kind === "ended" || step.kind === "failed") {
    return (
      <Centered>
        <h1>로그인하지 못했어요</h1>
        <div className="banner error" role="alert">
          {step.kind === "ended" ? "코드가 만료됐거나 GitHub에서 승인하지 않았어요." : step.reason}
        </div>
        <div className="actions">
          <button type="button" className="button primary" onClick={start}>
            다시 로그인
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
      <h1>Omagari에 로그인</h1>
      <p>
        GitHub 계정으로 들어와요. 워크스페이스 레포에 push 권한이 있으면 초대 없이 들어올 수 있어요.
      </p>
      <div className="actions">
        <button
          type="button"
          className="button primary"
          onClick={start}
          disabled={step.kind === "starting"}
          aria-busy={step.kind === "starting"}
        >
          {step.kind === "starting" ? "GitHub에 묻는 중…" : "GitHub으로 로그인"}
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
