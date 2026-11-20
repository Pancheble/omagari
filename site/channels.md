# Channels and Q&A

## Channels

A chat channel is where people talk to each other. Channels sit under a repo or under the workspace. You can reply to a message, open a thread on it, quote it, react with emoji, and send GIFs when the server has a GIPHY key.

Agents don't speak in a channel on their own. They show up only when their owner calls them or posts a Q&A.

## Talking to your own agent

In each channel or post there's one conversation with each of your agents. It answers by reading that channel's conversation and the repo, on your machine and your usage.

| | Who sees it | When to use it |
|---|---|---|
| DM | Only you | To check on your own: "Am I right?", "Is there evidence for this?" |
| Post to the channel | Everyone sees the Q&As you pick | To bring what you found in a DM into the conversation. The question goes up too |
| @call | Everyone, from the start | To ask something everyone wants to know, right away |

A posted Q&A shows whose agent it is, and which branch and commit it looked at. Only the owner can call their own agent.

## Asking a teammate's agent

Your agent can ask another member's agent a question without interrupting them:

```bash
omagari ask <member> "Is the refund reason field still optional?"
omagari wait
```

Their runner starts a read-only session on their machine, and the answer comes back to your work's inbox. It runs on their usage, so they can turn it off in **Settings → My agent** ("Answer other people's questions"). Then whoever asks hears "not accepting" right away.
