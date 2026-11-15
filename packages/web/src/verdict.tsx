import { type AlertRun, ago, MERGE_RUN_LABELS } from "@omagari/contract";
import { CircleCheck, CircleMinus, CircleQuestionMark, CircleX, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useId, useReducer, useState } from "react";

const DOCS = "https://github.com/Pancheble/omagari/blob/dev/docs/adr";
const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

/** 걸린 시간: "48초", "2분 5초". */
const took = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}`;
};

/** 돌리지 못한 까닭(러너가 올린 글)을 DESIGN.md의 네 가지로 가른다. 못 가르면 올라온 글 그대로 보인다. */
function notRun(reason = ""): ReactNode {
  if (/상한/.test(reason)) return "5분이 넘어 끊었어요 · 통과로 치지 않아요";
  if (/줄이 부딪혀/.test(reason)) return "직접 충돌을 먼저 풀어야 돌려 볼 수 있어요";
  if (/샌드박스/.test(reason))
    return (
      <>
        이 기기에 샌드박스 도구가 없어요 ·{" "}
        {link(`${DOCS}/0033-merge-runs-in-runner-sandbox.md`, "까는 법")}
      </>
    );
  if (/검사 명령|omagari\.json|기본 브랜치/.test(reason))
    return (
      <>
        레포에 검사 명령이 없어요 ·{" "}
        {link(`${DOCS}/0034-check-command-from-repo-file-on-by-default.md`, "정하는 법")}
      </>
    );
  return reason || "돌리지 못했어요";
}

const ICONS = {
  running: LoaderCircle,
  broken: CircleX,
  pass: CircleCheck,
  unclear: CircleQuestionMark,
  not_run: CircleMinus,
};

/**
 * 판정 띠(app-verdict-strip, DESIGN.md "판정 띠"): 간접 충돌 포스트의 대화 위에 붙는다. 경고색은 깨짐에만 쓴다.
 * 깨짐이고 출력이 있으면 "출력 보기"로 띠 아래에 한 줄과 출력 칸이 펼쳐진다(접힌 채가 기본).
 * `works`는 알림의 두 작업이고, 돌린 기기와 혼자서도 깨진 쪽의 이름을 거기서 찾는다.
 */
export function VerdictStrip({
  run,
  works,
}: {
  run: AlertRun;
  works: readonly { login: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, run.verdict === "running" ? 5_000 : 30_000);
    return () => clearInterval(timer);
  }, [run.verdict]);
  const id = useId();
  const nameOf = (login: string) => works.find((work) => work.login === login)?.name ?? login;
  const mine = nameOf(run.login);
  const theirs = works.find((work) => work.login !== run.login)?.name ?? "상대";
  const Icon = ICONS[run.verdict];
  const label = MERGE_RUN_LABELS[run.verdict];

  const text: ReactNode = run.stale
    ? "내용이 바뀌어서, 잠잠해지면 다시 돌려요"
    : run.verdict === "running"
      ? `${mine}의 기기에서 ${run.check ?? "검사 명령"} · ${took(Math.max(0, Date.now() - Date.parse(run.at)))}째`
      : run.verdict === "broken"
        ? "합치면 깨져요 · 따로 돌리면 둘 다 통과해요"
        : run.verdict === "pass"
          ? `합쳐도 통과해서 포스트를 닫았어요 · ${run.check ?? "검사 명령"} · ${ago(run.at)}`
          : run.verdict === "unclear"
            ? run.alone?.length === 2
              ? "두 작업 모두 혼자서도 깨져요"
              : `${run.alone?.[0] === "theirs" ? theirs : mine}의 작업만 돌려도 깨져요`
            : notRun(run.reason);
  const output = run.verdict === "broken" && !run.stale && run.output ? run.output : undefined;

  return (
    <div className="verdict">
      <div
        className={
          run.verdict === "broken" && !run.stale ? "verdict-strip warning" : "verdict-strip"
        }
        role="status"
      >
        <Icon
          size={16}
          aria-hidden
          className={run.verdict === "running" && !run.stale ? "spin" : undefined}
        />
        <p className="strip-text">
          <strong>
            {label}
            {run.stale && " · 지난 결과"}
          </strong>
          <span>{text}</span>
        </p>
        {output !== undefined && (
          <button
            type="button"
            className="button quiet strip-button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {open ? "출력 접기" : "출력 보기"}
          </button>
        )}
      </div>
      {output !== undefined && open && (
        <div id={id}>
          <p className="verdict-meta">
            {[run.check, run.ms !== undefined && took(run.ms), `${mine}의 기기`, ago(run.at)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <pre className="verdict-output">{output}</pre>
        </div>
      )}
    </div>
  );
}
