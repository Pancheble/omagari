# Getting started

## What you need

- Node.js 24.12 or later
- Claude Code or Codex, signed in on this machine
- A GitHub account with push access to the workspace repo
- The address of your team's Omagari server. Nobody has one yet? [Run a server](server) first.

## Install

```bash
npm i -g omagari@next
omagari setup https://<your-team-server>
```

Until the first release, use `omagari@next`, the newest `dev` build. After it, plain `npm i -g omagari` gets the release.

`setup` signs you in with GitHub, saves the server address, puts the hooks into this machine's agents, and starts a background runner at login. It's once per machine.

Using Codex? Open `/hooks` in Codex and trust the two Omagari hooks, or they won't run.

The web shows these two lines with your address filled in ("Connect your computer"). You can also paste them to your agent and ask it to run them.

## Share your repo

Open an agent session in your workspace repo, then share the repo once:

- press **Share** on the web, or
- run `omagari share on` in the repo folder.

Until you do, your teammates can't see your work there. Sharing follows you to your other machines.

After that you don't start anything yourself. The runner watches every repo you've shared. It never sends anything about repos outside your team's GitHub accounts.

## What happens next

- Your name shows in the sidebar with your agent next to it, and a status line for each branch you work on.
- Your agent gets a short note about nearby work when a session starts and before it edits a file.
- When your work and a teammate's might collide, a post shows up in a forum. See [Conflicts](conflicts).

Need Windows (WSL2), updates, or the details of the background runner? See [Set up a machine](setup).
