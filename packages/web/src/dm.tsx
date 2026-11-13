import {
  type Channel,
  type ChannelMessage,
  type Choices,
  ContractFailure,
  EXECUTOR_NAMES,
  type ExecutorId,
  type MemberView,
  type ModelChoice,
  type ModelPick,
  type Qa,
} from "@omagari/contract";
import { Check, ChevronDown, ChevronRight, CornerDownLeft, Forward } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Composer, flash, fullTime, SkeletonRow, timeOf } from "./conversation.tsx";
import { Mark } from "./members.tsx";
import { RightPanel } from "./workspace.tsx";

type Agent = MemberView["agents"][number];
/** 채널 하나의 내 DM: 불러온 문답(오래된 것부터), 불러오는 중, 또는 불러오지 못함. */
export type Dm = Qa[] | "loading" | "error";
/** 에이전트마다 기억해 둔 모델과 effort. */
export type Picks = Partial<Record<ExecutorId, ModelPick>>;

/**
 * 기억해 둔 값 가운데 지금 고를 거리에 있는 것만 남긴다. 없어진 모델이나, 고른 모델(없으면 "기본")에 없는 effort는 "기본"으로 본다.
 * 입력 칸의 칩과 보내는 질문이 같은 것을 쓴다.
 */
export function chosen(choices: Choices | undefined, pick: ModelPick | undefined): ModelPick {
  const model = choices?.models.find((m) => m.id === pick?.model);
  const efforts = (model ?? choices)?.efforts ?? [];
  const effort = efforts.find((e) => e === pick?.effort);
  return { ...(model && { model: model.id }), ...(effort && { effort }) };
}

/**
 * 버튼 하나와 그 메뉴(WAI-ARIA menu)의 여닫기. 열리면 고른 줄에 초점을 두고, 바깥을 누르거나 Tab으로 나가면 닫힌다.
 * 위아래 화살표로 줄을 옮기고, Esc는 메뉴만 닫고 버튼으로 돌아간다. DM 칸 머리와 입력 칸의 칩이 쓴다.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // 시트(dialog)는 닫지 않는다
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };
  return { open, setOpen, close, wrap, button, onKeyDown };
}

/**
 * 오른쪽 칸의 DM(DESIGN.md "DM 칸"): 머리에 고른 에이전트, 그 에이전트와의 문답, 입력 칸.
 * 물을 에이전트는 러너가 붙어 있는 내 에이전트 가운데서만 고른다. 고른 것이 끊기면 남은 것 가운데 첫째로 바뀌고,
 * 하나도 없으면 입력 칸 대신 빈 상태를 보인다. 문답 목록은 고른 에이전트의 것만 보인다(채널 세션이 채널과 에이전트마다 하나라서).
 */
