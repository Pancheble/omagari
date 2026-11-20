# Merge runs and the check command

A merge run merges two works for a moment and runs the repo's check command on the result. It shows whether a guessed indirect conflict really breaks. It runs on a member's machine, inside a sandbox, never on the server.

## Check command

The team sets the check command by committing `.omagari.json` at the repo root and merging it into the default branch. `setup` (a command that runs once before the check) is optional.

```json
{ "check": "npm test", "setup": "npm ci" }
```

The runner only reads the version merged into the default branch (the remote tracking branch), so it's the same for every member. **Settings → Merge run** on the web shows what it read, or why it couldn't.

To see whether the sandbox and the check command work on this machine, run it once against your current work in the current folder:

```bash
omagari runner check
```

## Sandbox

The sandbox blocks outside network access, writes outside a temp folder, and reading your home folder.

- **macOS**: nothing extra to install.
- **Linux and WSL2**: install bubblewrap, socat, and ripgrep. On Debian or Ubuntu: `sudo apt install bubblewrap socat ripgrep`.

Without them, the runner still works, but it doesn't run merge runs, and the web says this machine has no sandbox tool.

## Turning it off

Merge runs are on by default. To turn them off on this machine, start the runner with `omagari runner --merge-check off`. The choice is remembered per repo. Turning it on and off happens on the runner, not the web, so the server can't decide what runs on your machine. Verdicts other members' runners ran still show.

## Reading the verdict

| Verdict | What it means |
|---|---|
| Passes | Passes when merged, so the post closes |
| Fails | Breaks when merged, while both pass on their own. The post gets **Confirmed** |
| Can't tell | One side or both break even on their own |
| Could not run | No check command, no sandbox tool, a direct conflict in the way, or it hit the 5-minute limit. This never counts as a pass |
| Stale result | The content changed, so it runs again once things settle down |

Press **View output** to see what the check printed.
