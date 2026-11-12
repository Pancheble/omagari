import {
  api,
  type Channel,
  type ChannelMessage,
  type ChosenPresence,
  call,
  type ExecutorId,
  HISTORY_PAGE,
  type MemberView,
  type Presence,
  type PresenceDuration,
  type Qa,
  type Visibility,
} from "@omagari/contract";
import { Menu, MessageSquare, Users, X } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type Me, savedPicks, savePicks, server, signedOut } from "./api.ts";
import { byName, ChannelList, CreateChannel, useCollapsed } from "./channels.tsx";
import { ChannelTitle, Conversation, type View } from "./conversation.tsx";
import { chosen, type Dm, DmPanel, type Picks } from "./dm.tsx";
import { useLive } from "./live.ts";
import { MemberList, MemberSkeleton } from "./members.tsx";
import { ProfilePanel } from "./profile.tsx";

/** 이 폭부터 채널 패널이 늘 보인다. 그보다 좁으면 대화만 두고 채널 패널은 서랍으로 연다(DESIGN.md 앱의 좁은 화면). */
const WIDE = "(min-width: 834px)";

/** 미디어 쿼리가 맞는지. 창 폭이 바뀌면 따라온다. */
function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

/**
 * 번호로 합친다. 같은 메시지가 지난 대화와 실시간으로 두 번 와도 하나만 남고, 나중에 온 것이 앞의 것을 바꾼다.
 * 다만 답이 온 문답은 늦게 온 "답을 기다리는 중"으로 되돌리지 않는다.
 */
const merge = (a: ChannelMessage[], b: ChannelMessage[]) => {
  const byId = new Map<number, ChannelMessage>();
  for (const message of [...a, ...b]) {
    const known = byId.get(message.id);
    const stale =
      known?.kind === "qa" &&
      message.kind === "qa" &&
      known.qa.answer.state !== "pending" &&
      message.qa.answer.state === "pending";
    if (!stale) byId.set(message.id, message);
  }
  return [...byId.values()].sort((x, y) => x.id - y.id);
};

/** 문답을 번호로 넣거나 바꾼다. 답이 온 것은 늦게 온 "답을 기다리는 중"으로 되돌리지 않는다. */
const upsert = (qas: Qa[], qa: Qa) => {
  const known = qas.find((other) => other.id === qa.id);
  if (known && known.answer.state !== "pending" && qa.answer.state === "pending") return qas;
  return [...qas.filter((other) => other.id !== qa.id), qa].sort((x, y) => x.id - y.id);
};

