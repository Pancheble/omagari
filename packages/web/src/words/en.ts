import type { CheckReading, Importance } from "@omagari/contract";

type CheckProblem = Extract<CheckReading, { problem: unknown }>["problem"];

const rules = new Intl.PluralRules("en");
const plural = (n: number, one: string, other: string) =>
  `${n} ${rules.select(n) === "one" ? one : other}`;

/** English screen text, the source dictionary (`i18n.ts`). Follow DESIGN.md "Writing". */
export const en = {
  tryAgain: "Try again",
  importance: { reference: "FYI", discuss: "Discuss" } satisfies Record<Importance, string>,

  login: {
    title: "Log in to Omagari",
    body: "Log in with your GitHub account. If you have push access to the workspace repo, you're in, no invite needed.",
    start: "Log in with GitHub",
    starting: "Asking GitHub…",
    codeTitle: "Enter this code on GitHub",
    codeBody:
      "Once you enter the code and approve it on GitHub, this page moves on to the workspace by itself.",
    codeLabel: "Code to enter on GitHub",
    openGithub: "Open GitHub",
    copy: "Copy code",
    copied: "Copied the code.",
    waiting: "Waiting for you to approve on GitHub…",
    cancel: "Cancel",
    refusedTitle: "You can't join this workspace",
    refusedBody:
      "Only accounts with push access to the repo can join. Ask a repo admin for access, or switch accounts on GitHub and log in again.",
    again: "Log in again",
    failedTitle: "Couldn't log you in",
    ended: "The code expired, or it wasn't approved on GitHub.",
    offline: "Can't reach the server. Check your connection?",
    expired: "You've been logged out. Log in again to keep going.",
    unreachableTitle: "Can't reach the server",
    unreachableBody: "Check your connection and try again. You're still logged in.",
  },

  settings: {
    nav: "Settings",
    close: "Close settings",
    me: "Me",
    workspace: (name: string) => `Workspace · ${name}`,
    saveFailed: "Couldn't save that. Try again in a bit?",
    loadFailedTitle: "Couldn't load settings",
    loadFailedBody: "Can't reach the server.",
    off: "Off",
    on: "On",
    pages: {
      agent: "My agent",
      language: "Language",
      alerts: "Conflict alerts",
      labels: "Labels",
    },
    language: {
      name: "Display language",
      description: "Only changes it for you. Other members keep their own.",
    },
    agent: {
      whenAsked: "When others ask",
      whenAskedNote:
        "When it answers, the runner on your machine only reads your folder, and it uses your usage.",
      answerSwitch: "Answer other people's questions",
      answerOn: "When another member's agent asks, your agent reads your folder and answers.",
      answerOff: "It's off. Whoever asks hears “not accepting” right away.",
      answered: "What your agent answered",
      answeredSome: (count: number, days: number, name: string, text: string) =>
        `${plural(count, "time", "times")} in the last ${days} days · the last was “${text}”, asked by ${name}'s agent`,
      answeredNone: (days: number) => `No questions answered in the last ${days} days`,
      connected: "Connected agents",
      runnerOff: "The runner is off",
      runnerOn: "Runner on",
      runnerAnswering: "Runner on · answering",
      connectedBadge: "Connected",
      none: "No agents connected",
      noneHint: "Turn on the runner on this machine and it shows up here.",
    },
    alerts: {
      workspace: "Workspace",
      name: "Name",
      repo: "Repo",
      mergeRun: "Merge run",
      mergeRunNote:
        "It reads from the config file on the repo's default branch. To change it, edit that file and merge it. It's the same for every member. Turning it on and off happens on the runner, not the web, so the server can't decide what runs on your machine.",
      checkCommand: "Check command",
      checkWaiting: "Once a runner connects, it reads the repo's config file.",
      checkConfig: "The command that runs on the merged result.",
      checkProblems: {
        missing: "The repo has no config file. Once you merge one, it starts running.",
        invalid: "Couldn't read the repo's config file. It isn't JSON, or its shape is off.",
        unknown_branch:
          "The runner doesn't know the repo's default branch, so it couldn't read the config file.",
      } satisfies Record<CheckProblem, string>,
      howToSet: "How to set one",
      runOnMine: "Run on my runner",
      runOn: "It's on. It only runs inside the sandbox.",
      runOff: "It's off. Verdicts that other members' runners ran still show.",
      noSandbox: "This machine has no sandbox tool, so it doesn't run.",
      howToInstall: "How to install",
      runnerOff: "The runner is off.",
    },
    labels: {
      find: "Find a label",
      new: "New label",
      preview: "This is how it looks on a post",
      previewTitle: "The reason field on refund",
      directConflict: "Direct conflict",
      name: "Name",
      color: "Color",
      reroll: "Pick another color",
      description: "Description",
      importance: "Importance",
      importanceHelp: {
        reference: "Piles up as alerts. Doesn't open an issue.",
        discuss: "People look at it and talk. Adding it opens a GitHub issue.",
      } satisfies Record<Importance, string>,
      opening: (n: number) =>
        `Switching to Discuss opens issues on ${plural(n, "open post", "open posts")} with this label.`,
      taken: "There's already a label with that name.",
      githubRefused: "GitHub didn't take the label. Check your token's permissions?",
      saveFailed: "Couldn't save that. Try again in a bit?",
      help: "Name, color, and description change the GitHub label too. Importance is the same for every member.",
      revert: "Revert",
      save: "Save",
      create: "Create",
    },
  },
};
