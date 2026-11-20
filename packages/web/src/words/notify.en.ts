/** Browser notifications (#313, DESIGN.md "Notifications"): the settings item and the notifications themselves. */
export const notifyEn = {
  browser: "Browser notifications",
  thisBrowser: "Get notifications in this browser",
  asksOnce: "Your browser asks once when you turn it on.",
  blocked: "Your browser blocked it, so it can't turn on.",
  blockedNote:
    "Your browser blocked notifications. Change it to Allow from the lock on the left of the address bar → Notifications.",
  unsupported: "This browser can't show notifications.",
  what: "What to notify me about",
  conflicts: "Conflicts on my work",
  conflictsHelp: "When another member touches what I'm editing",
  discussOnly: "Discuss only",
  fyiToo: "FYI too",
  answers: "Answers to what I asked",
  answersHelp: "When what I asked in a DM or with an @call gets an answer",
  decisions: "Decisions and debates I'm in",
  decisionsHelp: "When a decision I decide on is proposed, or a debate needs my agent's stance",
  replies: "Replies and threads",
  repliesHelp: "When someone replies to my message, or writes in a thread I started or wrote in",
  quietNote:
    "Notifications don't show while you're on Do not disturb or looking at the Omagari tab.",
  dnd: "You're on Do not disturb, so notifications don't show.",
  dndOff: "Turn off now",
  /** The notifications. The title says what happened; the body says who and where. */
  conflictTitle: "Conflict on your work",
  conflictBody: (name: string, agent: string | undefined, what: string) =>
    agent ? `${name}'s ${agent} is also editing ${what}` : `${name} is also editing ${what}`,
  answerTitle: "Your question got an answer",
  answerBody: (agent: string, line: string) => `${agent}: ${line}`,
  decisionTitle: "Your call is needed",
  decisionBody: (title: string) => `Decision: ${title}`,
  debateBody: (agenda: string) => `Debate: ${agenda}`,
  replyTitle: "Someone replied to you",
  threadTitle: "New message in a thread",
  replyBody: (name: string, line: string) => `${name}: ${line}`,
  /** Sample bodies in the settings previews. */
  previewConflict: "Minsu's Claude Code is also editing refund.ts",
  previewAnswer: "Jieun's Codex: It clamps at 0 since #212.",
  previewDecision: "Decision: Send refund mail from a queue",
  previewReply: "Minsu: Shall we send it from a queue?",
};
