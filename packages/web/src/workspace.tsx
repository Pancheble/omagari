import {
  api,
  type Channel,
  type ChannelMessage,
  type ChosenPresence,
  call,
  type Decision,
  type Draft,
  type ExecutorId,
  HISTORY_PAGE,
  type MemberView,
  type Presence,
  type PresenceDuration,
  type Qa,
  type Visibility,
} from "@omagari/contract";
import {
  ChevronLeft,
  Maximize2,
  Menu,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Users,
  X,
} from "lucide-react";
import {
  type ComponentProps,
  type PointerEvent,
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
import { DecisionDialog, type Fields } from "./decision.tsx";
import { chosen, type Dm, DmPanel, type Picks } from "./dm.tsx";
import { changed, Forum, ForumTitle, type PostItem, postOf, postsOf, postTitle } from "./forum.tsx";
import { useLive } from "./live.ts";
import { MemberList, MemberSkeleton } from "./members.tsx";
import { ProfilePanel } from "./profile.tsx";
import { Settings } from "./settings.tsx";

/** 이 폭부터 채널 패널이 늘 보인다. 그보다 좁으면 대화만 두고 채널 패널은 서랍으로 연다(DESIGN.md 앱의 좁은 화면). */
const WIDE = "(min-width: 834px)";
/** 이 폭부터 오른쪽 칸이 대화 옆에 선다. 그보다 좁으면 대화 위에 뜨고, 833px 이하는 시트다. */
const BESIDE = "(min-width: 1069px)";

/** 채널 패널을 접고 펴는 단축키. 맥은 ⌘\, 그 밖은 Ctrl+\(DESIGN.md 채널 패널 접기). */
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const FOLD_KEY = MAC ? "⌘\\" : "Ctrl+\\";
/** 접힌 채널 패널을 꺼내 보거나 닫기 전에 마우스가 머무는 시간. */
const PEEK_DELAY = 300;

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
/** 포스트에서 말한 멤버들(글과 올린 문답을 쓴 사람). 결정자 후보로 보인다. */
const speakersOf = (messages: ChannelMessage[] = []) => [
  ...new Map(
    messages.flatMap((m) =>
      m.kind === "text" || m.kind === "qa"
        ? [[m.login, { login: m.login, name: m.name }] as const]
        : [],
    ),
  ).values(),
];

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
  const [collapsed, toggleCollapsed] = useCollapsed("omagari.channels-collapsed");
  const [members, setMembers] = useState<MemberView[]>();
  const [settings, setSettings] = useState(false);
  /** 정리한 결정 전부. 결정 상태 띠가 읽는다. 처음에 읽고, 결정 줄이 올 때와 내가 바꿀 때 갈아 끼운다. */
  const [decisions, setDecisions] = useState<Decision[]>([]);
  /** 결정 정리하기 대화 상자: 열려 있으면 값이 있고, 고치는 중이면 그 결정이 든다. */
  const [deciding, setDeciding] = useState<{ revising?: Decision }>();
  /** 실시간 연결로 온 가장 최근 결정 초안. 대화 상자가 자기 것인지 가려 받는다. */
  const [incoming, setIncoming] = useState<Draft>();
  /** 이 브라우저에서 결정 PR로 올린 마지막 네 칸. 결정의 본문은 계약에 없어서, 고쳐 올릴 때 이것으로 칸을 채운다. */
  const submitted = useRef<Record<number, Fields>>({});
  const wide = useMedia(WIDE);

  /** 채널 패널을 접었는지. 834px 이상에서만 쓰고, 좁아졌다 다시 넓어지면 기억한 대로 돌아간다. */
  const [folded, toggleFolded] = useCollapsed("omagari.side-panel-folded");
  const shut = wide && folded;
  const [peek, setPeek] = useState(false);
  /** 접힌 패널을 대화 위에 꺼내 보는 중인지. */
  const peeking = shut && peek;
  const sideId = useId();
  const side = useRef<HTMLElement>(null);
  const foldButton = useRef<HTMLButtonElement>(null);
  const unfoldButton = useRef<HTMLButtonElement>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** 접고 편 뒤에 초점을 다른 쪽 버튼으로 옮길지. */
  const refocus = useRef(false);
  /** 접고 편다. 초점이 사라질 곳(접힐 패널, 펴면 없어지는 펴는 버튼)에 있었으면 다른 쪽 버튼으로 옮긴다. */
  const toggleFold = () => {
    const at = document.activeElement;
    refocus.current = folded ? at === unfoldButton.current : !!side.current?.contains(at);
    clearTimeout(peekTimer.current);
    setPeek(false);
    toggleFolded();
  };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (folded ? unfoldButton : foldButton).current?.focus();
  }, [folded]);
  /** 꺼내 본 패널을 닫는다. 그 안에 초점이 있었으면 펴는 버튼으로 옮긴다. */
  const closePeek = () => {
    clearTimeout(peekTimer.current);
    if (side.current?.contains(document.activeElement)) unfoldButton.current?.focus();
    setPeek(false);
  };
  /** 꺼내 본 패널에서 연 상태 메뉴나 채널 만들기가 열려 있는지. 그동안은 닫지 않는다. */
  const held = () =>
    !!(settings || creator.current?.open || side.current?.querySelector(".status-menu"));
  /** 펴는 버튼이나 창 왼쪽 가장자리에 마우스가 머물면 꺼내 본다. 키보드 초점과 손가락으로는 꺼내 보지 않는다. */
  const hoverIn = (event: PointerEvent) => {
    clearTimeout(peekTimer.current);
    if (!peeking && event.pointerType === "mouse") {
      peekTimer.current = setTimeout(() => setPeek(true), PEEK_DELAY);
    }
  };
  /** 마우스가 나가고 잠시 뒤 닫는다. 그때 다시 들어와 있으면 두고, 메뉴가 열려 있으면 닫힐 때까지 미룬다. */
  const hoverOut = () => {
    clearTimeout(peekTimer.current);
    if (!peeking) return;
    const later = () => {
      peekTimer.current = setTimeout(() => {
        if (side.current?.matches(":hover")) return;
        if (held()) later();
        else closePeek();
      }, PEEK_DELAY);
    };
    later();
  };
  // ⌘\(Ctrl+\)로 접고 펴고, Esc로 꺼내 본 패널을 닫는다. 넓은 화면에서만 듣는다.
  // 키는 자판 배열과 상관없이 같은 자리(Backslash)로 본다. 한글 자판에서는 ₩가 찍히는 자리다.
  useEffect(() => {
    if (!wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Backslash" && (MAC ? event.metaKey : event.ctrlKey)) {
        event.preventDefault();
        toggleFold();
      } else if (event.key === "Escape" && peeking && !held()) closePeek();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
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
  /**
   * 옆 칸의 포스트가 오른쪽 칸을 쓰고 있으면 다른 칸을 열 때 포스트를 닫는다. 단, 내 에이전트는 포스트를 크게 보고 연다(포스트의 DM).
   * 오른쪽 칸 자리는 하나다.
   */
  const toggleRight = (panel: "members" | "agent") => {
    if (asidePost && openPost) {
      location.hash = `${current?.id}${panel === "agent" ? `/${openPost.alert}/big` : ""}`;
      return setRight(panel);
    }
    return right === panel ? closeRight() : setRight(panel);
  };
  // 닫으면 연 버튼으로 돌아간다. 시트(모달)가 사라진 뒤라야 바깥에 포커스를 줄 수 있다.
  useEffect(() => {
    if (right || !closing.current) return;
    closing.current.focus();
    closing.current = null;
  }, [right]);
  /** 채널마다 불러 둔 내 DM. 연 적 없는 채널은 없고, DM 칸을 처음 열 때 읽는다. */
  const [dms, setDms] = useState<Record<string, Dm>>({});
  /**
   * 채널 입력 칸에 붙인 DM 문답(DESIGN.md "채널에 올리기"). DM 칸과 채널 입력 칸이 함께 본다.
   * 입력 칸의 글처럼 그 채널에만 있어서 채널을 옮기면 빠진다.
   */
  const [attached, setAttached] = useState<Qa>();
  /** 에이전트마다 고른 모델과 effort. 이 브라우저에 남아 새로 고쳐도 그대로다. DM과 `@호출`이 같이 쓴다. */
  const [picks, setPicks] = useState<Picks>(() => savedPicks(me.login));
  /** 채널마다 불러 둔 대화. 연 적 없는 채널은 없고, 처음 열 때 지난 대화를 읽는다. */
  const [views, setViews] = useState<Record<string, View>>({});
  /** 주소는 `#채널 id`, 포럼의 포스트는 `#포럼 id/알림 번호`(옆 칸), 크게 보면 `#포럼 id/알림 번호/big`. */
  const [hashChannel, hashPost, hashSize] = useHash().split("/");
  const current =
    channels?.find((channel) => channel.id === hashChannel) ??
    channels?.find((channel) => channel.kind === "chat") ??
    channels?.[0];
  const forum = current?.kind === "forum";
  /** 포럼 포스트 전부. 포럼을 처음 읽을 때까지는 없다. */
  const [posts, setPosts] = useState<PostItem[]>();
  const openPost = forum ? posts?.find((item) => item.alert === Number(hashPost)) : undefined;
  const big = openPost !== undefined && hashSize === "big";
  const asidePost = openPost !== undefined && !big;
  /** 포스트는 채널처럼 동작한다: 글, 지난 대화, DM, `@호출`이 포스트의 채널로 간다. 이름은 제목이다. */
  const postChannel: Channel | undefined = openPost && {
    id: openPost.channel,
    name: postTitle(openPost),
    kind: "chat",
  };
  /** 대화와 DM이 향하는 채널: 열린 포스트, 아니면 고른 채널. 포럼 자체는 대화가 없다. */
  const active = postChannel ?? (forum ? undefined : current);
  /** 포스트마다 마지막으로 읽은 글 수. 이 기기에 남는다. */
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem("omagari.post-seen") ?? "{}");
    } catch {
      return {};
    }
  });
  const unread = (item: PostItem) => item.count > (seen[item.channel] ?? 0);
  // 열려 있는 포스트는 새 글이 와도 읽은 것으로 둔다.
  const openCount = openPost?.count;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열린 포스트의 글 수가 바뀔 때마다 읽은 자리를 옮긴다
  useEffect(() => {
    if (!postChannel || openCount === undefined || seen[postChannel.id] === openCount) return;
    const next = { ...seen, [postChannel.id]: openCount };
    setSeen(next);
    try {
      localStorage.setItem("omagari.post-seen", JSON.stringify(next));
    } catch {}
  }, [postChannel?.id, openCount]);
  const [forumCollapsed, toggleForumCollapsed] = useCollapsed("omagari.forum-collapsed");
  // biome-ignore lint/correctness/useExhaustiveDependencies: 대화를 옮기면 붙인 문답을 뺀다
  useEffect(() => setAttached(undefined), [active?.id]);

  /** 세션이 끝났으면 로그인으로 돌아간다. 그 밖의 실패는 부른 쪽이 보인다. */
  const check = (error: unknown) => {
    if (signedOut(error)) onSignedOut();
    return error;
  };

  const add = (channel: Channel) =>
    setChannels(
      (list) => list && byName([...list.filter((other) => other.id !== channel.id), channel]),
    );

  const upsertDecision = (decision: Decision) =>
    setDecisions((list) => [...list.filter((other) => other.id !== decision.id), decision]);

  /** 불러 둔 채널이면 대화에 넣는다. 안 연 채널의 것은 버리고, 열 때 지난 대화로 읽는다. */
  const receive = (message: ChannelMessage) => {
    if (message.kind === "decision") upsertDecision(message.decision);
    // 알림은 포럼 목록의 포스트다. 고쳐졌으면 고친 시각을 붙이고, 새 글이 서면 요약(`post`)이 바뀌어 온다.
    if (message.kind === "alert")
      setPosts((list) => {
        const known = list?.find((item) => item.alert === message.id);
        const edited = known && changed(known.message.alert, message.alert);
        const next = postOf(message, edited ? new Date().toISOString() : known?.edited);
        return [...(list ?? []).filter((item) => item.alert !== message.id), next].sort(
          (a, b) => a.alert - b.alert,
        );
      });
    setViews((all) => {
      const view = all[message.channel];
      return view
        ? { ...all, [message.channel]: { ...view, messages: merge(view.messages, [message]) } }
        : all;
    });
  };

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
  const dmLoaded = active !== undefined && dms[active.id] !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: DM 칸에서 채널을 처음 열 때 한 번만 읽는다
  useEffect(() => {
    if (right === "agent" && active && !dmLoaded) void loadDm(active.id);
  }, [right, active?.id, dmLoaded]);

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

  /**
   * DM의 문답을 채널 입력 칸에 붙인다. 초점은 입력 칸이 가져간다. 오른쪽 칸이 대화 위에 뜨는 폭이면 오른쪽 칸을 닫는다.
   * 그때는 연 버튼으로 초점을 돌리지 않는다(`closeRight`를 쓰지 않는다).
   */
  const attach = (qa: Qa) => {
    setAttached(qa);
    if (!matchMedia(BESIDE).matches) setRight(undefined);
  };

  /** DM의 문답을 함께 쓴 글과 채널에 올린다. 채널에 선 메시지와, 공개가 된 DM의 문답을 바로 넣는다. */
  const post = async (qa: Qa, text: string) => {
    try {
      const { message } = await call(server(session), api.postQa, { qa: qa.id, text });
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
        call(server(session), api.posts)
          .then(({ posts: list }) =>
            setPosts((old) =>
              postsOf(list).map((item) => ({
                ...item,
                edited: old?.find((other) => other.alert === item.alert)?.edited,
              })),
            ),
          )
          .catch(check);
        // 끊긴 사이에 온 답은 다시 오지 않는다. 불러 둔 DM을 버리고 열려 있는 것은 다시 읽는다.
        setDms({});
        call(server(session), api.decisions)
          .then(({ decisions: list }) => setDecisions(list))
          .catch(check);
      } else if (event.kind === "draft") setIncoming(event.payload);
      else if (event.kind === "channel") add(event.payload);
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

  const opened = active !== undefined && views[active.id] !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 채널을 처음 열 때 한 번만 읽는다
  useEffect(() => {
    if (active && !opened) void load(active.id);
  }, [active?.id, opened]);

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

  const panel = (onPick?: () => void, action?: ReactNode) => (
    <ChannelPanel
      me={me}
      action={action}
      mine={members?.find((member) => member.login === me.login)}
      onLogout={onLogout}
      onSettings={() => {
        drawer.current?.close();
        setSettings(true);
      }}
      onPresence={setPresence}
      onMessage={setMessage}
    >
      <ChannelList
        channels={channels}
        current={current?.id}
        post={openPost?.alert}
        posts={posts}
        unread={unread}
        collapsed={collapsed}
        forumCollapsed={forumCollapsed}
        onToggle={toggleCollapsed}
        onForumToggle={toggleForumCollapsed}
        onPick={onPick}
        onCreate={openCreator}
      />
    </ChannelPanel>
  );

  /** 지금 오른쪽 칸에 선 것. 옆 칸의 포스트가 있으면 그것이고, 포럼 목록에는 DM이 없다. */
  const shown = asidePost ? "post" : right === "agent" && !active ? undefined : right;

  /** 직접 충돌이 걸린 작업("로그인/브랜치"): 풀리지 않은 직접 충돌 알림의 두 작업. 멤버 목록의 작업 줄에 배지가 붙는다. */
  const direct = new Set(
    posts?.flatMap(({ message: { alert } }) =>
      alert.kind === "direct" && !alert.resolved
        ? alert.works.map((work) => `${work.login}/${work.branch}`)
        : [],
    ),
  );

  /** 열린 포스트의 결정: 가장 나중에 정리한 것. */
  const decision = openPost
    ? decisions.filter((other) => other.post === openPost.channel).sort((a, b) => b.id - a.id)[0]
    : undefined;
  const answer = async (act: () => Promise<{ decision: Decision }>) => {
    try {
      upsertDecision((await act()).decision);
    } catch (error) {
      throw check(error);
    }
  };
  const strip = decision && {
    decision,
    onRespond: (response: "agree" | "object" | "withdraw") =>
      answer(() => call(server(session), api.respondToDecision, { id: decision.id, response })),
    onRevise: () => setDeciding({ revising: decision }),
    onDiscard: () => answer(() => call(server(session), api.discardDecision, { id: decision.id })),
  };

  /** 결정 정리하기 버튼: 열린 포스트의 머리 띠에 두고 이름이 늘 보인다. */
  const decide = openPost && (
    <button type="button" className="header-button named" onClick={() => setDeciding({})}>
      <PenLine size={18} aria-hidden />
      <span>결정 정리하기</span>
    </button>
  );

  /** 고른 대화(채널, 또는 열린 포스트)를 그린다. 포스트는 지난 대화 앞에 첫 글인 알림이 붙는다. */
  const conversation = (label: string) => {
    if (!active) return null;
    const view = views[active.id];
    return (
      <Conversation
        key={active.id}
        channel={active}
        view={openPost && view ? { ...view, messages: [openPost.message, ...view.messages] } : view}
        live={live}
        members={members}
        me={me.login}
        label={openPost ? label : undefined}
        edited={openPost?.edited}
        strip={strip}
        attached={attached?.channel === active.id ? attached : undefined}
        onAttach={setAttached}
        onSend={(text) => send(active.id, text)}
        onCall={(executor, question) => ask(active.id, executor, question, "public")}
        onPost={post}
        onRetry={() => void load(active.id)}
        onOlder={() => {
          if (view?.more && !view.older) void load(active.id, view.messages[0]?.id);
        }}
      />
    );
  };

  return (
    <div
      className={["app", shown && "with-panel", asidePost && "with-post", shut && "folded"]
        .filter(Boolean)
        .join(" ")}
    >
      {/* 접힌 동안 창 왼쪽 가장자리(창 안쪽 여백 8px). 마우스가 머물면 꺼내 본다. */}
      {shut && <div className="peek-edge" onPointerEnter={hoverIn} onPointerLeave={hoverOut} />}
      <aside
        ref={side}
        id={sideId}
        className={peeking ? "side-panel peek" : "side-panel"}
        aria-label="채널 패널"
        inert={shut && !peeking}
        onPointerEnter={() => peeking && clearTimeout(peekTimer.current)}
        onPointerLeave={hoverOut}
      >
        {panel(
          peeking ? closePeek : undefined,
          <button
            ref={foldButton}
            type="button"
            className="fold-button"
            aria-label={folded ? "채널 패널 펼쳐 두기" : "채널 패널 닫기"}
            title={`${folded ? "채널 패널 펼쳐 두기" : "채널 패널 닫기"} ${FOLD_KEY}`}
            aria-keyshortcuts={MAC ? "Meta+\\" : "Control+\\"}
            aria-expanded={!folded}
            aria-controls={sideId}
            onClick={toggleFold}
          >
            {folded ? (
              <PanelLeftOpen size={18} aria-hidden />
            ) : (
              <PanelLeftClose size={18} aria-hidden />
            )}
          </button>,
        )}
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
          {shut && (
            <button
              ref={unfoldButton}
              type="button"
              className="header-button"
              aria-label="채널 패널 열기"
              title={`채널 패널 열기 ${FOLD_KEY}`}
              aria-keyshortcuts={MAC ? "Meta+\\" : "Control+\\"}
              aria-expanded={false}
              aria-controls={sideId}
              onClick={toggleFold}
              onPointerEnter={hoverIn}
              onPointerLeave={hoverOut}
            >
              <PanelLeftOpen size={18} aria-hidden />
            </button>
          )}
          {big && openPost && current ? (
            <div className="post-title">
              <a className="header-button" href={`#${current.id}`} aria-label="포럼으로 돌아가기">
                <ChevronLeft size={18} aria-hidden />
              </a>
              <a className="post-crumb" href={`#${current.id}`}>
                {current.name} ›
              </a>
              <h2>{postTitle(openPost)}</h2>
            </div>
          ) : forum && current ? (
            <ForumTitle name={current.name} />
          ) : (
            current && <ChannelTitle channel={current} members={members?.length} />
          )}
          {/* 오른쪽 칸을 여는 버튼들. 평소에는 아이콘만, 연 버튼만 이름이 붙는다. */}
          <div className="header-actions">
            {big && decide}
            {big && openPost && current && (
              <a
                className="header-button"
                href={`#${current.id}/${openPost.alert}`}
                aria-label="옆 칸으로"
                title="옆 칸으로"
              >
                <Minimize2 size={18} aria-hidden />
              </a>
            )}
            {active && (
              <button
                ref={agentButton}
                type="button"
                className="header-button"
                aria-label="내 에이전트"
                aria-expanded={shown === "agent"}
                aria-controls={shown === "agent" ? rightId : undefined}
                onClick={() => toggleRight("agent")}
              >
                <MessageSquare size={18} aria-hidden />
                {shown === "agent" && <span>내 에이전트</span>}
              </button>
            )}
            <button
              ref={membersButton}
              type="button"
              className="header-button"
              aria-label="멤버 목록"
              aria-expanded={shown === "members"}
              aria-controls={shown === "members" ? rightId : undefined}
              onClick={() => toggleRight("members")}
            >
              <Users size={18} aria-hidden />
              {shown === "members" && <span>멤버 목록</span>}
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
        ) : forum && !big ? (
          <Forum posts={posts} selected={openPost?.alert} unread={unread} />
        ) : (
          conversation(`${postChannel?.name}에 메시지 보내기`)
        )}
      </main>
      {asidePost && openPost && postChannel && (
        <RightPanel
          id={rightId}
          title={postChannel.name}
          sheet={!wide}
          full
          onClose={() => {
            location.hash = current?.id ?? "";
          }}
          head={
            <div className="post-head">
              <h2>{postChannel.name}</h2>
              {decide}
              {wide && (
                <a
                  className="header-button"
                  href={`#${current?.id}/${openPost.alert}/big`}
                  aria-label="크게 보기"
                  title="크게 보기"
                >
                  <Maximize2 size={18} aria-hidden />
                </a>
              )}
            </div>
          }
        >
          {conversation("이 포스트에 메시지 보내기")}
        </RightPanel>
      )}
      {shown === "agent" && active && (
        <DmPanel
          key={active.id}
          id={rightId}
          sheet={!wide}
          channel={active}
          post={big}
          agents={members?.find((member) => member.login === me.login)?.agents ?? []}
          dm={dms[active.id]}
          messages={views[active.id]?.messages}
          picks={picks}
          attached={attached?.id}
          onPick={(executor, pick) => {
            const next = { ...picks, [executor]: pick };
            setPicks(next);
            savePicks(me.login, next);
          }}
          onAsk={(executor, question) => ask(active.id, executor, question)}
          onAttach={attach}
          onReload={() => void loadDm(active.id)}
          onClose={closeRight}
        />
      )}
      {shown === "members" && (
        <RightPanel id={rightId} title="멤버 목록" sheet={!wide} onClose={closeRight}>
          {live === "reconnecting" && members && (
            <p className="banner info" role="status">
              서버에 다시 붙는 중…
            </p>
          )}
          {members ? (
            <MemberList me={me.login} members={members} direct={direct} />
          ) : (
            <MemberSkeleton />
          )}
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
      {deciding && postChannel && (
        <DecisionDialog
          // 열 때마다 새로: 초안을 쓰게 하고 칸을 비운다.
          key={deciding.revising?.id ?? "new"}
          post={postChannel.id}
          title={postChannel.name}
          repo={me.repo}
          me={me}
          agents={members?.find((member) => member.login === me.login)?.agents ?? []}
          picks={picks}
          speakers={speakersOf(views[postChannel.id]?.messages)}
          incoming={incoming}
          revising={deciding.revising}
          initial={deciding.revising && submitted.current[deciding.revising.id]}
          session={session}
          check={check}
          onDone={(decision, fields) => {
            submitted.current[decision.id] = fields;
            upsertDecision(decision);
          }}
          onClose={() => setDeciding(undefined)}
        />
      )}
      {settings && (
        <Settings
          me={me}
          mine={members?.find((member) => member.login === me.login)}
          channels={channels}
          session={session}
          check={check}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}

/**
 * 오른쪽 칸. 1069px 이상은 세 번째 칸, 834–1068px은 대화 위에 겹친 칸(CSS가 정한다),
 * 833px 이하(`sheet`)는 아래에서 올라오는 전체 높이 시트(모달 `<dialog>`)다. 닫기 버튼과 Esc, 덮개 누르기로 닫힌다.
 * `full`이면 시트 대신 채널처럼 화면 전체를 쓰는 대화이고(포스트와 DM), 닫기는 머리 왼쪽 "‹"다.
 * 머리 왼쪽은 제목(`title`)이고, `head`를 주면 그것이 대신 선다(DM 칸의 고른 에이전트).
 */
export function RightPanel({
  id,
  title,
  head,
  sheet,
  full = false,
  onClose,
  children,
}: {
  id: string;
  title: string;
  head?: ReactNode;
  sheet: boolean;
  full?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (sheet) dialog.current?.showModal();
  }, [sheet]);
  const page = sheet && full;
  const body = (
    <div className="right-panel">
      <div className="panel-head">
        {page && (
          <button type="button" className="header-button" aria-label="돌아가기" onClick={onClose}>
            <ChevronLeft size={18} aria-hidden />
          </button>
        )}
        {head ?? <h2>{title}</h2>}
        {!page && (
          <button
            type="button"
            className="header-button"
            aria-label={`${title} 닫기`}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        )}
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
      className={page ? "sheet full" : "sheet"}
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
  action,
  mine,
  onLogout,
  onSettings,
  onPresence,
  onMessage,
  children,
}: {
  me: Me;
  /** 워크스페이스 이름 줄 오른쪽 끝의 버튼(채널 패널 접기). 서랍에는 없다. */
  action?: ReactNode;
  mine?: MemberView;
  onLogout: () => void;
  onSettings: () => void;
  onPresence: (presence: ChosenPresence, duration?: PresenceDuration) => Promise<void>;
  onMessage: (message: string, emoji: string | null) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <>
      {/* 워크스페이스 이름은 아직 따로 정하는 곳이 없다. 워크스페이스 하나에 레포 하나라(ADR-0012) 레포 이름을 쓴다. */}
      <div className="workspace">
        <h1>{me.repo.split("/")[1]}</h1>
        {action}
        <p>{me.repo}</p>
      </div>
      {children}
      <ProfilePanel
        me={me}
        mine={mine}
        onLogout={onLogout}
        onSettings={onSettings}
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
  size: 22 | 36 | 40;
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
