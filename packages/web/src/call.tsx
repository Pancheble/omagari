import { EXECUTOR_NAMES, type ExecutorId, type MemberView, type Qa } from "@omagari/contract";
import { X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Composer } from "./conversation.tsx";
import { Mark } from "./members.tsx";

type Agent = MemberView["agents"][number];

/** 글쇠 앞에서 `@`로 시작하는 낱말. `@`는 맨 앞이나 공백 뒤에 있어야 한다(메일 주소의 @는 아니다). */
const TRIGGER = /(?:^|\s)@(\S*)$/;

/**
 * 채널의 입력 칸과 `@호출`. `@`를 치면 바로 위에 내 연결된 에이전트 메뉴(app-popover)가 열린다. DM 칸의 고르기와 같은 규칙이다:
 * 러너가 꺼진 에이전트는 나오지 않고, 하나여도 한 줄짜리 메뉴로 고른다. 없으면 메뉴가 그렇다고 알린다.
 * 고르면 친 `@…`는 지워지고 입력 칸 앞에 그 에이전트가 토큰으로 선다. 토큰이 있으면 보내는 글은 그 에이전트에게 모두가 보게 묻는 질문이다.
 * 메뉴는 WAI-ARIA 콤보박스(목록)다: 초점은 입력 칸에 두고 위아래 화살표로 고르고, Enter나 Tab으로 넣고, Esc로 닫는다.
 * DM의 문답을 붙이면(`attached`) 입력 칸 맨 위 줄에 그 문답(app-qa-attachment)이 서고 글은 그 아래 줄에 쓴다(DESIGN.md "채널에 올리기").
 * 붙인 문답은 토큰과 함께 두지 않는다: 붙이면 토큰을 지우고(친 글은 둔다), 붙어 있는 동안은 `@`로 메뉴가 열리지 않는다.
 */
