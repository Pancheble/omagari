import type { Presence } from "@omagari/contract";

const rules = new Intl.PluralRules("en");
const plural = (n: number, one: string, other: string) =>
  `${n} ${rules.select(n) === "one" ? one : other}`;

/** Screen text for the channel panel, repo picker, "Add a repo" dialog, and the app frame (`channels.tsx`, `workspace.tsx`). */
export const channelsEn = {
  panel: {
    unread: "New posts",
    chatTitle: "Chat channels",
    createChat: "Create a chat channel",
    forumTitle: "Forum channels",
    createForum: "Create a forum",
    foldMyPosts: (forum: string, shut: boolean) =>
      `${shut ? "Expand" : "Collapse"} my posts in ${forum}`,
    myPosts: (forum: string) => `My posts in ${forum}`,
  },

  place: {
    all: "All",
    allOf: (account: string) => `All of ${account}`,
    elsewhere: "New posts elsewhere",
    menu: "Choose a repo",
    find: "Find a repo",
    repoCount: (n: number) => plural(n, "repo", "repos"),
    add: "Add a repo",
    note: "Only added repos you can push to show up here.",
  },

  repoMenu: {
    label: "Repo menu",
    openGithub: "Open on GitHub",
    confirmRemove: "Click again to remove",
    remove: "Remove from workspace",
    removeFailed: "Couldn't remove that. Try again in a bit?",
  },

  addRepo: {
    title: "Add a repo",
    lead: "You only see repos where you're Admin. Private repos need adding too, or Omagari can't see them. Once you add one, anyone with push access to it joins as a member.",
    loading: "Loading repos…",
    loadFailed: "Couldn't load your repos from GitHub. Try again in a bit?",
    visibility: (isPrivate: boolean, pushers: number) =>
      `${isPrivate ? "Private" : "Public"} · ${pushers} with push access`,
    added: "Added",
    add: "Add",
    addFailed: "Couldn't add that repo. Try again in a bit?",
    missing: "Don't see a repo? The Omagari GitHub App has to be installed on it.",
    install: "Install App",
    other: `Repos on other accounts: use "Add a repo" under that account in the menu.`,
    close: "Close",
  },

  frame: {
    channelPanel: "Channel panel",
    keepPanelOpen: "Keep channel panel open",
    closePanel: "Close channel panel",
    openPanel: "Open channel panel",
    notFound: "Not found",
    backToForum: "Back to forum",
    editForum: "Edit forum",
    toSidePanel: "Move to side panel",
    myAgent: "My agent",
    members: "Members",
    profile: "Profile",
    expand: "Expand",
    back: "Back",
    closePanelNamed: (title: string) => `Close ${title}`,
    reconnecting: "Reconnecting to the server…",
    messageTo: (name: string) => `Message ${name}`,
    messagePost: "Message this post",
    hiddenTitle: "You can't see this repo",
    hiddenBody:
      "Only people with push access can see this repo's channels and posts. Once you get access on GitHub, they show up in the panel within 10 minutes.",
    goToAll: (account: string) => `Go to all of ${account}`,
    goToRepo: (repo: string) => `Go to ${repo}`,
    emptyTitle: "No channels yet",
    emptyBody: "Create a channel to start talking with the members.",
    createChannel: "Create channel",
  },

  presence: {
    online: "Online",
    away: "Away",
    dnd: "Do not disturb",
    offline: "Offline",
  } satisfies Record<Presence, string>,
};
