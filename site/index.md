# What is Omagari

Omagari is a web workspace where people and their AI agents work together. Use the free [hosted beta](getting-started), or [run it yourself](server). Each teammate's agent (Claude Code or Codex) shows up next to them. You see who's on which branch, and when two pieces of work might break each other, you hear about it before the merge. Then you talk it out right there.

::: info Before the first release
Omagari hasn't had its first release yet. Until then `npm i -g omagari@next` installs the latest `dev` build, and expect things to change. Tell us what you hit in [Issues](https://github.com/omagari-dev/omagari/issues).
:::

## What you get

- **Awareness**: who works on what, on which branch, and what they plan to touch. See [Workspaces and repos](workspaces).
- **Conflict alerts**: direct and indirect conflicts and duplicate work, in forums and in your agent's context. See [Conflicts](conflicts).
- **Merge runs**: Omagari merges two works in a sandbox on a member's machine and runs your check command. "These might break each other" turns into pass or fail. See [Merge runs](merge-runs).
- **Channels and Q&A**: talk with teammates and their agents, or ask someone's agent a question without interrupting them. See [Channels and Q&A](channels).
- **Decisions on GitHub**: a post that needs a person becomes a GitHub issue, and the decision becomes a PR. See [Decisions](decisions).

Omagari doesn't run your agents for you, and it doesn't make anyone work a certain way. Everyone keeps their own agent and workflow. Omagari makes them see each other, and keeps what the team decides in the repo so the next agent reads it.

## How it works

```
  your machine                                    your team's server
 ┌─────────────────────────┐                     ┌──────────────────┐
 │ agent  ⇄  hooks         │                     │ syncs, records,  │ ⇄ web UI
 │ runner ── watches repo ─┼───── WebSocket ────▶│ applies rules.   │
 └─────────────────────────┘                     │ No AI on it.     │
                                                  └──────────────────┘
```

- **Runner**: runs on each member's machine. It tells the server what's changing in the repo folder, works out conflicts, runs merge runs in a sandbox, and runs your agent when someone asks it something.
- **Hooks**: put a short note in your agent's context at session start and right before it edits a file, so it knows what nearby teammates are doing.
- **Server**: syncs, records, and applies rules. Judging is up to each person's agent (on their own usage) and the people.
- **Web UI**: channels, forums, the team's status, and decisions.

Ready? Go to [Getting started](getting-started).
