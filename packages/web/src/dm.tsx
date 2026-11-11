import {
  type Channel,
  type ChannelMessage,
  ContractFailure,
  EXECUTOR_NAMES,
  type ExecutorId,
  type MemberView,
  type Qa,
} from "@omagari/contract";
import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Composer, fullTime, SkeletonRow, timeOf } from "./conversation.tsx";
import { Mark } from "./members.tsx";
import { RightPanel } from "./workspace.tsx";

type Agent = MemberView["agents"][number];
/** 채널 하나의 내 DM: 불러온 문답(오래된 것부터), 불러오는 중, 또는 불러오지 못함. */
export type Dm = Qa[] | "loading" | "error";

/**
 * 오른쪽 칸의 DM(DESIGN.md "DM 칸"): 머리에 고른 에이전트, 그 에이전트와의 문답, 입력 칸.
 * 물을 에이전트는 러너가 붙어 있는 내 에이전트 가운데서만 고른다. 고른 것이 끊기면 남은 것 가운데 첫째로 바뀌고,
 * 하나도 없으면 입력 칸 대신 빈 상태를 보인다. 문답 목록은 고른 에이전트의 것만 보인다(채널 세션이 채널과 에이전트마다 하나라서).
 */
export function DmPanel({
  id,
  sheet,
  channel,
  agents,
  dm,
  onAsk,
  onPost,
  onReload,
  onClose,
}: {
  id: string;
  sheet: boolean;
  channel: Channel;
  /** 내 에이전트 전부. 꺼진 것도 온다. */
  agents: Agent[];
  dm?: Dm;
  onAsk: (executor: ExecutorId, question: string) => Promise<void>;
  /** 문답을 채널에 올린다. 질문과 답이 함께 올라간다. */
  onPost: (qa: Qa) => Promise<void>;
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

  return (
    <RightPanel
      id={id}
      title="내 에이전트"
      sheet={sheet}
      onClose={onClose}
      head={
        <DmHead channel={channel} connected={connected} selected={selected} onPick={setPicked} />
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
          <div className="qa-list" role="log" aria-label={`# ${channel.name}의 내 문답`}>
            {qas.map((qa) => (
              <QaCard key={qa.id} qa={qa} onRetry={retry(qa)} onPost={() => onPost(qa)} />
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
  connected,
  selected,
  onPick,
}: {
  channel: Channel;
  connected: Agent[];
  selected?: Agent;
  onPick: (executor: ExecutorId) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useId();
  const many = connected.length > 1;

  // 메뉴 바깥을 누르면 닫힌다. 열리면 고른 줄에 초점을 둔다.
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  // 고를 것이 하나 이하로 줄면 메뉴를 닫는다.
  if (open && !many) setOpen(false);

  const names = (
    <span className="dm-names">
      <span className="dm-title">
        {selected ? EXECUTOR_NAMES[selected.executor] : "내 에이전트"}
        {many && <ChevronDown size={14} className="dm-chevron" aria-hidden />}
      </span>
      <span className="dm-sub">나만 보여요 · # {channel.name}</span>
    </span>
  );
  const face = (
    <>
      {selected && <Mark agent={selected} aria-hidden />}
      {names}
    </>
  );
  if (!many) return <div className="dm-head">{face}</div>;

  // 메뉴(WAI-ARIA menu): 위아래 화살표로 줄을 옮기고, Esc는 메뉴만 닫고 머리로 돌아간다. Tab으로 나가면 닫힌다.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    const items = [
      ...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // 시트(dialog)는 닫지 않는다
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

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
                setOpen(false);
                button.current?.focus();
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

const VISIBILITY = { private: "비공개", public: "공개" } as const;

/**
 * 채널에 올라온 문답(DESIGN.md "문답"): 접힌 한 줄(app-qa-line)이 기본이고, 누르면 펼친 카드(app-qa-card)가 된다.
 * 사람의 대화를 덮지 않게 메시지 본문 위치에 맞춰 들인다. `state`는 그 에이전트의 지금 상태(러너가 붙어 있는지)다.
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
 * 문답 하나(app-qa-card): 질문, 답하는 중이나 답(마크다운)과 본 브랜치·커밋, 또는 끊긴 답.
 * DM에서는 공개 범위 배지와 시각을 머리에 두고, 비공개이고 답이 왔으면 아래에 "채널에 올리기"를 둔다.
 * 채널에 올라온 것(`posted`)은 머리에 누구의 에이전트인지와 누가 올렸는지, 아래에 "본 코드"와 "접기"를 둔다.
 * "다시 묻기"는 DM에서 그 에이전트가 연결되어 있을 때만 있다.
 */
function QaCard({
  qa,
  agent,
  posted,
  onRetry,
  onPost,
  onFold,
}: {
  qa: Qa;
  agent?: Agent;
  posted?: QaMessage;
  onRetry?: () => void;
  onPost?: () => Promise<void>;
  onFold?: () => void;
}) {
  const name = EXECUTOR_NAMES[qa.executor];
  const { answer } = qa;
  const [posting, setPosting] = useState(false);
  const [failed, setFailed] = useState(false);
  const post = async () => {
    setPosting(true);
    setFailed(false);
    try {
      await onPost?.();
    } catch {
      setFailed(true);
    } finally {
      setPosting(false);
    }
  };
  const canPost = onPost && qa.visibility === "private" && answer.state === "answered";
  const badge = (
    <span className={qa.visibility === "public" ? "badge outline" : "badge chip"}>
      {VISIBILITY[qa.visibility]}
    </span>
  );
  return (
    <article className="qa-card">
      {posted ? (
        <div className="qa-head posted">
          <Mark agent={agent ?? { executor: qa.executor, state: "offline" }} aria-hidden />
          <p className="qa-owner">
            <strong className="qa-owner-name">
              {posted.name}의 {name}
            </strong>
            <span className="qa-owner-meta">
              {subject(posted.name)} 올림 ·{" "}
              <time dateTime={posted.at} title={fullTime(posted.at)}>
                {timeOf(posted.at)}
              </time>
            </span>
          </p>
          {badge}
        </div>
      ) : (
        <p className="qa-head">
          {badge}
          <time dateTime={qa.at} title={fullTime(qa.at)}>
            {timeOf(qa.at)}
          </time>
        </p>
      )}
      <p className="qa-question">{qa.question}</p>
      {answer.state === "pending" ? (
        <p className="qa-pending" role="status">
          <Mark agent={{ executor: qa.executor, state: "answering" }} aria-hidden />
          {name}가 답하는 중…
        </p>
      ) : answer.state === "answered" ? (
        <Answer text={answer.text} />
      ) : (
        <div className={answer.error.code === "turn_timeout" ? "banner warning" : "banner error"}>
          {FAILED[answer.error.code] ?? `${name}가 답하지 못했어요`}
          {onRetry && (
            <button type="button" className="banner-action" onClick={onRetry}>
              다시 묻기
            </button>
          )}
        </div>
      )}
      {failed && (
        <div className="banner error" role="alert">
          채널에 올리지 못했어요
          <button type="button" className="banner-action" onClick={() => void post()}>
            다시 시도
          </button>
        </div>
      )}
      {(answer.state === "answered" || posted) && (
        <div className={posted ? "qa-source posted" : "qa-source"}>
          {answer.state === "answered" && (
            <>
              <span className={posted ? "qa-source-label" : "sr-only"}>본 코드</span>
              <span className="source-ref" title={answer.source.commit}>
                {answer.source.branch ?? "브랜치 아님"} · {answer.source.commit.slice(0, 7)}
              </span>
              {answer.source.dirty && <span className="badge warning">작업 중 변경 포함</span>}
            </>
          )}
          {canPost && (
            <button
              type="button"
              className="button outline qa-action"
              disabled={posting}
              onClick={() => void post()}
            >
              {posting ? "올리는 중…" : "채널에 올리기"}
            </button>
          )}
          {onFold && (
            <button
              type="button"
              className="button quiet qa-action"
              aria-expanded={true}
              onClick={onFold}
            >
              접기
            </button>
          )}
        </div>
      )}
    </article>
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
