# Omagari

A web collaboration space where people and each person's AI agents work together. You can see who is doing what. When work collides, you settle it right there in conversation. What gets decided stays in the repo.

The Korean name is in parentheses after each English term. The English UI and English docs use the English name.

## People and agents

**Owner** (주인):
A person who has an agent. The agent runs on the owner's machine, using the owner's subscription and usage.
_Avoid_: user, owner account

**Agent** (에이전트):
A member shown in the sidebar next to its owner. An agent is a pair of an owner and an executor, so one person with several executors has several agents (ADR-0015). Many agent sessions run behind each agent.
_Avoid_: bot, assistant

**Executor** (실행기):
The tool that actually runs agent sessions. Right now that is Claude Code and Codex.
_Avoid_: vendor, model

**Agent session** (에이전트 세션):
One conversation in which an agent actually runs. There are work sessions and runner sessions.
_Avoid_: thread, conversation (on its own)

**Work session** (작업 세션):
An agent session the owner starts directly to change code. Omagari feeds it context through hooks but never talks to this session on its own.

**Runner session** (러너 세션):
A read-only agent session that the runner starts without a screen to answer questions.
_Avoid_: fork (a fork is only one way to make a runner session)

**Channel session** (채널 세션):
A runner session kept going for each channel and each agent. The DMs and @calls one agent gets in that channel share it.

**Runner** (러너):
The Omagari program that runs on the owner's machine. It is paired with one work folder, watches it, and starts runner sessions on that machine with the executors it has.
_Avoid_: daemon, agent

**Offline** (오프라인):
The state where an agent's runner is not connected to the server. The agent can't answer then. This is different from a person's status of "offline".

**Presence** (접속 상태):
Whether a person is in right now, and the status they pick. It is one of online, away, do not disturb, or offline. A person who is not in, or who picks "appear offline", is offline. Away, do not disturb, and appear offline can be set for a set time.
_Avoid_: status (on its own)

**Status message** (상태 메시지):
One line the person writes. It can contain emoji and shows on the profile and in the member list. It is different from the status line the agent writes for each work.
_Avoid_: status (on its own), custom status

**Profile** (프로필):
Everything about one person, gathered in one place. Clicking a person opens a small profile card. The full view opens in the right-hand pane from there. It shows photo, name, GitHub login, presence, status message, and that person's work and agents. It is different from the profile panel at the bottom left, where you change your own.

**Reaction** (반응):
An emoji added to a message. Each message groups the people who added each emoji. Pressing the same reaction again adds or removes it.
_Avoid_: like

## Current situation

**Work** (작업):
One person's ongoing work on one branch. It is the unit for the status line and for observation.
_Avoid_: task, session

**Awareness** (상황):
The overall picture of who is doing what in the team. It corresponds to workspace awareness in CSCW.
_Avoid_: status (on its own)

**Status line** (상태 한 줄):
The one-line "doing ~" shown next to a person's name, for each work.
_Avoid_: status (on its own), status message, awareness

**Observation** (관측):
The runner reads from the work folder's Git state which files the work changed and what they contain, and sends that to the server. It never writes someone else's changes into your folder.
_Avoid_: sync, surveillance

**Share level** (공유 수준):
How much an observation sends to the server. It is one of full (the full content of changed files), declared (all paths, content only for claimed paths), or intent (only the status line and claims).
_Avoid_: visibility (visibility is a word for Q&A)

**Base commit** (기준 커밋):
The commit an observation compares a work's changes against. It is where that branch split from the default branch.
_Avoid_: base (on its own)

**Definition line** (정의 줄):
The line that declares a named symbol (function, method, class, type).
_Avoid_: signature (a signature is part of a definition line)

**Nearby work** (근처 작업):
Other work that changes a file I am about to edit. My other branches' work counts as nearby work too.
_Avoid_: neighbor, surrounding work

**Claim** (선점):
A mark an agent puts on a symbol, line range, or folder that says "I'm doing this here." It only informs others. It blocks nothing.
_Avoid_: lock, reservation

**Contract** (계약):
The public interface other people's code depends on. For example, a function signature or an API spec.
_Avoid_: interface (on its own), spec

## Routes to the agent

**Session-start hook** (세션 시작 훅):
A hook that gives a work session the current situation once, when it starts.

**Pre-edit hook** (편집 전 훅):
A hook that gives a work session the nearby work for a file just before it edits that file. It only gives the context when it changed since last time.
_Avoid_: edit hook, pre hook

**Inbox** (편지함):
Each work has one. It holds news sent directly to that work's agent. Only things that involve you come in: a collision with your work, a change to a contract you use, or the answer to a question you asked.
_Avoid_: notification box

**Feed** (피드):
The rest of the news, which you see only when you look it up.
_Avoid_: timeline, log

**Ask** (묻기):
A question your agent sends to another member's agent. The receiving runner session answers, and the answer arrives in the asking work's inbox. The receiving owner can refuse to take questions, and then you can't ask.
_Avoid_: Q&A (Q&A is between you and your own agent), DM

## Spaces

**Workspace** (워크스페이스):
The outermost unit that the people using Omagari share. It is paired with one GitHub account (an organization or a personal account) and holds several of that account's repos. One server can hold several workspaces.

