# Set up a machine

The short version is in [Getting started](getting-started). This page has the details: the background runner, Windows, updating, and running from a clone.

## Install

```bash
npm i -g omagari
omagari --version
```

You need Node.js 24.12 or later. The `omagari` package holds the CLI, the runner, and the hooks ([ADR-0048](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0048-publish-to-npm-latest-from-tags-next-from-dev.md)). Until the first release, `latest` isn't a real build yet. Use `npm i -g omagari@next`, which is the newest `dev` build.

If you get `command not found`, the folder where npm puts global programs isn't on your PATH. `npm prefix -g` shows where it is. Add its `bin` folder to your shell config and open a new terminal. Agents call `omagari` from their hooks and the status line skill, so it has to be on the PATH of every shell.

## Set up this machine

```bash
omagari setup https://<your-team-server>
```

This does four things:

- signs you in with GitHub,
- saves the server address in `~/.config/omagari/config.json`, next to `sessions.json`,
- puts the session-start hook, the pre-edit hook, and the status line skill into this machine's agents (Claude Code and Codex),
- registers the background runner to start at login.

Leave the address out and it asks for one (`Server address?`). `OMAGARI_SERVER` still wins when it's set. Without either, the CLI connects to `http://127.0.0.1:3000`.

Running `setup` again is safe: with the same address and session nothing changes, and a new address switches to it (signing in again if that server has no session yet). For Codex, open `/hooks` in Codex and trust the two Omagari hooks, or they won't run. Codex has no way to trust them in advance, so `setup` ends by saying so.

The web shows the same two lines with your address filled in ("Connect your computer"). You can also paste them to your agent and ask it to run them.

## The background runner

There's one background runner per machine ([ADR-0049](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0049-background-runner-watches-shared-repos-agents-open.md)). `setup` registers it with launchd on macOS, and with a systemd user unit on Linux and WSL2. It starts at login, starts again if it crashes, and runs one runner per repo inside the same process. You don't start it, and you don't list folders.

- **Where it looks.** When an agent session starts in a folder, the session-start hook tells the runner. It remembers the folders it has seen, so they come back after a restart.
- **What it watches.** Only repos you've shared. Share a repo once with the Share button on the web, or `omagari share on` in the repo folder. It follows you to your other machines. `omagari share off` stops it. Until you share, the runner connects but doesn't observe the repo, and your agent is told how to share it.
- **What it never sends.** A repo whose GitHub remote isn't under one of your team's accounts isn't sent to the server, not even by name.
- **Logs.** On macOS, to `~/.config/omagari/background.log`. On Linux, `journalctl --user -u <unit>`. `omagari runner log` shows what the runner ran.
- **By hand.** `omagari runner` in a repo folder still works, and counts as sharing. If the background runner already watches that repo, it says so and exits. Use it where there's no background runner, like a Linux without systemd.

To take Omagari off this machine:

```bash
omagari uninstall              # removes the hooks, the skill, and the background runner
omagari uninstall --sign-out   # also ends this server's session and forgets it
```

## Windows

Omagari runs on Windows through WSL2. Open a WSL2 terminal, install Node.js there, and do everything in this page inside it. Keep the repo inside WSL2 too, because Windows drives (`/mnt/c` and so on) aren't readable from the sandbox.

`omagari setup` from PowerShell stops and says to use WSL2. If WSL2 runs without systemd, `setup` can't start the background runner at login. It tells you to add this to `/etc/wsl.conf`, run `wsl --shutdown` in Windows, open WSL2 again, and run `omagari setup` again:

```ini
[boot]
systemd=true
```

## Merge runs

Merge runs need a sandbox tool. On macOS there's nothing extra to install. On Linux and WSL2 you need bubblewrap, socat, and ripgrep. The check command, the sandbox, and turning merge runs off are in [Merge runs and the check command](merge-runs).

## Update

A runner installed from npm updates itself. When the server's contract is newer and rejects your runner, it runs `npm i -g omagari@<the tag it came from>` and starts again, and the background runner comes back in the new version. What it pulled goes to `omagari runner log`. If it can't, it changes nothing and tells you what to do.

To update by hand:

```bash
npm i -g omagari@latest   # or omagari@next
```

If you upgraded Node, or `omagari` moved, run `omagari setup` again, because the hook commands contain the Node and install paths.

What changed in each release is on [GitHub Releases](https://github.com/omagari-dev/omagari/releases). If a release starts with "Runners need to update too", the contract between the server and the runner changed.

## Check your version

```bash
omagari --version
```

It prints the package version and the contract version, like `omagari 0.1.0 (contract 62)`. From a clone it prints the git tag instead, like `omagari v0.1.0 (contract 62)`.

If the server and this machine have different contract versions, the server rejects the runner, and the runner tells you what to do.

- **Server is newer**: the runner updates itself and restarts. If it can't, follow [Update](#update).
- **Server is older**: the server has to be updated. Tell whoever runs it.

## Run from a clone

Contributors and the dogfood machines run from a clone. Members of a team don't need this.

```bash
git clone --branch dev https://github.com/omagari-dev/omagari.git ~/omagari
cd ~/omagari
npm ci
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
omagari --version
```

`~/.local/bin` has to be on your PATH (add `export PATH="$HOME/.local/bin:$PATH"` to your shell config, and open a new terminal). Then `omagari setup` works the same.

The dogfood server follows `dev` ([ADR-0042](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0042-dogfood-server-on-fly-follows-dev.md)). Machines that use it can also install with `npm i -g omagari@next` ([ADR-0048](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0048-publish-to-npm-latest-from-tags-next-from-dev.md)).

A clone updates with `git pull --ff-only` and `npm ci`. If the server's contract is newer, the runner does the same in the install clone (the checkout that holds the runner program) and starts again. It never touches the repo folder it observes. If the clone has edited files or can't fast-forward, it changes nothing and tells you what to do.
