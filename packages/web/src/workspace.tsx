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
  type Prefs,
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
import { ConnectCard, LimitNotice, ShareNotice } from "./connect.tsx";
import { ChannelTitle, Conversation, type ReplyBody, type View } from "./conversation.tsx";
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
import { setLanguage, t } from "./i18n.ts";
import { type CreateKind, ForumDialog, LabelsContext, PostLabels } from "./labels.tsx";
import { useLive } from "./live.ts";
import { MemberList, MemberSkeleton } from "./members.tsx";
import { browserAllows, type Notice, noticeFor } from "./notify.ts";
import { ALL, placeIn, placeOf } from "./places.ts";
import { ProfilePanel } from "./profile.tsx";
import { type Opened, PeopleContext, ProfileCard, ProfileView } from "./profile-card.tsx";
import { Settings } from "./settings.tsx";
import { setAppearance } from "./theme.ts";

/** From this width the channel panel is always visible. Narrower, only the conversation shows and the channel panel opens as a drawer (DESIGN.md, app on narrow screens). */
const WIDE = "(min-width: 834px)";
/** From this width the right column sits next to the conversation. Narrower, it floats over the conversation, and at 833px or less it is a sheet. */
const BESIDE = "(min-width: 1069px)";

/** Shortcut to fold and unfold the channel panel. ⌘\ on Mac, Ctrl+\ elsewhere (DESIGN.md, folding the channel panel). */
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const FOLD_KEY = MAC ? "⌘\\" : "Ctrl+\\";
/** How long the mouse must rest before a folded channel panel peeks out or closes. */
const PEEK_DELAY = 300;

/** Whether the media query matches. Follows window width changes. */
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
 * Merge by number. The same message arriving twice, from past conversation and live, stays as one, and the later one replaces the earlier.
 * But a Q&A that has an answer is never reverted to a late "waiting for the answer".
 */
/** Members who spoke in a Post (people who wrote messages or posted Q&As). Shown as Decision-maker candidates. */
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

/** Insert or replace a Q&A by number. One that has an answer is never reverted to a late "waiting for the answer". */
const upsert = (qas: Qa[], qa: Qa) => {
  const known = qas.find((other) => other.id === qa.id);
  if (known && known.answer.state !== "pending" && qa.answer.state === "pending") return qas;
  return [...qas.filter((other) => other.id !== qa.id), qa].sort((x, y) => x.id - y.id);
};

