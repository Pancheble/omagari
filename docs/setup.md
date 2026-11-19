# Set up a machine

The short version is in the [README](../README.md#quick-start). This page has the details: PATH problems, the check command, updating, and versions.

## Which version to run

Members run `main`. `dev` is where work collects, so don't use it ([ADR-0019](adr/0019-stage1-version-is-git-tag-members-run-main.md)).

The one exception is dogfooding. The dogfood server follows `dev` ([ADR-0042](adr/0042-dogfood-server-on-fly-follows-dev.md)), so machines that use it clone with `--branch dev`. When the server moves to a new contract, the runner updates this clone by itself (see [Update](#update)).

## Put `omagari` on your PATH

Link the CLI into a folder that's already on your PATH. If you installed Claude Code or Codex natively, `~/.local/bin` is already there.

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
omagari --version
```

If you get `command not found`, `~/.local/bin` isn't on your PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell config (`~/.zshrc` and so on) and open a new terminal. Agents call `omagari` from the status line skill, so it has to be in the shell config, not just typed once.

Put the server address in your shell config too. Without it, the CLI connects to `http://127.0.0.1:3000`.

```bash
export OMAGARI_SERVER=https://<your-team-server>
```

## Install the hooks

```bash
omagari install
```

This puts the session-start hook, the pre-edit hook, and the status line skill into this machine's agents (Claude Code and Codex). Run it once per machine; running it again keeps one copy. For Codex, open `/hooks` in Codex and trust the two hooks, or they won't run.

## Check command

A merge run merges two works and runs the repo's check command inside a sandbox on this machine. The sandbox blocks outside network access, writes outside a temp folder, and reading your home folder.

The team sets the check command by committing `.omagari.json` at the repo root and merging it into the default branch. `setup` (a command that runs once before the check) is optional.

```json
{ "check": "npm test", "setup": "npm ci" }
```

The runner only reads the version merged into the default branch (the remote tracking branch). To see whether the sandbox and the check command work on this machine, run it once against your current work in the current folder.

```bash
omagari runner check
```

On macOS there's nothing extra to install. On Linux you need bubblewrap, socat, and ripgrep. On Windows, run the runner inside WSL2 and keep the repo inside WSL2 too, with the same tools as Linux (a runner started from PowerShell doesn't do merge runs). Windows drives (`/mnt/c` and so on) aren't readable from WSL2 either.

To turn merge runs off on this machine, start the runner with `omagari runner --merge-check off`. The choice is remembered per repo.

## Update

```bash
cd ~/omagari
git pull
npm ci
```

Then restart the runner (`Ctrl-C`, then `omagari runner`).

If the server's contract is newer and rejects your runner, the runner updates itself: it runs `git pull --ff-only` and `npm ci` in the install clone (the checkout that holds the runner program) and starts again with the same arguments. What it pulled (the commits before and after) goes to `omagari runner log`. It never touches the repo folder it observes. If the install clone has edited files or can't fast-forward, it changes nothing and tells you what to do. It doesn't update to an older server's contract either.

If you upgraded Node or moved the checkout, run `omagari install` again, because the hook commands contain the Node and checkout paths.

What changed in each release is on [GitHub Releases](https://github.com/omagari-dev/omagari/releases). If a release starts with "Runners need to update too", the contract between the server and the runner changed.

## Check your version

```bash
omagari --version
```

It prints this checkout's git tag and the contract version, like `omagari v0.1.0 (contract 9)`. After a release, commits show up as `v0.1.0-3-gabc1234`. A clone without tags shows the commit instead.

If the server and this machine have different contract versions, the server rejects the runner, and the runner tells you what to do.

- **Server is newer**: the runner updates itself and restarts. If it can't, follow [Update](#update) and restart the runner.
- **Server is older**: the server has to be updated. Tell whoever runs it.
