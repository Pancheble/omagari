---
status: accepted
---

# One background runner per machine; it watches the repos agents open, once each person shares them

Today a person keeps `omagari runner` open in a terminal for each repo folder (ADR-0016). Decided on 2026-11-19 by @Pancheble in the #347 grilling: `omagari setup` registers the runner as a background service that starts at login, and nobody lists folders.

- **One background process per machine.** `setup` registers it with launchd (macOS) or a systemd user unit (Linux, WSL2). It runs one runner per repo inside the same process, with the same GitHub session (one per server, as today). With no repo yet it just waits.
- **Windows means WSL2.** ADR-0038 already runs the runner inside WSL2. `setup` on Windows itself stops and says to use WSL2. On WSL2 without systemd, it says how to turn systemd on.
- **The session-start hook tells it where to look.** When an agent session starts, the hook sends its folder to the background process over one socket per user. The process keeps the folders it has seen in the config folder, so they come back after a restart without waiting for a session.
- **Repos outside the server's accounts are never sent.** The server tells a logged-in runner which GitHub accounts it accepts (ADR-0043). The runner checks a folder's GitHub remotes against that list on the machine. A remote under another account isn't sent to the server, not even by name, and the hook stays quiet there.
- **Each person shares each repo once** (repo sharing). For a workspace repo the person hasn't shared yet, the runner connects but doesn't observe, and the session-start hook tells the agent: the repo is in the team's workspace, isn't shared from this person yet, and can be shared on the web or with `omagari share on`. Sharing is stored on the server per member and repo, so it follows the person to other machines. `omagari share off` stops it. Running `omagari runner` in a folder by hand counts as sharing, as before, and repos a member already observed before this change count as shared.
- **No two runners on one repo.** The per-repo socket check stays. `omagari runner` in a terminal on a repo the background process already watches says so and exits. With the background process off, the terminal runner works as today.

## Considered Options

- **One background process per folder**: a service unit per repo, and `setup` would need the folder list up front.
- **Share without asking**: smoothest, but opening an agent session would upload work in progress without anyone saying yes. Today, typing `omagari runner` is the yes.
- **Ask once in `setup` for every workspace repo**: one yes covers repos the person hasn't seen yet.
- **Send every folder's remotes and let the server decide**: leaks the names of private repos that have nothing to do with the team.
- **Windows Task Scheduler for a native Windows runner**: the runner doesn't run natively on Windows (ADR-0038).

## Consequences

- Updates ADR-0016: the hook no longer stays quiet just because `<git-common-dir>/omagari` is missing. It stays quiet for repos outside the server's accounts.
- The contract grows a sharing state per member and repo, and the list of accepted accounts.
- `omagari setup` replaces `omagari install`, and `omagari uninstall` removes the service and the hooks.
- Codex still asks the person to trust the hooks once in `/hooks`. Codex has no setting that trusts them in advance, only `--dangerously-bypass-hook-trust` for one run ([Codex hooks](https://learn.chatgpt.com/docs/hooks), checked 2026-11-19). `setup` says so at the end.
