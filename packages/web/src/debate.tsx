import {
  ContractFailure,
  type Debate,
  type DebateOption,
  type DebateRequest,
  type DebateSeat,
  EVIDENCE_MARKS,
  type Experiment,
  INBOX_MS,
  type Stance,
  VERDICT_LABELS,
} from "@omagari/contract";
import {
  Bot,
  Check,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  EyeOff,
  FlaskConical,
  Gavel,
  Hourglass,
  MessagesSquare,
  Power,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { fullTime, timeOf } from "./conversation.tsx";
import { josa } from "./decision.tsx";
import { AiBadge } from "./dm.tsx";
import { took } from "./verdict.tsx";
import { notRunWords } from "./verdict-words.ts";

/** 토론 띠의 자리. 머리의 "토론 보기"가 여기로 초점을 옮긴다. */
export const DEBATE_STRIP = "debate-strip";

const DAY = 86_400_000;
const daysLeft = (at: string) =>
  Math.max(1, Math.ceil((Date.parse(at) + INBOX_MS - Date.now()) / DAY));
const submitted = (debate: Debate) =>
  debate.seats.filter((seat) => seat.state === "submitted").length;
/** 안에 대행이 낸 입장이 있으면 그 대행. */
const proxyOf = (option: DebateOption) => option.stances.find((stance) => stance.proxy)?.proxy;
const VERDICT_ICONS = { pass: CircleCheck, broken: CircleX, not_run: CircleMinus };

/**
 * 토론 띠(app-debate-strip, DESIGN.md "토론", 시안 57-A). 판정 띠와 같은 모양이고 그 아래 선다.
 * 기다리는 자리의 러너가 꺼져 있으면 "대행 부르기"가 늘 있다. 사람이 고르지 않고 정해졌으면 "결정 정리하기"가 띠에 있다.
 */
// ponytail: 계약에 실험이 도는 중이라는 상태가 없어 "실험을 돌리는 중"은 그리지 못한다. 러너가 알리면 띠에 더한다.
export function DebateStrip({
  debate,
  onProxy,
  onDecide,
}: {
  debate: Debate;
  onProxy: (seat: number) => void;
  onDecide: () => void;
}) {
  const away = debate.state === "open" ? debate.seats.findIndex((seat) => seat.away) : -1;
  const awaySeat = debate.seats[away];
  const count = `입장 ${submitted(debate)}/2`;
  const conclusion = debate.conclusion;
  const won = conclusion && debate.options[conclusion.option];

  let Icon = MessagesSquare;
  let label: string;
  let text: string;
  let button: { text: string; primary?: boolean; act: () => void } | undefined;
  if (awaySeat) {
    Icon = Hourglass;
    label = "기다리는 중";
    text = `${debate.round === 1 ? `${awaySeat.name}의 에이전트가 아직 없어요` : count} · ${daysLeft(debate.at)}일 남음`;
    button = { text: "대행 부르기", act: () => onProxy(away) };
  } else if (debate.state === "open") {
    Icon = debate.round === 1 ? EyeOff : MessagesSquare;
    label = `라운드 ${debate.round}/${debate.rounds}`;
    text = `${debate.round === 1 ? "가린 첫 입장" : "반박"} · ${count}`;
  } else if (debate.state === "choosing") {
    Icon = Gavel;
    label = "고를 차례";
    text = "두 안 가운데 하나를 골라 주세요 · 주인은 덮여 있어요";
  } else if (conclusion && won) {
    Icon = Check;
    label = `안 ${conclusion.option + 1}로 정했어요`;
    text = debate.options.some(proxyOf)
      ? "대행이 낀 토론이에요 · 주인이 돌아와 확인할 때까지 이의 창이 열려 있어요"
      : conclusion.by === "choice"
        ? `${josa(conclusion.chooser?.name ?? "멤버", "이", "가")} 골랐어요 · 결정 초안을 쓸 수 있어요`
        : conclusion.by === "experiment"
          ? "실험이 한 안만 통과했어요 · 사람이 고르지 않아도 돼요"
          : `검증된 근거가 안 ${conclusion.option + 1}에만 있어요 · 사람이 고르지 않아도 돼요`;
    // 사람이 골랐으면 결론 카드에 같은 버튼이 있다. 한 화면에 파란 버튼은 하나다.
    if (conclusion.by !== "choice")
      button = { text: "결정 정리하기", primary: true, act: onDecide };
  } else {
    Icon = CircleMinus;
    label = "토론이 끝났어요";
    text =
      debate.state === "expired"
        ? debate.options.length === 0 && submitted(debate) === 0
          ? "14일이 지나도 낸 입장이 없어요"
          : "14일 안에 라운드가 끝나지 않았어요"
        : "두 자리 모두 입장을 내지 않았어요";
  }
  const quiet = debate.state === "ended" || debate.state === "expired";

  return (
    <div
      id={DEBATE_STRIP}
      tabIndex={-1}
      className={quiet ? "debate-strip quiet" : "debate-strip"}
      role="status"
    >
      <Icon size={16} aria-hidden />
      <p className="strip-text">
        <strong>토론 · {label}</strong>
        <span
          className="round-dots"
          role="img"
          aria-label={`라운드 ${debate.round}/${debate.rounds}`}
        >
          {Array.from({ length: debate.rounds }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: 점은 라운드 번호다
              key={i}
              className={
                i + 1 < debate.round ||
                (i + 1 === debate.round && !quiet && debate.state !== "open")
                  ? "done"
                  : i + 1 === debate.round && debate.state === "open"
                    ? "now"
                    : undefined
              }
            />
          ))}
        </span>
        <span>{text}</span>
      </p>
      {button && (
        <button
          type="button"
          className={`button strip-button ${button.primary ? "primary" : "outline"}`}
          onClick={button.act}
        >
          {button.text}
        </button>
      )}
    </div>
  );
}

