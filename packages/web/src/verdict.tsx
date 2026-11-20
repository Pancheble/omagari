import type { AlertRun } from "@omagari/contract";
import { CircleCheck, CircleMinus, CircleQuestionMark, CircleX, LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useId, useReducer, useState } from "react";
import { ago, t } from "./i18n.ts";
import { notRunWords } from "./verdict-words.ts";

/** The docs page on the check command and the sandbox tools (site/merge-runs.md). */
const DOCS = "https://omagari-dev.github.io/omagari/merge-runs";
const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

/** How long it took: "48s", "2m 5s". */
export const took = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? t.verdict.seconds(s) : t.verdict.minutes(Math.floor(s / 60), s % 60);
};

function notRun(reason: string, mine: string): ReactNode {
  const { text, help } = notRunWords(reason, mine);
  if (help === "sandbox")
    return (
      <>
        {text} · {link(`${DOCS}#sandbox`, t.verdict.howToInstall)}
      </>
    );
  if (help === "check")
    return (
      <>
        {text} · {link(`${DOCS}#check-command`, t.verdict.howToSet)}
      </>
    );
  return text;
}

const ICONS = {
  running: LoaderCircle,
  broken: CircleX,
  pass: CircleCheck,
  unclear: CircleQuestionMark,
  not_run: CircleMinus,
};

/**
 * The verdict strip (app-verdict-strip, DESIGN.md "Verdict strip"): sits above the conversation of an indirect conflict post. The warning color is only for "fail".
 * If it failed and has output, "Show output" opens a line and an output box under the strip (closed by default).
 * `works` are the alert's two works. The machine that ran it and the side that broke alone are looked up there.
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
  const theirs = works.find((work) => work.login !== run.login)?.name ?? t.verdict.other;
  const Icon = ICONS[run.verdict];
  const label = t.verdict.names[run.verdict];
  const check = run.check ?? t.verdict.checkFallback;

  const text: ReactNode = run.stale
    ? t.verdict.staleText
    : run.verdict === "running"
      ? t.verdict.running(mine, check, took(Math.max(0, Date.now() - Date.parse(run.at))))
      : run.verdict === "broken"
        ? t.verdict.broken
        : run.verdict === "pass"
          ? t.verdict.pass(check, ago(run.at))
          : run.verdict === "unclear"
            ? run.alone?.length === 2
              ? t.verdict.bothBroken
              : t.verdict.oneBroken(run.alone?.[0] === "theirs" ? theirs : mine)
            : notRun(run.reason ?? "", mine);
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
            {run.stale && ` · ${t.verdict.stale}`}
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
            {open ? t.verdict.hideOutput : t.verdict.showOutput}
          </button>
        )}
      </div>
      {output !== undefined && open && (
        <div id={id}>
          <p className="verdict-meta">
            {[run.check, run.ms !== undefined && took(run.ms), t.verdict.machine(mine), ago(run.at)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <pre className="verdict-output">{output}</pre>
        </div>
      )}
    </div>
  );
}