export function CallComposer({
  label,
  agents,
  owner,
  value,
  onChange,
  token,
  onToken,
  attached,
  onDetach,
  onSubmit,
}: {
  label: string;
  /** 내 에이전트 전부. 꺼진 것도 온다. */
  agents: Agent[];
  /** 내 이름. 붙인 문답의 "지은의 Claude Code"에 쓴다. */
  owner: string;
  value: string;
  onChange: (text: string) => void;
  /** 부른 에이전트. 없으면 사람끼리의 메시지다. */
  token?: ExecutorId;
  onToken: (executor?: ExecutorId) => void;
  /** 붙인 DM 문답. 있으면 보내는 글은 그 문답과 함께 채널에 올리는 한마디다. */
  attached?: Qa;
  onDetach: () => void;
  onSubmit: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useId();
  const title = useId();
  const connected = agents.filter((agent) => agent.state !== "offline");
  /** 친 `@`의 자리와 그 뒤에 친 글. */
  const [trigger, setTrigger] = useState<{ at: number; query: string }>();
  /** Esc로 닫은 `@`의 자리. 그 자리의 `@`로는 다시 열지 않는다. */
  const [dismissed, setDismissed] = useState<number>();
  const [active, setActive] = useState(0);

  const query = trigger?.query.toLowerCase() ?? "";
  const options = connected.filter((agent) =>
    [EXECUTOR_NAMES[agent.executor].replaceAll(" ", ""), agent.executor].some((name) =>
      name.toLowerCase().startsWith(query),
    ),
  );
  const open =
    trigger !== undefined &&
    trigger.at !== dismissed &&
    (connected.length === 0 || options.length > 0);
  const current = options[Math.min(active, options.length - 1)];

  // 문답을 붙이면(바꿔 붙여도) 토큰과 열린 메뉴를 거두고 글 줄로 간다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 붙인 문답이 바뀔 때만 한다
  useEffect(() => {
    if (!attached) return;
    onToken(undefined);
    setTrigger(undefined);
    area.current?.focus();
  }, [attached?.id]);

  /**
   * 글이 바뀌거나 글쇠가 움직이면 `@`를 다시 찾는다. 이미 부른 에이전트나 붙인 문답이 있으면 찾지 않는다(한 번에 하나만 부르고, 문답과 함께 부르지 않는다).
   */
  const sync = (element: HTMLTextAreaElement) => {
    const before = element.value.slice(0, element.selectionStart);
    const match =
      token || attached || element.selectionStart !== element.selectionEnd
        ? null
        : TRIGGER.exec(before);
    const query = match?.[1] ?? "";
    const next = match ? { at: before.length - query.length - 1, query } : undefined;
    if (next?.at === trigger?.at && next?.query === trigger?.query) return;
    setTrigger(next);
    setActive(0);
  };

  const pick = (agent: Agent) => {
    if (!trigger) return;
    const { at } = trigger;
    onChange(value.slice(0, at) + value.slice(at + 1 + trigger.query.length));
    onToken(agent.executor);
    setTrigger(undefined);
    requestAnimationFrame(() => area.current?.setSelectionRange(at, at));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return; // 한글을 조합하는 중
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (
      (token || attached) &&
      event.key === "Backspace" &&
      selectionStart === 0 &&
      selectionEnd === 0
    ) {
      event.preventDefault();
      if (token) onToken(undefined);
      else onDetach();
      return;
    }
    if (!open || !trigger) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(trigger.at);
    } else if (current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((options.indexOf(current) + step + options.length) % options.length);
    } else if (current && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      pick(current);
    }
  };

  const called = agents.find((agent) => agent.executor === token);
  const name = token && EXECUTOR_NAMES[token];

  const menu =
    open &&
    (connected.length === 0 ? (
      <div className="menu call-menu" role="status">
        <p className="call-empty">
          <strong className="call-empty-title">연결된 에이전트가 없어요</strong>
          <span className="call-empty-text">
            이 기기에서 러너를 켜면 @로 내 에이전트를 불러 모두가 보게 물을 수 있어요.
          </span>
        </p>
      </div>
    ) : (
      <div className="menu call-menu">
        <p className="call-menu-title" id={title}>
          모두가 보게 묻기
        </p>
        <div id={list} role="listbox" aria-labelledby={title}>
          {options.map((agent, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: 글쇠는 입력 칸이 받는다(콤보박스)
            <div
              key={agent.executor}
              id={`${list}-${agent.executor}`}
              role="option"
              aria-selected={agent === current}
              tabIndex={-1}
              className="menu-item"
              // 눌러도 입력 칸의 초점이 떠나지 않는다.
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(i)}
              onClick={() => pick(agent)}
            >
              <Mark agent={agent} aria-hidden />
              <span className="agent-name">{EXECUTOR_NAMES[agent.executor]}</span>
              <span className={agent.state === "answering" ? "agent-state busy" : "agent-state"}>
                {agent.state === "answering" ? "답하는 중…" : "쉬는 중"}
              </span>
            </div>
          ))}
        </div>
      </div>
    ));

  return (
    <Composer
      label={attached ? "한마디 덧붙이기 (선택)" : name ? `${name}에게 모두가 보게 묻기` : label}
      sendable={!!attached}
      value={value}
      onChange={(text) => {
        onChange(text);
        if (area.current) sync(area.current);
      }}
      onSubmit={onSubmit}
      area={area}
      menu={menu}
      before={
        attached ? (
          <div className="qa-attachment">
            <Mark
              agent={
                agents.find((agent) => agent.executor === attached.executor) ?? {
                  executor: attached.executor,
                  state: "offline",
                }
              }
              aria-hidden
            />
            <strong className="qa-attachment-owner">
              {owner}의 {EXECUTOR_NAMES[attached.executor]}
            </strong>
            <span className="qa-attachment-question">{attached.question}</span>
            <button
              type="button"
              className="call-token-remove qa-attachment-remove"
              aria-label="올릴 문답 빼기"
              onClick={() => {
                onDetach();
                area.current?.focus();
              }}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : (
          token && (
            <span className="call-token">
              <Mark agent={called ?? { executor: token, state: "offline" }} aria-hidden />
              {name}
              <button
                type="button"
                className="call-token-remove"
                aria-label={`${name} 부르기 취소`}
                onClick={() => {
                  onToken(undefined);
                  area.current?.focus();
                }}
              >
                <X size={14} aria-hidden />
              </button>
            </span>
          )
        )
      }
      textarea={{
        role: "combobox",
        "aria-expanded": open,
        "aria-controls": open && connected.length > 0 ? list : undefined,
        "aria-autocomplete": "list",
        "aria-activedescendant": open && current ? `${list}-${current.executor}` : undefined,
        onKeyDown,
        onSelect: (event) => sync(event.currentTarget),
        onBlur: () => setTrigger(undefined),
      }}
    />
  );
}
