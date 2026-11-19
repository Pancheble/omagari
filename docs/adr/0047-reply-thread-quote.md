---
status: accepted
---

# Replies, threads, and quotes; how they reach GitHub and agents

@Pancheble asked to answer someone's message with a quote (#339). Before drafting, we settled what goes in (2026-11-19 @Pancheble, #339 comment). All three of Discord's, Slack's, and GitHub's ways go in, as separate things:

- **Reply**: a message points at one earlier message in the same channel, post, or DM. The pointer is a reference to the original, not a copy, so the screen shows the original's current first line. Replies work in channels and posts.
- **Thread**: a side conversation under one channel message. Only channels have threads. A post is already one topic, and GitHub issue comments have no branches to carry a thread (Discord's forum posts can't hold threads either). A thread reply can "also send to the channel" (Slack's "Also send to #channel"), and the channel copy shows as a reply to the thread's original.
- **Quote**: `>` lines in the message text. It's a copy at that moment, so the contract doesn't change for it. The first line may be `> **login**` to say whose words they are (draft 115-B).
- **Same place only.** You can only reply to or quote a message in the same channel, post, or DM. So anyone who can see a reply can see its original, and no visibility check per viewer is needed. If the original can't be loaded anyway, the screen shows "Can't see the original message" the same way whether it was deleted or hidden (#239).
- **Who gets called**: a reply calls the original's author unless the sender turned it off. A thread calls its original's author and everyone who wrote in it. A quote calls nobody. Delivery belongs to browser notifications (#313).
- **GitHub**: a reply in a post becomes an issue comment that starts with `> **login** · [original](comment link)` and `> first line`, a blank line, then the text. No `@login`, so GitHub doesn't email the author again. When the original is a message that has no GitHub comment yet, the link goes to the issue. A comment that comes in from GitHub is never turned back into a reply, since GitHub doesn't say what it answers.
- **Agents** don't make replies or quotes themselves. When a person `@call`s inside a reply, with a quote, or in a thread, the original (in a thread: the original and its replies) goes into the question as context, and in a thread the answer lands in that thread. It only includes messages the caller can see in that place.

## Considered Options

- **Only Discord's reply**: smallest. @Pancheble wanted all three, since they do different jobs.
- **Threads in posts too**: GitHub has no place for them, so the issue would show a flat mix. Left out.
- **Quoting messages from other channels** (Slack's link preview): each viewer would need a visibility check, and a hidden channel's text could leak. Left out.
- **`@login` in GitHub comments**: GitHub would email the author on top of the issue subscription they already have.

## Consequences

- The contract gains, on a message: `replyTo` (the original's id, or nothing), `threadOf` (the thread's original id, for replies inside a thread), `alsoInChannel`, and `notify` (whether a reply calls the author). A channel message gains a thread summary (reply count, up to three writers, last reply time). Sending gains the same fields. `CONTRACT_VERSION` goes up.
- The server rejects a `replyTo` or `threadOf` that points into another channel, post, or DM, and a `threadOf` in a post or a DM.
- The web renders `> ` lines as a quote block; until now human messages were plain text.
- GitHub sync writes the reply header when it posts a reply as a comment.
- The `@call` question carries the quoted context; the runner session gets it as part of the question.

## Sources

- [Discord replies](https://support.discord.com/hc/en-us/articles/360057382374-Replies-FAQ), [Discord threads](https://support.discord.com/hc/en-us/articles/4403205878423-Threads-FAQ)
- [Slack threads](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions-)
- [GitHub keyboard shortcuts: R quotes the selection](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)
