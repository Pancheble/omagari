/** Deleting an account, a repo's data, and a workspace (ADR-0054). */
export const deletionEn = {
  deletedMember: "Deleted member",
  account: {
    title: "Delete account",
    body: "Your sessions, GitHub tokens, profile, works, and settings are deleted. Messages you wrote stay as a deleted member's.",
    button: "Delete account",
    confirm: "Delete your account?",
    lines: [
      "Your sessions, GitHub tokens, profile, presence, works, and settings are deleted.",
      "Your runners disconnect.",
      "Messages you wrote stay as a deleted member's.",
    ],
  },
  repo: {
    confirm: (repo: string) => `Remove ${repo} and delete its data?`,
    lines: [
      "Its works, alerts, posts, labels, decisions, check commands, and repo channels are deleted.",
      "Adding it again starts empty.",
    ],
  },
  workspace: {
    title: "Delete workspace",
    body: "Every repo's works, alerts, posts, labels, and decisions are deleted, and so is every channel.",
    note: "Only a GitHub Admin of every repo here can delete it.",
    button: "Delete workspace",
    confirm: (name: string) => `Delete the ${name} workspace?`,
    lines: (repos: number) => [
      `Everything in its ${repos === 1 ? "repo" : `${repos} repos`} is deleted: works, alerts, posts, labels, decisions, and check commands.`,
      "Every channel and forum here is deleted too.",
    ],
    forbidden: "You're not a GitHub Admin of every repo here, so you can't delete it.",
  },
  forever: "You can't undo this. Backups keep it until they expire.",
  typeName: "To confirm, type the name:",
  cancel: "Cancel",
  delete: "Delete",
  failed: "Couldn't delete that. Try again in a bit?",
};
