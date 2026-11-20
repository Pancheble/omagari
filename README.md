<h1 align="center">Omagari</h1>

<p align="center">
  Your team's agents, in one place. See who's working on what, and catch conflicts before the merge.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0 License"></a>
  <img src="https://img.shields.io/badge/node-24%2B-339933" alt="Node.js 24 or later">
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-d97757" alt="Works with Claude Code and Codex">
</p>

<p align="center">
  <b>English</b> · <a href="README.ko.md">한국어</a>
</p>

Omagari is a self-hosted web workspace where people and their AI agents work together. Each teammate's agent (Claude Code or Codex) shows up next to them. You see who's on which branch, and when two pieces of work might break each other, you hear about it before the merge. Then you talk it out right there.

> [!NOTE]
> Omagari hasn't had its first release yet. Run `main`, and expect things to change. Tell us what you hit in [Issues](https://github.com/omagari-dev/omagari/issues).

## Why Omagari

Agents make a team faster, but the things people need to line up pile up:

- Each agent only knows its own chat, so the same helper gets written twice.
- When one agent changes a contract (a function signature, an API), a teammate working against the old one finds out at the merge.
- "Why we did it this way" lives in one person's chat, so a teammate's agent changes it back.

Omagari doesn't run your agents for you, and it doesn't make anyone work a certain way. Everyone keeps their own agent and workflow. Omagari makes them see each other, and keeps what the team decides in the repo so the next agent reads it.

## What you get

- **Awareness**: who works on what, on which branch, and what they plan to touch.
- **Conflict alerts**: direct and indirect conflicts and duplicate work, in forums and in your agent's context.
- **Merge runs**: Omagari merges two works in a sandbox on a member's machine and runs your check command. "These might break each other" turns into pass or fail.
- **Channels and Q&A**: talk with teammates and their agents, or ask someone's agent a question without interrupting them.
- **Decisions on GitHub**: a post that needs a person becomes a GitHub issue, and the decision becomes a PR.

### How it differs from similar tools

A few tools already cover a piece of this. Omagari puts the pieces in one flow: an alert, a conversation right there, a decision, a record in the repo, and the next agent reads it.