export function DmPanel({
  id,
  sheet,
  channel,
  post,
  agents,
  dm,
  messages = [],
  picks,
  attached,
  onPick,
  onAsk,
  onAttach,
  onReload,
  onClose,
}: {
  id: string;
  sheet: boolean;
  /** 포스트면 `channel.name`이 포스트의 제목이다. */
  channel: Channel;
  /** `channel`이 포스트다(채널에 올리기가 포스트에 올리기가 된다). */
  post?: boolean;
  /** 내 에이전트 전부. 꺼진 것도 온다. */
  agents: Agent[];
  dm?: Dm;
  /** 채널에 불러 둔 메시지. 공개 문답의 채널 줄("보기")을 여기서 찾는다. */
  messages?: ChannelMessage[];
  /** 에이전트마다 기억해 둔 모델과 effort. 고른 값으로 묻는 것은 `onAsk`를 부른 쪽이 한다. */
  picks: Picks;
  /** 채널 입력 칸에 붙어 있는 문답의 번호. */
  attached?: number;
  onPick: (executor: ExecutorId, pick: ModelPick) => void;
  onAsk: (executor: ExecutorId, question: string) => Promise<void>;
  /** 문답을 채널 입력 칸에 붙인다. 보내면 질문과 답이 함께 올라간다. */
  onAttach: (qa: Qa) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const connected = agents.filter((agent) => agent.state !== "offline");
  const [picked, setPicked] = useState<ExecutorId>();
  const selected = connected.find((agent) => agent.executor === picked) ?? connected[0];
  // 고른 것이 끊겨 첫째로 바뀌었으면 그것을 고른 것으로 둔다. 끊긴 것이 다시 붙어도 되돌아가지 않는다.
  const now = selected?.executor;
  useEffect(() => {
    if (now) setPicked(now);
  }, [now]);
  /** 목록에 보일 에이전트. 연결된 것이 없으면 마지막으로 고른 것의 문답을 그대로 둔다. */
  const shown = selected?.executor ?? picked;

  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const ask = async (executor: ExecutorId, question: string) => {
    setFailure(undefined);
    scroller.current?.scrollTo({ top: 0 }); // 거꾸로 쌓는 목록이라 0이 맨 아래다
    try {
      await onAsk(executor, question);
    } catch (error) {
      const offline = error instanceof ContractFailure && error.code === "runner_offline";
      setFailure(
        offline
          ? `${EXECUTOR_NAMES[executor]} 러너가 꺼져 있어 지금은 물을 수 없어요`
          : "질문을 보내지 못했어요",
      );
      throw error;
    }
  };
  const send = (executor: ExecutorId) => {
    const question = text.trim();
    if (!question) return;
    setText("");
    ask(executor, question).catch(() => setText((now) => now || question));
  };

  const qas = Array.isArray(dm) ? dm.filter((qa) => qa.executor === shown) : [];
  const retry = (qa: Qa) =>
    connected.some((agent) => agent.executor === qa.executor)
      ? () => void ask(qa.executor, qa.question).catch(() => {})
      : undefined;
  const lines = messages.filter((message) => message.kind === "qa");

  // 열 때와 답이 올 때: 마지막 문답이 목록보다 길면 그 질문의 머리를 목록 위에 두고(답의 끝이 아니라 질문부터 읽게), 짧으면 맨 아래에 붙인다.
  const last = qas.at(-1);
  const settled = last?.answer.state === "pending" ? undefined : last?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 마지막 문답의 답이 올 때마다 다시 맞춘다
  useLayoutEffect(() => {
    const box = scroller.current;
    const item = box?.querySelector(".dm-qa:last-child");
    if (!box || !item) return;
    if (item.clientHeight <= box.clientHeight)
      box.scrollTo({ top: 0 }); // 거꾸로 쌓는 목록이라 0이 맨 아래다
    else box.scrollBy({ top: item.getBoundingClientRect().top - box.getBoundingClientRect().top });
  }, [settled]);

  /** 공개 문답의 "보기": 채널에서 그 문답의 메시지로 스크롤하고 잠깐 칠한다. 시트는 대화를 덮으니 닫는다. */
  const show = (qa: Qa) => {
    if (sheet) onClose();
    flash(qa.id);
  };

  return (
    <RightPanel
      id={id}
      title="내 에이전트"
      sheet={sheet}
      full
      onClose={onClose}
      head={
        <DmHead
          channel={channel}
          post={post}
          connected={connected}
          selected={selected}
          onPick={setPicked}
        />
      }
    >
      {dm === undefined || dm === "loading" ? (
        <div className="skeleton" role="status" aria-busy="true" aria-label="문답을 불러오는 중">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : dm === "error" ? (
        <div className="empty">
          <h2>문답을 불러오지 못했어요</h2>
          <p>네트워크를 확인하고 다시 시도해 주세요.</p>
          <button type="button" className="button outline" onClick={onReload}>
            다시 시도
          </button>
        </div>
      ) : qas.length > 0 ? (
        <div className="scroller" ref={scroller}>
          <div className="dm-list" role="log" aria-label={`# ${channel.name}의 내 문답`}>
            {qas.map((qa) => (
              <DmQa
                key={qa.id}
                qa={qa}
                channel={post ? "이 포스트" : `# ${channel.name}`}
                post={post}
                line={lines.find((line) => line.qa.id === qa.id)}
                attached={qa.id === attached}
                onRetry={retry(qa)}
                onAttach={() => onAttach(qa)}
                onShow={() => show(qa)}
              />
            ))}
          </div>
        </div>
      ) : selected ? (
        <div className="empty">
          <h2>{EXECUTOR_NAMES[selected.executor]}에게 아직 묻지 않았어요</h2>
          <p>이 채널의 대화와 내 폴더의 레포를 보고 답해요. 문답은 나만 봐요.</p>
        </div>
      ) : null}
      {failure && (
        <div className="banner error" role="alert">
          {failure}
        </div>
      )}
      {selected ? (
        <Composer
          label={`${EXECUTOR_NAMES[selected.executor]}에게 묻기`}
          value={text}
          onChange={setText}
          onSubmit={() => send(selected.executor)}
          tools={
            selected.choices.models.length + selected.choices.efforts.length > 0 && (
              <Chips
                choices={selected.choices}
                pick={chosen(selected.choices, picks[selected.executor])}
                onPick={(pick) => onPick(selected.executor, pick)}
              />
            )
          }
        />
      ) : (
        <div className={qas.length > 0 ? "empty no-agent" : "empty"}>
          <h2>연결된 에이전트가 없어요</h2>
          <p>이 기기에서 러너를 켜면 여기서 물을 수 있어요.</p>
        </div>
      )}
    </RightPanel>
  );
}

/**
 * DM 칸의 머리: 고른 에이전트와 "나만 보여요 · # 채널". 연결된 에이전트가 둘 이상이면 머리 전체가 버튼이고,
 * 누르면 바로 아래에 에이전트마다 한 줄인 메뉴가 열린다. 하나면 고르는 장치가 없고, 없으면 "내 에이전트"만 쓴다.
 */
function DmHead({
  channel,
  post,
  connected,
  selected,
  onPick,
}: {
  channel: Channel;
  post?: boolean;
  connected: Agent[];
  selected?: Agent;
  onPick: (executor: ExecutorId) => void;
}) {
  const { open, setOpen, close, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const many = connected.length > 1;

  // 고를 것이 하나 이하로 줄면 메뉴를 닫는다.
  if (open && !many) setOpen(false);

  const names = (
    <span className="dm-names">
      <span className="dm-title">
        {selected ? EXECUTOR_NAMES[selected.executor] : "내 에이전트"}
        {many && <ChevronDown size={14} className="dm-chevron" aria-hidden />}
      </span>
      <span className="dm-sub">나만 보여요 · {post ? channel.name : `# ${channel.name}`}</span>
    </span>
  );
  const face = (
    <>
      {selected && <Mark agent={selected} aria-hidden />}
      {names}
    </>
  );
  if (!many) return <div className="dm-head">{face}</div>;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다
    <div className="dm-picker" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="dm-head"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        aria-label={`물을 에이전트: ${selected ? EXECUTOR_NAMES[selected.executor] : ""}`}
        onClick={() => setOpen(!open)}
      >
        {face}
      </button>
      {open && (
        <div className="menu agent-menu" id={menu} role="menu" aria-label="물을 에이전트">
          {connected.map((agent) => (
            <button
              key={agent.executor}
              type="button"
              role="menuitemradio"
              aria-checked={agent.executor === selected?.executor}
              className="menu-item"
              tabIndex={-1}
              onClick={() => {
                onPick(agent.executor);
                close();
              }}
            >
              <Mark agent={agent} aria-hidden />
              <span className="agent-name">{EXECUTOR_NAMES[agent.executor]}</span>
              <span className={agent.state === "answering" ? "agent-state busy" : "agent-state"}>
                {agent.state === "answering" ? "답하는 중…" : "쉬는 중"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * DM 입력 칸 아래 줄의 모델 칩과 effort 칩(DESIGN.md "모델과 effort", app-composer-chip). 고를 거리는 그 에이전트의 실행기가 알린 것뿐이다.
 * 모델을 알리지 않았으면 모델 칩이, 고른 모델(없으면 "기본")의 effort를 알리지 않았으면 effort 칩이 없다.
 */
function Chips({
  choices,
  pick,
  onPick,
}: {
  choices: Choices;
  /** 지금 고를 거리에 맞춘 고른 값 */
  pick: ModelPick;
  onPick: (pick: ModelPick) => void;
}) {
  const model = choices.models.find((m) => m.id === pick.model);
  const efforts = (model ?? choices).efforts;
  const { latest, older } = splitModels(choices.models);
  const row = (m: ModelChoice) => ({ value: m.id, label: m.name });
  return (
    <>
      {choices.models.length > 0 && (
        <ChoiceChip
          name="모델"
          face={model?.name ?? "기본 모델"}
          options={latest.map(row)}
          older={older.map(row)}
          value={pick.model}
          // effort는 그대로 둔다. 새 모델에 없는 값이면 "기본"으로 보이고, 있는 모델로 돌아오면 다시 쓰인다.
          onPick={(id) => onPick({ ...pick, model: id })}
        />
      )}
      {efforts.length > 0 && (
        <ChoiceChip
          name="effort"
          face={`effort ${pick.effort ?? "기본"}`}
          options={efforts.map((e) => ({ value: e, label: e }))}
          value={pick.effort}
          onPick={(effort) => onPick({ ...pick, effort })}
        />
      )}
    </>
  );
}

/**
 * 실행기는 지난 판까지 모두 알린다. 이름 끝의 판 번호를 뗀 같은 이름("Opus 5.5"와 "Opus 4.8") 가운데 먼저 알린 것만 위에 두고
 * 나머지는 "이전 모델"로 접는다. 판 번호가 없는 이름은 모두 위에 둔다.
 */
function splitModels(models: ModelChoice[]) {
  const seen = new Set<string>();
  const latest: ModelChoice[] = [];
  const older: ModelChoice[] = [];
  for (const model of models) {
    const family = model.name.replace(/[\d.]+$/, "");
    if (family !== model.name && seen.has(family)) older.push(model);
    else latest.push(model);
    seen.add(family);
  }
  return { latest, older };
}

/**
 * 칩 메뉴를 입력 칸 위 4px에 둔다(DESIGN.md "메뉴 자리"). 왼쪽은 누른 칩에 맞추되 입력 칸(칸 안쪽 8px) 오른쪽을 넘지 않게 당기고,
 * 높이는 칸 몸통의 위 끝까지 남은 만큼이다. 넘치면 메뉴 안에서 스크롤한다.
 */
function place(menu: HTMLElement | null, chip: HTMLElement | null) {
  const form = menu?.offsetParent; // 입력 칸(.composer)
  const body = form?.closest(".panel-body");
  if (!menu || !chip || !(form instanceof HTMLElement) || !body) return;
  const box = form.getBoundingClientRect();
  menu.style.maxHeight = `${box.top - 4 - body.getBoundingClientRect().top}px`;
  const left = Math.min(chip.getBoundingClientRect().left, box.right - menu.offsetWidth);
  menu.style.left = `${Math.max(left, box.left) - box.left - form.clientLeft}px`;
}

/** 메뉴의 줄. 값이 없는 줄은 "기본"이다. */
type Row = { value?: string; label: string };

/**
 * 칩 하나와 입력 칸 위에 열리는 메뉴. 맨 위 줄은 "기본"(실행기 자기 설정)이다.
 * `older`가 있으면 맨 아래 "이전 모델 N개" 줄로 접어 두고 누르면 같은 메뉴 안에서 펼친다. 고른 것이 그 안에 있으면 펼친 채로 연다.
 */
function ChoiceChip({
  name,
  face,
  options,
  older = [],
  value,
  onPick,
}: {
  name: string;
  face: string;
  options: Row[];
  older?: Row[];
  /** 고른 것. 없으면 "기본"이다. */
  value?: string;
  onPick: (value: string | undefined) => void;
}) {
  const { open, setOpen, close, wrap, button, onKeyDown } = useMenu();
  const menu = useId();
  const list = useRef<HTMLDivElement>(null);
  const [unfolded, setUnfolded] = useState(false);
  const rows: Row[] = [{ label: "기본" }, ...options];
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열 때와 펼쳐 폭이 바뀔 때 다시 둔다
  useLayoutEffect(() => place(list.current, button.current), [open, unfolded]);
  const item = (row: Row) => (
    <button
      key={row.value ?? ""}
      type="button"
      role="menuitemradio"
      aria-checked={row.value === value}
      className="menu-item"
      tabIndex={-1}
      onClick={() => {
        onPick(row.value);
        close();
      }}
    >
      <span>{row.label}</span>
      {row.value === undefined && <span className="menu-note">설정값</span>}
    </button>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 키를 한곳에서 받는다
    <div className="chip-picker" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="composer-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        aria-label={`${name}: ${[...rows, ...older].find((row) => row.value === value)?.label ?? "기본"}`}
        onClick={() => {
          if (!open) setUnfolded(older.some((row) => row.value === value));
          setOpen(!open);
        }}
      >
        {face}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div ref={list} className="menu chip-menu" id={menu} role="menu" aria-label={name}>
          {rows.map(item)}
          {older.length > 0 && (
            <button
              type="button"
              role="menuitem"
              aria-expanded={unfolded}
              className="menu-item"
              tabIndex={-1}
              onClick={() => setUnfolded(!unfolded)}
            >
              <span>이전 모델 {older.length}개</span>
              <ChevronRight size={14} className="older-chevron" aria-hidden />
            </button>
          )}
          {unfolded && older.map(item)}
        </div>
      )}
    </div>
  );
}

/** 끊긴 답과 답하지 못한 것의 알림. 그 밖의 실패는 "<에이전트>가 답하지 못했어요"다. */
const FAILED: Partial<Record<string, string>> = {
  turn_timeout: "10분이 넘어 답을 끊었어요",
  runner_offline: "답하기 전에 러너가 꺼졌어요",
};

type QaMessage = Extract<ChannelMessage, { kind: "qa" }>;

/** "김지은이", "박민수가"처럼 이름 뒤에 이/가를 붙인다. 한글로 끝나지 않으면 이름만 둔다("owner 올림"). */
function subject(name: string) {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return name;
  return `${name}${code % 28 ? "이" : "가"}`;
}

/**
 * 채널에 올라온 문답(DESIGN.md "문답"): 접힌 한 줄(app-qa-line)이 기본이고, 누르면 펼친 카드(app-qa-card)가 된다.
 * 올린 사람의 메시지 본문 안에 둔다. `state`는 그 에이전트의 지금 상태(러너가 붙어 있는지)다.
 */
export function QaLine({ message, state }: { message: QaMessage; state: Agent["state"] }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const toggled = useRef(false);
  // 펼치거나 접으면 누른 버튼이 사라지니, 바뀐 쪽의 펼치기·접기 버튼으로 초점을 옮긴다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 펼치고 접을 때마다 옮긴다
  useEffect(() => {
    if (toggled.current) row.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
  }, [open]);
  const toggle = (next: boolean) => {
    toggled.current = true;
    setOpen(next);
  };
  const { qa } = message;
  const agent = { executor: qa.executor, state };
  const owner = `${message.name}의 ${EXECUTOR_NAMES[qa.executor]}`;
  return (
    <div className="qa-row" ref={row}>
      {open ? (
        <QaCard qa={qa} agent={agent} posted={message} onFold={() => toggle(false)} />
      ) : (
        <button
          type="button"
          className="qa-line"
          aria-expanded={false}
          onClick={() => toggle(true)}
        >
          <Mark agent={agent} aria-hidden />
          <strong className="qa-line-owner">{owner}</strong>
          <span className="qa-line-question">{qa.question}</span>
          <span className="qa-line-toggle" aria-hidden>
            {qa.answer.state === "pending" ? "답하는 중…" : "펼치기"}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * 채널에 펼친 문답(app-qa-card): 머리에 누구의 에이전트인지와 누가 올렸는지, 질문, 답, 아래에 "본 코드"와 "접기".
 * 채널의 카드에는 "다시 묻기"가 없다.
 */
function QaCard({
  qa,
  agent,
  posted,
  onFold,
}: {
  qa: Qa;
  agent: Pick<Agent, "executor" | "state">;
  posted: QaMessage;
  onFold: () => void;
}) {
  const { answer } = qa;
  return (
    <article className="qa-card">
      <div className="qa-head posted">
        <Mark agent={agent} aria-hidden />
        <p className="qa-owner">
          <strong className="qa-owner-name">
            {posted.name}의 {EXECUTOR_NAMES[qa.executor]}
          </strong>
          <span className="qa-owner-meta">
            {subject(posted.name)} 올림 ·{" "}
            <time dateTime={posted.at} title={fullTime(posted.at)}>
              {timeOf(posted.at)}
            </time>
          </span>
        </p>
        <span className="badge outline">공개</span>
      </div>
      <p className="qa-question">{qa.question}</p>
      <Reply qa={qa} />
      <div className="qa-source posted">
        {answer.state === "answered" && (
          <>
            <span className="qa-source-label">본 코드</span>
            <Source answer={answer} />
          </>
        )}
        <button
          type="button"
          className="button quiet qa-action"
          aria-expanded={true}
          onClick={onFold}
        >
          접기
        </button>
      </div>
    </article>
  );
}

/**
 * DM의 문답 하나(DESIGN.md "DM 칸"): 오른쪽 말풍선의 질문(app-dm-question)과 칸 바탕에 바로 놓은 답(app-dm-answer).
 * 답 아래에 본 브랜치·커밋과 배지, 그 아래 동작 줄에 비공개면 "채널에 올리기"(app-post-action, 누르면 채널 입력 칸에 붙는다)나
 * 붙어 있는 동안의 "채널 입력 칸에 넣었어요", 공개면 어디에 올랐는지와 "보기". "다시 묻기"는 그 에이전트가 연결되어 있을 때만 있다.
 */
function DmQa({
  qa,
  channel,
  post,
  line,
  attached,
  onRetry,
  onAttach,
  onShow,
}: {
  qa: Qa;
  /** 올린 곳을 부르는 말("# 결제", "이 포스트"). */
  channel: string;
  post?: boolean;
  /** 채널에 불러 둔 그 문답의 줄. 없으면 "보기"가 없다. */
  line?: QaMessage;
  /** 채널 입력 칸에 붙어 있다. */
  attached: boolean;
  onRetry?: () => void;
  onAttach: () => void;
  onShow: () => void;
}) {
  const { answer } = qa;
  // `@호출`은 물을 때 채널에 서서 줄의 시각이 물은 시각이다. 올린 것은 답이 온 뒤라 늦다.
  // ponytail: 채널에 불러 두지 않은 지난 `@호출`은 "올렸어요"로 보인다. 계약이 가르는 값을 주면 그것을 쓴다.
  const called = answer.state === "pending" || line?.at === qa.at;
  return (
    <article className="dm-qa">
      <div className="dm-ask">
        <p className="dm-question">{qa.question}</p>
        <time className="dm-time" dateTime={qa.at} title={fullTime(qa.at)}>
          {timeOf(qa.at)}
        </time>
      </div>
      <Reply qa={qa} onRetry={onRetry} />
      {answer.state === "answered" && (
        <div className="qa-source">
          <span className="sr-only">본 코드</span>
          <Source answer={answer} />
        </div>
      )}
      {qa.visibility === "public" ? (
        <div className="dm-actions">
          <p className="dm-shared">
            <Check size={16} aria-hidden />
            {called ? `${channel}에서 @호출로 물었어요` : `${channel}에 올렸어요`}
          </p>
          {line && (
            <button type="button" className="dm-show" onClick={onShow}>
              보기
            </button>
          )}
        </div>
      ) : (
        answer.state === "answered" && (
          <div className="dm-actions">
            {attached ? (
              <p className="dm-shared">
                <CornerDownLeft size={16} aria-hidden />
                {post ? "포스트 입력 칸에 넣었어요" : "채널 입력 칸에 넣었어요"}
              </p>
            ) : (
              <button type="button" className="post-action" onClick={onAttach}>
                <Forward size={16} aria-hidden />
                {post ? "포스트에 올리기" : "채널에 올리기"}
              </button>
            )}
          </div>
        )
      )}
    </article>
  );
}

/** 답하는 중, 답(마크다운), 또는 끊긴 답의 알림. `onRetry`가 있으면 알림에 "다시 묻기"를 둔다. */
function Reply({ qa, onRetry }: { qa: Qa; onRetry?: () => void }) {
  const name = EXECUTOR_NAMES[qa.executor];
  const { answer } = qa;
  if (answer.state === "pending") {
    return (
      <p className="qa-pending" role="status">
        <Mark agent={{ executor: qa.executor, state: "answering" }} aria-hidden />
        {name}가 답하는 중…
      </p>
    );
  }
  if (answer.state === "answered") return <Answer text={answer.text} />;
  return (
    <div className={answer.error.code === "turn_timeout" ? "banner warning" : "banner error"}>
      {FAILED[answer.error.code] ?? `${name}가 답하지 못했어요`}
      {onRetry && (
        <button type="button" className="banner-action" onClick={onRetry}>
          다시 묻기
        </button>
      )}
    </div>
  );
}

/** 답이 본 브랜치·커밋(app-source-ref), 작업 중 변경이 있으면 그 배지, 답한 모델 배지. */
function Source({ answer }: { answer: Extract<Qa["answer"], { state: "answered" }> }) {
  return (
    <>
      <span className="source-ref" title={answer.source.commit}>
        {answer.source.branch ?? "브랜치 아님"} · {answer.source.commit.slice(0, 7)}
      </span>
      {answer.source.dirty && <span className="badge warning">작업 중 변경 포함</span>}
      {answer.model && (
        <span className="badge outline" title="답한 모델">
          {answer.effort ? `${answer.model} · ${answer.effort}` : answer.model}
        </span>
      )}
    </>
  );
}

/**
 * 에이전트의 답(마크다운과 코드). react-markdown은 HTML을 만들지 않고 React 요소로만 그린다.
 * 답에 든 HTML은 글자로 보이고, `javascript:` 같은 링크는 비운다. 링크는 새 탭으로 연다.
 */
function Answer({ text }: { text: string }) {
  return (
    <div className="answer">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 비운 링크(`javascript:` 등)는 누를 곳이 없으니 글자로만 둔다.
          a: ({ node: _, href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