/**
 * 대화에 쌓이는 토론(DESIGN.md "토론"): 토론 요청 카드, 대행을 부른 줄, 안마다 입장 카드(시안 56-C), 빈 자리, 고르기(58-C)나 결론 카드.
 * 결론 전까지 안의 주인은 스포일러처럼 덮여 있고, 누른 사람의 화면에서만 열린다(시안 61).
 */
export function DebateLog({
  debate,
  request,
  onChoose,
  onDecide,
  onRequest,
}: {
  debate: Debate | null;
  request: DebateRequest | null;
  onChoose: (option: number) => Promise<void>;
  onDecide: () => void;
  onRequest: () => void;
}) {
  const owns = (seat: DebateSeat) =>
    debate?.options.some((o) => o.owner?.login === seat.login && o.owner.branch === seat.branch);
  // 공개 전에는 어느 자리가 안이 될지 모르므로 자리마다 빈 카드다. 공개 뒤에는 안이 없는 자리만 빈 카드다.
  const ghosts = debate ? debate.seats.filter((seat) => !debate.revealed || !owns(seat)) : [];
  return (
    <section className="debate-log" aria-label="토론">
      {request && <RequestCard request={request} onRetry={onRequest} />}
      {debate?.seats.map(
        (seat) =>
          seat.proxy && (
            <p key={seat.login + seat.branch} className="debate-line">
              <Bot size={16} aria-hidden />
              <span>
                <strong>{josa(seat.proxy.name, "이", "가")}</strong> {seat.name}의 대행을 불렀어요 ·{" "}
                {seat.proxy.name}의 러너가 {seat.proxy.name}의 사용량으로 띄웠어요
              </span>
            </p>
          ),
      )}
      {debate?.options.map((option, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 안의 번호가 곧 자리다
        <OptionCard key={i} option={option} index={i} debate={debate} />
      ))}
      {ghosts.map((seat) => (
        <Ghost key={seat.login + seat.branch} seat={seat} />
      ))}
      {debate?.state === "choosing" && <ChooseCard debate={debate} onChoose={onChoose} />}
      {debate?.conclusion?.by === "choice" && (
        <ConclusionCard debate={debate} onDecide={onDecide} />
      )}
    </section>
  );
}