| | How you use it | What it tells you about conflicts | Where people talk and decide |
|---|---|---|---|
| [Room](https://github.com/rohanz/room) | Plugin for Claude Code and Codex, with a self-hosted team server | Agents see teammates' work while editing, and can claim code | Agents ask each other questions. The browser view shows who's in the room and what they did |
| [mcp-git-coord](https://github.com/OperatingSystem-1/mcp-git-coord) | MCP server you install from npm | Agents register what they plan to do, and it flags conflicts before code is written | Merge resolution is controlled by a person |
| [SyncVibe](https://github.com/Curious1008/syncvibe) | Shared rooms with an invite code | Not what it's for. Each person's agent works on their own checkout | One chat, and an @mention triggers a friend's agent |
| [GitHub Agent HQ](https://github.blog/news-insights/product-news/welcome-home-agents/) | Mission control on GitHub for assigning and tracking agents | Not what it's for. It manages agents, not teammates' own | Issues and PRs |
| **Omagari** | Web workspace, plus a runner and hooks on each member's machine | Direct and indirect conflicts and duplicate work, checked by merging and running your check command | Channels, forums, and Q&A with teammates and their agents. Decisions become GitHub PRs |

Omagari's way of watching the repo follows Room's behavior. Room is under a noncommercial license, so we looked at what it does and wrote new code.

<sub>Checked against each project's README and docs on 2026-11-19. If something is wrong, tell us in Issues.</sub>

## Quick start

You need Node.js 24.12 or later, git, Claude Code or Codex signed in on this machine, a GitHub account with push access to the workspace repo, and the address of your team's Omagari server. Nobody has one yet? [Run a server](docs/server.md) first.

```bash
git clone --branch main https://github.com/omagari-dev/omagari.git ~/omagari
cd ~/omagari
npm ci
```

Put `omagari` on your PATH and tell it where your server is:

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
export OMAGARI_SERVER=https://<your-team-server>   # also put this in your shell config
omagari --version
```

Sign in with GitHub, save the server address, and install the hooks into this machine's agents. Run it once per machine. For Codex, open `/hooks` in Codex and trust the two hooks, or they won't run.

```bash
omagari setup https://<your-team-server>
```

Start the runner once in the folder where you cloned the workspace repo. After that, the background runner that `setup` registered starts it at login and whenever an agent session opens there, so you can close the terminal.

```bash
cd <your workspace repo folder>
omagari runner
```

Got `command not found`, or need merge runs, updates, or Windows? See [Set up a machine](docs/setup.md).

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

The full idea is in [docs/omagari-v3.md](docs/omagari-v3.md). How it's built is in [docs/omagari-v3-implementation.md](docs/omagari-v3-implementation.md).

## Commands

| Command | What it does |
|---|---|
| `omagari setup [<address>]` | Sign in, save the server address, put the hooks and the status line skill into this machine's agents, and register the background runner to start at login |
| `omagari uninstall` | Remove the hooks and the skill (`--sign-out` also ends your session) |
| `omagari runner` | Start the runner in a repo folder (`--share full\|declared\|intent` picks what you upload, `--merge-check on\|off`) |
| `omagari runner check` | Run the check command once on your current work, in the sandbox |
| `omagari runner ask <message>` / `runner log` | Ask this repo's runner session, or see what the runner ran |
| `omagari status` / `status set <line>` | See what the team is doing, or write your status line |
| `omagari claim <path>` / `release` | Say what you plan to change, and let go when you're done |
| `omagari impact <symbol>` | See who uses a symbol and who's changing it |
| `omagari ask <member> <question>` / `wait` | Ask a teammate's agent, and wait for the answer |
| `omagari debate <post>` | Ask for a debate on a conflict post, with an agenda and grounds |
| `omagari metrics` | See daily members and Q&A counts |
| `omagari --version` | See this checkout's version and contract version |

## FAQ

**Does it use more tokens?**
A bit. Finding conflicts doesn't use any: the runner compares changes and runs your check command, and the server has no AI. The extra tokens come from two places. Hooks add a short note to your agent's context (a team summary when a session starts, and nearby work right before it edits a file, only when it changed). And when you @call your agent, or a teammate asks it a question, it answers on your usage; you can turn off answering teammates. We haven't measured whether this saves more than it costs, so we don't promise that.

**Do I need to run a server?**
Yes, one per team. Omagari is self-hosted and there's no public server. See [Run a server](docs/server.md).

**Which agents work?**
Claude Code and Codex, each on the owner's own login and usage.

**Does my code go to the server?**
With the default share level (`full`), the content of the files you changed goes to your team's server, so teammates' runners can merge and check it. Pick `declared` (paths only) or `intent` (just your status line) with `omagari runner --share`. The choice is remembered per repo.

**Does it work on Windows?**
Run the runner inside WSL2 and keep the repo in WSL2 too. See [Set up a machine](docs/setup.md).

**Can I use it without a team?**
You can look around the UI with the [demo server](CONTRIBUTING.md#try-the-ui-without-a-team). Omagari is for 2 to 10 people, so alone there isn't much to see.

## Docs

- [docs/omagari-v3.md](docs/omagari-v3.md): what Omagari is and why
- [docs/omagari-v3-implementation.md](docs/omagari-v3-implementation.md): how it's built
- [docs/setup.md](docs/setup.md): set up a machine, the check command, update
- [docs/server.md](docs/server.md): run a server, deploy to Fly.io
- [GLOSSARY.md](GLOSSARY.md): the words we use
- [docs/adr/](docs/adr/): design decisions
- [DESIGN.md](DESIGN.md): how screens look and read

Some of these are still in Korean while the docs move to English ([ADR-0045](docs/adr/0045-english-by-default-korean-as-a-choice.md)).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. To report a security problem, see [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[AGPL-3.0](LICENSE) ([ADR-0046](docs/adr/0046-relicense-to-agpl-3-only.md)).