/** `#channel id` in the address. Channel rows are links, so picking one changes it, and so does Back. */
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
 * App frame: the channel panel on the left, the conversation in the middle, the right column. The right column holds only one of the member list (#19) and my agent (#21).
 * On narrow screens the same channel panel opens as a left drawer (modal `<dialog>`).
 * Every time the live connection attaches (first time, and reconnects) the channel list is read again. Reading after attaching means nothing created in between is missed.
 * The member list arrives once each time the same connection attaches, and again whenever it changes.
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
  /** The workspaces I joined and the id of the one picked */
  workspaces: Space[];
  workspace: string;
  /** Picked a place (a repo or "All") on another account (mock 101). */
  onSwitch: (workspace: string, place: string) => void;
  /** Added or removed a repo (all the repos visible to me). The app updates the workspace list. */
  onRepos: (repos: string[]) => void;
  onLogout: () => void;
  /** The session ended (the API or the live connection said so). */
  onSignedOut: () => void;
}) {
  const drawer = useRef<HTMLDialogElement>(null);
  const creator = useRef<HTMLDialogElement>(null);
  /** The kind picked in the "Create" dialog. Set by the `+` of the category that was clicked (mock 88-A). */
  const [createKind, setCreateKind] = useState<CreateKind>("chat");
  const forumEditor = useRef<HTMLDialogElement>(null);
  const space = workspaces.find((other) => other.id === workspace) ?? (workspaces[0] as Space);
  /** The repos of this workspace that are visible to me. The app changes it when repos are added or removed. */
  const repos = space.repos;
  /** Labels per repo (ADR-0039, ADR-0043). Read on connect and replaced by the live connection's `labels` (the first repo's). */
  const [labelsByRepo, setLabelsByRepo] = useState<Record<string, Label[]>>({});
  /** The labels the forum filter chooses from: the repos' labels merged by name. */
  const labels = [
    ...new Map(
      Object.values(labelsByRepo)
        .flat()
        .map((label) => [label.name, label]),
    ).values(),
  ];
  const repoDialog = useRef<HTMLDialogElement>(null);
  /** The repos I'm Admin of, per account (the "Add a repo" list and the ⋯ on repo rows). Missing means not loaded yet. */
  const [admins, setAdmins] = useState<Record<string, AdminRepo[] | "error">>({});
  /** Where to install the server's GitHub App (ADR-0053). Absent on a server with an OAuth app. */
  const [install, setInstall] = useState<string>();
  /** The accounts being loaded. Keeps the menu from loading the same account over and over. */
  const reading = useRef(new Set<string>());
  const loadAdmin = (id: string) => {
    reading.current.add(id);
    return call({ ...server(session), workspace: id }, api.adminRepos)
      .then(({ repos: list, install }) => {
        setAdmins((all) => ({ ...all, [id]: list }));
        setInstall(install);
      })
      .catch((error) => {
        check(error);
        setAdmins((all) => ({ ...all, [id]: "error" }));
      })
      .finally(() => reading.current.delete(id));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once when the workspace opens
  useEffect(() => void loadAdmin(workspace), []);
  /** The account whose "Add a repo" window is open */
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
  /** My personal settings. Changes from my other tabs and devices come as `prefs` on the live connection. */
  const [prefs, setPrefs] = useState<Prefs>(me.prefs);
  /** Has my runner ever connected, and which repos have I shared (#354). Read again on every connect and when the member list changes. */
  const [setup, setSetup] = useState({ connected: me.connected, shared: me.shared });
  const [shareFailed, setShareFailed] = useState(false);
  /** Browser notifications (#313): the message number when this tab first connected, the Q&As seen waiting, and the notifications already shown. */
  const since = useRef<number>(undefined);
  const asking = useRef(new Set<number>());
  const notified = useRef(new Set<string>());
  const heard = useRef(new Set<number>());
  /** All written-up Decisions. The decision status strip reads it. Read at first, and replaced when a decision line arrives and when I change one. */
  const [decisions, setDecisions] = useState<Decision[]>([]);
  /** The write-up dialog: has a value while open, and holds that Decision while editing. */
  const [deciding, setDeciding] = useState<{ revising?: Decision }>();
  /** Debates and Debate requests per Post (channel id). Read with `api.posts` on connect, and changes arrive over the live connection. */
  const [debates, setDebates] = useState<
    Record<string, { debate: Debate | null; request: DebateRequest | null }>
  >({});
  /** The open dialog: opening a Debate (a re-request fills in the last request) or calling a stand-in. */
  const [debating, setDebating] = useState<{ open: true } | { seat: number }>();
  /** The most recent Decision draft that came over the live connection. The dialog picks out whether it's its own. */
  const [incoming, setIncoming] = useState<Draft>();
  /** The last four fields sent as a decision PR from this browser. The contract has no Decision body, so this fills in the fields when editing and resending. */
  const submitted = useRef<Record<number, Fields>>({});
  const wide = useMedia(WIDE);

  /** Whether the channel panel is folded. Only used at 834px and up; when the window narrows and widens again, it returns to what was remembered. */
  const [folded, toggleFolded] = useCollapsed("omagari.side-panel-folded");
  const shut = wide && folded;
  const [peek, setPeek] = useState(false);
  /** Whether the folded panel is peeking out over the conversation. */
  const peeking = shut && peek;
  const sideId = useId();
  const side = useRef<HTMLElement>(null);
  const foldButton = useRef<HTMLButtonElement>(null);
  const unfoldButton = useRef<HTMLButtonElement>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Whether to move focus to the other button after folding or unfolding. */
  const refocus = useRef(false);
  /** Fold or unfold. If focus was where it would disappear (the panel being folded, or the unfold button that vanishes on unfolding), move it to the other button. */
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
  /** Close the peeking panel. If focus was inside it, move it to the unfold button. */
  const closePeek = () => {
    clearTimeout(peekTimer.current);
    if (side.current?.contains(document.activeElement)) unfoldButton.current?.focus();
    setPeek(false);
  };
  /** Whether a status menu or channel creation opened from the peeking panel is open. It doesn't close meanwhile. */
  const held = () =>
    !!(settings || creator.current?.open || side.current?.querySelector(".status-menu"));
  /** Peek out when the mouse rests on the unfold button or the left edge of the window. Keyboard focus and touch don't peek it out. */
  const hoverIn = (event: PointerEvent) => {
    clearTimeout(peekTimer.current);
    if (!peeking && event.pointerType === "mouse") {
      peekTimer.current = setTimeout(() => setPeek(true), PEEK_DELAY);
    }
  };
  /** Close shortly after the mouse leaves. If it has come back in by then, leave it; if a menu is open, wait until it closes. */
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
  // Fold and unfold with ⌘\ (Ctrl+\), and close the peeking panel with Esc. Only listens on wide screens.
  // The key is read by position (Backslash) regardless of keyboard layout. On a Korean keyboard that position types ₩.
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
  /** The open right column: member list, my agent (DM), or full profile view. Only one opens at a time. */
  const [right, setRight] = useState<"members" | "agent" | "profile" | "thread">();
  /** The open profile card, and the person (login) open in the full view */
  const [card, setCard] = useState<Opened>();
  const [profile, setProfile] = useState<string>();
  const rightId = useId();
  const membersButton = useRef<HTMLButtonElement>(null);
  const agentButton = useRef<HTMLButtonElement>(null);
  /** The button to return focus to when closed. The one that opened it. */
  const closing = useRef<HTMLButtonElement | null>(null);
  const closeRight = () => {
    closing.current = right === "agent" ? agentButton.current : membersButton.current;
    setRight(undefined);
  };
  /**
   * If a side-column post is using the right column, opening another column closes the post. The exception is my agent, which opens with the post in the big view (the post's DM).
   * There is only one right-column slot.
   */
  const toggleRight = (panel: "members" | "agent" | "profile") => {
    if (asidePost && openPost) {
      location.hash = `${current?.id}${panel === "agent" ? `/${openPost.alert}/big` : ""}`;
      return setRight(panel);
    }
    return right === panel ? closeRight() : setRight(panel);
  };
  // On close, return to the button that opened it. Focus can only go outside after the sheet (modal) is gone.
  useEffect(() => {
    if (right || !closing.current) return;
    closing.current.focus();
    closing.current = null;
  }, [right]);
  /** My DM per channel, already loaded. Missing for channels never opened; read the first time the DM column opens. */
  const [dms, setDms] = useState<Record<string, Dm>>({});
  /**
   * DM Q&As attached to the channel input (DESIGN.md "posting to a channel"). The DM column and the channel input both see them.
   * Like the text in the input, they belong to that channel only, so they drop when the channel changes.
   */
  const [attached, setAttached] = useState<Qa>();
  /** The model and effort picked per agent. Kept in this browser, so they survive a refresh. DM and `@call` share them. */
  const [picks, setPicks] = useState<Picks>(() => savedPicks(me.login));
  /** The conversation per channel, already loaded. Missing for channels never opened; past messages are read the first time it opens. */
  const [views, setViews] = useState<Record<string, View>>({});
  /** The address is `#channel id`; a forum post is `#forum id/alert number` (side column), and the big view is `#forum id/alert number/big`. */
  const hash = useHash();
  const [hashChannel, hashPost, hashSize] = hash.split("/");
  const found =
    channels?.find((channel) => channel.id === hashChannel) ??
    (hashChannel === OTHER.id ? OTHER : undefined);
  /** The place picked in the menu (a repo name or "All"). Kept on this device. */
  const [picked, setPicked] = useState(() => remembered(placeKey(workspace)));
  /** The place being viewed (mock 101): the one the address's channel stands in, else the picked one. The panel always shows this place. */
  const here = found ? placeOf(found, repos) : placeIn(repos, picked);
  const inPlace = channels?.filter((channel) => placeOf(channel, repos) === here);
  const current =
    found ??
    inPlace?.find((channel) => channel.kind === "chat" && !channel.repo) ??
    inPlace?.find((channel) => channel.kind === "chat") ??
    inPlace?.[0];
  // Remember the place being viewed and the channel seen there. Coming back via the menu goes to that channel.
  useEffect(() => {
    if (here !== picked) setPicked(here);
    remember(placeKey(workspace), here);
    if (found) remember(lastKey(workspace, here), `#${hash}`);
  }, [here, hash, found, picked, workspace]);
  /** Share the repo being viewed (the Share button). The notice goes away once the server says yes. */
  const share = async () => {
    try {
      await call(server(session, here), api.share, { on: true });
      setSetup((now) => ({ ...now, shared: [...now.shared, here] }));
      setShareFailed(false);
    } catch (error) {
      check(error);
      setShareFailed(true);
    }
  };
  /** Pick a place from the menu. On another account the app switches to that workspace. Goes to the last channel seen there. */
  const pick = (id: string, place: string) => {
    if (id !== workspace) return onSwitch(id, place);
    setPicked(place);
    location.hash = remembered(lastKey(workspace, place)) ?? "";
  };
  const forum = current?.kind === "forum";
  /** All forum Posts. There are none until the forum is first read. */
  const [posts, setPosts] = useState<PostItem[]>();
  const openPost = forum ? posts?.find((item) => item.alert === Number(hashPost)) : undefined;
  const big = openPost !== undefined && hashSize === "big";
  /**
   * A channel or post reached by link isn't visible (mock 93-C): we don't tell "doesn't exist" from "in a repo you have no push access to".
   * The server doesn't reveal the repo name, so the screen has none either.
   */
  const missing =
    (!!hashChannel && channels !== undefined && !found) ||
    (forum && !!hashPost && posts !== undefined && !openPost);
  const asidePost = openPost !== undefined && !big;
  /** A Post acts like a channel: messages, past conversation, DMs, and `@call` go to the Post's channel. Its name is the title. */
  const postChannel: Channel | undefined = openPost && {
    id: openPost.channel,
    name: postTitle(openPost),
    kind: "chat",
  };
  /** The channel that the conversation and DM go to: the open post, else the picked channel. A forum itself has no conversation. */
  const active = postChannel ?? (forum ? undefined : current);
  /** The number of messages last read per Post. Kept on this device. */
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem("omagari.post-seen") ?? "{}");
    } catch {
      return {};
    }
  });
  const unread = (item: PostItem) => item.count > (seen[item.channel] ?? 0);
  /**
   * Posts I'm involved in (mockup 55-D): alerts that involve my work, or Posts where I wrote a message. A Decision-maker is a member who spoke in that Post, so this includes them.
   * My messages are known only from the last message and the conversation read on this screen.
   */
  // ponytail: the contract has no list of who spoke in a Post, so a message I wrote long ago in an unread Post isn't known. If that gets missed often, put the speakers on Post.
  const mine = (item: PostItem) =>
    item.message.alert.works.some((work) => work.login === me.login) ||
    item.last?.login === me.login ||
    !!views[item.channel]?.messages.some(
      (m) => (m.kind === "text" || m.kind === "qa") && m.login === me.login,
    );
  // An open Post counts as read even when new messages arrive.
  const openCount = openPost?.count;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the read position moves whenever the open Post's message count changes
  useEffect(() => {
    if (!postChannel || openCount === undefined || seen[postChannel.id] === openCount) return;
    const next = { ...seen, [postChannel.id]: openCount };
    setSeen(next);
    try {
      localStorage.setItem("omagari.post-seen", JSON.stringify(next));
    } catch {}
  }, [postChannel?.id, openCount]);
  const [forumCollapsed, toggleForumCollapsed] = useCollapsed("omagari.forum-collapsed");
  /** Where each forum id sits */
  const forumPlace = new Map(channels?.map((channel) => [channel.id, placeOf(channel, repos)]));
  /** Is there anything new there: one of my open Posts in that forum has unread messages (same as the panel's branch). */
  const fresh = (place: string) =>
    !!posts?.some(
      (item) =>
        !settled(item) &&
        unread(item) &&
        mine(item) &&
        item.forums.some((id) => forumPlace.get(id) === place),
    );
  /** I'm the only member (mock 100-A). Decided by member count, not account type. */
  const solo = members?.length === 1 && members[0]?.login === me.login;
  /** The card's "View full profile": opens that person in the right column. If a side-column post is using the column, it closes the post. */
  const showProfile = (login: string) => {
    setCard(undefined);
    setProfile(login);
    if (asidePost && openPost) location.hash = `${current?.id}`;
    setRight("profile");
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: moving the conversation removes the attached Q&A
  useEffect(() => setAttached(undefined), [active?.id]);

  /** If the session ended, return to login. Other failures are shown by the caller. */
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

  /** The thread open in the right column (draft 114-A): its channel, original, and the original with its replies. */
  const [thread, setThread] = useState<{ channel: string; id: number; view: View }>();
  /** "Also send to # channel" per channel, last state. Kept on this device. */
  const [alsoSend, setAlsoSend] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("omagari.also-send") ?? "{}");
    } catch {
      return {};
    }
  });
  const rememberAlsoSend = (channel: string, on: boolean) => {
    const next = { ...alsoSend, [channel]: on };
    setAlsoSend(next);
    try {
      localStorage.setItem("omagari.also-send", JSON.stringify(next));
    } catch {}
  };
  /** Opens the thread under message `id` in the open channel and reads it. Threads are only in chat channels, not posts. */
  const openThread = async (channel: string, id: number) => {
    const known = (views[channel]?.messages ?? []).filter(
      (m) => m.id === id || ("threadOf" in m && m.threadOf?.id === id),
    );
    // What's already loaded shows at once; the read fills in older replies.
    setThread({
      channel,
      id,
      view: { status: known.length > 0 ? "ready" : "loading", messages: known, more: false },
    });
    setRight("thread");
    // ponytail: reads the first page only (50). A longer thread shows its latest 50; page it like the channel if threads get that long.
    try {
      const { messages } = await call(server(session), api.history, { channel, thread: id });
      setThread((now) =>
        now?.id === id
          ? {
              ...now,
              view: { status: "ready", messages: merge(now.view.messages, messages), more: false },
            }
          : now,
      );
    } catch (error) {
      check(error);
      setThread((now) =>
        now?.id === id ? { ...now, view: { status: "error", messages: [], more: false } } : now,
      );
    }
  };

  /** If the channel is already loaded, put it into the conversation. For a channel never opened, drop it and read past messages when it opens. */
  const receive = (message: ChannelMessage) => {
    setThread((now) =>
      now && (message.id === now.id || ("threadOf" in message && message.threadOf?.id === now.id))
        ? { ...now, view: { ...now.view, messages: merge(now.view.messages, [message]) } }
        : now,
    );
    if (message.kind === "decision") upsertDecision(message.decision);
    // An alert is a Post in the forum list. If it was fixed, the fix time is added, and when a new message lands the summary (`post`) arrives changed.
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

  /** If it is the DM of an already loaded channel, put it in. For a channel never opened, drop it and read when it opens. */
  const receiveQa = (qa: Qa) =>
    setDms((all) => {
      const dm = all[qa.channel];
      return Array.isArray(dm) ? { ...all, [qa.channel]: upsert(dm, qa) } : all;
    });

  const loadDm = async (channel: string) => {
    setDms((all) => ({ ...all, [channel]: "loading" }));
    try {
      const { qas } = await call(server(session), api.dms, { channel });
      // Merge in what arrived live while reading.
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: read only once, the first time the DM column opens the channel
  useEffect(() => {
    if (right === "agent" && active && !dmLoaded) void loadDm(active.id);
  }, [right, active?.id, dmLoaded]);

  /** Ask my agent. DM is private, `@call` is public. For `@call`, the Q&A standing in the channel is put in right away too. */
  const ask = async (
    channel: string,
    executor: ExecutorId,
    message: string,
    visibility: Visibility = "private",
    reply?: ReplyBody,
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
        ...reply,
      });
      asking.current.add(asked.qa.id);
      receiveQa(asked.qa);
      if (asked.message) receive(asked.message);
    } catch (error) {
      throw check(error);
    }
  };

  /**
   * Attach the DM's Q&A to the channel input. The input takes focus. If the right column floats over the conversation at this width, close the right column.
   * In that case, don't return focus to the opening button (don't use `closeRight`).
   */
  const attach = (qa: Qa) => {
    setAttached(qa);
    if (!matchMedia(BESIDE).matches) setRight(undefined);
  };

  /** Post the DM's Q&A with the text written alongside to the channel. Put in right away the message that stands in the channel, and the Q&A of a DM that became public. */
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
        // Replies that arrived while disconnected don't come again. Drop the loaded DMs and read the open one again.
        setDms({});
        // A language or look picked elsewhere while we were cut off doesn't come again.
        call(server(session), api.me)
          .then((me) => {
            setLanguage(me.prefs.language);
            setAppearance(me.prefs.appearance);
            setPrefs(me.prefs);
            setSetup({ connected: me.connected, shared: me.shared });
          })
          .catch(check);
        since.current ??= event.payload.seq;
      } else if (event.kind === "prefs") {
        setLanguage(event.payload.language);
        setAppearance(event.payload.appearance);
        setPrefs(event.payload);
      } else if (event.kind === "draft") setIncoming(event.payload);
      else if (event.kind === "channel") add(event.payload);
      else if (event.kind === "labels" && repos[0])
        setLabelsByRepo((all) => ({ ...all, [repos[0] as string]: event.payload }));
      else if (event.kind === "forumDeleted")
        setChannels((list) => list?.filter((channel) => channel.id !== event.payload.id));
      else if (event.kind === "message") receive(event.payload);
      else if (event.kind === "members") {
        setMembers(event.payload.members);
        // A runner that just connected, or a repo shared from the CLI, changes what the setup notices show.
        call(server(session), api.me)
          .then((me) => setSetup({ connected: me.connected, shared: me.shared }))
          .catch(check);
      } else if (event.kind === "qa") receiveQa(event.payload);
      else if (event.kind === "debate") {
        const { post: channel, ...rest } = event.payload;
        setDebates((all) => ({ ...all, [channel]: rest }));
      }
      notify(event);
    },
    onSignedOut,
  );

  /** Shows a browser notification for a live event, if my settings want one (`noticeFor`). Pressing it goes to that post or DM. */
  const notify = (event: Parameters<typeof noticeFor>[0]) => {
    if (event.kind === "qa" && event.payload.answer.state === "pending")
      asking.current.add(event.payload.id);
    if (since.current === undefined) return;
    const notice = noticeFor(event, {
      me: me.login,
      prefs,
      members,
      allowed: browserAllows(),
      looking: document.hasFocus(),
      since: since.current,
      asking: asking.current,
      heard: heard.current,
      postTitle: (channel) => {
        const item = posts?.find((one) => one.channel === channel);
        return item && postTitle(item);
      },
    });
    if (event.kind === "message") heard.current.add(event.payload.id);
    if (!notice || notified.current.has(notice.tag)) return;
    notified.current.add(notice.tag);
    const shownNow = new Notification(notice.title, { body: notice.body, tag: notice.tag });
    shownNow.onclick = () => {
      focus();
      goTo(notice);
      shownNow.close();
    };
  };
  const goTo = ({ channel, dm, thread }: Notice) => {
    const item = posts?.find((one) => one.channel === channel);
    location.hash = item ? `${item.forums[0] ?? OTHER.id}/${item.alert}` : channel;
    if (dm) setRight("agent");
    if (thread !== undefined) void openThread(channel, thread);
  };

  /**
   * Things that are per repo (Posts, labels, Decisions) are read per repo and merged (ADR-0043). The live connection receives all of the workspace's alert lines,
   * but only the first repo's labels come with it, so other repos' labels are read when reconnecting.
   */
  // ponytail: one call per repo. With many repos, add a way to read several repos at once to the contract.
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

  /** After adding or removing a repo on account `id`: the visible repos changed, so if it's the current workspace, read the channels and per-repo things again. */
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

  /** Read past messages. Without `before`, from the very end; with it, older than that. */
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
      // If older ones couldn't be read, leave it, and it reads again when scrolled up again.
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: read only once, the first time the channel opens
  useEffect(() => {
    if (active && !opened) void load(active.id);
  }, [active?.id, opened]);

  const send = async (channel: string, text: string, reply?: ReplyBody) => {
    try {
      receive((await call(server(session), api.send, { channel, text, ...reply })).message);
    } catch (error) {
      throw check(error);
    }
  };

  /** GIF search. The server asks GIPHY on our behalf with the key attached (ADR-0044). */
  const searchGifs = async (query: string) =>
    (await call(server(session), api.gifs, { query })).gifs;

  /** A chat channel is created in the place being viewed. For an account with only one repo, it is that repo's channel. */
  const create = async (name: string) => {
    const { channel } = await call(server(session), api.createChannel, {
      name,
      repo: here === ALL ? undefined : here,
    });
    add(channel);
    location.hash = channel.id;
  };

  /** Changes a Post's labels. The changed summary is put in right from the reply, and also arrives as an alert line on the live connection. */
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
    // The kind is already picked, so focus goes to the name field, not to the kind picker.
    creator.current?.querySelector<HTMLInputElement>(".text-input")?.focus();
  };

  /** Change my presence and status message. The change comes back in the live connection's member list. */
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

  /** What stands in the right column now. If there is a side-column post it is that, and the forum list has no DM. */
  const shown = asidePost ? "post" : right === "agent" && !active ? undefined : right;

  /** Works caught in a direct conflict ("login/branch"): the two works of an unresolved direct-conflict alert. A badge goes on their work line in the member list. */
  const direct = new Set(
    posts?.flatMap(({ message: { alert } }) =>
      alert.kind === "direct" && !alert.resolved
        ? alert.works.map((work) => `${work.login}/${work.branch}`)
        : [],
    ),
  );

  /** The open Post's Decision: the one written up last. */
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

  /** The "Labels" button in the Post head (mockup 54-C). */
  const labelButton = openPost && (
    <LabelsContext value={labelsByRepo[openPost.repo] ?? []}>
      <PostLabels
        labels={openPost.labels}
        issue={openPost.issue?.number}
        onChange={(next) => setPostLabels(openPost, next)}
      />
    </LabelsContext>
  );

  /** The open Post's Debate. */
  const debated = openPost ? debates[openPost.channel] : undefined;
  const debate = debated?.debate ?? null;
  /** Calls the Debate API and swaps in the Debate that comes back. It also arrives over the live connection, but this draws it first. */
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
  /** Open a Debate / View the Debate (mockup 60-B). If a Debate is open, go to the Debate strip. */
  const debateButton = openPost && (
    <button
      type="button"
      className="header-button named debate-button"
      aria-label={debate ? t.debate.view : t.debate.open}
      onClick={() => {
        if (!debate) return setDebating({ open: true });
        const strip = document.getElementById(DEBATE_STRIP);
        strip?.scrollIntoView({ block: "nearest" });
        strip?.focus();
      }}
    >
      <MessagesSquare size={18} aria-hidden />
      <span>{debate ? t.debate.viewShort : t.debate.openShort}</span>
    </button>
  );

  /** The write-up button: placed in the open Post's head strip, with its name always visible. */
  const decide = openPost && (
    <button
      type="button"
      className="header-button named debate-button"
      aria-label={t.debate.writeUp}
      onClick={() => setDeciding({})}
    >
      <PenLine size={18} aria-hidden />
      <span>{t.debate.writeUpShort}</span>
    </button>
  );

  /** Draws the picked conversation (a channel, or the open Post). A Post has its alert as the first message before the past conversation. */
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
        onSend={(text, reply) => send(active.id, text, reply)}
        searchGifs={me.gif ? searchGifs : undefined}
        onCall={(executor, question, reply) => ask(active.id, executor, question, "public", reply)}
        onPost={post}
        onThread={openPost ? undefined : (id) => void openThread(active.id, id)}
        onRetry={() => void load(active.id)}
        onReact={async (message, emoji, on) => {
          try {
            receive((await call(server(session), api.react, { message, emoji, on })).message);
          } catch (error) {
            throw check(error);
          }
        }}
        onOlder={() => {
          if (view?.more && !view.older) void load(active.id, view.messages[0]?.id);
        }}
      />
    );
  };

  /** The preview in the forum dialog: the open Post and its title. */
  const previews = (posts ?? [])
    .filter((item) => !settled(item))
    .map((item) => ({
      labels: item.labels,
      importance: item.importance,
      repo: item.repo,
      title: postTitle(item),
    }));

  /** Profile photos of the members. Person avatars look them up by login. */
  const faces = new Map(
    (members ?? []).flatMap((member) => (member.avatar ? [[member.login, member.avatar]] : [])),
  );
  if (me.avatar && !faces.has(me.login)) faces.set(me.login, me.avatar);

  const profileOf = members?.find((member) => member.login === profile);
  const cardOf = members?.find((member) => member.login === card?.login);
  const people = { members: members ?? [], open: setCard };

  return (
    <FacesContext value={faces}>
      <PeopleContext value={people}>
        <LabelsContext value={labels}>
          <div
            className={["app", shown && "with-panel", asidePost && "with-post", shut && "folded"]
              .filter(Boolean)
              .join(" ")}
          >
            {/* While folded, the left edge of the window (8px inner margin). Peeks out when the mouse rests on it. */}
            {shut && (
              <div className="peek-edge" onPointerEnter={hoverIn} onPointerLeave={hoverOut} />
            )}
            <aside
              ref={side}
              id={sideId}
              className={peeking ? "side-panel peek" : "side-panel"}
              aria-label={t.channels.frame.channelPanel}
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
                  aria-label={folded ? t.channels.frame.keepPanelOpen : t.channels.frame.closePanel}
                  data-tip={`${folded ? t.channels.frame.keepPanelOpen : t.channels.frame.closePanel} ${FOLD_KEY}`}
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
                  aria-label={t.channels.frame.openPanel}
                  onClick={() => drawer.current?.showModal()}
                >
                  <Menu size={18} aria-hidden />
                </button>
                {shut && (
                  <button
                    ref={unfoldButton}
                    type="button"
                    className="header-button"
                    aria-label={t.channels.frame.openPanel}
                    data-tip={`${t.channels.frame.openPanel} ${FOLD_KEY}`}
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
                      <span>{t.channels.frame.notFound}</span>
                    </h2>
                  </div>
                ) : big && openPost && current ? (
                  <div className="post-title">
                    <a
                      className="header-button"
                      href={`#${current.id}`}
                      aria-label={t.channels.frame.backToForum}
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
                {/* Buttons that open the right column. Usually icon only; only the open one gets a name. */}
                <div className="header-actions" hidden={missing}>
                  {big && labelButton}
                  {big && debateButton}
                  {big && decide}
                  {forum && !big && current && current.id !== OTHER.id && (
                    <button
                      type="button"
                      className="header-button"
                      aria-label={t.channels.frame.editForum}
                      onClick={() => forumEditor.current?.showModal()}
                    >
                      <Settings2 size={18} aria-hidden />
                    </button>
                  )}
                  {big && openPost && current && (
                    <a
                      className="header-button"
                      href={`#${current.id}/${openPost.alert}`}
                      aria-label={t.channels.frame.toSidePanel}
                    >
                      <Minimize2 size={18} aria-hidden />
                    </a>
                  )}
                  {active && (
                    <button
                      ref={agentButton}
                      type="button"
                      className="header-button"
                      aria-label={t.channels.frame.myAgent}
                      aria-expanded={shown === "agent"}
                      aria-controls={shown === "agent" ? rightId : undefined}
                      onClick={() => toggleRight("agent")}
                    >
                      <MessageSquare size={18} aria-hidden />
                      {shown === "agent" && <span>{t.channels.frame.myAgent}</span>}
                    </button>
                  )}
                  {/* Alone, a member list makes no sense, so there is no button (mock 100-A). */}
                  {!solo && (
                    <button
                      ref={membersButton}
                      type="button"
                      className="header-button"
                      aria-label={
                        shown === "profile" ? t.channels.frame.profile : t.channels.frame.members
                      }
                      aria-expanded={shown === "members" || shown === "profile"}
                      aria-controls={
                        shown === "members" || shown === "profile" ? rightId : undefined
                      }
                      onClick={() => toggleRight(shown === "profile" ? "profile" : "members")}
                    >
                      <Users size={18} aria-hidden />
                      {shown === "members" && <span>{t.channels.frame.members}</span>}
                      {shown === "profile" && <span>{t.channels.frame.profile}</span>}
                    </button>
                  )}
                </div>
              </header>
              <LimitNotice />
              {!missing && !setup.connected && <ConnectCard address={server(session).url} />}
              {!missing && here !== ALL && !setup.shared.includes(here) && (
                <ShareNotice onShare={() => void share()} failed={shareFailed} />
              )}
              {missing ? (
                <div className="empty">
                  <h2>{t.channels.frame.hiddenTitle}</h2>
                  <p>{t.channels.frame.hiddenBody}</p>
                  {/* Don't use the repo name. For an account with only one repo there is no "All", so it goes to that repo (mocks 93-C, 101). */}
                  <button
                    type="button"
                    className="button outline"
                    onClick={() => {
                      setPicked(repos.length > 1 ? ALL : repos[0]);
                      location.hash = "";
                    }}
                  >
                    {repos.length > 1
                      ? t.channels.frame.goToAll(space.name)
                      : t.channels.frame.goToRepo(repoName(repos[0] ?? ""))}
                  </button>
                </div>
              ) : inPlace?.length === 0 && !found ? (
                <div className="empty">
                  <h2>{t.channels.frame.emptyTitle}</h2>
                  <p>{t.channels.frame.emptyBody}</p>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => openCreator("chat")}
                  >
                    {t.channels.frame.createChannel}
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
                conversation(t.channels.frame.messageTo(postChannel?.name ?? ""))
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
                        aria-label={t.channels.frame.expand}
                      >
                        <Maximize2 size={18} aria-hidden />
                      </a>
                    )}
                  </div>
                }
              >
                {conversation(t.channels.frame.messagePost)}
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
            {shown === "thread" && active && thread?.channel === active.id && (
              <RightPanel
                id={rightId}
                title={t.conversation.thread.thread}
                sheet={!wide}
                onClose={closeRight}
                head={
                  <div className="thread-head">
                    <h2>{t.conversation.thread.thread}</h2>
                    <p># {active.name}</p>
                  </div>
                }
              >
                <div className="thread">
                  <Conversation
                    key={`thread-${thread.id}`}
                    channel={active}
                    view={thread.view}
                    live={live}
                    members={members}
                    me={me.login}
                    onAttach={() => {}}
                    onSend={(text, reply) => send(active.id, text, reply)}
                    searchGifs={me.gif ? searchGifs : undefined}
                    onCall={(executor, question, reply) =>
                      ask(active.id, executor, question, "public", reply)
                    }
                    onPost={post}
                    onRetry={() => void openThread(active.id, thread.id)}
                    onReact={async (message, emoji, on) => {
                      try {
                        receive(
                          (await call(server(session), api.react, { message, emoji, on })).message,
                        );
                      } catch (error) {
                        throw check(error);
                      }
                    }}
                    onOlder={() => {}}
                    thread={{
                      id: thread.id,
                      alsoSend: !!alsoSend[active.id],
                      onAlsoSend: (on) => rememberAlsoSend(active.id, on),
                    }}
                  />
                </div>
              </RightPanel>
            )}
            {shown === "members" && !solo && (
              <RightPanel
                id={rightId}
                title={t.channels.frame.members}
                sheet={!wide}
                onClose={closeRight}
              >
                {live === "reconnecting" && members && (
                  <p className="banner info" role="status">
                    {t.channels.frame.reconnecting}
                  </p>
                )}
                {members ? (
                  <MemberList me={me.login} members={members} cardOf={card?.login} />
                ) : (
                  <MemberSkeleton />
                )}
              </RightPanel>
            )}
            {shown === "profile" && profileOf && (
              <RightPanel
                id={rightId}
                title={t.channels.frame.profile}
                sheet={!wide}
                onClose={closeRight}
              >
                <ProfileView member={profileOf} direct={direct} />
              </RightPanel>
            )}
            {/* Clicking the cover closes it. With the keyboard, Esc closes it (the dialog does that). */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the dialog handles Esc */}
            <dialog
              ref={drawer}
              className="drawer"
              aria-label={t.channels.frame.channelPanel}
              onClick={(event) => event.target === event.currentTarget && drawer.current?.close()}
            >
              <div className="side-panel">{panel(() => drawer.current?.close())}</div>
            </dialog>
            <RepoDialog
              dialog={repoDialog}
              account={workspaces.find((other) => other.id === adding) ?? space}
              repos={admins[adding]}
              install={install}
              onAdd={addRepo}
            />
            <ForumDialog
              // Changing the place redraws it, so it opens with the repo chip set to the place being viewed.
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
                // New each time it opens: let it write a draft and empty the fields.
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
            {debating &&
              openPost &&
              debate &&
              "seat" in debating &&
              debate.seats[debating.seat] && (
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
                prefs={prefs}
                onPrefs={async (next) => {
                  const before = prefs;
                  setPrefs({ ...prefs, ...next });
                  try {
                    setPrefs(await call(server(session), api.setPrefs, next));
                  } catch (error) {
                    setPrefs(before);
                    throw error;
                  }
                }}
                onDndOff={() => void setPresence("online").catch(() => {})}
                onClose={() => setSettings(false)}
              />
            )}
            {card && cardOf && (
              <ProfileCard
                key={card.login}
                opened={card}
                member={cardOf}
                direct={direct}
                onFull={showProfile}
                onClose={() => setCard(undefined)}
              />
            )}
          </div>
        </LabelsContext>
      </PeopleContext>
    </FacesContext>
  );
}

