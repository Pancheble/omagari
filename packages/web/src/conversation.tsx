import {
  type Channel,
  type ChannelMessage,
  ContractFailure,
  EXECUTOR_NAMES,
  type ExecutorId,
  MAX_MESSAGE_CHARS,
  type MemberView,
} from "@omagari/contract";
import { ArrowUp, Hash } from "lucide-react";
import {
  type ComponentProps,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CallComposer } from "./call.tsx";
import { QaLine } from "./dm.tsx";
import type { LiveState } from "./live.ts";
import { Avatar } from "./workspace.tsx";

/** 채널 하나의 대화. 실시간으로 받은 것은 불러오는 중에도 쌓아 두고, 지난 대화를 받으면 번호로 합친다. */
export type View = {
  status: "loading" | "ready" | "error";
  messages: ChannelMessage[];
  /** 더 오래된 메시지가 서버에 남아 있을 수 있다. */
  more: boolean;
  /** 더 오래된 메시지를 불러오는 중이다. */
  older?: boolean;
};

/** 같은 사람이 이 안에 이어 쓴 메시지는 이름과 아바타 없이 묶는다. */
const GROUP_MS = 5 * 60_000;
/** 위로 이만큼 남았으면 더 오래된 메시지를 미리 불러온다. */
const OLDER_PX = 400;

