import {
  api,
  type Channel,
  type ChannelMessage,
  call,
  HISTORY_PAGE,
  type MemberView,
} from "@omagari/contract";
import { Menu, Users, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type Me, server, signedOut } from "./api.ts";
import { byName, ChannelList, CreateChannel } from "./channels.tsx";
import { ChannelTitle, Conversation, type View } from "./conversation.tsx";
import { useLive } from "./live.ts";
import { MemberList, MemberSkeleton } from "./members.tsx";

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

/** 번호로 합친다. 같은 메시지가 지난 대화와 실시간으로 두 번 와도 하나만 남는다. */
const merge = (a: ChannelMessage[], b: ChannelMessage[]) =>
  [...new Map([...a, ...b].map((message) => [message.id, message])).values()].sort(
    (x, y) => x.id - y.id,
  );

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
  const [members, setMembers] = useState<MemberView[]>();
  const wide = useMedia(WIDE);
  /** 열린 오른쪽 칸. 내 에이전트(#21)가 여기에 더해진다. */
  const [right, setRight] = useState<"members">();
  const rightId = useId();
  const membersButton = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const closeRight = () => {
    closing.current = true;
    setRight(undefined);
  };
  // 닫으면 연 버튼으로 돌아간다. 시트(모달)가 사라진 뒤라야 바깥에 포커스를 줄 수 있다.
  useEffect(() => {
    if (right || !closing.current) return;
    closing.current = false;
    membersButton.current?.focus();
  }, [right]);
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

  const live = useLive(
    session,
    (event) => {
      if (event.kind === "welcome") {
        call(server(session), api.channels)
          .then((list) => setChannels(byName(list.channels)))
          .catch(check);
      } else if (event.kind === "channel") add(event.payload);
      else if (event.kind === "message") receive(event.payload);
      else if (event.kind === "members") setMembers(event.payload.members);
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

  const panel = (onPick?: () => void) => (
    <ChannelPanel me={me} onLogout={onLogout}>
      <ChannelList
        channels={channels}
        current={current?.id}
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
          {/* 오른쪽 칸을 여는 버튼들. 평소에는 아이콘만, 연 버튼만 이름이 붙는다. #21이 내 에이전트를 앞에 더한다. */}
          <div className="header-actions">
            <button
              ref={membersButton}
              type="button"
              className="header-button"
              aria-label="멤버 목록"
              aria-expanded={right === "members"}
              aria-controls={right === "members" ? rightId : undefined}
              onClick={() => (right === "members" ? closeRight() : setRight("members"))}
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
            onSend={(text) => send((current as Channel).id, text)}
            onRetry={() => current && void load(current.id)}
            onOlder={() => {
              const view = current && views[current.id];
              if (current && view?.more && !view.older) void load(current.id, view.messages[0]?.id);
            }}
          />
        )}
      </main>
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
 */
function RightPanel({
  id,
  title,
  sheet,
  onClose,
  children,
}: {
  id: string;
  title: string;
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
        <h2>{title}</h2>
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
  onLogout,
  children,
}: {
  me: Me;
  onLogout: () => void;
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
      <ProfilePanel me={me} onLogout={onLogout} />
    </>
  );
}

export const Avatar = ({ name, size }: { name: string; size: 36 | 40 }) => (
  <span className={`avatar avatar-${size}`} aria-hidden>
    {/* 접속 점(온라인, 자리 비움, 방해 금지, 오프라인)은 아바타 오른쪽 아래에 붙는다. 1단계에 넣을지 아직 정하지 않았다. */}
    {Array.from(name)[0]?.toUpperCase()}
  </span>
);

/** 채널 패널 맨 아래의 프로필 패널. 누르면 바로 위에 메뉴가 열린다. */
function ProfilePanel({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useId();

  // 메뉴 바깥을 누르면 닫힌다.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  // Esc는 메뉴만 닫는다. 서랍 안에서 열었어도 서랍은 그대로 둔다.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 Esc를 한곳에서 받는다
    <div className="profile" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="profile-button"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <Avatar name={me.name} size={36} />
        {/* 이름 아래 줄은 상태 메시지 자리다. 상태 메시지가 생기기 전까지 GitHub 아이디를 둔다. */}
        <span className="names">
          <strong>{me.name}</strong>
          <span>{me.login}</span>
        </span>
      </button>
      {/* 메뉴는 버튼 뒤에 둔다. 위에 떠 보여도 Tab은 버튼에서 메뉴로 간다. */}
      {open && (
        <div className="menu" id={menu}>
          <div className="menu-head">
            <Avatar name={me.name} size={40} />
            <div className="names">
              <strong>{me.name}</strong>
              <span>{me.login}</span>
            </div>
          </div>
          {/* 상태 메시지 칸과 접속 상태 고르기가 여기에 온다. 1단계에 넣을지 아직 정하지 않았다. */}
          <hr />
          <button type="button" className="menu-item" disabled>
            설정
            <span className="menu-note">준비 중</span>
          </button>
          <button type="button" className="menu-item danger" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