/**
 * Right column. At 1069px and up it is the third column; at 834–1068px it is a column overlapping the conversation (CSS decides),
 * and at 833px and below (`sheet`) it is a full-height sheet rising from the bottom (modal `<dialog>`). It closes with the close button, Esc, or clicking the cover.
 * With `full`, it is not a sheet but a conversation using the whole screen like a channel (posts and DMs), and the close is the "‹" at the head's left.
 * The head's left is the title (`title`); if `head` is given, that stands there instead (the agent picked in the DM column).
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
          <button
            type="button"
            className="header-button"
            aria-label={t.channels.frame.back}
            onClick={onClose}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
        )}
        {head ?? <h2>{title}</h2>}
        {!page && (
          <button
            type="button"
            className="header-button"
            aria-label={t.channels.frame.closePanelNamed(title)}
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: the dialog's cancel handles Esc
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
  /** The name row (repo picker) */
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

/** GitHub profile photo URL per person (login). The app frame fills it from the member list. */
export const FacesContext = createContext<Map<string, string>>(new Map());

/** Person name (#288): "GitHub name (login)". If there is no GitHub name or it equals the login, only the login. */
export const personName = (name: string, login: string) =>
  name && name !== login ? `${name} (${login})` : login;

/** The words that read a presence. The name of the presence dot, and the second line of a member row with no status message. */
// Getters, so the words follow the current language at render time.
export const PRESENCE_WORDS = {
  get online() {
    return t.channels.presence.online;
  },
  get away() {
    return t.channels.presence.away;
  },
  get dnd() {
    return t.channels.presence.dnd;
  },
  get offline() {
    return t.channels.presence.offline;
  },
} as const satisfies Record<Presence, string>;

/**
 * Person avatar. With `presence`, a presence dot sits at the bottom right (DESIGN.md "presence dot").
 * The ring around the dot cuts the avatar out in the dot's shape so the background behind shows through as is. It fits even when the background changes (on hover).
 */
export const Avatar = ({
  name,
  login,
  size,
  presence,
}: {
  name: string;
  /** If given, uses that person's GitHub profile photo (carried by the member list). Without it or if it fails to load, initials. */
  login?: string;
  size: 16 | 20 | 22 | 28 | 36 | 40 | 64 | 80;
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

/** Dot shape only: online is a green circle, away an orange crescent, dnd a red circle with a white bar, offline an empty gray ring. */
export const Dot = ({ presence, ...rest }: { presence: Presence } & ComponentProps<"span">) => (
  <span className="dot" data-presence={presence} {...rest} />
);
