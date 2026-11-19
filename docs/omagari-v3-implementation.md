# Omagari v3 implementation

The plan is in the Omagari v3 tab. This tab covers how we build it and in what order.

## 1. Build order

We don't build it all at once. When the earlier stage is done, we open the next one. We dropped the gate between stages (2026-11-12, [ADR-0021](adr/0021-drop-stage1-headcount-gate.md)), because people only use something if there's something to use it for. We measure precision and the effect of debates with the metrics in section 12.

| Stage       | What we build                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Measure  | We build nothing. Use Room with 2 people for a week and write down how many conflicts happened and what we couldn't resolve                                                                                    |
| 1. Space    | Runner, channels, an agent next to each person, status line, agent DMs and @calls, session-start hook and pre-edit hook                                                                                        |
| 2. One flow | Direct conflict and guessed-alert → conversation right there → decision PR. Claims, inbox and feed, asking and waiting, and definition lines come in here too. No debate engine, a person wraps it up          |
| 3. Evidence | Merge run                                                                                                                                                                                                      |
| 4. Debate   | Debate posts (agent debate, ending with experiments), grilling                                                                                                                                                 |
| 5. Deploy   | Put up the server and build Omagari with Omagari (dogfooding). Conflicts between one person's own works, several workspaces and several repos                                                                  |
| Later       | Conflicts across repos and workspace posts, people without push permission (view, contribute), decision retros, voice and transcription, @mentions across devices, mechanisms we turn on once they're observed |

**What we lock down**: we only lock down the spec through stage 1. From stage 2 it's a direction, and we adjust it from what we learn using the earlier stages. Stage 1 starts with one workspace and no team split, and the many-to-many mapping between teams and repos comes after stage 2. In stage 5 a workspace gets paired with one GitHub account and holds several repos, and teams follow GitHub teams (ADR-0043). Only the owner can call an agent.

**What stage 1 leaves out** (ADR-0009): claims, inbox and feed, asking and waiting (`omagari ask`), and definition lines. Stage 1 observation uploads the changed files and their content, and the two hooks only show nearby work, using that observation and the status line. `omagari ask` calls the other person's agent on the other person's usage, which clashes with "only the owner can call an agent". The receiving side agrees with a switch they turn on and off (ADR-0024).

**Stage 1's server and members**: there's one server, the one we run, and one workspace (ADR-0012). Only GitHub accounts with push permission on that repo join the workspace (ADR-0011). From stage 5 one server holds several workspaces, and members are decided per repo by push permission (ADR-0043). The dogfood server runs on Fly.io and follows `dev` (ADR-0042).

### Order inside stage 1: runner first

We know how to build screens, and the uncertainty is all in the runner. So we punch through the thinnest line from start to finish first.

1. **Runner only**: put one message in from the terminal and an agent session on my machine answers, and a second message continues the same session
2. **Server relay**: a message sent from another machine reaches my runner through the server
3. **Observation**: the runner looks at Git state and uploads the changed files and their content, and the status line shows from that
4. **Web screen**: on top of that go channels, the sidebar, and agent DMs

**What we confirmed from the docs (Claude Code)**

| Question                                               | Answer                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can we continue a session we started without a screen? | Yes. Run it with `claude -p` and continue with `--resume <session ID>`                                                                                                                                                    |
| Can we fork the owner's work session?                  | Yes. A fork makes a new session that copies the original's history and leaves the original alone. We can read the session list on disk to find the latest session                                                         |
| Does it stop at permission checks?                     | No. In a `-p` run, calls that need approval are denied. `--allowedTools` only decides which tools run without approval, so we narrow the tools you can use at all with `--tools` (ADR-0003)                               |
| Can it run on a subscription?                          | Yes. `claude -p` and Agent SDK use logged in with a plan count against the subscription limit                                                                                                                             |
| How does `/btw` work?                                  | It sees the whole conversation context but can't use tools, and the answer isn't kept in the history. Omagari's DM is a side question about the channel conversation, not about a work session, so it doesn't need a fork |

**Things to watch out for from this**

- A fork splits only the conversation, not the files. If the forked agent edits files, it really changes the owner's work folder, so a runner session has to be read-only
- `--bare` mode doesn't use the subscription login and needs an API key. It's planned to become the default for `-p`, and the runner may be affected then

**Why fork**: a new session doesn't know what the owner was working on, and putting a message straight into the work session interrupts the work and mixes into the conversation. A fork knows the work context without getting in the way of the work.

**What to check while building**

