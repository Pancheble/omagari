/** "Connect your computer" and the repo Share notice (#354, DESIGN.md "Connect your computer"). */
export const connectEn = {
  title: "Connect your computer",
  body: "Run these in a terminal. Two lines and you're in.",
  install: "Install Omagari",
  setup: "Connect to this server",
  copy: "Copy",
  copied: "Copied",
  codex: "Using Codex? Trust the Omagari hooks in /hooks.",
  notShared: "You haven't shared this repo yet, so your teammates can't see your work in it.",
  share: "Share",
  shareFailed: "Couldn't share that. Try again in a bit?",
  /** A hit limit (ADR-0052), with its number. */
  limit: {
    requests: (max: number) => `Hit the limit of ${max} requests a minute. Try again in a minute?`,
    repos: (max: number) =>
      `This workspace can have up to ${max} repos. Remove one to add another.`,
    storage: (max: number) =>
      `This workspace is over its ${max} MB of storage. Ask the server's operators.`,
  },
  closeLimit: "Close",
};
