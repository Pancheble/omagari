import {
  api,
  type ChannelMessage,
  ContractFailure,
  call,
  type Decision,
  type DecisionWindow,
  type Draft,
  EXECUTOR_NAMES,
  type ExecutorId,
  type MemberView,
} from "@omagari/contract";
import { GitPullRequest } from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { server } from "./api.ts";
import { timeOf } from "./conversation.tsx";
import { chosen, type Picks } from "./dm.tsx";
import { Mark } from "./members.tsx";
import { Avatar } from "./workspace.tsx";

type Message = Extract<ChannelMessage, { kind: "decision" }>;
export type Fields = { title: string; context: string; decision: string; consequences: string };
const EMPTY: Fields = { title: "", context: "", decision: "", consequences: "" };

/** 받침이 있으면 앞, 없으면 뒤: 지은이 / 민수가. */
const josa = (name: string, withFinal: string, without: string) => {
  const code = Array.from(name).at(-1)?.charCodeAt(0) ?? 0;
  return (
    name + (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? withFinal : without)
  );
};

/** "#12" 뒤의 을/를: 이(2), 사(4), 오(5), 구(9)는 받침이 없다. */
const eul = (n: number) => ("2459".includes(String(n).at(-1) ?? "") ? "를" : "을");

/** 남은 시간이 흐르도록 30초마다 다시 그린다. */
function useTick() {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
}

/** "18시간 남음", "3일 남음", "12분 남음". 닫힐 때가 지났으면 "곧 닫혀요". */
function remaining(closes: string) {
  const minutes = Math.ceil((Date.parse(closes) - Date.now()) / 60_000);
  if (minutes <= 0) return "곧 닫혀요";
  if (minutes < 60) return `${minutes}분 남음`;
  if (minutes < 48 * 60) return `${Math.ceil(minutes / 60)}시간 남음`;
  return `${Math.ceil(minutes / 1440)}일 남음`;
}

const WINDOWS = [
  ["now", "바로"],
  ["hour", "1시간"],
  ["day", "하루"],
  ["three_days", "3일"],
  ["custom", "직접"],
] as const;

/** 창 길이를 말로: "하루", "1시간", "12시간". */
export const windowWord = (window: DecisionWindow) =>
  typeof window === "object"
    ? `${window.amount}${window.unit === "hour" ? "시간" : "일"}`
    : { now: "바로", hour: "1시간", day: "하루", three_days: "3일" }[window];

const objectors = (decision: Decision) =>
  [...new Set(decision.objections.map((objection) => objection.name))].join(", ");

/** 띠의 상태 이름과 설명, 띠 색. */
function describe(decision: Decision): {
  name: string;
  text: string;
  tone: "" | "warning" | "error" | "quiet";
} {
  const agreed = decision.deciders.filter((decider) => decider.agreed).length;
  const left = decision.closes ? `${remaining(decision.closes)} · ` : "";
  const count = `동의 ${agreed}/${decision.deciders.length}`;
  switch (decision.status) {
    case "proposed":
      return {
        name: "제안됨",
        text: `${left}${count} · 결정자가 모두 동의하면 바로 머지해요`,
        tone: "",
      };
    case "objected":
      return {
        name: `이의 ${decision.objections.length}개`,
        text: `${josa(objectors(decision), "이", "가")} 이의를 냈어요 · 모두 거둬질 때까지 머지하지 않아요`,
        tone: "warning",
      };
    case "reopened":
      return {
        name: "다시 열림",
        text: `이의가 모두 거둬져 창을 다시 열었어요 · ${left}${count}`,
        tone: "",
      };
    case "blocked":
      return {
        name: "머지 막힘",
        text: `창은 닫혔지만 GitHub이 막았어요${decision.reason ? `: ${decision.reason}` : ""} · 풀리면 바로 머지해요`,
        tone: "warning",
      };
    case "stalled":
      return {
        name: "머지 멈춤",
        text: `${decision.name}의 GitHub 토큰이 듣지 않아 머지를 멈췄어요 · ${josa(decision.name, "이", "가")} 다시 로그인하면 이어 가요`,
        tone: "error",
      };
    case "accepted":
      return {
        name: "수락됨",
        text: `${decision.early ? "결정자가 모두 동의해 창을 일찍 닫고 " : ""}${decision.path}로 머지했어요`,
        tone: "",
      };
    case "closed":
      return {
        name: "버림",
        text: `${josa(decision.name, "이", "가")} 결정을 버려 결정 PR을 닫았어요`,
        tone: "quiet",
      };
  }
}