function RequestCard({ request, onRetry }: { request: DebateRequest; onRetry: () => void }) {
  return (
    <article className={request.opened ? "debate-card" : "debate-card warning"}>
      <p className="debate-card-head">
        <MessagesSquare size={16} aria-hidden />
        <strong>{request.opened ? "토론 요청" : "토론 요청 · 열지 않았어요"}</strong>
        <time className="debate-meta" dateTime={request.at} title={fullTime(request.at)}>
          {request.name} · {timeOf(request.at)}
        </time>
      </p>
      <dl className="debate-request">
        <dt>안건</dt>
        <dd>{request.agenda || "(비어 있어요)"}</dd>
        <dt>근거</dt>
        <dd>{request.grounds || "(비어 있어요)"}</dd>
      </dl>
      {!request.opened && (
        <div className="debate-card-foot">
          <p>
            {request.agenda ? "근거가" : "안건이"} 비어 있어서 토론을 열지 않았어요.{" "}
            {request.agenda ? "근거를" : "안건을"} 더해 다시 요청해 주세요.
          </p>
          <button type="button" className="button outline strip-button" onClick={onRetry}>
            {request.agenda ? "근거" : "안건"} 더해 다시 요청
          </button>
        </div>
      )}
    </article>
  );
}

const GHOSTS = {
  submitted: { Icon: EyeOff, text: "입장 하나 · 냈어요", sub: "둘 다 낼 때까지 가려 둬요" },
  waiting: { Icon: Hourglass, text: "입장 하나 · 기다려요", sub: undefined },
  off: { Icon: Power, text: "안 자리 하나 · 토론 참여를 껐어요", sub: undefined },
  failed: { Icon: CircleX, text: "입장을 내지 못했어요", sub: undefined },
} as const;

function Ghost({ seat }: { seat: DebateSeat }) {
  const { Icon, text, sub } = GHOSTS[seat.state];
  return (
    <div className="debate-ghost">
      <Icon size={16} aria-hidden />
      <span>
        {text}
        {(sub ?? seat.error?.message) && (
          <span className="debate-meta"> · {sub ?? seat.error?.message}</span>
        )}
      </span>
    </div>
  );
}

