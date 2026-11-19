import {
  ContractFailure,
  type Debate,
  type DebateOption,
  type DebateRequest,
  type DebateSeat,
  type Experiment,
  INBOX_MS,
  type Stance,
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
import { AiBadge } from "./dm.tsx";
import { t } from "./i18n.ts";
import { Person } from "./profile-card.tsx";
import { took } from "./verdict.tsx";
import { notRunWords } from "./verdict-words.ts";

/** Anchor of the debate strip. "View debate" in the header moves focus here. */
export const DEBATE_STRIP = "debate-strip";

const DAY = 86_400_000;
const daysLeft = (at: string) =>
  Math.max(1, Math.ceil((Date.parse(at) + INBOX_MS - Date.now()) / DAY));
const submitted = (debate: Debate) =>
  debate.seats.filter((seat) => seat.state === "submitted").length;
/** The stand-in, if the option has a stance from a stand-in. */
const proxyOf = (option: DebateOption) => option.stances.find((stance) => stance.proxy)?.proxy;
const VERDICT_ICONS = { pass: CircleCheck, broken: CircleX, not_run: CircleMinus };

/**
 * Debate strip (app-debate-strip, DESIGN.md "Debate", mockup 57-A). Same shape as the verdict strip and sits below it.
 * "Call stand-in" is always there if the waiting slot's runner is off. Not shown for a debate with two tasks from the same person (ADR-0041). If it was settled without a person choosing, "Wrap up decision" is on the strip.
 */
// ponytail: the contract has no "experiment running" state, so "running an experiment" can't be drawn. Add it to the strip once the runner reports it.
export function DebateStrip({
  debate,
  onProxy,
  onDecide,
}: {
  debate: Debate;
  onProxy: (seat: number) => void;
  onDecide: () => void;
}) {
  const [first, second] = debate.seats;
  const away =
    debate.state === "open" && first.login !== second.login
      ? debate.seats.findIndex((seat) => seat.away)
      : -1;
  const awaySeat = debate.seats[away];
  const count = t.debate.stances(submitted(debate));
  const conclusion = debate.conclusion;
  const won = conclusion && debate.options[conclusion.option];

  let Icon = MessagesSquare;
  let label: string;
  let text: string;
  let button: { text: string; primary?: boolean; act: () => void } | undefined;
  if (awaySeat) {
    Icon = Hourglass;
    label = t.debate.waiting;
    text = `${debate.round === 1 ? t.debate.noAgent(awaySeat.name) : count} · ${t.debate.left(daysLeft(debate.at))}`;
    button = { text: t.debate.callStandIn, act: () => onProxy(away) };
  } else if (debate.state === "open") {
    Icon = debate.round === 1 ? EyeOff : MessagesSquare;
    label = t.debate.round(debate.round, debate.rounds);
    text = `${debate.round === 1 ? t.debate.hiddenFirst : t.debate.rebuttal} · ${count}`;
  } else if (debate.state === "choosing") {
    Icon = Gavel;
    label = t.debate.yourTurn;
    text = t.debate.chooseText;
  } else if (conclusion && won) {
    Icon = Check;
    label = t.debate.chosenOption(conclusion.option + 1);
    text = debate.options.some(proxyOf)
      ? t.debate.hasStandIn
      : conclusion.by === "choice"
        ? t.debate.chose(conclusion.chooser?.name ?? t.debate.member)
        : conclusion.by === "experiment"
          ? t.debate.byExperiment
          : t.debate.byEvidence(conclusion.option + 1);
    // If a person chose, the conclusion card has the same button. Only one blue button per screen.
    if (conclusion.by !== "choice")
      button = { text: t.debate.writeUp, primary: true, act: onDecide };
  } else {
    Icon = CircleMinus;
    label = t.debate.ended;
    text =
      debate.state === "expired"
        ? debate.options.length === 0 && submitted(debate) === 0
          ? t.debate.noneIn14
          : t.debate.notDoneIn14
        : t.debate.noneGiven;
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
        <strong>{t.debate.title(label)}</strong>
        <span
          className="round-dots"
          role="img"
          aria-label={t.debate.round(debate.round, debate.rounds)}
        >
          {Array.from({ length: debate.rounds }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: dots are round numbers
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
 * Debate that builds up in the conversation (DESIGN.md "Debate"): debate request card, stand-in call line, a stance card per option (mockup 56-C), empty slots, the pick (58-C) or conclusion card.
 * Until the conclusion, the option's owner is covered like a spoiler and opens only on the screen of whoever clicked (mockup 61).
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
  // Before reveal we don't know which slot becomes an option, so every slot is an empty card. After reveal, only slots without an option are empty cards.
  const ghosts = debate ? debate.seats.filter((seat) => !debate.revealed || !owns(seat)) : [];
  return (
    <section className="debate-log" aria-label={t.debate.aria}>
      {request && <RequestCard request={request} onRetry={onRequest} />}
      {debate?.seats.map(
        (seat) =>
          seat.proxy && (
            <p key={seat.login + seat.branch} className="debate-line">
              <Bot size={16} aria-hidden />
              <span>{t.debate.standInLine(seat.proxy.name, seat.name)}</span>
            </p>
          ),
      )}
      {debate?.options.map((option, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the option number is the slot
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
        <strong>{request.opened ? t.debate.request : t.debate.requestNotOpened}</strong>
        <time className="debate-meta" dateTime={request.at} title={fullTime(request.at)}>
          {request.name} · {timeOf(request.at)}
        </time>
      </p>
      <dl className="debate-request">
        <dt>{t.debate.agenda}</dt>
        <dd>{request.agenda || t.debate.empty}</dd>
        <dt>{t.debate.grounds}</dt>
        <dd>{request.grounds || t.debate.empty}</dd>
      </dl>
      {!request.opened && (
        <div className="debate-card-foot">
          <p>{request.agenda ? t.debate.missingGrounds : t.debate.missingAgenda}</p>
          <button type="button" className="button outline strip-button" onClick={onRetry}>
            {request.agenda ? t.debate.addGrounds : t.debate.addAgenda}
          </button>
        </div>
      )}
    </article>
  );
}

const GHOST_ICONS = { submitted: EyeOff, waiting: Hourglass, off: Power, failed: CircleX } as const;

function Ghost({ seat }: { seat: DebateSeat }) {
  const Icon = GHOST_ICONS[seat.state];
  const text = t.debate.ghost[seat.state];
  const sub =
    seat.state === "submitted"
      ? t.debate.ghost.submittedSub
      : seat.error && (t.debate.ghost.known[seat.error.message] ?? seat.error.message);
  return (
    <div className="debate-ghost">
      <Icon size={16} aria-hidden />
      <span>
        {text}
        {sub && <span className="debate-meta"> · {sub}</span>}
      </span>
    </div>
  );
}

/** One stance card. The owner in the header is a cover chip until the conclusion, and clicking opens it on this screen only. */
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
    <article className="debate-card" aria-label={t.debate.option(index + 1)}>
      <div className="debate-card-head">
        <span className="debate-number" aria-hidden>
          {index + 1}
        </span>
        <strong>{t.debate.option(index + 1)}</strong>
        <AiBadge />
        {model && <span className="badge outline">{model}</span>}
        {latest.context === "none" && <span className="badge outline">{t.debate.noContext}</span>}
        {chosen && <span className="badge chosen">{t.debate.chosen}</span>}
        <Owner option={option} index={index} open={debate.state === "concluded"} />
        <span className="badge outline debate-round">{t.debate.roundN(option.stances.length)}</span>
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
            {t.debate.pastToggle(earlier.length === 1 ? "1" : `1–${earlier.length}`, past)}
          </button>
          {past && (
            <div id={pastId} className="debate-past">
              {earlier.map((stance, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: round order
                <div key={i}>
                  <p className="debate-past-round">{t.debate.roundN(i + 1)}</p>
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

/** Owner of the option. When covered it is a fixed-width chip, so neither name length nor stand-in status leaks. */
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
        aria-label={t.debate.showOwner(index + 1)}
        onClick={() => setShown(true)}
      >
        <EyeOff size={12} aria-hidden />
      </button>
    );
  const proxy = proxyOf(option);
  return (
    <span className="debate-owner" role={open ? undefined : "status"}>
      <span className="badge outline owner-name">
        {proxy ? (
          t.debate.standInOwner(owner.name, proxy.name)
        ) : (
          <>
            <Person login={owner.login}>{owner.name}</Person>
            {t.debate.ownerAgent}
          </>
        )}
      </span>
      {proxy && (
        <span className="badge outline">
          <Bot size={12} aria-hidden />
          {t.debate.standIn}
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
              <strong>{t.debate.changedStance}</strong> · {t.debate.reason}: {stance.changed.reason}
            </span>
          </p>
        ) : (
          <p className="debate-changed warning">
            <TriangleAlert size={16} aria-hidden />
            <span>
              <strong>{t.debate.noReason}</strong> {t.debate.noReasonText}
            </span>
          </p>
        ))}
      {stance.evidence.length > 0 && (
        <ul className="debate-evidence">
          {stance.evidence.map((evidence, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: order given by the agent
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
                {t.debate.evidence[evidence.mark]}
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

/** Experiment line. Verdict name and icon match the verdict strip. The patch expands to view. */
// ponytail: the contract's experiment has no check output, so even on a failure only the patch shows instead of "View output". Add it once the runner includes output.
function ExperimentLine({ experiment }: { experiment: Experiment }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const Icon = VERDICT_ICONS[experiment.verdict];
  const text =
    experiment.verdict === "not_run"
      ? notRunWords(experiment.reason ?? "", t.debate.asker).text
      : `${experiment.check ?? t.verdict.checkFallback} · ${took(experiment.ms)}`;
  return (
    <div>
      <p className={`debate-experiment ${experiment.verdict}`}>
        <FlaskConical size={12} aria-hidden />
        <strong>{t.debate.experiment}</strong>
        <Icon size={12} aria-hidden />
        <span>{t.verdict.names[experiment.verdict]}</span>
        <span className="debate-meta">{text}</span>
        {experiment.patch && (
          <button
            type="button"
            className="debate-link"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {open ? t.debate.hidePatch : t.debate.showPatch}
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

/** One-line summary of the last stance: "2 verified evidence · experiment passed". */
const summary = (option: DebateOption) => {
  const last = option.stances.at(-1);
  const verified = last?.evidence.filter((e) => e.mark === "verified").length ?? 0;
  return [
    t.debate.verifiedEvidence(verified),
    last?.experiment && t.debate.experimentVerdict(t.verdict.names[last.experiment.verdict]),
  ]
    .filter(Boolean)
    .join(" · ");
};

/** Pick (mockup 58-C): any member of the post; whoever picks first decides the conclusion. */
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
          ? t.debate.alreadyPicked
          : t.debate.pickFailed,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="debate-card debate-choose">
      <legend className="debate-card-head">
        <Gavel size={16} aria-hidden />
        <strong>{t.debate.pickOne}</strong>
      </legend>
      {debate.options.map((option, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the option number is the slot
        <label key={i} className="debate-radio">
          <input type="radio" name={name} checked={picked === i} onChange={() => setPicked(i)} />
          <span>
            <strong>{t.debate.option(i + 1)}</strong>
            <span className="debate-radio-claim">{option.stances.at(-1)?.claim}</span>
            <span className="debate-meta">{summary(option)}</span>
          </span>
        </label>
      ))}
      <div className="debate-card-foot">
        <p className={error ? "help error" : "help"} aria-live="polite">
          {error ?? t.debate.pickHelp}
        </p>
        <button
          type="button"
          className="button primary"
          disabled={picked === undefined || busy}
          onClick={() => void choose()}
        >
          {picked === undefined ? t.debate.decide : t.debate.decideOption(picked + 1)}
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
    .map((o, i) => o.owner && t.debate.whoWrote(i + 1, o.owner.name, o.owner.branch))
    .filter(Boolean)
    .join(", ");
  return (
    <article className="debate-card">
      <p className="debate-card-head">
        <Check size={16} aria-hidden />
        <strong>{t.debate.wentWith(n)}</strong>
        <time className="debate-meta" dateTime={conclusion.at} title={fullTime(conclusion.at)}>
          {t.debate.choseAt(conclusion.chooser?.name ?? t.debate.member, timeOf(conclusion.at))}
        </time>
      </p>
      <div className="debate-card-foot">
        <p className="debate-meta">{t.debate.conclusionNote(who, n)}</p>
        <button type="button" className="button primary" onClick={onDecide}>
          {t.debate.writeUp}
        </button>
      </div>
    </article>
  );
}

/** Call stand-in (mockup 59-C): the caller's runner starts it, using the caller's usage. */
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
          ? t.debate.runnerOffline
          : code === "conflict"
            ? t.debate.seatTaken
            : t.debate.callFailed,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is handled by the dialog
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={title}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={title}>{t.debate.callTitle(name)}</h2>
        <ul className="dialog-list">
          <li>{t.debate.callBullets.mine}</li>
          <li>{t.debate.callBullets.sees(name)}</li>
          <li>{t.debate.callBullets.mark}</li>
          <li>{t.debate.callBullets.back(name)}</li>
        </ul>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            {t.debate.cancel}
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {t.debate.callStandIn}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Open debate (mockup 60-B): needs both an agenda and evidence. When re-sending a request that failed to open, it opens prefilled with the earlier text. */
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
          ? t.debate.alreadyOpen
          : t.debate.openFailed,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is handled by the dialog
    <dialog
      ref={dialog}
      className="dialog debate-dialog"
      aria-labelledby={title}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
    >
      <form onSubmit={submit}>
        <h2 id={title}>{t.debate.open}</h2>
        <p className="dialog-lead">{t.debate.openLead(post)}</p>
        <div className="field">
          <label htmlFor={`${title}-agenda`}>{t.debate.agenda}</label>
          <input
            id={`${title}-agenda`}
            className="text-input"
            value={agenda}
            placeholder={t.debate.agendaHint}
            autoComplete="off"
            onChange={(event) => setAgenda(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${title}-grounds`}>{t.debate.grounds}</label>
          <textarea
            id={`${title}-grounds`}
            className="text-input draft-area debate-grounds"
            value={grounds}
            placeholder={t.debate.groundsHint}
            onChange={(event) => setGrounds(event.target.value)}
          />
        </div>
        <p className="help debate-help">{t.debate.emptyNote}</p>
        <p className="help">{t.debate.openNote}</p>
        {error && (
          <p className="help error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => dialog.current?.close()}>
            {t.debate.cancel}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !agenda.trim() || !grounds.trim()}
          >
            {t.debate.open}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Dialog that opens as soon as it is drawn. When closed, the caller removes it in `onClose`. */
function useModal() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return dialog;
}
