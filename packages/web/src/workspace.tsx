import {
  api,
  type Channel,
  type ChannelMessage,
  type ChosenPresence,
  call,
  type Debate,
  type DebateRequest,
  type Decision,
  type Draft,
  type ExecutorId,
  type ForumFilter,
  HISTORY_PAGE,
  type Label,
  type MemberView,
  type Presence,
  type PresenceDuration,
  type Qa,
  type Visibility,
} from "@omagari/contract";
import {
  ChevronLeft,
  Lock,
  Maximize2,
  Menu,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Settings2,
  Users,
  X,
} from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type PointerEvent,
  type ReactNode,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  lastKey,
  type Me,
  placeKey,
  remember,
  remembered,
  repoName,
  type Workspace as Space,
  savedPicks,
  savePicks,
  server,
  signedOut,
} from "./api.ts";
import {
  type AdminRepo,
  byName,
  ChannelList,
  PlacePicker,
  RepoDialog,
  useCollapsed,
} from "./channels.tsx";
import { ChannelTitle, Conversation, type View } from "./conversation.tsx";
import { DEBATE_STRIP, DebateDialog, DebateLog, DebateStrip, ProxyDialog } from "./debate.tsx";
import { DecisionDialog, type Fields } from "./decision.tsx";
import { chosen, type Dm, DmPanel, type Picks } from "./dm.tsx";
import {
  changed,
  Forum,
  ForumTitle,
  IssueNumber,
  OTHER,
  type PostItem,
  postOf,
  postsOf,
  postTitle,
  settled,
} from "./forum.tsx";
import { type CreateKind, ForumDialog, LabelsContext, PostLabels } from "./labels.tsx";
import { useLive } from "./live.ts";
import { MemberList, MemberSkeleton } from "./members.tsx";
import { ALL, placeIn, placeOf } from "./places.ts";
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
  workspaces,
  workspace,
  onSwitch,
  onRepos,
  onLogout,
  onSignedOut,
}: {
  me: Me;
  session: string;
  /** 내가 들어간 워크스페이스들과 지금 고른 것의 id */
  workspaces: Space[];
  workspace: string;
  /** 다른 계정의 곳(레포나 "전체")을 골랐다(시안 101). */
  onSwitch: (workspace: string, place: string) => void;
  /** 레포를 넣거나 뺐다(내게 보이는 레포 전부). 앱이 워크스페이스 목록을 고친다. */
  onRepos: (repos: string[]) => void;
  onLogout: () => void;
  /** 세션이 끝났다(API나 실시간 연결이 그렇게 답했다). */
  onSignedOut: () => void;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const creator = useRef<HTMLDialogElement>(null);
  /** "만들기" 대화 상자에서 고른 종류. 누른 카테고리의 `+`가 정해 둔다(시안 88-A). */
  const [createKind, setCreateKind] = useState<CreateKind>("chat");
  const forumEditor = useRef<HTMLDialogElement>(null);
  const space = workspaces.find((other) => other.id === workspace) ?? (workspaces[0] as Space);
  /** 이 워크스페이스에서 내게 보이는 레포들. 레포를 넣고 빼면 앱이 바꿔 준다. */
  const repos = space.repos;
  /** 레포마다의 라벨(ADR-0039, ADR-0043). 붙을 때 읽고, 실시간 연결의 `labels`(첫 레포의 것)로 갈아 끼운다. */
  const [labelsByRepo, setLabelsByRepo] = useState<Record<string, Label[]>>({});
  /** 포럼의 필터가 고르는 라벨: 레포들의 라벨을 이름으로 합친 것. */
  const labels = [
    ...new Map(
      Object.values(labelsByRepo)
        .flat()
        .map((label) => [label.name, label]),
    ).values(),
  ];
  const repoDialog = useRef<HTMLDialogElement>(null);
  /** 계정마다 내가 Admin인 레포(레포 넣기 목록과 레포 줄의 ⋯). 없으면 아직 읽지 않았다. */
  const [admins, setAdmins] = useState<Record<string, AdminRepo[] | "error">>({});
  /** 읽는 중인 계정. 메뉴가 같은 계정을 거듭 읽지 않게 한다. */
  const reading = useRef(new Set<string>());
  const loadAdmin = (id: string) => {
    reading.current.add(id);
    return call({ ...server(session), workspace: id }, api.adminRepos)
      .then(({ repos: list }) => setAdmins((all) => ({ ...all, [id]: list })))
      .catch((error) => {
        check(error);
        setAdmins((all) => ({ ...all, [id]: "error" }));
      })
      .finally(() => reading.current.delete(id));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 워크스페이스를 열 때 한 번 읽는다
  useEffect(() => void loadAdmin(workspace), []);
  /** "레포 넣기" 창을 연 계정 */
  const [adding, setAdding] = useState(workspace);
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
  /** 포스트(채널 id)마다의 토론과 토론 요청. 붙을 때 `api.posts`로 읽고, 바뀌면 실시간 연결로 온다. */
  const [debates, setDebates] = useState<
    Record<string, { debate: Debate | null; request: DebateRequest | null }>
  >({});
  /** 열린 대화 상자: 토론 열기(다시 요청이면 지난 요청을 채운다)나, 대행을 부를 자리. */
  const [debating, setDebating] = useState<{ open: true } | { seat: number }>();
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
  const hash = useHash();
  const [hashChannel, hashPost, hashSize] = hash.split("/");
  const found =
    channels?.find((channel) => channel.id === hashChannel) ??
    (hashChannel === OTHER.id ? OTHER : undefined);
  /** 메뉴에서 고른 곳(레포 이름이나 "전체"). 이 기기에 남는다. */
  const [picked, setPicked] = useState(() => remembered(placeKey(workspace)));
  /** 지금 보는 곳(시안 101): 주소의 채널이 선 곳, 없으면 고른 곳이다. 패널은 늘 이곳의 것이다. */
  const here = found ? placeOf(found, repos) : placeIn(repos, picked);
  const inPlace = channels?.filter((channel) => placeOf(channel, repos) === here);
  const current =
    found ??
    inPlace?.find((channel) => channel.kind === "chat" && !channel.repo) ??
    inPlace?.find((channel) => channel.kind === "chat") ??
    inPlace?.[0];
  // 지금 보는 곳과 그곳에서 본 채널을 기억한다. 메뉴로 다시 오면 그 채널로 간다.
  useEffect(() => {
    if (here !== picked) setPicked(here);
    remember(placeKey(workspace), here);
    if (found) remember(lastKey(workspace, here), `#${hash}`);
  }, [here, hash, found, picked, workspace]);
  /** 메뉴에서 곳을 고른다. 다른 계정이면 앱이 그 워크스페이스로 바꾼다. 그곳에서 마지막에 본 채널로 간다. */
  const pick = (id: string, place: string) => {
    if (id !== workspace) return onSwitch(id, place);
    setPicked(place);
    location.hash = remembered(lastKey(workspace, place)) ?? "";
  };
  const forum = current?.kind === "forum";
  /** 포럼 포스트 전부. 포럼을 처음 읽을 때까지는 없다. */
  const [posts, setPosts] = useState<PostItem[]>();
  const openPost = forum ? posts?.find((item) => item.alert === Number(hashPost)) : undefined;
  const big = openPost !== undefined && hashSize === "big";
  /**
   * 링크로 온 채널이나 포스트가 보이지 않는다(시안 93-C): 없는 것과 push 권한이 없는 레포의 것을 가르지 않는다.
   * 레포 이름은 서버가 내주지 않으니 화면에도 없다.
   */
  const missing =
    (!!hashChannel && channels !== undefined && !found) ||
    (forum && !!hashPost && posts !== undefined && !openPost);
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
  /**
   * 내가 관련된 포스트(시안 55-D): 내 작업이 걸린 알림이거나 내가 글을 쓴 포스트. 결정자는 그 포스트에서 말한 멤버라 이것으로 든다.
   * 내가 쓴 글은 마지막 글과 이 화면에서 읽은 대화로만 안다.
   */
  // ponytail: 계약에 포스트에서 말한 사람이 없어, 안 읽은 포스트에 오래전에 쓴 글은 모른다. 놓치는 일이 잦으면 Post에 말한 사람을 싣는다.
  const mine = (item: PostItem) =>
    item.message.alert.works.some((work) => work.login === me.login) ||
    item.last?.login === me.login ||
    !!views[item.channel]?.messages.some(
      (m) => (m.kind === "text" || m.kind === "qa") && m.login === me.login,
    );
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
  /** 포럼 id마다 선 곳 */
  const forumPlace = new Map(channels?.map((channel) => [channel.id, placeOf(channel, repos)]));
  /** 그곳에 새 글이 있나: 그곳 포럼에 달린 내 열린 포스트에 안 읽은 글이 있다(패널의 가지와 같은 것). */
  const fresh = (place: string) =>
    !!posts?.some(
      (item) =>
        !settled(item) &&
        unread(item) &&
        mine(item) &&
        item.forums.some((id) => forumPlace.get(id) === place),
    );
  /** 멤버가 나 하나다(시안 100-A). 계정 종류가 아니라 멤버 수로 정한다. */
  const solo = members?.length === 1 && members[0]?.login === me.login;
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
    workspace,
    (event) => {
      if (event.kind === "welcome") {
        call(server(session), api.channels)
          .then((list) => setChannels(byName(list.channels)))
          .catch(check);
        loadRepos(repos);
        // 끊긴 사이에 온 답은 다시 오지 않는다. 불러 둔 DM을 버리고 열려 있는 것은 다시 읽는다.
        setDms({});
      } else if (event.kind === "draft") setIncoming(event.payload);
      else if (event.kind === "channel") add(event.payload);
      else if (event.kind === "labels" && repos[0])
        setLabelsByRepo((all) => ({ ...all, [repos[0] as string]: event.payload }));
      else if (event.kind === "forumDeleted")
        setChannels((list) => list?.filter((channel) => channel.id !== event.payload.id));
      else if (event.kind === "message") receive(event.payload);
      else if (event.kind === "members") setMembers(event.payload.members);
      else if (event.kind === "qa") receiveQa(event.payload);
      else if (event.kind === "debate") {
        const { post: channel, ...rest } = event.payload;
        setDebates((all) => ({ ...all, [channel]: rest }));
      }
    },
    onSignedOut,
  );

  /**
   * 레포마다인 것(포스트, 라벨, 결정)을 레포마다 읽어 합친다(ADR-0043). 실시간 연결은 워크스페이스의 알림 줄을 다 받지만,
   * 라벨은 첫 레포의 것만 오므로 다른 레포의 라벨은 다시 붙을 때 읽는다.
   */
  // ponytail: 레포마다 한 번씩 부른다. 레포가 많아지면 계약에 여러 레포를 한 번에 읽는 길을 더한다.
  const loadRepos = (list: string[]) => {
    const each = <T,>(read: (repo: string) => Promise<T>) =>
      Promise.all(list.map(read)).catch((error) => {
        throw check(error);
      });
    void each((repo) => call(server(session, repo), api.labels))
      .then((all) =>
        setLabelsByRepo(Object.fromEntries(all.map((one, i) => [list[i], one.labels]))),
      )
      .catch(() => {});
    void each((repo) => call(server(session, repo), api.posts))
      .then((all) => all.flatMap((one) => one.posts))
      .then((list) => {
        setDebates(
          Object.fromEntries(
            list.map((item) => [item.channel, { debate: item.debate, request: item.request }]),
          ),
        );
        setPosts((old) =>
          postsOf(list).map((item) => ({
            ...item,
            edited: old?.find((other) => other.alert === item.alert)?.edited,
          })),
        );
      })
      .catch(() => {});
    void each((repo) => call(server(session, repo), api.decisions))
      .then((all) => setDecisions(all.flatMap((one) => one.decisions)))
      .catch(() => {});
  };

  /** 계정 `id`의 레포를 넣고 뺀 뒤: 보이는 레포가 바뀌었으니 지금 워크스페이스면 채널과 레포마다인 것을 다시 읽는다. */
  const reposChanged = (id: string, all: string[]) => {
    onRepos(all);
    void loadAdmin(id);
    if (id !== workspace) return;
    call(server(session), api.channels)
      .then((list) => setChannels(byName(list.channels)))
      .catch(check);
    loadRepos(all.filter((repo) => repo.split("/")[0]?.toLowerCase() === workspace));
  };
  const addRepo = async (repo: string) => {
    try {
      reposChanged(adding, (await call(server(session), api.addRepo, { repo })).repos);
    } catch (error) {
      throw check(error);
    }
  };
  const removeRepo = async (id: string, repo: string) => {
    try {
      reposChanged(id, (await call(server(session), api.removeRepo, { repo })).repos);
    } catch (error) {
      throw check(error);
    }
  };

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

  /** 채팅 채널은 지금 보는 곳에 만든다. 레포가 하나뿐인 계정이면 그 레포의 채널이다. */
  const create = async (name: string) => {
    const { channel } = await call(server(session), api.createChannel, {
      name,
      repo: here === ALL ? undefined : here,
    });
    add(channel);
    location.hash = channel.id;
  };

  /** 포스트의 라벨을 바꾼다. 바뀐 요약은 답으로 바로 넣고, 실시간 연결의 알림 줄로도 온다. */
  const setPostLabels = async (item: PostItem, next: string[]) => {
    try {
      const { post: summary } = await call(server(session), api.setPostLabels, {
        post: item.channel,
        labels: next,
      });
      const { alert: _, ...rest } = summary;
      setPosts((list) =>
        list?.map((other) =>
          other.alert === item.alert
            ? { ...other, ...rest, message: { ...other.message, post: rest } }
            : other,
        ),
      );
    } catch (error) {
      throw check(error);
    }
  };

  const createForum = async (name: string, filter: ForumFilter) => {
    try {
      const { channel } = await call(server(session), api.createForum, { name, filter });
      add(channel);
      location.hash = channel.id;
    } catch (error) {
      throw check(error);
    }
  };
  const updateForum = async (forum: Channel, name: string, filter: ForumFilter) => {
    try {
      add((await call(server(session), api.updateForum, { id: forum.id, name, filter })).channel);
    } catch (error) {
      throw check(error);
    }
  };
  const deleteForum = async (forum: Channel) => {
    try {
      await call(server(session), api.deleteForum, { id: forum.id });
      setChannels((list) => list?.filter((channel) => channel.id !== forum.id));
      location.hash = "";
    } catch (error) {
      throw check(error);
    }
  };

  const openCreator = (kind: CreateKind) => {
    drawer.current?.close();
    setCreateKind(kind);
    creator.current?.showModal();
    // 종류는 이미 골라져 있으니 초점은 종류 고르기가 아니라 이름 칸에 둔다.
    creator.current?.querySelector<HTMLInputElement>(".text-input")?.focus();
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
      head={
        <PlacePicker
          workspaces={workspaces}
          current={space}
          place={here}
          fresh={fresh}
          admin={admins}
          action={action}
          onAdmin={(id) => !reading.current.has(id) && void loadAdmin(id)}
          onPick={(id, place) => {
            onPick?.();
            pick(id, place);
          }}
          onAddRepo={(id) => {
            drawer.current?.close();
            setAdding(id);
            if (!reading.current.has(id)) void loadAdmin(id);
            repoDialog.current?.showModal();
          }}
          onRemoveRepo={removeRepo}
        />
      }
      solo={solo}
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
        channels={inPlace}
        other={here === placeOf(OTHER, repos) && !!posts?.some((item) => item.forums.length === 0)}
        current={current?.id}
        post={openPost?.alert}
        posts={posts}
        unread={unread}
        mine={mine}
        collapsed={collapsed}
        forumCollapsed={forumCollapsed}
        onToggle={toggleCollapsed}
        onForumToggle={toggleForumCollapsed}
        onPick={onPick}
        onCreate={() => openCreator("chat")}
        onCreateForum={() => openCreator("forum")}
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

  /** 포스트 머리의 "라벨" 버튼(시안 54-C). */
  const labelButton = openPost && (
    <LabelsContext value={labelsByRepo[openPost.repo] ?? []}>
      <PostLabels
        labels={openPost.labels}
        issue={openPost.issue?.number}
        onChange={(next) => setPostLabels(openPost, next)}
      />
    </LabelsContext>
  );

  /** 열린 포스트의 토론. */
  const debated = openPost ? debates[openPost.channel] : undefined;
  const debate = debated?.debate ?? null;
  /** 토론 API를 부르고 돌아온 토론으로 바꾼다. 실시간 연결로도 오지만 먼저 그린다. */
  const debateCall = async (
    act: () => Promise<{ debate: Debate | null; request?: DebateRequest }>,
  ) => {
    if (!openPost) return;
    const channel = openPost.channel;
    try {
      const result = await act();
      setDebates((all) => ({
        ...all,
        [channel]: {
          debate: result.debate,
          request: result.request ?? all[channel]?.request ?? null,
        },
      }));
    } catch (error) {
      throw check(error);
    }
  };
  /** 토론 열기 / 토론 보기(시안 60-B). 열린 토론이 있으면 토론 띠로 간다. */
  const debateButton = openPost && (
    <button
      type="button"
      className="header-button named debate-button"
      aria-label={debate ? "토론 보기" : "토론 열기"}
      onClick={() => {
        if (!debate) return setDebating({ open: true });
        const strip = document.getElementById(DEBATE_STRIP);
        strip?.scrollIntoView({ block: "nearest" });
        strip?.focus();
      }}
    >
      <MessagesSquare size={18} aria-hidden />
      <span>{debate ? "토론 보기" : "토론 열기"}</span>
    </button>
  );

  /** 결정 정리하기 버튼: 열린 포스트의 머리 띠에 두고 이름이 늘 보인다. */
  const decide = openPost && (
    <button
      type="button"
      className="header-button named debate-button"
      aria-label="결정 정리하기"
      onClick={() => setDeciding({})}
    >
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
        debate={
          debate && (
            <DebateStrip
              debate={debate}
              onProxy={(seat) => setDebating({ seat })}
              onDecide={() => setDeciding({})}
            />
          )
        }
        tail={
          debated &&
          (debated.debate || debated.request) && (
            <DebateLog
              debate={debated.debate}
              request={debated.request}
              onChoose={(option) =>
                debateCall(() =>
                  call(server(session), api.chooseDebate, { post: active.id, option }),
                )
              }
              onDecide={() => setDeciding({})}
              onRequest={() => setDebating({ open: true })}
            />
          )
        }
        verdict={
          openPost?.message.alert.kind === "indirect" && openPost.message.alert.run
            ? { run: openPost.message.alert.run, works: openPost.message.alert.works }
            : undefined
        }
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

  /** 포럼 대화 상자의 미리 보기: 열린 포스트와 제목. */
  const previews = (posts ?? [])
    .filter((item) => !settled(item))
    .map((item) => ({
      labels: item.labels,
      importance: item.importance,
      repo: item.repo,
      title: postTitle(item),
    }));

  /** 멤버들의 프로필 사진. 사람 아바타가 로그인으로 찾는다. */
  const faces = new Map(
    (members ?? []).flatMap((member) => (member.avatar ? [[member.login, member.avatar]] : [])),
  );
  if (me.avatar && !faces.has(me.login)) faces.set(me.login, me.avatar);

  return (
    <FacesContext value={faces}>
      <LabelsContext value={labels}>
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
                data-tip={`${folded ? "채널 패널 펼쳐 두기" : "채널 패널 닫기"} ${FOLD_KEY}`}
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
                  data-tip={`채널 패널 열기 ${FOLD_KEY}`}
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
              {missing ? (
                <div className="channel-title">
                  <h2>
                    <Lock className="channel-mark" size={20} aria-hidden />
                    <span>찾을 수 없음</span>
                  </h2>
                </div>
              ) : big && openPost && current ? (
                <div className="post-title">
                  <a
                    className="header-button"
                    href={`#${current.id}`}
                    aria-label="포럼으로 돌아가기"
                  >
                    <ChevronLeft size={18} aria-hidden />
                  </a>
                  <a className="post-crumb" href={`#${current.id}`}>
                    {current.name} ›
                  </a>
                  <h2>{postTitle(openPost)}</h2>
                  <IssueNumber post={openPost} />
                </div>
              ) : forum && current ? (
                <ForumTitle forum={current} solo={solo} />
              ) : (
                current && (
                  <ChannelTitle channel={current} members={solo ? undefined : members?.length} />
                )
              )}
              {/* 오른쪽 칸을 여는 버튼들. 평소에는 아이콘만, 연 버튼만 이름이 붙는다. */}
              <div className="header-actions" hidden={missing}>
                {big && labelButton}
                {big && debateButton}
                {big && decide}
                {forum && !big && current && current.id !== OTHER.id && (
                  <button
                    type="button"
                    className="header-button"
                    aria-label="포럼 고치기"
                    onClick={() => forumEditor.current?.showModal()}
                  >
                    <Settings2 size={18} aria-hidden />
                  </button>
                )}
                {big && openPost && current && (
                  <a
                    className="header-button"
                    href={`#${current.id}/${openPost.alert}`}
                    aria-label="옆 칸으로"
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
                {/* 혼자면 멤버 목록이 뜻이 없어 버튼을 두지 않는다(시안 100-A). */}
                {!solo && (
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
                )}
              </div>
            </header>
            {missing ? (
              <div className="empty">
                <h2>이 레포는 볼 수 없어요</h2>
                <p>
                  push 권한이 있는 사람만 이 레포의 채널과 포스트를 봐요. GitHub에서 권한을 받으면
                  10분 안에 패널에 생겨요.
                </p>
                {/* 레포 이름은 쓰지 않는다. 레포가 하나뿐인 계정이면 "전체"가 없어 그 레포로 간다(시안 93-C, 101). */}
                <button
                  type="button"
                  className="button outline"
                  onClick={() => {
                    setPicked(repos.length > 1 ? ALL : repos[0]);
                    location.hash = "";
                  }}
                >
                  {repos.length > 1
                    ? `${space.name} 전체로 가기`
                    : `${repoName(repos[0] ?? "")}로 가기`}
                </button>
              </div>
            ) : inPlace?.length === 0 && !found ? (
              <div className="empty">
                <h2>아직 채널이 없어요</h2>
                <p>채널을 만들어 멤버들과 이야기를 시작해 보세요.</p>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => openCreator("chat")}
                >
                  채널 만들기
                </button>
              </div>
            ) : forum && !big ? (
              <Forum
                key={current.id}
                forum={current}
                posts={posts}
                selected={openPost?.alert}
                unread={unread}
                me={me.login}
                solo={solo}
                account={space.name}
                repos={repos}
                onSaveFilter={(filter) => updateForum(current, current.name, filter)}
              />
            ) : (
              conversation(`${postChannel?.name}에 메시지 보내기`)
            )}
          </main>
          {!missing && asidePost && openPost && postChannel && (
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
                  <IssueNumber post={openPost} />
                  {labelButton}
                  {debateButton}
                  {decide}
                  {wide && (
                    <a
                      className="header-button"
                      href={`#${current?.id}/${openPost.alert}/big`}
                      aria-label="크게 보기"
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
          {shown === "members" && !solo && (
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
          <RepoDialog
            dialog={repoDialog}
            account={workspaces.find((other) => other.id === adding) ?? space}
            repos={admins[adding]}
            onAdd={addRepo}
          />
          <ForumDialog
            // 곳을 바꾸면 새로 그려 레포 칩이 지금 보는 곳으로 골라진 채로 열린다.
            key={here}
            dialog={creator}
            posts={previews}
            account={space.name}
            repos={repos}
            start={here === ALL || repos.length < 2 ? [] : [here]}
            kind={createKind}
            onKind={setCreateKind}
            onCreateChat={create}
            onSave={createForum}
          />
          {forum && current && current.id !== OTHER.id && (
            <ForumDialog
              key={`${current.id}:${current.name}:${JSON.stringify(current.filter)}`}
              dialog={forumEditor}
              forum={current}
              posts={previews}
              account={space.name}
              repos={repos}
              onSave={(name, filter) => updateForum(current, name, filter)}
              onDelete={() => deleteForum(current)}
            />
          )}
          {deciding && postChannel && (
            <DecisionDialog
              // 열 때마다 새로: 초안을 쓰게 하고 칸을 비운다.
              key={deciding.revising?.id ?? "new"}
              post={postChannel.id}
              title={postChannel.name}
              repo={openPost?.repo ?? me.repo}
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
          {debating && openPost && postChannel && "open" in debating && (
            <DebateDialog
              title={postChannel.name}
              initial={debated?.request?.opened === false ? debated.request : undefined}
              onRequest={(agenda, grounds) =>
                debateCall(() =>
                  call(server(session), api.requestDebate, {
                    post: openPost.channel,
                    agenda,
                    grounds,
                  }),
                )
              }
              onClose={() => setDebating(undefined)}
            />
          )}
          {debating && openPost && debate && "seat" in debating && debate.seats[debating.seat] && (
            <ProxyDialog
              seat={debate.seats[debating.seat]}
              onProxy={() =>
                debateCall(() =>
                  call(server(session), api.proxyDebate, {
                    post: openPost.channel,
                    seat: debating.seat,
                  }),
                )
              }
              onClose={() => setDebating(undefined)}
            />
          )}
          {settings && (
            <Settings
              me={me}
              posts={posts}
              mine={members?.find((member) => member.login === me.login)}
              session={session}
              check={check}
              onClose={() => setSettings(false)}
            />
          )}
        </div>
      </LabelsContext>
    </FacesContext>
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
  head,
  solo,
  mine,
  onLogout,
  onSettings,
  onPresence,
  onMessage,
  children,
}: {
  me: Me;
  /** 이름 줄(레포 고르기) */
  head: ReactNode;
  solo: boolean;
  mine?: MemberView;
  onLogout: () => void;
  onSettings: () => void;
  onPresence: (presence: ChosenPresence, duration?: PresenceDuration) => Promise<void>;
  onMessage: (message: string, emoji: string | null) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <>
      {head}
      {children}
      <ProfilePanel
        me={me}
        mine={mine}
        solo={solo}
        onLogout={onLogout}
        onSettings={onSettings}
        onPresence={onPresence}
        onMessage={onMessage}
      />
    </>
  );
}

/** 사람마다(로그인) GitHub 프로필 사진 주소. 앱 틀이 멤버 목록으로 채운다. */
export const FacesContext = createContext<Map<string, string>>(new Map());

/** 사람 이름(#288): "GitHub 이름 (로그인)". GitHub 이름이 없거나 로그인과 같으면 로그인만 쓴다. */
export const personName = (name: string, login: string) =>
  name && name !== login ? `${name} (${login})` : login;

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
  login,
  size,
  presence,
}: {
  name: string;
  /** 주면 그 사람의 GitHub 프로필 사진을 쓴다(멤버 목록이 실어 온 것). 없거나 받지 못하면 이니셜이다. */
  login?: string;
  size: 22 | 36 | 40;
  presence?: Presence;
}) => {
  const src = use(FacesContext).get(login ?? "");
  const [failed, setFailed] = useState<string>();
  const face = (
    <span className={`avatar avatar-${size}`} aria-hidden>
      {src && failed !== src ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : (
        Array.from(name)[0]?.toUpperCase()
      )}
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