**Repo** (레포):
One room in a workspace. It is paired with one GitHub repo, and work, posts, labels, and decisions are kept per repo.
_Avoid_: space, room, project

**Member** (멤버):
A person who has joined a workspace. A member is a GitHub account with push permission on at least one of the workspace's repos.
_Avoid_: user, teammate (a teammate may include people who don't use Omagari)

**Channel** (채널):
Where people talk to each other. There are chat channels and forum channels. They sit under a repo or under a workspace.

**DM** (DM):
A Q&A inside a channel that only you and one of your agents can see. If you have several agents, you pick which one to ask. You can post a finished DM to the channel.
_Avoid_: whisper, private message

**@call** (@호출):
A Q&A in a channel with one of your agents, visible to everyone from the start. You pick one of your agents to call, and only an owner can call an agent.
_Avoid_: mention (confused with mentions between people)

**Q&A** (문답):
One question and its answer. Each Q&A has its own visibility (private or public).

**Forum channel** (포럼 채널):
A view that filters posts by importance or by label. You don't write in the forum itself. You talk inside each post. A post appears in every forum that fits it. At first there are "Discuss" and "FYI" (ADR-0039).

**Post** (포스트):
A conversation that discusses and settles one topic. Like a channel, you write messages in it and use DMs and @calls. Each alert starts as one post.
A post whose importance is Discuss is one GitHub issue. Messages in the post map to issue comments, and issue comments map to messages in the post (ADR-0032, ADR-0039).
_Avoid_: thread, topic

## Conflicts and decisions

**Conflict** (부딪힘):
Two works that don't fit together. Work by the same person can also collide. It is the umbrella term for direct conflict, indirect conflict, and duplicate work. It is different from importance (FYI, Discuss).
_Avoid_: collision (on its own)

**Direct conflict** (직접 충돌):
Two works change the same spot in the same file, so their lines clash when merged.

**Indirect conflict** (간접 충돌):
One work changes a definition that another work uses. Some are guessed from name matching, and some are confirmed by a merge run. The two are kept apart.

**Duplicate work** (중복 구현):
Two works each build the same thing separately.

**Merge run** (합쳐 돌려 보기):
Temporarily merges two works and runs the check command on the result. It shows whether a guessed indirect conflict really breaks.
_Avoid_: merge preview, virtual merge

**Check command** (검사 명령):
The team's command that a merge run executes on the merged result. It can be a test, a build, or a lint.
_Avoid_: test command

**Verdict** (판정):
The result of a merge run. It is one of pass, fail, cannot tell (one side breaks even alone), or could not run.
_Avoid_: result (on its own), status (on its own)

**Alert** (알림):
One line Omagari posts to a channel about a conflict. There is one per pair of works and per kind of conflict. It also lands in the inboxes of both works.
_Avoid_: warning, notification (the banner on screen is something else)

**Label** (라벨):
A tag on a post. It is the same as a GitHub label in the repo. Four kinds and "confirmed" exist from the start. Path rules and people add more (ADR-0039).
_Avoid_: tag

**Importance** (중요도):
A value the team sets for each label. It is either FYI (only look) or Discuss (a person reads it and talks it through to decide; this opens an issue). A post's importance is the highest importance among its labels.
_Avoid_: priority, urgency (Room's term)

**Debate** (토론):
In a post, the owner agents of two conflicting works state positions with reasons, then end with experiments, verified evidence, and finally people. It opens on its own when an evidence label (confirmed, contract change) is attached. Otherwise someone requests it (ADR-0040).
_Avoid_: meeting, argument

**Stance** (입장):
The claim and its reasons that one agent makes in a debate. In the first round, positions stay hidden until everyone has posted. A changed stance records the reason.
_Avoid_: opinion, statement (on its own)

**Experiment** (실험):
In a debate, applying the patch attached to a stance to both works and running the check command on the result. The verdict becomes that stance's verified evidence.
_Avoid_: experiment branch (never pushed)

**Decision** (결정):
One conclusion that is recorded in the repo. Its status is proposed, accepted, superseded, or rejected.

**Decision PR** (결정 PR):
A PR that puts a proposed decision into the repo. The objection window is the time this PR stays open.

**Objection window** (이의 창):
The time during which someone can object to a proposed decision. If there are no objections, it is confirmed.
_Avoid_: approval step, review period

**Objection** (이의):
A mark against a proposed decision. While any objection stands, the decision is not confirmed.
_Avoid_: rejection, veto

**Decider** (결정자):
The people who make the decision. They are the members named in the post that summarizes the decision.

**Agree** (동의):
A decider's mark in favor of a proposed decision. When all deciders agree, the objection window closes early (ADR-0029). Without anyone pressing it, the decision is confirmed when the window closes.
_Avoid_: approve (confused with a GitHub review approval)

**Stand-in** (대행):
An agent session that speaks in place of an offline owner, using only what that person left behind. Its messages are marked "stand-in". By default it waits for the owner. Any member of the post can call one in at any time, using their own usage (ADR-0040).
_Avoid_: proxy, substitute