- If we fork the session the owner is using right now, how much of the conversation comes in?
- Codex: there's `codex exec resume <session ID>`, and `codex exec` uses the saved CLI login as is (usually a ChatGPT login) and defaults to a read-only sandbox (confirmed from the docs). **A hand check (2026-11-11, codex-cli 0.167.1) found the subscription login, session continuation, and read-only all worked as documented.** The default sandbox follows the user's setting (`sandbox_mode` in `~/.codex/config.toml`), so the runner (#16) doesn't lean on the default. It passes `-s read-only` itself and turns off MCP servers, apps, and plugins (ADR-0003). `codex exec fork` exists in 0.167.1. **A hand check (2026-11-17, codex-cli 0.167.1, owner's machine, #203) found that forking worked.** The new session answered with the context of the original session (from 2026-11-12), and the original session file's SHA-256 was the same before and after the fork. Read-only was given with `-c 'sandbox_mode="read-only"'` (`fork` has no `-s`). The shell `touch` was blocked with `Operation not permitted` and no file was created. Each fork makes a new session record. The runner (`debate.ts`) wired this in (#232). Session records are at `$CODEX_HOME/sessions/<year>/<month>/<day>/rollout-*.jsonl` (default `~/.codex`), and the `payload` of the first-line `session_meta` has `id`, `cwd`, and `git.branch` (this is the shape seen in 0.167.1 records, and we couldn't confirm it from the docs). Among sessions whose `cwd` is that work folder and whose `git.branch` is that branch, minus the ones the runner started, the runner forks the most recent with `codex exec fork <id> -`. A hand check on 2026-11-18 (0.167.1, owner's machine, #232) got a new `thread_id` with this argument shape, and it answered with the context of the original session. `fork` refuses outside a git repo with "Not inside a trusted directory" (a work folder is always inside a repo). If it can't find one, it joins without context
- Auto-compact in a Claude Code session without a screen: it happened in a hand check. A session with a lowered threshold (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`) shrank from 74,569 tokens to 3,399, the summary kept the first turn's content, and turns after the compact still remembered it. The session id stayed the same. We didn't look at Codex (undecided, below)

**Real executor hand check results** (`test/real-executors.ts`, how to run it is in `docs/executor-check.md`)

- Claude Code (2026-11-11, the #7 session in this repo ran it with the owner's machine's claude.ai login, with `ANTHROPIC_MODEL=haiku` to cut usage)
  - [x] Subscription login: it ran without an API key, and `claude auth status` shows a claude.ai login
  - [x] Session continuation: the second turn, continued through the runner's channel session, answered the first turn's passphrase, and the session id stayed the same
  - [x] Read-only: after being told to create and edit files, the work folder is unchanged. The answer was "I couldn't, because the only tools I can use are Glob, Grep, and Read"
  - Long session (observation): the auto-compact line above
- Codex (2026-11-11, @Pancheble ran `node test/real-executors.ts codex --quick`, codex-cli 0.167.1, darwin arm64, Node 24.19.0)
  - [x] Subscription login: it ran without an API key environment variable, and `codex login status` shows a ChatGPT login
  - [x] Session continuation: the second turn, continued with `codex exec resume <id> -`, answered the first turn's passphrase, and the session id stayed the same
  - [x] Read-only: with no `--sandbox` (the default), after being told to create and edit files, the work folder is unchanged. The answer was "I can't write files with read-only permission"
  - Long session: not checked (`--quick`). We put it off because it's hard to grow the context to 40k tokens on the free plan's usage
- Codex, after wiring it into the runner (2026-11-11, the #16 session ran `node test/real-executors.ts codex --quick`, codex-cli 0.167.1). We ran a DM channel session with the runner's `codex` executor
  - [x] Subscription login: `codex login status` shows a ChatGPT login
  - [x] Session continuation: the second turn, continued through the runner's channel session, answered the first turn's passphrase, and the session id stayed the same
  - [x] Read-only: after being told to create and edit files in a session the runner continued with `-s read-only`, the work folder is unchanged. The answer was "the workspace is read-only, so I can't create files"
- Switching models in a continued session (2026-11-12, the #55 session ran it by hand on the owner's machine, in an empty Git folder, with the same flags as the runner). What we decided is ADR-0020
  - Asking for the choices: neither calls a model. For Claude Code (2.1.319), sending the control request `initialize` to `claude -p --input-format=stream-json --output-format=stream-json --verbose --settings={"disableAllHooks":true}` got 14 `models` back within 1.7 seconds (including `default`, with `resolvedModel` and `supportedEffortLevels` attached), and it left no session record. For Codex (0.167.1), `model/list` on `codex app-server` returned 3 non-hidden models (free plan), with `supportedReasoningEfforts` and `isDefault` for each model
  - Claude Code: a session where haiku had memorized a passphrase was continued with `--resume --model=sonnet --effort=low`, and sonnet answered the passphrase (sonnet was added to `modelUsage`). Continuing again without `--model` answered **with sonnet**, not the default in settings (Fable 5.2) (`model` in `system`/`init` was `claude-sonnet-5-5`). In the session record, the requested effort is low only on the turn that got `--effort=low`, and medium on the rest, so effort doesn't carry over. The result's `modelUsage` sums the whole session, so it can't tell which model this turn used. Running again with the runner's `claudeCode` executor gave the same: the answering model the executor returned was haiku → (`--model` sonnet, `--effort` low) sonnet → (no flags) sonnet, and it answered the passphrase through the third turn
  - Codex: a session where `-m gpt-5.6-luna -c model_reasoning_effort=low` had memorized a passphrase was continued with `exec -m gpt-6-luna -c model_reasoning_effort=high resume <id> -`. After the warning "This session was recorded with model `gpt-5.6-luna` but is resuming with `gpt-6-luna`" (an `error` item in `item.completed`), it answered the passphrase in the same turn, and the exit code is 0. The session record's `turn_context` writes the model and effort for each turn: luna/low → 6-luna/high → (no flags) 6-luna/none → `-m gpt-5.6-terra` terra/none → (no flags) **6-luna**/none. Continuing without `-m` runs on the model in settings, not that session's model, and effort doesn't carry over either

**Dogfood server first deploy hand check results** (2026-11-18~19, #234. The server is Fly.io `omagari-dogfood`, Tokyo, volume `omagari_data`. @Pancheble did the account, billing, secrets, and first `fly deploy` themselves, and this session watched from beside them. The build was fee180c (manual deploy), then contract 43 after cd14ac7 (auto deploy))

- [x] Health check and web: `GET /api/health` returns `{"contract":43}` (200), and the server serves the web login screen. @Pancheble logged into the web with GitHub device authorization and saw the screen come up
- [x] Runner and agents: from the install clone (`dev`), ran `omagari install`, gave `OMAGARI_SERVER` the server address, and started the runner. `omagari status` shows Claude Code and Codex online. Both agents answered a message sent from a web channel (`omagari runner log`), and the earlier conversation went into the next question's context. @Pancheble looked at the agent list on the web screen
- [x] A child session's worktree shows up as work: the child sessions started after the runner came on (#253, #254) and this session's worktree showed up as work in the web member list (@Pancheble's screenshot, the hub confirmed). The agent mark on the work line wasn't there then and came in with #270 (591f62c)
- [x] Session-start hook: when this session restarted, the hook output included `<omagari-inbox>` (six lines of news about resolved indirect conflicts) (this session saw it itself). The hub session's SessionStart hook got `<omagari-situation>`, and its pre-edit hook got news of a direct conflict, an indirect conflict, and "closed because the merge run verdict was pass" (the hub confirmed)
- [x] Auto deploy: after #250 merged (cd14ac7), dev CI passed and Deploy ran (run 44305609539). At "decide whether to deploy", `DEPLOY=1` and `flyctl deploy` succeeded, and the new image went onto the same machine and volume (this session confirmed it from the run steps and `fly machine list`). Three more after that (922e1e4, 3e14908, 591f62c) all succeeded too (the hub)
- [x] DB after restart: the 5 conversations in the channel "일반" (General) (2026-11-18 12:15~12:25 UTC) and the CLI login are still there after three auto deploys (the hub confirmed with `api.history` and `omagari status`). This session saw the member and agents still there in `omagari status`
- Not seen: restoring from a volume snapshot (only snapshots piling up is turned on, we haven't tried restoring). The behavior where a build that fails the health check leaves the old build. The behavior where Deploy skips when you rerun an old CI run that isn't the tip of `dev` (#250's check, the build was the same). A server with several members joined
- What this check decided: `FLY_API_TOKEN` isn't a repo secret but a secret in the GitHub Environment `dogfood`, which only `dev` can use (#250). The contract went from 42 to 43 at the first deploy, so we manually deployed once more to a server that didn't have auto deploy yet

**Repo move to an organization hand check results** (2026-11-19, #278. We moved `Pancheble/omagari` to the organization `omagari-dev`, and looked at the server following it (#279) and two workspaces on the dogfood server. @Pancheble did creating the organization, Transfer, OAuth approval, web actions, and starting the runner, and this session guided from beside them. The hub looked at the server DB read-only)

- [x] Backup before the move: volume snapshot `vs_l0oNVl4K2v2AUeG308O41bwN` (the hub)
- [x] Organization OAuth approval: in the Omagari app's Organization access in GitHub settings, Grant on `omagari-dev`, and a green ✓ showed up (@Pancheble saw it). After the move, access was still there even after re-reading permissions every 10 minutes (the hub)
- [x] The server followed: after deploying with `OMAGARI_REPO="omagari-dev,Pancheble/kagami"` (#280), the log said "Pancheble/omagari was moved on GitHub to omagari-dev/omagari and we followed". There's one `repo_moves` row in the DB, the repo list is `omagari-dev/omagari` and `Pancheble/kagami`, and the 28 posts and channels and 32 conversations under the new name were all still there (the hub)
- [x] Picking a workspace: the workspace list at the top left of the web showed both `omagari-dev` and `Pancheble` (@Pancheble saw it, the hub confirmed with `api.me`)
- [x] Adding a repo: in `omagari-dev`, "Add repo" added `omagari-sandbox` (private), and it went into the DB's repo and permission lists (the hub). There was a web bug where switching workspaces made the added repo vanish from the list (the web only read the workspace list at login), and #287 fixed it (#285)
- [x] Runner: runners for the three folders `omagari-dev/omagari`, `omagari-dev/omagari-sandbox`, and `Pancheble/kagami` connected to the server from the same machine. The sandbox runner printed "Runner started: Pancheble's agent, omagari-dev/omagari-sandbox", and all three runners had a live connection to the server (this session confirmed it from the processes and connections). The runner of an install clone that still had the old remote (`Pancheble/omagari`) was still connected too
- What we didn't see and what's left: you can't add the first repo of an account with no repos from the web (because the workspace list only shows accounts that have a repo you can see). So `Pancheble/kagami` was added through settings. How a personal-account workspace and a workspace with a single repo look was decided again in #286 (#289) and changed in #290

Sources: [Claude Code non-interactive run](https://code.claude.com/docs/en/headless), [Working with sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [Using the Agent SDK with your plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [About /btw](https://blog.vincentqiao.com/en/posts/claude-code-btw/), [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

The runner only needs to confirm behavior, and then we get to the screen fast. We can only measure "do people stay in the space" once we reach step 4.

## 2. Components

| Piece         | Where it runs         | What it does                                                                                                                                    |
| ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app       | Browser               | The space's screen                                                                                                                              |
| Server        | Omagari server        | Sync, records, rule calculation. No AI                                                                                                          |
| Runner        | Each person's machine | Observation, running agent sessions, merge runs                                                                                                 |
| GitHub app    | GitHub                | Reading PRs, comments, making and merging decision PRs. Stage 2 does it without an app, with the token of the member who wraps it up (ADR-0025) |
| CLI and hooks | Each person's machine | How an agent uses Omagari                                                                                                                       |

Login is with a GitHub account. There's no separate invite screen. At login, push permission on that repo decides whether you're a member.

## 3. Runner

- **Observation**: it looks at the work folder's Git state and uploads the changed files, their content, and the definition lines to the server. The share level decides how much it uploads (section 11)
- **Running sessions**: when an agent DM, an @call in a channel, or a request to join a debate comes in, it starts an agent session on the owner's machine without a screen and sends the answer back. DMs and @calls use the same session that continues for each channel and each agent, which gets that channel's conversation as data and answers while reading the repo. For the channel conversation, each turn only passes the messages since the last turn, and the first turn passes up to the latest 50. We don't put the work session's context in during stage 1. The only difference between them is the visibility of the Q&A, so the server only keeps a private or public mark for each Q&A. A debate forks the owner's work session read-only and starts that. If the machine is off, that agent shows as offline
- **Model and effort**: the runner passes the model and effort picked in a DM to the executor. The runner asks the executor for the choices when it starts and tells the server, and it can change and pass them in a continued channel session too (ADR-0020)
- **Merge run**: for a pair with a guessed indirect conflict, it merges them in a temporary worktree and runs the check command inside a sandbox (ADR-0033, ADR-0034, ADR-0035, ADR-0036)
- The cost of running agents all comes out of the owner's subscription and usage

**Which folder the runner runs in**: you start the runner in a folder where you've downloaded the repo, and it registers that folder paired with the repo. A channel is connected to a repo, and the agent for DMs and @calls reads what's currently checked out in my folder for that repo. Stage 1 starts with one repo per workspace.

## 4. Connecting agents

- **Files are the default**: decisions are markdown in the repo, so any agent reads them as usual
- **Actions go through the CLI**: `omagari status` (see the situation), `omagari status set` (write the status line). The CLI wraps the Omagari API
- **Timing goes through hooks**: at session start or right before an edit, it shows nearby work and related decisions. The runner receives the surrounding situation ahead of time, and a hook only puts something in when it differs from what it showed last time. It doesn't call the server on every edit or put in the same alert again. Waking up an idle session uses each vendor's own way
- **API**: if it can send an HTTP request, it connects without a shell
- **MCP is optional**: a thin wrapper for chat apps that can't send authenticated HTTP requests

**Teammates who don't use Omagari**: decisions are repo files so they read them as is, opening a draft PR shares the plan, and they get conflict alerts and decision PRs on GitHub. What's missing is observing local work before a push and the agent joining a debate.

### How agents get to know each other

For agents to coordinate, they first have to know each other's situation. There's a route for each moment.

| Moment                       | Mechanism                   | What it does                                                                                                                                                         |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When a session starts        | Session-start hook          | Puts in a one-time summary of who's doing what on the team right now                                                                                                 |
| When planning                | Skill + `omagari status`    | Looks at nearby work before the plan, and declares any contract it will change. It's before any code is written, so it's the easiest to fix                          |
| Right before editing a file  | Pre-edit hook               | Puts in only what relates to that file, and only when it differs from last time                                                                                      |
| Every time the CLI is called | Piggyback on the response   | The `omagari` command's response also carries the unread inbox. It works with agents that have no hooks                                                              |
| When curious                 | `omagari impact <symbol>`   | Directly looks up who uses that symbol and who's changing it                                                                                                         |
| While working                | Push into a running session | Sends only urgent things, like a declared breaking change, right away. It uses each vendor's way, and if that doesn't work, it goes in the next hook or CLI response |
| When asking the other side   | `omagari ask`               | My agent asks the other agent. The runner on the other machine answers, and a stand-in answers if it's off                                                           |

- **Split the inbox and the feed**: only questions sent to me, conflicts with my work, and urgent alerts go to the inbox and reach the agent. The rest of the news stays in the feed and only shows when you look it up (Room's way)
- **Questions first, debate second**: if a conflict is suspected, the agent asks the other side first. If one question settles it, that's the end, and if it doesn't, it asks for a debate with an agenda and evidence attached
- The hook names are Claude Code's. Codex can also put text in with session-start (SessionStart) and pre-edit (PreToolUse) hooks, and hooks only run once you trust them in `/hooks` ([Codex hooks](https://learn.chatgpt.com/docs/hooks)). Codex's pre-edit hook hangs on `apply_patch` and looks at nearby work for each file a patch changes (#16, ADR-0016)
- **Routes in stage 1**: session-start hook, pre-edit hook, and `omagari status` (seeing the situation and writing the status line). The rest (declaring contracts, piggybacking on responses, `omagari impact`, pushing, `omagari ask`) go into stage 2 along with claims, the inbox, and definition lines

**Claim**: when an agent starts work, it declares "I'm doing this here" with `omagari claim`, and lets go with `omagari release` when it's done. The unit and the line number shifting are exactly Room's way (ADR-0008).

- The unit is a symbol, a line range, or a folder. A newly made file claims the whole file
- Someone else's claim is shown shifted to the line numbers of my copy. If we can't read their content, we use their numbers as they are and mark it "approximate"
- You set one even when nobody's nearby. That's so someone who arrives later, and people who use that contract, see it before the code changes (Room only sets one when someone's nearby)
- It doesn't lock. It only informs and doesn't stop anyone else from editing. It doesn't reject overlapping claims either
- A contract you'll change is declared attached to the claim. It goes straight into the inbox of whoever uses that contract
- When claims overlap, it goes into both inboxes, and the pre-edit hook shows it
- A claim from someone whose machine is off is marked as old
- The status line is a description a person reads, and a claim is the range detection uses. The draft PR's plan stands in for teammates who don't use claims

## 5. Seeing the current situation

This is what CSCW research calls workspace awareness. It shares in-progress changes so you notice conflicts before a commit.

- **Observation (automatic)**: the runner looks at the branch and the in-progress diff. By default it sends the content of changed files too. The share levels that send less content are in section 11
- **Declaration (draft PR)**: when starting work, you write the scope and the contract you'll change in the draft PR. The plan stays on GitHub and Omagari only reads it. An agent looks at one skill and writes the plan of any workflow in a short format
- **Showing it**: to people as a status line, to agents through the pre-edit hook. When one person runs several works, each work (branch) shows one line

**The agent writes the status line**: the server only writes rules, so all it can make is "editing payment.ts and 3 others". Only the agent doing the job knows what it's doing. So a skill tells the agent to write a line with `omagari status set "..."` (read with `omagari status`). If nothing's written, we show the draft PR title or the file being edited instead.

- **When to write**: when starting work, when direction changes, when finishing. When finishing, write "끝: <summary>" (the CLI and skill still use the Korean prefix)
- **What it shows**: picked in this order. Offline → the line the agent wrote → draft PR title → the file being edited → no line if nothing changed
- **When it was written**: a note like "2 hours ago" goes next to the line the agent wrote
- **When to clear it**: when that branch is merged, or when observed changes drop to 0 after being there, the line the agent wrote is cleared (ADR-0010)
  The pre-edit hook goes the other way, telling my agent about someone else's status.

## 6. Conflict detection

Coordination theory sees coordination as "managing dependencies between activities" and splits dependencies into types. We organize what we detect by those types. All of it is calculated without a model, and none of it blocks work.

| Dependency type   | Conflict                                                                 | How we detect it                                                                                                                                                                                                              | What happens                         |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Shared resource   | Direct conflict: the same spot in the same file is changed               | Two works changed the same file, and 3-way merging the two versions from the base commit makes lines clash (same as Room). If we can't read the other side's content, we only mark it "may clash"                             | Shown in the status line             |
| Producer-consumer | Indirect conflict (guessed): someone else uses a definition that changed | We find the symbol whose definition line changed by name in the symbol index the runner builds with tree-sitter (same as Room. Same names can link wrongly). If there's an API spec, we use an existing compatibility checker | Alert only, to the people who use it |
| Producer-consumer | **Indirect conflict (confirmed)**: breaks when merged                    | Merge the two people's work ahead of time and run build and tests. If there are contract tests, run those                                                                                                                     | **Debate opens automatically**       |
| Producer-consumer | **Declared breaking change**                                             | Someone else's work uses a contract change written in the draft PR plan                                                                                                                                                       | **Debate opens automatically**       |
| Task-subtask      | Duplicate work: two people build the same thing                          | A new definition with the same name shows up on different branches, or draft PR scopes overlap                                                                                                                                | Alert only, to both sides            |

- **Split guesses from confirmations**: symbol name matching is a guess and has false positives mixed in. The only things that open a debate are confirmed ones, like a merge run result or a declaration
- **Scope of the merge run**: we don't run every pair, only pairs with a guessed indirect conflict, and it runs on its own once both works go quiet (ADR-0036). It merges unpushed work too. The runner that calculated the guess, in a temporary worktree, lays the other side's changed files from the server on top of the base commit, merges them with its own local work, and runs the check command (same as Room's merge preview). The check command is read from a file committed to the repo (ADR-0034) and only runs inside a sandbox (ADR-0033). It counts as confirmed when only the merged version breaks (ADR-0035). If the other side's share level isn't full, or a file was left out of observation, that part can't be merged, and the verdict marks the missing files. Pushed work is in the observation too, so it merges the same way
- **We measure precision**: we record how many of the automatically opened debates were a real problem. If it's low, we narrow the conditions for opening one

## 7. Debate posts

A model-free engine runs the process, and the owner agents of the clashing works (each on their own machine) do the judging.

Research on multi-agent debate says agreement between agents is weak evidence of a right answer, because they tend to go along with each other and agree early. A debate helps when the debaters have different information, the evidence is verified, and the verdict comes from outside the debate.

- **Different contexts**: each agent speaks for its own owner's work and conversation context. It doesn't summarize someone else's stance for them
- **Blind first round**: we hide everyone's statements from each other until all the first stances are in
- **Marking evidence**: references like a commit, file:line, a decision record, or a test run are marked "verified", free-form text is "unverified", and a reference that doesn't exist is "doesn't exist"
- **Order of ending**
  1. **Experiment**: if tests can decide it, run them on an experiment branch and end with that result
  2. **Verified evidence**: if verified evidence is only on one side, propose that side as the conclusion
  3. **A person**: if neither works, or it's a matter of taste or priority, a person picks. When picking, we cover who owns each stance, and reveal it after they pick. Covering is Discord spoiler style: it's only hidden from a glance, and anyone who wants to look can press to see (2026-11-17 @Pancheble: "Not so they can never see it. If you want to look you can, it's just out of sight, like a Discord spoiler")
- **The result is a proposal**: a debate's conclusion becomes a "proposed decision" and goes through the flow in section 8
- **When the owner is offline** (ADR-0040): the default is to wait. The side that's there posts its first stance hidden, and the server API's slot carries "no runner" (`away`). When the runner connects, it sends a request to join and continues, and if it isn't done within 14 days, it ends as "expired". Any member of the post can call a stand-in into a waiting slot at any time (`api.proxyDebate`). A stand-in is started by the caller's runner, with the caller's executor and usage, and it speaks only from what it sees: the absent person's draft PR, the observation uploaded to the server at the share level, and decisions (the absent person's work session conversation is on their machine, so it can't see it). If the caller's runner is off, it refuses. The stance is marked "stand-in" with the caller. When the absent person's runner connects, a real agent takes over from the next round, and changing a stand-in's stance takes a reason. A decision that a stand-in was part of isn't merged even after the window closes, until the absent person confirms (agrees)
- **Auto-join switch**: joining a debate uses each owner's usage. Each person can turn it off and on at any time
- **Scope of experiments**: a debate instance only reads the owner's work tree, and experiments only write on an experiment branch in a separate worktree
- The same engine also does **grilling between agents**

**How context carries over**: a debate session forks the most recent session the owner used on that branch. If that doesn't work, it joins with only the draft PR's plan, the diff, and related decisions, and carries a mark saying it joined without context.

**Two ways a debate opens**: the server detects a confirmed conflict and opens it, or an agent asks for one with an agenda and evidence for a problem that a question didn't settle. A request with no agenda or evidence is only marked and doesn't open.

**Safeguards against agreeing too early**

- **Changing a stance takes a reason**: a stance that changes with no reason gets marked. "The other side said it strongly" isn't a reason, and new evidence is
- **Objections get a severity**: if a conclusion comes out with a critical objection unresolved, that objection is shown along with the proposed decision

## 8. Decisions

Decision records follow ADR practice as it is.

| Status     | Meaning                                                             | Next                                                                  |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Proposed   | A conclusion from a debate or conversation. The decision PR is open | No objection → Accepted, objection → debate again                     |
| Accepted   | The decision PR is merged and it's in the repo                      | A new decision replaces it → Superseded, no longer applies → Rejected |
| Superseded | A new decision overturned it                                        | It stays as a link pointing to the new decision                       |
| Rejected   | What it was about is gone                                           | It stays as a record                                                  |

- **Format**: context, decision, consequences, plus the deciders (the people involved) and the source (the debate link). An accepted decision isn't edited, it's replaced by a new decision
- **Objection window = decision PR**: a proposed decision goes up as a PR to the repo's `docs/decisions/`. If nobody objects until the window closes, Omagari merges it. Stage 2 opens and merges it under the name of the member who wrapped it up (ADR-0025). You raise an objection in the PR comments or in the space
- **Length of the window**: hard-to-undo things (decisions from a breaking contract change) default to one day, and easy-to-undo things (conventions, naming rules) merge right away. The team can adjust it
- **Follow GitHub's rules**: if the team set required reviews, it waits for a person's approval by that rule. Omagari doesn't ask for exceptions
- **Scope**: the default is a team decision. If it touches another team's area, it's a joint decision of the teams involved

## 9. What we keep

All we keep is decisions. Decisions go into `docs/decisions/` on the base branch as in section 8, and AGENTS.md points to that folder so any agent reads it.

**We don't build a fact memory**

- Facts you can check in code don't need to be stored. If you ask with a DM or an @call, the agent reads the latest repo and answers. It's more accurate than a stored memory
- Context that isn't in the code (outside constraints, an attempt that failed before) is kept as a decision record
- The memory each agent has (Claude Code's memory, Copilot Memory, etc.) is left alone and we don't touch it

## 10. Stick the pieces together

| Piece                           | What we use first                                                                  | What Omagari builds                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Observing the current situation | Refer to Room's way (it's a noncommercial license, so we don't attach it directly) | Runner                                                          |
| Merge run                       | The team's existing tests (check command), sandbox tools                           | The connection that runs two works merged                       |
| Contract compatibility          | Existing compatibility checkers, consumer-driven contract tests                    | The connection that reads the result and turns it into an alert |
| Decision format                 | ADR                                                                                | The bot that makes decision PRs                                 |
| Fact memory                     | Leave each agent's memory as it is                                                 | We don't build it                                               |
| Workflow                        | Each person's own (Superpowers, gstack, Matt Pocock's skills, etc.)                | One skill that writes the plan in the draft PR                  |
| **Space**                       | -                                                                                  | **The whole web app**                                           |
| **Debate**                      | -                                                                                  | **A rule-based engine that runs the process**                   |

## 11. Security and what's shared

- **Share level**: the owner picks, for each runner, how much observation uploads to the server (Room's three levels, ADR-0007). We say clearly what leaves when you connect

  | Level          | What goes up to the server                                        |
  | -------------- | ----------------------------------------------------------------- |
  | full (default) | The whole content of changed files                                |
  | declared       | The paths of all changed files, content only inside claimed paths |
  | intent         | Only the status line, claims, and plan. No file content           |

- **Always left out**: gitignored files, and `.env` and `.env.*` even if tracked (`.env.example` stays). Binaries and files over the size limit send only the path
- **The server holds code**: members of a channel are collaborators on the same repo, so they see each other's in-progress code. If the server gets broken into, that code leaks, so only collaborators on that repo join the workspace
- **Decision record poisoning**: every agent reads decision records, so once one is poisoned it spreads. So decisions go through a PR, carry a source (the debate link), and get passed to agents wrapped as data, not instructions
- **Agent permissions**: running happens inside each owner agent's permission settings

**Runner safeguards**: the runner starts agents on the owner's machine from messages the server sends. If the server is broken into, agents could run on every teammate's machine, so we keep to the following.

- Sessions the runner starts are read-only by default. It writes only inside an experiment worktree
- The runner only takes set kinds of requests (DMs, debate turns), and doesn't take arbitrary commands. It doesn't take merge runs as requests either, the runner decides them itself (ADR-0033)
- Other people's statements and the channel conversation go in wrapped as data, not instructions
- The owner can see on their machine what the runner ran, as a record
- Merge-running unpushed work means running code from the server on the owner's machine. Pushed branches come from GitHub, but this code goes through the server, so if the server is broken into, running tests turns into running arbitrary code. So merge runs only run inside a sandbox (ADR-0033)

**Real sandbox hand check results** (`test/real-sandbox.ts`, how to run it is in `docs/sandbox-check.md`). 2026-11-14, the #138 session ran it with the runner's `checkWork` and the real `osSandbox` on the owner's machine (macOS, darwin arm64, Node 24.19.0, `@anthropic-ai/sandbox-runtime` 0.0.81). We couldn't run Linux (this machine is macOS only)

- [x] Tools: `checkDependenciesAsync` passed without ripgrep. 0.0.81 doesn't need ripgrep on macOS (same as PR #141 said)
- [x] Outside network is blocked (both https and http. We first confirmed it's reachable outside the sandbox)
- [x] Can't write outside the temporary worktree (home folder, repo folder, check folder). It can write inside the temporary worktree and `HOME`
- [x] Can't read the home folder (including `~/.ssh`)
- [x] It opens and connects to ports on its own machine (127.0.0.1). It also connects to a 127.0.0.1 server running outside the sandbox
- [x] Environment variables holding tokens (`GITHUB_TOKEN` etc.) don't come through
- [x] Even with Node under the home folder (we copied Node to `~/.omagari-check-node/bin/node` and ran with that. We didn't install nvm itself), the check command runs and the items above stay the same
- [x] It reads dependencies. **Writing inside** `node_modules/.cache` or a linked package folder **is blocked** (`Operation not permitted`). Making a new folder under `node_modules` works. A tool that writes its cache to `node_modules/.cache` fails there
- [x] What #142 left, 1: `git add`, `write-tree`, `commit`, and `status` inside the temporary worktree work (writing the index is fine)
- [x] What #142 left, 2: it reads the temporary worktree under home and the repo's `objects` (`git log`, `cat-file`). It can't read the `config` (remote URL) in the repo's Git folder
- [ ] What #142 left, 3: this repo's `npm test` inside the sandbox **fails 147 of 148** (1 passes). All of them are Unix socket `listen EPERM` → #145
  - After the fix (2026-11-15, #145 session, same machine and build, ADR-0037): it opens and connects to Unix sockets inside the temporary worktree and temporary folder. It can't connect to a socket in `/tmp` opened outside the sandbox, or to a link pointing at it. With `TMPDIR` still at `/tmp/claude`, it's still 152 of 153 with `EPERM` (#146). In the experiment with `TMPDIR` put back, 152 of 153 passed, and the remaining one (`merge-run.test.ts`) was cut off at the 30-second limit (load average about 29)
- [ ] sandbox-runtime overrides `TMPDIR` to `/tmp/claude` → #146
- [ ] When the runner's current folder isn't a repo, it could write to the temporary worktree's `.git/config`, and the `git` the runner calls outside the sandbox ran a command through `core.fsmonitor` (reproduced with a harmless `touch`). Started from the repo folder, writing `.git/config` and `.git/hooks` is blocked → #144
  - After the fix (2026-11-14, #144 session, same machine and build, `--quick`): whether the runner's current folder is a repo or not, it "didn't run". The runner calls git on the temporary worktree with its own Git folder, which the sandbox can't write (ADR-0033). The git inside the sandbox uses a copy made fresh for each run, so `.git/config`, `.git/hooks`, and `.git/HEAD` are now writable even when started from the repo folder, and `add` and `commit` still work
- Not seen: real nvm, Jest's watch tool (`--no-watchman`). Linux and WSL2 are in the block below

**Linux and WSL2 hand check results** (`test/real-sandbox.ts`, the GitHub Actions button `real-sandbox.yml`, run [43781176425](https://github.com/Pancheble/omagari/actions/runs/43781176425)). 2026-11-16, the #166 session pressed it on the `docs/real-sandbox-results` branch (a build with two added lines that put results in the log. The first run on `dev` the same day, 43780358075, had the same results). The tool is `@anthropic-ai/sandbox-runtime` 0.0.81 on all of them, Node 24 (the 24.x that setup-node picked), and ripgrep is the apt build.

| Machine         | Image                                                                                             | bubblewrap       | ripgrep | Result                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------- | ---------------- | ------- | ------------------------------------------------------------------------ |
| ubuntu-24.04    | `ubuntu-24.04` 20261111.127.1 (ran with the user namespace restriction lifted)                    | 0.9.0-1ubuntu0.3 | 14.1.0  | Tools pass, `npm test` runs (154 failed), the rest can't run the command |
| ubuntu-22.04    | `ubuntu-22.04` 20261111.360.2                                                                     | 0.6.1-1ubuntu0.3 | 13.0.0  | Tools pass, `npm test` runs (154 failed), the rest can't run the command |
| WSL2 on Windows | WSL2 Ubuntu 24.04 on `windows-2025-vs2026` 20261103.298.1 (user is root, repo at `/root/omagari`) | 0.9.0-1ubuntu0.3 | 14.1.0  | Tools pass, `npm test` runs (154 failed), the rest can't run the command |

- [x] WSL2 turns on on GitHub's Windows machine. We installed Ubuntu 24.04 with `Vampire/setup-wsl@v7.2.0` and ran apt, Node 24, `npm ci`, and the check through `wsl.exe` (the check takes about 7 minutes)
- [x] Tools: `checkDependenciesAsync` passed on all three machines (ripgrep path `/usr/bin/rg`)
- [ ] Apart from `npm test`, the other items **all failed with the same error** on all three machines: `bash: line 21: …/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/x64/apply-seccomp: No such file or directory`. The helper file is on the host (we confirmed a static ELF with `npm ci` on macOS). It seems that path isn't visible inside the sandbox. It may be hidden by the home-read block, because `node_modules` is under the home folder (`/home/runner/...`, `/root/...`). The only evidence was the difference from the `npm test` item below → fixed in #174 and confirmed in the "After fixing #174" block below
  - The items that failed with this error are blocking the outside network, blocking and allowing writes, blocking home reads, ports on its own machine, five Unix socket items, environment variables, Node, reading dependencies, git inside the temporary worktree, reading `objects` and `config`, and leftover processes (#150). The command couldn't run, so these failures don't tell us whether the blocking works. For the same reason, "blocked" on the "(observation)" lines means nothing
  - **`npm test` did run** (on all three machines, and the experiment line with TMPDIR put back had the same numbers): `tests 160`, `pass 5`, `fail 154`, `310 EPERM`, verdict broken (Ubuntu 24.04 11 seconds, 22.04 18 seconds, WSL2 238 seconds). If it couldn't find `apply-seccomp`, 160 tests couldn't run, so this item differs from the error above. It looks like `EPERM` from Linux blocking Unix sockets, and it looks like #145 on macOS, but this log alone can't confirm that the `EPERM` is really because of sockets (we also didn't look at whether the fix in ADR-0037 and #172 is in this run)
  - Possible reason for the difference (a guess): only this item runs `checkWork({ folder: top })`, on this repo's own folder that holds `node_modules` (and `apply-seccomp` inside it). The other items run a different repo, `.omagari-sandbox-check-*/repo` under home, and there this repo's `node_modules` under home may get hidden. The real runner also calls a sandbox-runtime installed somewhere other than the user's repo, so the same thing could happen in real use
  - WSL2's block on reading the Windows drive (#164) came out as a failure for the same reason. We've never properly seen this item yet
  - Whether a command runs outside the sandbox through `fsmonitor` (an escape) came out as "didn't run", but a command inside the sandbox couldn't run, so this result can't be trusted either
  - It ran on Ubuntu 24.04 with `kernel.apparmor_restrict_unprivileged_userns=0` set. We didn't look at how it behaves without lifting it
- Not seen: all the blocks above (on Linux and WSL2), the kernel version, why `npm test` gets `EPERM`, the result of the socket block in ADR-0037. We saw some of it in the blocks below

**After fixing #174** (the same check, run [43787046653](https://github.com/Pancheble/omagari/actions/runs/43787046653), 2026-11-16, branch `claude/fix-seccomp-helper-path-372177`, sandbox-runtime 0.0.81). The three machines' images and tool versions are the same as the table above.

- Reason: `apply-seccomp` is called **inside** the sandbox (`buildSandboxCommand` in `linux-sandbox-utils.js` puts `applySeccompPrefix` on the first line of the shell inside bubblewrap). The path is `vendor/seccomp/<arch>` inside the sandbox-runtime package, which is the `node_modules` the runner was installed into and may be under the home folder. The runner's read block (`denyRead: [home]`) hid that folder. This repo's `npm test` item is a temporary worktree where the folder holding `node_modules` is itself readable, so the helper was visible.
- Fix: the runner puts the helper folder (`vendor/seccomp/<arch>`) in the allow-read list (`seccompHelper` in `packages/runner/src/check.ts`). We didn't `ls` the helper folder directly inside the sandbox. The evidence is that after the fix, the same run's log has 0 `apply-seccomp` errors and the items run.
- Result (same on the three machines): these **passed**: outside network blocked, writing inside the worktree, `HOME` writes, ports on its own machine, outside Unix sockets, links, and Docker sockets blocked, environment variable filtering, Node, reading dependencies, git inside the temporary worktree, `objects` readable and the Git folder's `config` not readable, and leftover processes (#150). The `fsmonitor` observation is "didn't run".
- Remaining failures (same on the three machines, we split them off as problems different from this issue):
  - Can't write outside the temporary worktree, can't read the home folder (and the Windows drive on WSL2): the command didn't end with 0. No line shows a file really being made outside. It looks like the check command's expectation differs from bubblewrap, but we **didn't confirm** it → #176
  - Opening and connecting to Unix sockets inside the worktree and temporary folder: `EPERM` (matches ADR-0037, that Linux blocks all sockets). This repo's `npm test` still has verdict broken (11 seconds, 18 seconds, about 3 minutes). We haven't read the reason yet → #177
- Not seen: whether the home-read block and write block really work on Linux (#176 above), whether tests that use sockets can run on Linux (#177), the kernel version, without lifting `kernel.apparmor_restrict_unprivileged_userns`, hiding the WSL2 drives. We didn't bump sandbox-runtime to 0.0.83 (comparing the installed 0.0.81 and 0.0.83 packages showed lots of changed files, but we couldn't confirm it addresses this problem, and the fix is on the runner's side, so we don't bump it without a reason)

**After fitting the #176 home-block check's expectations to Linux** (the same check, run [43790979921](https://github.com/Pancheble/omagari/actions/runs/43790979921), 2026-11-16, branch `fix/linux-home-probe`, sandbox-runtime 0.0.81). The three machines' images and tool versions are the same as the table above.

- What it hid: the block **was working**, and the check command's expectation differed from Linux. This is the result of running commands one at a time inside the sandbox (run 43790149734, same on the three machines):
  - `ls -A home`: exit code 0. It lists only the names of the places that were opened again (the check folder, and the tool folder inside it), not home's real contents. That's because home is covered with an empty `tmpfs` and only the reopened folders hang on top of it (we saw the mounted places in `/proc/self/mountinfo`).
  - `cat home/.../canary/secret.txt`: `No such file or directory`, exit code 1.
  - Writing and reading back under home: both write and read exit with 0 (it writes to `tmpfs`). In the same run, that file was **not made** outside the sandbox.
- So the expectations of `! ls home`, `! (echo x > under home)`, and `! ls /mnt/c` were wrong on Linux. The fix: reading home checks that the canaries (directly under home and inside the check folder) can't be read and that `ls -A home` doesn't have the canary name, writing checks whether a file really got made outside, and the WSL2 drive checks that `ls -A` is an error or empty. On macOS the expectation stays as it was (must fail with `!`).
- Result (all of Ubuntu 24.04, 22.04, and WSL2): these **passed**: can't write outside the temporary worktree (no file made outside), can't read the home folder, WSL2's `/mnt/c` and `/mnt/d` are an error or empty, and can't read the Git folder's `config`.
- Not seen: real secret folders like `~/.ssh` in home (none of the three machines had `~/.ssh`, we only looked with canaries), whether `ls home` tells you the names of the reopened folders (only the names show and the inside doesn't open. We think it doesn't break the block but didn't test it separately), what it looks like when there are real files inside `/mnt/c` (on GitHub's machines we couldn't confirm that both `C:` and `D:` are empty. The log only says "an error or empty"), on macOS, we ran the same check on this Mac with `--quick` and the fixed items (writing, whether the written file shows up outside, reading home including `~/.ssh`) passed (we didn't run the `npm test` item), and Unix sockets and the `npm test` failures (#177) are outside this issue.

**After hiding the #177 socket items** (the same check, run [43793894717](https://github.com/Pancheble/omagari/actions/runs/43793894717), 2026-11-16, branch `test/linux-socket-expect`, sandbox-runtime 0.0.81). The three machines' images and tool versions are the same as the table above.

- What it hid, 1: `allowUnixSockets` is **ignored** on Linux. The source (`wrapCommandWithSandboxLinux` in `linux-sandbox-utils.js`) splits sockets only by `allowAllUnixSockets` and puts the seccomp helper on or leaves it off, and the comment says "The allowUnixSockets configuration is not path-based on Linux". And in practice, we gave the allow list as in ADR-0037, but `listen` inside the temporary worktree and `HOME` was `EPERM` on all three machines.
- What it hid, 2: the `EPERM` in `npm test`: all three machines show `tests 160, pass 5, fail 154`, and 310 lines of `EPERM` (in run [43793288849](https://github.com/Pancheble/omagari/actions/runs/43793288849), which added diagnostic lines, Ubuntu 24.04 took 10 seconds, 22.04 took 11 seconds, WSL2 took 116 seconds). Counted by call, it's 157 lines of `listen EPERM`, and the other `EPERM` lines are `code: 'EPERM'` lines that print the same error again. There's no `EPERM` from `connect` or any other call. So **all of it is creating sockets (`listen`) being blocked.** There's no `EPERM` that isn't about sockets, so we didn't make a new issue. But we didn't pull the path out of the lines to see whether the target of `listen` is a Unix socket, and we inferred that TCP `listen` opens from the check item ("ports on its own machine") passing.
- The verdict now carries on `broken` "On this machine (Linux) the sandbox blocks Unix sockets. … we can't tell whether it broke from merging" (#172). This repo's check command, which uses sockets, is `cannot tell` on Linux.
- Fix: the check's two socket items expect "blocked with `EPERM`" on Linux. The macOS expectation stays as it was. #167 handles sockets opening on Linux.
- Result (same on the three machines): the two socket items **passed** as "blocked". Outside sockets, links, and the Docker socket being blocked also passed (WSL2 has no Docker socket). The only failures left are the two `npm test` items (Ubuntu 24.04 10 seconds, 22.04 19 seconds, WSL2 151 seconds), and the verdict `broken` carries the Linux reason above. This item can't pass on Linux, so we leave the check as it is (until #167, `cannot tell` is the right result)
- Not seen: whether sockets open on the build of sandbox-runtime PR #797 (#167), whether all 157 `listen` calls in `npm test` are Unix socket paths.

## 12. Verification and metrics

- **Do people stay**: weekly active people, agent DM use, the share of alerts where a conversation started
- **Frequency**: indirect conflicts and duplicate work per week
- **Precision**: how many of the automatically opened debates were a real problem
- **Against a baseline**: compare outcomes for the same conflict when we only send the two people an alert versus when we open a debate
- **Does coordination really happen**: among pairs of people who needed to coordinate because of a code dependency, the share who actually talked in the space (socio-technical congruence)
- **Do people read decisions**: how often the decision inbox is opened, the share that got objections
- **Outcomes**: merges broken by contracts and decisions reversed, before and after adoption

## 13. Open items

- [ ] The draft PR plan format (how to write the scope and the contract to change)
- [x] When the agent updates the status line → when it starts, when direction changes, when it finishes (section 5, ADR-0010)
- [x] Where to run merge runs (GitHub Actions, runner) → runner (ADR-0033)
- [x] Safeguards for merge-running pre-push code from the server on the runner → only run inside a sandbox (ADR-0033)
- [x] The name and shape of the config file that holds the check command → `.omagari.json` at the repo's top level, `{"check": "<check command>", "setup": "<setup command>"}` (ADR-0034)
- [ ] Whether to sign observations so the server can't swap the content (ADR-0033)
- [x] Whether the server or the runner calculates the 3-way merge for direct conflicts → the runner. Each runner calculates from its own work, and the server bundles it per pair and tells them (ADR-0023)
- [x] The range of records a stand-in can see (whether to include pre-push work content uploaded to the server) → include it. The draft PR, the observation content uploaded to the server at the share level, and decisions (ADR-0040)
- [x] The default length of the objection window → one day. The person who wraps it up picks "right away" or "one day" (ADR-0025)
- [x] The default of the auto debate-join switch (on or off) → on. It's used together with the consent switch for asking (ADR-0024)
- [x] Where to run the server (one shared server, or each team on their own) → stage 1 is one server we run. We'll build the bundle for teams to run on their own when another team says they'll use it (ADR-0012). The stage 5 dogfood server is Fly.io (ADR-0042)
- [ ] The standing of members without push permission. Right now only accounts with push permission join (ADR-0011). In stage 5, we decided to split it into viewing (Read permission only) and contributing (outside contributors) and decide after dogfooding. Read permission on a public repo is the whole world, so it comes together with the open source question (ADR-0043)
- [x] How the receiving side consents to the cost of `omagari ask` (stage 2) → a switch on the receiving side, default on (ADR-0024)
- [ ] Which repo a decision that spans several repos goes in. The direction is the home repo the workspace picks (like the source repo of a GitHub organization's discussions, ADR-0043). We'll build it after dogfooding with two or more repos
- [ ] What to show when a related code PR merges before the decision is made

* [ ] A draft PR can only be opened with a commit. What to commit first when starting work
* [x] Whether forking a work session read-only (what debates use) also works on Codex. In the 2026-11-17 hand check (#203, codex-cli 0.167.1), the context came in with `codex exec fork`, the original session stayed as it was, and read-only held (section 1). We wired it into the runner (#232)
* [ ] A hand check of how a debate finds the owner's work session. The runner (#195) assumes Claude Code's session records are at `<config folder>/projects/<the work folder's name with non-letters replaced by ->/<session id>.jsonl` with `gitBranch` on every line, and forks the most recent one that isn't a runner-started session with `--resume <id> --fork-session`. We couldn't confirm this path and shape from the docs. Codex finds it by `cwd` and `git.branch` on the first line of the session record and forks it with `codex exec fork` (section 1, #232). We couldn't confirm that shape from the docs either

- [x] Whether the runner can run on Codex with a subscription login (confirmed for Claude Code). In the 2026-11-11 hand check, `codex exec` ran on the saved ChatGPT login, and session continuation and read-only worked (section 1, "Real executor hand check results"). Wiring it into the runner is #16
- [ ] Whether auto-compact happens when a Codex session without a screen gets long, and what's left if it does. We confirmed Claude Code (section 1). We'll look at Codex with `node test/real-executors.ts codex` (including the long session)
- [x] How much channel conversation to pass to a DM session → only messages since the last turn, and up to the latest 50 on the first turn (section 3)
- [ ] Whether to let a DM ask about the context of my own work session. We leave it out of stage 1 (forking a running session hasn't been confirmed)

## Sources

- [Crystal: Proactive Detection of Collaboration Conflicts](https://homes.cs.washington.edu/~mernst/pubs/vc-conflicts-fse2011.pdf)
- [Palantír: Awareness of indirect conflicts](https://www.ase-conferences.org/olbib/p94-sarma.pdf)
- [Gutwin & Greenberg, Workspace Awareness](https://dl.eusset.eu/handle/20.500.12015/3612)
- [Malone & Crowston, The Interdisciplinary Study of Coordination](https://crowston.syr.edu/node/54)
- [Cataldo & Herbsleb, Coordination Breakdowns](https://par.nsf.gov/servlets/purl/10038372)
- [ADR status](https://faq.arc42.org/questions/C-9-3/)
- [Debate or Vote](https://neurips.cc/virtual/2025/poster/116557)
- [Khan et al., Debating with More Persuasive LLMs](https://arxiv.org/pdf/2402.06782)
- [GitHub Copilot agentic memory](https://github.blog/2026-01-09-building-an-agentic-memory-system-for-github-copilot)
- [Evaluating AGENTS.md](https://iclr.cc/virtual/2026/10021142)
- [Memory Poisoning Attack and Defense](https://arxiv.org/html/2601.05504v1)
- [Consumer-driven contract tests](https://oneuptime.com/blog/post/2026-08-24-consumer-driven-contract-breaking-changes/view)
- [Room](https://github.com/rohanz/room)