/** 입장 카드 하나. 머리의 주인은 결론 전까지 덮개 칩이고, 누르면 이 화면에서만 열린다. */
function OptionCard({
  option,
  index,
  debate,
}: {
  option: DebateOption;
  index: number;
  debate: Debate;
}) {
  const [past, setPast] = useState(false);
  const pastId = useId();
  const latest = option.stances.at(-1);
  if (!latest) return null;
  const chosen = debate.conclusion?.option === index;
  const earlier = option.stances.slice(0, -1);
  const model = [latest.model, latest.effort].filter(Boolean).join(" · ");
  return (
    <article className="debate-card" aria-label={`안 ${index + 1}`}>
      <div className="debate-card-head">
        <span className="debate-number" aria-hidden>
          {index + 1}
        </span>
        <strong>안 {index + 1}</strong>
        <AiBadge />
        {model && <span className="badge outline">{model}</span>}
        {latest.context === "none" && <span className="badge outline">맥락 없이 참여</span>}
        {chosen && <span className="badge chosen">정한 안</span>}
        <Owner option={option} index={index} open={debate.state === "concluded"} />
        <span className="badge outline debate-round">라운드 {option.stances.length}</span>
      </div>
      <StanceBody stance={latest} />
      {earlier.length > 0 && (
        <>
          <button
            type="button"
            className="debate-past-toggle"
            aria-expanded={past}
            aria-controls={pastId}
            onClick={() => setPast(!past)}
          >
            라운드 {earlier.length === 1 ? "1" : `1–${earlier.length}`} 입장{" "}
            {past ? "접기" : "보기"}
          </button>
          {past && (
            <div id={pastId} className="debate-past">
              {earlier.map((stance, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 라운드 순서다
                <div key={i}>
                  <p className="debate-past-round">라운드 {i + 1}</p>
                  <StanceBody stance={stance} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** 안의 주인. 덮였으면 폭이 늘 같은 칩이라 이름 길이도 대행 여부도 새지 않는다. */
function Owner({ option, index, open }: { option: DebateOption; index: number; open: boolean }) {
  const [shown, setShown] = useState(false);
  const { owner } = option;
  if (!owner) return null;
  if (!open && !shown)
    return (
      <button
        type="button"
        className="spoiler"
        aria-pressed="false"
        aria-label={`안 ${index + 1}의 주인 보기. 누르면 이 화면에서만 보여요`}
        onClick={() => setShown(true)}
      >
        <EyeOff size={12} aria-hidden />
      </button>
    );
  const proxy = proxyOf(option);
  return (
    <span className="debate-owner" role={open ? undefined : "status"}>
      <span className="badge outline owner-name">
        {proxy
          ? `${owner.name} 대신 ${josa(proxy.name, "이", "가")} 띄운 에이전트`
          : `${owner.name}의 에이전트`}
      </span>
      {proxy && (
        <span className="badge outline">
          <Bot size={12} aria-hidden />
          대행
        </span>
      )}
      <span className="debate-branch">{owner.branch}</span>
    </span>
  );
}

function StanceBody({ stance }: { stance: Stance }) {
  return (
    <div className="debate-stance">
      <p className="debate-claim">{stance.claim}</p>
      {stance.changed &&
        (stance.changed.reason ? (
          <p className="debate-changed">
            <RefreshCw size={16} aria-hidden />
            <span>
              <strong>입장을 바꿨어요</strong> · 사유: {stance.changed.reason}
            </span>
          </p>
        ) : (
          <p className="debate-changed warning">
            <TriangleAlert size={16} aria-hidden />
            <span>
              <strong>사유 없이 바뀜</strong> 지난 라운드와 달라졌는데 사유를 적지 않았어요
            </span>
          </p>
        ))}
      {stance.evidence.length > 0 && (
        <ul className="debate-evidence">
          {stance.evidence.map((evidence, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 에이전트가 낸 순서다
            <li key={i}>
              <span
                className={`badge ${evidence.mark === "missing" ? "warning" : "outline"} mark-${evidence.mark}`}
              >
                {evidence.mark === "verified" ? (
                  <Check size={12} aria-hidden />
                ) : evidence.mark === "unverified" ? (
                  <CircleDashed size={12} aria-hidden />
                ) : (
                  <CircleX size={12} aria-hidden />
                )}
                {EVIDENCE_MARKS[evidence.mark]}
              </span>
              <span>{evidence.text}</span>
            </li>
          ))}
        </ul>
      )}
      {stance.experiment && <ExperimentLine experiment={stance.experiment} />}
    </div>
  );
}

/** 실험 줄. 판정 이름과 아이콘은 판정 띠의 것과 같다. 패치는 펼쳐 본다. */
// ponytail: 계약의 실험에 검사 출력이 없어 깨짐에도 "출력 보기" 대신 패치만 보인다. 러너가 출력을 실으면 더한다.
function ExperimentLine({ experiment }: { experiment: Experiment }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const Icon = VERDICT_ICONS[experiment.verdict];
  const text =
    experiment.verdict === "not_run"
      ? notRunWords(experiment.reason ?? "", "입장을 낸 쪽").text
      : `${experiment.check ?? "검사 명령"} · ${took(experiment.ms)}`;
  return (
    <div>
      <p className={`debate-experiment ${experiment.verdict}`}>
        <FlaskConical size={12} aria-hidden />
        <strong>실험</strong>
        <Icon size={12} aria-hidden />
        <span>{VERDICT_LABELS[experiment.verdict]}</span>
        <span className="debate-meta">{text}</span>
        {experiment.patch && (
          <button
            type="button"
            className="debate-link"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {open ? "패치 접기" : "패치 보기"}
          </button>
        )}
      </p>
      {open && (
        <pre id={id} className="verdict-output">
          {experiment.patch}
        </pre>
      )}
    </div>
  );
}

/** 마지막 입장의 한 줄 요약: "검증된 근거 2 · 실험 통과". */
const summary = (option: DebateOption) => {
  const last = option.stances.at(-1);
  const verified = last?.evidence.filter((e) => e.mark === "verified").length ?? 0;
  return [
    `검증된 근거 ${verified}`,
    last?.experiment && `실험 ${VERDICT_LABELS[last.experiment.verdict]}`,
  ]
    .filter(Boolean)
    .join(" · ");
};

/** 고르기(시안 58-C): 포스트의 멤버 누구나, 먼저 고른 것이 결론이다. */
function ChooseCard({
  debate,
  onChoose,
}: {
  debate: Debate;
  onChoose: (option: number) => Promise<void>;
}) {
  const [picked, setPicked] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = useId();
  const choose = async () => {
    if (picked === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await onChoose(picked);
    } catch (failure) {
      setError(
        failure instanceof ContractFailure && failure.code === "conflict"
          ? "누군가 먼저 골랐어요"
          : "고르지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="debate-card debate-choose">
      <legend className="debate-card-head">
        <Gavel size={16} aria-hidden />
        <strong>하나를 골라 주세요</strong>
      </legend>
      {debate.options.map((option, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 안의 번호가 곧 자리다
        <label key={i} className="debate-radio">
          <input type="radio" name={name} checked={picked === i} onChange={() => setPicked(i)} />
          <span>
            <strong>안 {i + 1}</strong>
            <span className="debate-radio-claim">{option.stances.at(-1)?.claim}</span>
            <span className="debate-meta">{summary(option)}</span>
          </span>
        </label>
      ))}
      <div className="debate-card-foot">
        <p className={error ? "help error" : "help"} aria-live="polite">
          {error ??
            "고르면 바꿀 수 없어요. 먼저 고른 안이 결정 초안이 되고, 반대는 결정 PR의 이의 창에서 낼 수 있어요."}
        </p>
        <button
          type="button"
          className="button primary"
          disabled={picked === undefined || busy}
          onClick={() => void choose()}
        >
          {picked === undefined ? "정하기" : `안 ${picked + 1}로 정하기`}
        </button>
      </div>
    </fieldset>
  );
}

function ConclusionCard({ debate, onDecide }: { debate: Debate; onDecide: () => void }) {
  const conclusion = debate.conclusion;
  if (!conclusion) return null;
  const n = conclusion.option + 1;
  const who = debate.options
    .map((o, i) => o.owner && `안 ${i + 1}은 ${o.owner.name}의 에이전트(${o.owner.branch})`)
    .filter(Boolean)
    .join(", ");
  return (
    <article className="debate-card">
      <p className="debate-card-head">
        <Check size={16} aria-hidden />
        <strong>안 {n}로 정했어요</strong>
        <time className="debate-meta" dateTime={conclusion.at} title={fullTime(conclusion.at)}>
          {josa(conclusion.chooser?.name ?? "멤버", "이", "가")} 골랐어요 · {timeOf(conclusion.at)}
        </time>
      </p>
      <div className="debate-card-foot">
        <p className="debate-meta">
          {who}가 냈어요. 결정 정리하기를 누르면 내 에이전트가 안 {n}을 바탕으로 결정 초안을 써요.
        </p>
        <button type="button" className="button primary" onClick={onDecide}>
          결정 정리하기
        </button>
      </div>
    </article>
  );
}

/** 대행 부르기(시안 59-C): 부른 사람의 러너가 부른 사람의 사용량으로 띄운다. */
export function ProxyDialog({
  seat,
  onProxy,
  onClose,
}: {
  seat: DebateSeat;
  onProxy: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useModal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = useId();
  const name = seat.name;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onProxy();
      dialog.current?.close();
    } catch (failure) {
      const code = failure instanceof ContractFailure ? failure.code : undefined;
      setError(
        code === "runner_offline"
          ? "내 러너가 꺼져 있어 대행을 띄울 수 없어요. 러너를 켜고 다시 시도해 주세요."
          : code === "conflict"
            ? "이미 입장을 냈거나 대행을 부를 수 없는 자리예요."
            : "대행을 부르지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={title}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={title}>{name}의 대행을 부를까요?</h2>
        <ul className="dialog-list">
          <li>내 러너가 내 사용량으로 띄워요</li>
          <li>
            {name}의 초안 PR, 브랜치 diff, 관련 결정만 봐요 (작업 대화는 {name}의 기기에 있어 볼 수
            없어요)
          </li>
          <li>대행이 낸 입장에는 "대행" 표시가 붙어요</li>
          <li>
            {name}의 에이전트가 돌아오면 이어받아요. 대행이 낀 결정은 {josa(name, "이", "가")}{" "}
            확인할 때까지 이의 창이 열려 있어요
          </li>
        </ul>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            대행 부르기
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** 토론 열기(시안 60-B): 안건과 근거가 모두 있어야 열 수 있다. 열지 못한 요청을 다시 낼 때는 지난 글을 채워 연다. */
export function DebateDialog({
  title: post,
  initial,
  onRequest,
  onClose,
}: {
  title: string;
  initial?: DebateRequest | null;
  onRequest: (agenda: string, grounds: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useModal();
  const [agenda, setAgenda] = useState(initial?.agenda ?? "");
  const [grounds, setGrounds] = useState(initial?.grounds ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const title = useId();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onRequest(agenda, grounds);
      dialog.current?.close();
    } catch (failure) {
      setError(
        failure instanceof ContractFailure && failure.code === "conflict"
          ? "이미 열린 토론이 있어요."
          : "토론을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다
    <dialog
      ref={dialog}
      className="dialog debate-dialog"
      aria-labelledby={title}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={title}>토론 열기</h2>
        <p className="dialog-lead">{post} · 부딪힌 두 작업의 에이전트가 안건을 두고 입장을 내요.</p>
        <div className="field">
          <label htmlFor={`${title}-agenda`}>안건</label>
          <input
            id={`${title}-agenda`}
            className="text-input"
            value={agenda}
            placeholder="무엇을 두고 부딪혔는지 한 줄로 적어 주세요"
            autoComplete="off"
            onChange={(event) => setAgenda(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${title}-grounds`}>근거</label>
          <textarea
            id={`${title}-grounds`}
            className="text-input draft-area debate-grounds"
            value={grounds}
            placeholder="커밋, 파일:줄, 결정 파일을 붙이면 검증돼요"
            onChange={(event) => setGrounds(event.target.value)}
          />
        </div>
        <p className="help debate-help">
          안건이나 근거가 비어 있으면 토론은 열리지 않고, 요청만 포스트에 남아요.
        </p>
        <p className="help">
          열면 부딪힌 두 주인의 에이전트가 각자 사용량으로 입장을 내요. 라운드는 3까지예요.
        </p>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            취소
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !agenda.trim() || !grounds.trim()}
          >
            토론 열기
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** 그려지면 바로 여는 대화 상자. 닫히면 부른 쪽이 `onClose`에서 치운다. */
function useModal() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return dialog;
}