/**
 * 결정 상태 띠(app-decision-strip): 포스트의 대화 위에 늘 붙는다. 상태, 남은 시간과 동의 수, PR 링크,
 * 보는 사람(`me`)에 따른 버튼. 머지되거나 버린 뒤에는 버튼이 없다.
 */
export function DecisionStrip({
  decision,
  me,
  onRespond,
  onRevise,
  onDiscard,
}: {
  decision: Decision;
  me: string;
  onRespond: (response: "agree" | "object" | "withdraw") => Promise<void>;
  onRevise: () => void;
  onDiscard: () => Promise<void>;
}) {
  useTick();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const { name, text, tone } = describe(decision);
  const over = decision.status === "accepted" || decision.status === "closed";
  const mine = decision.login === me;
  const decider = decision.deciders.find((other) => other.login === me);
  const objected = decision.objections.some((o) => o.login === me && o.via === "post");

  const run = async (act: () => Promise<void>, failed: string) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await act();
    } catch {
      setFailure(failed);
    } finally {
      setBusy(false);
    }
  };
  const button = (label: string, kind: string, act: () => Promise<void>) => (
    <button
      type="button"
      className={`button ${kind} strip-button`}
      disabled={busy}
      onClick={() => void run(act, `${label}를 하지 못했어요`)}
    >
      {label}
    </button>
  );

  return (
    <div className={tone ? `decision-strip ${tone}` : "decision-strip"} role="status">
      <GitPullRequest size={16} aria-hidden />
      <p className="strip-text">
        <strong>{name}</strong>
        <span>{text}</span>
        <a href={decision.pull.url} target="_blank" rel="noreferrer">
          PR #{decision.pull.number}
        </a>
        {failure && <span className="strip-failure">{failure}</span>}
      </p>
      {!over && (
        <div className="strip-actions">
          {mine ? (
            <>
              <button type="button" className="button quiet strip-button" onClick={onRevise}>
                고쳐 올리기
              </button>
              {button("버리기", "danger", onDiscard)}
            </>
          ) : (
            <>
              {decider && !decider.agreed && button("동의", "primary", () => onRespond("agree"))}
              {!objected && button("이의", "outline", () => onRespond("object"))}
              {objected && button("내 이의 거두기", "outline", () => onRespond("withdraw"))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 대화에 쌓이는 결정 PR의 한 줄: "Omagari · 지은이 결정 PR #12를 열었어요 · 이의 창 하루 · 오전 10:50". */
export function DecisionLine({ message }: { message: Message }) {
  const { decision, event, by } = message;
  const n = decision.pull.number;
  const pull = `결정 PR #${n}`;
  const who = by?.name ?? decision.name;
  const words: Record<Message["event"], string> = {
    opened: `${josa(decision.name, "이", "가")} ${pull}${eul(decision.pull.number)} 열었어요 · 이의 창 ${windowWord(decision.window)}`,
    agreed: `${josa(who, "이", "가")} ${pull}에 동의했어요`,
    objected: `${josa(who, "이", "가")} ${pull}에 이의를 냈어요`,
    withdrawn: `${josa(who, "이", "가")} 이의를 거뒀어요`,
    revised: `${josa(who, "이", "가")} 결정을 고쳐 올렸어요`,
    merged: `${pull}${eul(n)} ${decision.early ? "결정자가 모두 동의해 일찍 " : ""}머지했어요`,
    closed: `${pull}${eul(n)} 머지 없이 닫았어요`,
    blocked: `GitHub이 머지를 막았어요${message.reason ? `: ${message.reason}` : ""}`,
    stalled: `${decision.name}의 GitHub 토큰이 듣지 않아 머지를 멈췄어요`,
  };
  return (
    <p className="decision-line">
      <GitPullRequest size={16} aria-hidden />
      <span>
        Omagari · {words[event]} ·{" "}
        <time dateTime={message.at} title={message.at}>
          {timeOf(message.at)}
        </time>
      </span>
    </p>
  );
}

const FIELD_ROWS = { context: 4, decision: 4, consequences: 2 } as const;

/**
 * 결정 정리하기 대화 상자(DESIGN.md "결정 정리하기"). 열리면 바로 내 에이전트가 초안을 쓰기 시작하고(#103),
 * 사람이 읽고 고쳐서 결정 PR을 연다. 고치려고 열었으면(`revising`) 초안을 쓰지 않고 그 결정의 칸으로 시작해 같은 PR에 올린다.
 * 에이전트는 연결된 것 가운데 첫째, 모델과 effort는 DM에서 기억해 둔 값이다.
 */
export function DecisionDialog({
  post,
  title,
  repo,
  me,
  agents,
  picks,
  speakers,
  incoming,
  revising,
  initial,
  session,
  check,
  onDone,
  onClose,
}: {
  /** 포스트의 채널 id. */
  post: string;
  /** 포스트 제목. 출처 링크의 글이다. */
  title: string;
  repo: string;
  me: { login: string; name: string };
  agents: MemberView["agents"];
  picks: Picks;
  /** 이 포스트에서 말한 멤버들. 결정자로 보인다. */
  speakers: { login: string; name: string }[];
  /** 실시간 연결로 온 초안. 이 대화 상자가 받은 `draft.id`와 맞는 것만 쓴다. */
  incoming?: Draft;
  revising?: Decision;
  /** 고치려고 열었을 때 칸에 미리 넣을 것(이 브라우저에서 올린 마지막 칸). 계약은 결정의 본문을 주지 않는다. */
  initial?: Fields;
  session: string;
  check: (error: unknown) => unknown;
  onDone: (decision: Decision, fields: Fields) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [fields, setFields] = useState<Fields>(
    initial ?? (revising ? { ...EMPTY, title: revising.title } : EMPTY),
  );
  /** 초안 요청의 지금: 쓰는 중이면 초안, 러너가 꺼짐이면 "offline", 아직 안 불렀으면 없다. */
  const [draft, setDraft] = useState<Draft | "offline">();
  const [everDrafted, setEverDrafted] = useState(false);
  const [unit, setUnit] = useState<(typeof WINDOWS)[number][0]>("day");
  const [amount, setAmount] = useState("12");
  const [per, setPer] = useState<"hour" | "day">("hour");
  const [failure, setFailure] = useState<string>();
  const [sending, setSending] = useState(false);

  const agent = agents.find((a) => a.state !== "offline");
  const executor: ExecutorId | undefined = agent?.executor;
  const owner = me.name;
  const pending = draft !== undefined && draft !== "offline" && draft.state.state === "pending";

  const write = async () => {
    if (!executor) return setDraft("offline");
    setFailure(undefined);
    try {
      const { draft } = await call(server(session), api.draftDecision, {
        agent: me.login,
        executor,
        post,
        ...chosen(agent?.choices, picks[executor]),
      });
      setDraft(draft);
    } catch (error) {
      check(error);
      if (error instanceof ContractFailure && error.code === "runner_offline") setDraft("offline");
      else setFailure("초안을 쓰게 하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열릴 때 한 번 초안을 쓰게 한다
  useEffect(() => {
    dialog.current?.showModal();
    if (!revising) void write();
  }, []);

  // 실시간으로 온 초안: 내가 부른 초안이면 받고, 다 썼으면 네 칸을 채운다.
  const mineId = draft !== undefined && draft !== "offline" ? draft.id : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 새 초안이 올 때만 본다
  useEffect(() => {
    if (!incoming || incoming.id !== mineId) return;
    setDraft(incoming);
    if (incoming.state.state === "drafted") {
      const { title, context, decision, consequences } = incoming.state;
      setFields({ title, context, decision, consequences });
      setEverDrafted(true);
    }
  }, [incoming]);

  const stop = () => {
    if (draft === undefined || draft === "offline") return;
    call(server(session), api.stopDraft, { draft: draft.id }).then(
      (reply) => setDraft(reply.draft),
      check,
    );
  };

  const close = () => {
    if (pending) stop();
    dialog.current?.close();
  };

  const amountNumber = Number(amount);
  const custom = unit === "custom";
  const customOk = Number.isInteger(amountNumber) && amountNumber >= 1 && amountNumber <= 9999;
  const win: DecisionWindow = unit === "custom" ? { amount: amountNumber, unit: per } : unit;
  const filled = Object.values(fields).every((value) => value.trim());
  const canOpen = filled && !pending && !sending && (!custom || customOk);
  const length = custom
    ? `${customOk ? amountNumber : "정한"}${per === "hour" ? "시간" : "일"}`
    : windowWord(win);

  const submit = async () => {
    setSending(true);
    setFailure(undefined);
    try {
      const { decision } = revising
        ? await call(server(session), api.reviseDecision, { id: revising.id, ...fields })
        : await call(server(session), api.proposeDecision, { post, ...fields, window: win });
      onDone(decision, fields);
      dialog.current?.close();
    } catch (error) {
      check(error);
      setFailure(
        error instanceof ContractFailure && error.code === "github_failed"
          ? "GitHub이 결정 PR을 받지 않았어요. 로그인과 레포 권한을 확인해 주세요."
          : "결정 PR을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    } finally {
      setSending(false);
    }
  };

  type Band = { tone: string; title: string; text: string; stop?: boolean; model?: string };
  const band = ((): Band | undefined => {
    if (revising) return undefined;
    const failed = draft !== "offline" && draft?.state.state === "failed" ? draft.state : undefined;
    if (draft === "offline" || failed) {
      const runner = !failed || failed.error.code === "runner_offline";
      return {
        tone: "warning",
        title: "초안을 쓸 수 없어요",
        text: runner
          ? "Claude Code 러너가 꺼져 있어요. 직접 쓰거나, 러너를 켜고 다시 쓰게 하세요."
          : "에이전트가 초안을 쓰지 못했어요. 직접 쓰거나 다시 쓰게 하세요.",
      };
    }
    if (!draft) return { tone: "", title: "초안을 쓰게 하는 중", text: "에이전트를 부르고 있어요" };
    const read = `이 포스트의 글 ${draft.read.texts}개와 문답 ${draft.read.qas}개`;
    const name = `${owner}의 ${EXECUTOR_NAMES[draft.executor]}`;
    if (draft.state.state === "pending")
      return {
        tone: "",
        title: `${name}가 초안을 쓰는 중`,
        text: `${read}를 읽고 있어요`,
        stop: true,
      };
    if (draft.state.state === "stopped")
      return { tone: "", title: "초안 쓰기를 멈췄어요", text: "직접 쓰거나 다시 쓰게 하세요." };
    if (draft.state.state !== "drafted") return undefined;
    const { model, effort } = draft.state;
    return {
      tone: "",
      title: `${name}가 쓴 초안이에요`,
      text: `${read}를 읽고 썼어요. 읽어 보고 고친 뒤 여세요.`,
      model: model ? (effort ? `${model} · ${effort}` : model) : undefined,
    };
  })();

  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    setFields((now) => ({ ...now, [key]: event.target.value }));
  const bones = (rows: number) => (
    <span className="draft-bones" aria-hidden>
      {(["a", "b", "c"] as const).slice(0, rows).map((line) => (
        <span key={line} className="bone" />
      ))}
    </span>
  );
  const field = (key: keyof Fields, label: string, hint: string, rows?: number) => (
    <div className={rows ? "field" : "field wide"}>
      <label htmlFor={`${heading}-${key}`}>{label}</label>
      {pending ? (
        bones(rows ? Math.min(rows, 3) : 1)
      ) : rows ? (
        <textarea
          id={`${heading}-${key}`}
          className="text-input draft-area"
          rows={rows}
          value={fields[key]}
          onChange={set(key)}
          placeholder={hint}
        />
      ) : (
        <input
          id={`${heading}-${key}`}
          className="text-input"
          value={fields[key]}
          onChange={set(key)}
          placeholder={hint}
          autoComplete="off"
        />
      )}
    </div>
  );

  return (
    // 덮개를 누르면 닫힌다. 키보드로는 Esc가 닫는다(dialog가 해 준다).
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="dialog decision-dialog"
      aria-labelledby={heading}
      onCancel={() => pending && stop()}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <form
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (canOpen) void submit();
        }}
      >
        <h2 id={heading}>{revising ? "결정 고쳐 올리기" : "결정 정리하기"}</h2>
        {band && (
          <div className={band.tone ? `draft-band ${band.tone}` : "draft-band"} role="status">
            {band.tone ? null : agent && <Mark agent={agent} aria-hidden />}
            <p>
              <strong>{band.title}</strong>
              <span>{band.text}</span>
            </p>
            {band.stop && (
              <button type="button" className="button quiet strip-button" onClick={stop}>
                그만 쓰기
              </button>
            )}
            {band.model && <span className="badge outline">{band.model}</span>}
          </div>
        )}
        <div className="draft-fields">
          {field("title", "제목", "무엇을 정했나요")}
          {field("context", "맥락", "왜 정해야 했나요", FIELD_ROWS.context)}
          {field("decision", "결정", "무엇으로 정했나요", FIELD_ROWS.decision)}
          {field("consequences", "결과", "그래서 무엇이 바뀌나요", FIELD_ROWS.consequences)}
        </div>
        {!revising && (
          <fieldset className="window" disabled={sending}>
            <legend>이의 창</legend>
            <div className="segments">
              {WINDOWS.map(([id, word]) => (
                <label key={id} className="segment">
                  <input
                    type="radio"
                    name={`${heading}-window`}
                    checked={unit === id}
                    onChange={() => setUnit(id)}
                  />
                  <span>{word}</span>
                </label>
              ))}
            </div>
            {custom && (
              <div className="window-custom">
                <input
                  className="text-input"
                  type="number"
                  min={1}
                  max={9999}
                  inputMode="numeric"
                  aria-label="이의 창 길이"
                  aria-invalid={!customOk}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <select
                  className="text-input"
                  aria-label="단위"
                  value={per}
                  onChange={(event) => setPer(event.target.value as "hour" | "day")}
                >
                  <option value="hour">시간</option>
                  <option value="day">일</option>
                </select>
                <span>동안</span>
              </div>
            )}
            <p className="help">
              {win === "now"
                ? "열자마자 머지해요. 이의를 낼 틈이 없으니 되돌리기 쉬운 것만 고르세요."
                : `${length} 동안 아무도 이의를 내지 않으면 머지해요. 결정자가 모두 동의하면 더 일찍 머지해요.`}
            </p>
          </fieldset>
        )}
        {!revising && (
          <div className="auto-box">
            <p>
              <strong>결정자</strong>
              {[me, ...speakers.filter((s) => s.login !== me.login)].map((s) => (
                <span key={s.login} className="decider">
                  <Avatar name={s.name} size={36} />
                  {s.name}
                </span>
              ))}
            </p>
            <p>
              <strong>출처</strong>
              <a href={`${location.pathname}${location.hash}`}>{title}</a>
            </p>
          </div>
        )}
        {failure && (
          <p className="banner error" role="alert">
            {failure}
          </p>
        )}
        <p className="help dialog-note">
          {owner}의 이름으로 {repo}에 {revising ? "새 커밋을 올려요" : "결정 PR을 열어요"}.
        </p>
        <div className="dialog-actions decision-actions">
          {!revising && (
            <button
              type="button"
              className="button quiet"
              disabled={pending || sending}
              onClick={() => void write()}
            >
              {everDrafted ? "다시 쓰게 하기" : "초안 쓰게 하기"}
            </button>
          )}
          <button type="button" className="button quiet" onClick={close}>
            취소
          </button>
          <button type="submit" className="button primary" disabled={!canOpen}>
            {revising ? "고쳐 올리기" : "결정 PR 열기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