const dayOf = (iso: string) => new Date(iso).toDateString();
const midnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** 날짜 구분선의 글: "오늘", "어제", "11월 9일 (월)", 올해가 아니면 연도를 붙인다. */
function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round((midnight(today) - midnight(date)) / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  return date.toLocaleDateString("ko-KR", {
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" });

/** 채널 머리 띠의 왼쪽: `# 채널 이름`과 멤버 수. 채널의 멤버는 워크스페이스의 멤버 모두다. */
export function ChannelTitle({ channel, members }: { channel: Channel; members?: number }) {
  return (
    <div className="channel-title">
      <h2>
        <Hash className="channel-mark" size={20} aria-hidden />
        <span>{channel.name}</span>
      </h2>
      {members !== undefined && <span className="channel-members">멤버 {members}명</span>}
    </div>
  );
}

/**
 * 대화 칸의 머리 띠 아래: 알림 띠, 메시지 목록, 입력 칸. 채널을 아직 모르면(처음 붙는 중) 뼈대만 보인다.
 * 입력 칸에서 내 에이전트를 `@호출`하면 메시지 대신 그 에이전트에게 모두가 보게 묻는다.
 * 보내지 못한 메시지나 질문은 입력 칸에 (부른 에이전트와 함께) 되돌려 두고, 알림 띠의 "다시 시도"가 다시 보낸다.
 */
export function Conversation({
  channel,
  view,
  live,
  members,
  me,
  onSend,
  onCall,
  onRetry,
  onOlder,
}: {
  channel?: Channel;
  view?: View;
  live: LiveState;
  /** 멤버 목록. 내 에이전트(`@호출`)와 문답한 에이전트의 지금 상태를 여기서 읽는다. */
  members?: MemberView[];
  me: string;
  onSend: (text: string) => Promise<void>;
  onCall: (executor: ExecutorId, question: string) => Promise<void>;
  onRetry: () => void;
  onOlder: () => void;
}) {
  const [text, setText] = useState("");
  const [token, setToken] = useState<ExecutorId>();
  const [failure, setFailure] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const agentsOf = (login: string) => members?.find((member) => member.login === login)?.agents;

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    const called = token;
    setText("");
    setToken(undefined);
    setFailure(undefined);
    scroller.current?.scrollTo({ top: 0 }); // 거꾸로 쌓는 목록이라 0이 맨 아래다
    try {
      await (called ? onCall(called, message) : onSend(message));
    } catch (error) {
      const offline = error instanceof ContractFailure && error.code === "runner_offline";
      setFailure(
        !called
          ? "메시지를 보내지 못했어요"
          : offline
            ? `${EXECUTOR_NAMES[called]} 러너가 꺼져 있어 지금은 물을 수 없어요`
            : "질문을 보내지 못했어요",
      );
      setText((now) => now || message);
      setToken((now) => now ?? called);
    }
  };

  return (
    <>
      {live === "reconnecting" && (
        <div className="banner info" role="status">
          서버에 다시 붙는 중…
        </div>
      )}
      {failure && (
        <div className="banner error" role="alert">
          {failure}
          <button type="button" className="banner-action" onClick={() => void send()}>
            다시 시도
          </button>
        </div>
      )}
      {!channel || !view || view.status === "loading" ? (
        <Skeleton />
      ) : view.status === "error" ? (
        <div className="empty">
          <h2>메시지를 불러오지 못했어요</h2>
          <p>네트워크를 확인하고 다시 시도해 주세요.</p>
          <button type="button" className="button outline" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : view.messages.length === 0 ? (
        <div className="empty">
          <h2># {channel.name}에 아직 메시지가 없어요</h2>
          <p>첫 메시지를 보내 대화를 시작해 보세요.</p>
        </div>
      ) : (
        // 목록을 거꾸로 쌓는 칸(column-reverse)에 넣어, 처음부터 맨 아래가 보이고 위에 오래된 것을 붙여도 보던 자리가 그대로다.
        <div
          className="scroller"
          ref={scroller}
          onScroll={(event) => {
            const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;
            if (scrollHeight - clientHeight + scrollTop < OLDER_PX) onOlder();
          }}
        >
          <div className="log" role="log" aria-label={`# ${channel.name}의 메시지`}>
            {view.older && <SkeletonRow />}
            {view.messages.map((message, i) => {
              const previous = view.messages[i - 1];
              const newDay = !previous || dayOf(previous.at) !== dayOf(message.at);
              // 문답은 묶지 않고, 문답 다음의 글은 머리를 다시 단다.
              const grouped =
                !newDay &&
                message.kind === "text" &&
                previous.kind === "text" &&
                previous.login === message.login &&
                Date.parse(message.at) - Date.parse(previous.at) < GROUP_MS;
              return (
                <Fragment key={message.id}>
                  {newDay && <div className="day">{dayLabel(message.at)}</div>}
                  {message.kind === "qa" ? (
                    <QaLine
                      message={message}
                      state={
                        agentsOf(message.login)?.find(
                          (agent) => agent.executor === message.qa.executor,
                        )?.state ?? "offline"
                      }
                    />
                  ) : (
                    <Message message={message} grouped={grouped} />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
      {channel && (
        <CallComposer
          label={`#${channel.name}에 메시지 보내기`}
          agents={agentsOf(me) ?? []}
          value={text}
          onChange={setText}
          token={token}
          onToken={setToken}
          onSubmit={() => void send()}
        />
      )}
    </>
  );
}

/**
 * 입력 칸(app-composer). 줄이 늘면 커지고 최대 높이(CSS)를 넘으면 칸 안에서 스크롤한다. Enter는 보내기, Shift+Enter는 줄바꿈.
 * 열리면 바로 쓸 수 있게 초점을 둔다. 터치 화면에서는 자판이 갑자기 올라오지 않게 초점을 옮기지 않는다.
 */
export function Composer({
  label,
  value,
  onChange,
  onSubmit,
  area: given,
  before,
  menu,
  textarea,
  tools,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  /** 입력 칸을 부른 쪽도 쓸 때(초점, 글쇠 자리) 넘긴다. */
  area?: RefObject<HTMLTextAreaElement | null>;
  /** 입력 칸 앞에 둘 것(`@호출`의 토큰). */
  before?: ReactNode;
  /** 입력 칸 위에 뜨는 메뉴(`@호출`의 에이전트 메뉴). */
  menu?: ReactNode;
  /** 입력 칸에 더할 속성. `onKeyDown`은 먼저 불리고, 막으면(preventDefault) 보내기와 줄바꿈을 하지 않는다. */
  textarea?: ComponentProps<"textarea">;
  /** 글 아래 줄 왼쪽에 둘 것(DM의 모델·effort 칩). 있으면 입력 칸이 두 줄이 되고 보내기 버튼은 아래 줄 오른쪽 끝에 선다. */
  tools?: ReactNode;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const area = given ?? own;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 글이 바뀔 때마다 높이를 다시 잰다
  useLayoutEffect(() => {
    if (area.current) fitHeight(area.current);
  }, [value]);

  // 폭이 바뀌어도 다시 잰다. 처음 그릴 때 칸이 좁거나 숨겨져 있었으면 안내 글이 접힌 채 높이가 잡혀 있다.
  // 높이를 바꾸면 다시 불리니 같은 폭이면 넘어간다. 불린 자리에서 바로 높이를 바꾸면 브라우저가
  // "ResizeObserver loop" 오류를 내므로 다음 프레임에 잰다.
  // ponytail: field-sizing: content가 Baseline 널리 쓰임이 되면(Vite 기본 빌드 대상이 받치면) 이 감시와 fitHeight를 CSS 한 줄로 바꾼다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열릴 때 한 번만 건다
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    let width = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitHeight(element));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 열릴 때 한 번만 초점을 둔다
  useEffect(() => {
    if (matchMedia("(pointer: fine)").matches) area.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    textarea?.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // 한글을 조합하는 중의 Enter는 글자를 끝내는 것이다. Safari는 그때 isComposing 없이 229를 낸다.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      className={tools ? "composer stacked" : "composer"}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {menu}
      {before}
      <textarea
        {...textarea}
        ref={area}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder={label}
        aria-label={label}
      />
      {tools && <div className="composer-tools">{tools}</div>}
      <button type="submit" className="send-button" aria-label="보내기" disabled={!value.trim()}>
        <ArrowUp size={18} aria-hidden />
      </button>
    </form>
  );
}

/** 입력 칸 높이를 글에 맞춘다. 최대 높이는 CSS가 막는다. */
function fitHeight(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

/** 메시지 한 줄. 글은 React가 글자로만 넣는다. 든 HTML이나 스크립트는 실행되지 않고 그대로 보인다. */
function Message({
  message,
  grouped,
}: {
  message: Extract<ChannelMessage, { kind: "text" }>;
  grouped: boolean;
}) {
  return (
    <article className={grouped ? "message grouped" : "message"}>
      {grouped ? (
        <time className="side-time" dateTime={message.at} title={fullTime(message.at)}>
          {timeOf(message.at)}
        </time>
      ) : (
        <Avatar name={message.name} size={36} />
      )}
      <div className="message-body">
        {!grouped && (
          <p className="message-head">
            <strong>{message.name}</strong>
            <time dateTime={message.at} title={fullTime(message.at)}>
              {timeOf(message.at)}
            </time>
          </p>
        )}
        <p className="message-text">{message.text}</p>
      </div>
    </article>
  );
}

export const SkeletonRow = () => (
  <div className="skeleton-row" aria-hidden>
    <span className="bone circle" />
    <span className="bones">
      <span className="bone" />
      <span className="bone" />
    </span>
  </div>
);

/** 불러오는 중: 메시지 세 개만큼의 회색 뼈대. */
const Skeleton = () => (
  <div className="skeleton" role="status" aria-busy="true" aria-label="메시지를 불러오는 중">
    <SkeletonRow />
    <SkeletonRow />
    <SkeletonRow />
  </div>
);
