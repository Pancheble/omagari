import { type Channel, type ChannelMessage, MAX_MESSAGE_CHARS } from "@omagari/contract";
import { ArrowUp, Hash } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
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
 * 보내지 못한 메시지는 입력 칸에 되돌려 두고, 알림 띠의 "다시 시도"가 다시 보낸다.
 */
export function Conversation({
  channel,
  view,
  live,
  onSend,
  onRetry,
  onOlder,
}: {
  channel?: Channel;
  view?: View;
  live: LiveState;
  onSend: (text: string) => Promise<void>;
  onRetry: () => void;
  onOlder: () => void;
}) {
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setText("");
    setFailed(false);
    scroller.current?.scrollTo({ top: 0 }); // 거꾸로 쌓는 목록이라 0이 맨 아래다
    try {
      await onSend(message);
    } catch {
      setFailed(true);
      setText((now) => now || message);
    }
  };

  return (
    <>
      {live === "reconnecting" && (
        <div className="banner info" role="status">
          서버에 다시 붙는 중…
        </div>
      )}
      {failed && (
        <div className="banner error" role="alert">
          메시지를 보내지 못했어요
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
              const grouped =
                !newDay &&
                previous.login === message.login &&
                Date.parse(message.at) - Date.parse(previous.at) < GROUP_MS;
              return (
                <Fragment key={message.id}>
                  {newDay && <div className="day">{dayLabel(message.at)}</div>}
                  <Message message={message} grouped={grouped} />
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
      {channel && (
        <Composer
          label={`#${channel.name}에 메시지 보내기`}
          value={text}
          onChange={setText}
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
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 글이 바뀔 때마다 높이를 다시 잰다
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (matchMedia("(pointer: fine)").matches) area.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글을 조합하는 중의 Enter는 글자를 끝내는 것이다. Safari는 그때 isComposing 없이 229를 낸다.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={area}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_MESSAGE_CHARS}
        placeholder={label}
        aria-label={label}
      />
      <button type="submit" className="send-button" aria-label="보내기" disabled={!value.trim()}>
        <ArrowUp size={18} aria-hidden />
      </button>
    </form>
  );
}

/** 메시지 한 줄. 글은 React가 글자로만 넣는다. 든 HTML이나 스크립트는 실행되지 않고 그대로 보인다. */
function Message({ message, grouped }: { message: ChannelMessage; grouped: boolean }) {
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