/** 주소의 `#채널 id`. 채널 줄이 링크라 고르면 바뀌고, 뒤로 가기로도 바뀐다. */
function useHash() {
  const [hash, setHash] = useState(() => decodeURIComponent(location.hash.slice(1)));
  useEffect(() => {
    const changed = () => setHash(decodeURIComponent(location.hash.slice(1)));
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return hash;
}

/**
 * 앱 틀: 왼쪽 채널 패널, 가운데 대화 칸, 오른쪽 칸. 오른쪽 칸은 멤버 목록(#19)과 내 에이전트(#21) 가운데 하나만 열린다.
 * 좁은 화면에서는 같은 채널 패널을 왼쪽 서랍(모달 `<dialog>`)으로 연다.
 * 실시간 연결이 붙을 때마다(처음, 다시 붙을 때) 채널 목록을 다시 읽는다. 붙은 뒤에 읽으니 그사이 생긴 것도 빠지지 않는다.
 * 멤버 목록은 같은 연결로 붙을 때마다 한 번, 달라질 때마다 온다.
 */
export function Workspace({
  me,
  session,
  onLogout,
  onSignedOut,
}: {
  me: Me;
  session: string;
  onLogout: () => void;
  /** 세션이 끝났다(API나 실시간 연결이 그렇게 답했다). */
  onSignedOut: () => void;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const creator = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const wide = matchMedia(WIDE);
    const close = () => wide.matches && drawer.current?.close();
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  const [channels, setChannels] = useState<Channel[]>();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [members, setMembers] = useState<MemberView[]>();
  const wide = useMedia(WIDE);
  /** 열린 오른쪽 칸: 멤버 목록이나 내 에이전트(DM). 한 번에 하나만 열린다. */
  const [right, setRight] = useState<"members" | "agent">();
  const rightId = useId();
  const membersButton = useRef<HTMLButtonElement>(null);
  const agentButton = useRef<HTMLButtonElement>(null);
  /** 닫히면 초점을 돌려줄 버튼. 연 버튼이다. */
  const closing = useRef<HTMLButtonElement | null>(null);
  const closeRight = () => {
    closing.current = right === "agent" ? agentButton.current : membersButton.current;
    setRight(undefined);
  };
  const toggleRight = (panel: "members" | "agent") =>
    right === panel ? closeRight() : setRight(panel);
  // 닫으면 연 버튼으로 돌아간다. 시트(모달)가 사라진 뒤라야 바깥에 포커스를 줄 수 있다.
  useEffect(() => {
    if (right || !closing.current) return;
    closing.current.focus();
    closing.current = null;
  }, [right]);
  /** 채널마다 불러 둔 내 DM. 연 적 없는 채널은 없고, DM 칸을 처음 열 때 읽는다. */
  const [dms, setDms] = useState<Record<string, Dm>>({});
  /** 에이전트마다 고른 모델과 effort. 이 브라우저에 남아 새로 고쳐도 그대로다. DM과 `@호출`이 같이 쓴다. */
  const [picks, setPicks] = useState<Picks>(() => savedPicks(me.login));
  /** 채널마다 불러 둔 대화. 연 적 없는 채널은 없고, 처음 열 때 지난 대화를 읽는다. */
  const [views, setViews] = useState<Record<string, View>>({});
  const hash = useHash();
  const current = channels?.find((channel) => channel.id === hash) ?? channels?.[0];

  /** 세션이 끝났으면 로그인으로 돌아간다. 그 밖의 실패는 부른 쪽이 보인다. */
  const check = (error: unknown) => {
    if (signedOut(error)) onSignedOut();
    return error;
  };

  const add = (channel: Channel) =>
    setChannels(
      (list) => list && byName([...list.filter((other) => other.id !== channel.id), channel]),
    );

  /** 불러 둔 채널이면 대화에 넣는다. 안 연 채널의 것은 버리고, 열 때 지난 대화로 읽는다. */
  const receive = (message: ChannelMessage) =>
    setViews((all) => {
      const view = all[message.channel];
      return view
        ? { ...all, [message.channel]: { ...view, messages: merge(view.messages, [message]) } }
        : all;
    });

  /** 불러 둔 채널의 DM이면 넣는다. 안 연 채널의 것은 버리고, 열 때 읽는다. */
  const receiveQa = (qa: Qa) =>
    setDms((all) => {
      const dm = all[qa.channel];
      return Array.isArray(dm) ? { ...all, [qa.channel]: upsert(dm, qa) } : all;
    });

  const loadDm = async (channel: string) => {
    setDms((all) => ({ ...all, [channel]: "loading" }));
    try {
      const { qas } = await call(server(session), api.dms, { channel });
      // 읽는 사이에 실시간으로 온 것도 합친다.
      setDms((all) => {
        const now = all[channel];
        return { ...all, [channel]: Array.isArray(now) ? now.reduce(upsert, qas) : qas };
      });
    } catch (error) {
      check(error);
      setDms((all) => ({ ...all, [channel]: "error" }));
    }
  };
  const dmLoaded = current !== undefined && dms[current.id] !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: DM 칸에서 채널을 처음 열 때 한 번만 읽는다
  useEffect(() => {
    if (right === "agent" && current && !dmLoaded) void loadDm(current.id);
  }, [right, current?.id, dmLoaded]);

  /** 내 에이전트에게 묻는다. DM은 비공개, `@호출`은 공개다. `@호출`이면 채널에 선 문답도 바로 넣는다. */
  const ask = async (
    channel: string,
    executor: ExecutorId,
    message: string,
    visibility: Visibility = "private",
  ) => {
    const agent = members
      ?.find((m) => m.login === me.login)
      ?.agents.find((a) => a.executor === executor);
    try {
      const asked = await call(server(session), api.ask, {
        agent: me.login,
        executor,
        channel,
        message,
        visibility,
        ...chosen(agent?.choices, picks[executor]),
      });
      receiveQa(asked.qa);
      if (asked.message) receive(asked.message);
    } catch (error) {
      throw check(error);
    }
  };

  /** DM의 문답을 채널에 올린다. 채널에 선 줄과, 공개가 된 DM의 문답을 바로 넣는다. */
  const post = async (qa: Qa) => {
    try {
      const { message } = await call(server(session), api.postQa, { qa: qa.id });
      receive(message);
      if (message.kind === "qa") receiveQa(message.qa);
    } catch (error) {
      throw check(error);
    }
  };

  const live = useLive(
    session,
    (event) => {
      if (event.kind === "welcome") {
        call(server(session), api.channels)
          .then((list) => setChannels(byName(list.channels)))
          .catch(check);
        // 끊긴 사이에 온 답은 다시 오지 않는다. 불러 둔 DM을 버리고 열려 있는 것은 다시 읽는다.
        setDms({});
      } else if (event.kind === "channel") add(event.payload);
      else if (event.kind === "message") receive(event.payload);
      else if (event.kind === "members") setMembers(event.payload.members);
      else if (event.kind === "qa") receiveQa(event.payload);
    },
    onSignedOut,
  );

  /** 지난 대화를 읽는다. `before`가 없으면 맨 끝에서부터, 있으면 그보다 오래된 것이다. */
  const load = async (channel: string, before?: number) => {
    setViews((all) => ({
      ...all,
      [channel]:
        before === undefined
          ? { status: "loading", messages: all[channel]?.messages ?? [], more: false }
          : { ...(all[channel] as View), older: true },
    }));
    try {
      const { messages } = await call(server(session), api.history, { channel, before });
      setViews((all) => ({
        ...all,
        [channel]: {
          status: "ready",
          messages: merge(all[channel]?.messages ?? [], messages),
          more: messages.length === HISTORY_PAGE,
        },
      }));
    } catch (error) {
      check(error);
      // 오래된 것을 못 읽었으면 그대로 두고, 다시 위로 올리면 또 읽는다.
      setViews((all) => ({
        ...all,
        [channel]:
          before === undefined
            ? { status: "error", messages: [], more: false }
            : { ...(all[channel] as View), older: false },
      }));
    }
  };

  const opened = current !== undefined && views[current.id] !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 채널을 처음 열 때 한 번만 읽는다
  useEffect(() => {
    if (current && !opened) void load(current.id);
  }, [current?.id, opened]);

  const send = async (channel: string, text: string) => {
    try {
      receive((await call(server(session), api.send, { channel, text })).message);
    } catch (error) {
      throw check(error);
    }
  };

  const create = async (name: string) => {
    const { channel } = await call(server(session), api.createChannel, { name });
    add(channel);
    location.hash = channel.id;
  };

  const openCreator = () => {
    drawer.current?.close();
    creator.current?.showModal();
  };

  /** 내 접속 상태와 상태 메시지를 바꾼다. 바뀐 것은 실시간 연결의 멤버 목록으로 돌아온다. */
  const setPresence = async (presence: ChosenPresence, duration?: PresenceDuration) => {
    try {
      await call(server(session), api.setPresence, { presence, duration });
    } catch (error) {
      throw check(error);
    }
  };
  const setMessage = async (message: string, emoji: string | null) => {
    try {
      await call(server(session), api.setStatusMessage, { message, emoji });
    } catch (error) {
      throw check(error);
    }
  };

  const panel = (onPick?: () => void) => (
    <ChannelPanel
      me={me}
      mine={members?.find((member) => member.login === me.login)}
      onLogout={onLogout}
      onPresence={setPresence}
      onMessage={setMessage}
    >
      <ChannelList
        channels={channels}
        current={current?.id}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onPick={onPick}
        onCreate={openCreator}
      />
    </ChannelPanel>
  );

  return (
    <div className={right ? "app with-panel" : "app"}>
      <aside className="side-panel" aria-label="채널 패널">
        {panel()}
      </aside>
      <main className="conversation">
        <header className="channel-header">
          <button
            type="button"
            className="header-button drawer-button"
            aria-label="채널 패널 열기"
            onClick={() => drawer.current?.showModal()}
          >
            <Menu size={18} aria-hidden />
          </button>
          {current && <ChannelTitle channel={current} members={members?.length} />}
          {/* 오른쪽 칸을 여는 버튼들. 평소에는 아이콘만, 연 버튼만 이름이 붙는다. */}
          <div className="header-actions">
            {current && (
              <button
                ref={agentButton}
                type="button"
                className="header-button"
                aria-label="내 에이전트"
                aria-expanded={right === "agent"}
                aria-controls={right === "agent" ? rightId : undefined}
                onClick={() => toggleRight("agent")}
              >
                <MessageSquare size={18} aria-hidden />
                {right === "agent" && <span>내 에이전트</span>}
              </button>
            )}
            <button
              ref={membersButton}
              type="button"
              className="header-button"
              aria-label="멤버 목록"
              aria-expanded={right === "members"}
              aria-controls={right === "members" ? rightId : undefined}
              onClick={() => toggleRight("members")}
            >
              <Users size={18} aria-hidden />
              {right === "members" && <span>멤버 목록</span>}
            </button>
          </div>
        </header>
        {channels?.length === 0 ? (
          <div className="empty">
            <h2>아직 채널이 없어요</h2>
            <p>채널을 만들어 멤버들과 이야기를 시작해 보세요.</p>
            <button type="button" className="button primary" onClick={openCreator}>
              채널 만들기
            </button>
          </div>
        ) : (
          <Conversation
            key={current?.id}
            channel={current}
            view={current && views[current.id]}
            live={live}
            members={members}
            me={me.login}
            onSend={(text) => send((current as Channel).id, text)}
            onCall={(executor, question) =>
              ask((current as Channel).id, executor, question, "public")
            }
            onRetry={() => current && void load(current.id)}
            onOlder={() => {
              const view = current && views[current.id];
              if (current && view?.more && !view.older) void load(current.id, view.messages[0]?.id);
            }}
          />
        )}
      </main>
      {right === "agent" && current && (
        <DmPanel
          key={current.id}
          id={rightId}
          sheet={!wide}
          channel={current}
          agents={members?.find((member) => member.login === me.login)?.agents ?? []}
          dm={dms[current.id]}
          picks={picks}
          onPick={(executor, pick) => {
            const next = { ...picks, [executor]: pick };
            setPicks(next);
            savePicks(me.login, next);
          }}
          onAsk={(executor, question) => ask(current.id, executor, question)}
          onPost={post}
          onReload={() => void loadDm(current.id)}
          onClose={closeRight}
        />
      )}
      {right === "members" && (
        <RightPanel id={rightId} title="멤버 목록" sheet={!wide} onClose={closeRight}>
          {live === "reconnecting" && members && (
            <p className="banner info" role="status">
              서버에 다시 붙는 중…
            </p>
          )}
          {members ? <MemberList me={me.login} members={members} /> : <MemberSkeleton />}
        </RightPanel>
      )}
      {/* 덮개를 누르면 닫힌다. 키보드로는 Esc가 닫는다(dialog가 해 준다). */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다 */}
      <dialog
        ref={drawer}
        className="drawer"
        aria-label="채널 패널"
        onClick={(event) => event.target === event.currentTarget && drawer.current?.close()}
      >
        <div className="side-panel">{panel(() => drawer.current?.close())}</div>
      </dialog>
      <CreateChannel dialog={creator} onCreate={create} />
    </div>
  );
}

/**
 * 오른쪽 칸. 1069px 이상은 세 번째 칸, 834–1068px은 대화 위에 겹친 칸(CSS가 정한다),
 * 833px 이하(`sheet`)는 아래에서 올라오는 전체 높이 시트(모달 `<dialog>`)다. 닫기 버튼과 Esc, 덮개 누르기로 닫힌다.
 * 머리 왼쪽은 제목(`title`)이고, `head`를 주면 그것이 대신 선다(DM 칸의 고른 에이전트).
 */
export function RightPanel({
  id,
  title,
  head,
  sheet,
  onClose,
  children,
}: {
  id: string;
  title: string;
  head?: ReactNode;
  sheet: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (sheet) dialog.current?.showModal();
  }, [sheet]);
  const body = (
    <div className="right-panel">
      <div className="panel-head">
        {head ?? <h2>{title}</h2>}
        <button
          type="button"
          className="header-button"
          aria-label={`${title} 닫기`}
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
  if (!sheet) {
    return (
      <aside id={id} className="right-slot" aria-label={title}>
        {body}
      </aside>
    );
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog의 cancel이 맡는다
    <dialog
      ref={dialog}
      id={id}
      className="sheet"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      {body}
    </dialog>
  );
}

function ChannelPanel({
  me,
  mine,
  onLogout,
  onPresence,
  onMessage,
  children,
}: {
  me: Me;
  mine?: MemberView;
  onLogout: () => void;
  onPresence: (presence: ChosenPresence, duration?: PresenceDuration) => Promise<void>;
  onMessage: (message: string, emoji: string | null) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <>
      {/* 워크스페이스 이름은 아직 따로 정하는 곳이 없다. 워크스페이스 하나에 레포 하나라(ADR-0012) 레포 이름을 쓴다. */}
      <div className="workspace">
        <h1>{me.repo.split("/")[1]}</h1>
        <p>{me.repo}</p>
      </div>
      {children}
      <ProfilePanel
        me={me}
        mine={mine}
        onLogout={onLogout}
        onPresence={onPresence}
        onMessage={onMessage}
      />
    </>
  );
}

/** 접속 상태를 읽는 말. 접속 점의 이름이고, 상태 메시지가 없는 멤버 행의 둘째 줄이다. */
export const PRESENCE_WORDS = {
  online: "온라인",
  away: "자리 비움",
  dnd: "방해 금지",
  offline: "오프라인",
} as const satisfies Record<Presence, string>;

/**
 * 사람 아바타. `presence`를 주면 오른쪽 아래에 접속 점(DESIGN.md "접속 점")이 붙는다.
 * 점 둘레의 고리는 아바타를 점 모양으로 도려내 놓인 바탕이 그대로 보이게 한다. 바탕이 바뀌어도(올렸을 때) 맞는다.
 */
export const Avatar = ({
  name,
  size,
  presence,
}: {
  name: string;
  size: 36 | 40;
  presence?: Presence;
}) => {
  const face = (
    <span className={`avatar avatar-${size}`} aria-hidden>
      {Array.from(name)[0]?.toUpperCase()}
    </span>
  );
  if (!presence) return face;
  const word = PRESENCE_WORDS[presence];
  return (
    <span className="with-dot">
      {face}
      <Dot presence={presence} role="img" aria-label={word} title={word} />
    </span>
  );
};

/** 접속 점의 모양만: 온라인은 초록 원, 자리 비움은 주황 초승달, 방해 금지는 빨간 원에 흰 가로줄, 오프라인은 회색 빈 고리. */
export const Dot = ({ presence, ...rest }: { presence: Presence } & ComponentProps<"span">) => (
  <span className="dot" data-presence={presence} {...rest} />
);
