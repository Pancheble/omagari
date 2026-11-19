# Omagari v3: a collaboration space for people and their agents

## 1. Definition

Omagari is a **web collaboration space where people and each person's AI agents work together**. You see a teammate's agent right next to them, you see who's doing what right now, and when work collides you settle it in conversation, right where the alert showed up. What you decide stays in the repo, so the next person's agent reads it.

Conflict detection, team memory, and decision records already have tools of their own. What Omagari builds is the **space where they connect without breaking up**. For each piece, we stick with what already exists wherever we can.

## 2. Why we need it

Working in a team with agents makes code faster, but the things people need to line up pile up unaligned.

- Each agent only knows its own conversation, so conventions drift apart and the same utility gets written twice
- "Why we did it this way" lives only in one person's chat, so a teammate's agent changes it back
- When one person's agent changes a contract (a function signature, an API), a teammate who was working against the old contract breaks at the moment of the merge
- Several people's agents remember different things, and nobody resolves the contradiction

**Evidence that the problem is real**

- It's common even in human teams. A study of the history of 9 open source projects found text conflicts in 16% of merges, and one in three conflicts showed up not in the text but in the build or tests (Crystal)
- Agents can't yet line things up by themselves. When two coding agents cooperate, the success rate was 25%, about half of what one agent got doing both jobs (CooperBench)
- Several tools have appeared for the same problem: Room, mcp-git-coord, memlay, AgentHelm, GitHub Copilot Memory

## 3. Today it's all separate

| Layer                                    | What exists                                      | Where it breaks when used separately                                                                                 |
| ---------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Conversation between people              | Discord, Slack                                   | Agents are just notification bots, and you can't see who's doing what                                                |
| Current situation and conflict detection | Room, mcp-git-coord                              | A terminal or a read-only screen. The conversation after you see the alert happens somewhere else                    |
| Team memory                              | Copilot Memory (Copilot only), memlay, AgentHelm | Locked inside each tool. Omagari doesn't touch this, and only keeps what everyone needs to know as a decision record |
| Decision records                         | ADR                                              | Who writes one and when is up to a person                                                                            |
| Structured debate                        | Single-user plugins                              | Can't be used between different people's agents                                                                      |

**What sets Omagari apart isn't the pieces, it's the flow.** A conflict alert → a conversation right there → a decision → a record in the repo → the next agent reads it. That flow happens without breaking up, in one space where people and agents are seen together.

## 4. Principles

| Principle                                       | What it means                                                                                                                                   | Borrowed from                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. The space comes first                        | The center of the product is the space where people and agents stay together, not features. Features get stacked on top, in order               | -                                                                                  |
| 2. Stick the pieces together                    | We don't rebuild the detection, memory, and checking tools that already exist. What we build is the space and the connections                   | -                                                                                  |
| 3. Standardize only the output, not the process | Everyone is free to work their own way. All we set is the format of two shared outputs: the draft PR plan and the decision record               | Mintzberg's coordination mechanisms: standardize outputs instead of work processes |
| 4. An objection window instead of a gate        | There's no step where a person has to approve. Instead there's time to object, and with no objection it's confirmed                             | Lazy consensus (Apache), Ship/Show/Ask                                             |
| 5. Treat only the hard-to-undo differently      | Easy-to-undo things take effect right away. Only hard-to-undo things get an objection window                                                    | Bezos's one-way and two-way doors                                                  |
| 6. Announce guesses, call on evidence           | A conflict guessed from rules is only announced. A debate opens only when there's a result from actually merging and running                    | Crystal's virtual merge analysis                                                   |
| 7. End on evidence, not agreement               | The fact that agents agreed isn't enough to confirm anything. It ends on test results or verified evidence, and if that fails, a person picks   | Research on multi-agent debate                                                     |
| 8. Don't store facts, read them when needed     | Facts you can check in code aren't stored. With DMs and @calls, an agent reads the latest repo and answers. The only thing we keep is decisions | None                                                                               |
| 9. No AI on the server                          | The server only syncs, records, and applies rules. Judgment is up to each person's agent (at their own cost) and the people                     | -                                                                                  |
| 10. Agents speak only when called               | A channel is a conversation between people. Omagari posts the alerts                                                                            | -                                                                                  |
| 11. Enforce only when it repeats                | We flag formats but don't block them. When the same problem repeats 3 times, we turn the mechanism on                                           | An analogy borrowed from the Rule of Three, YAGNI                                  |

## 5. Who it's for and a day in the life

**Who it's for**: dev teams of 2 to 10, where everyone uses their own agent and their own workflow. It assumes several teams share one repo.

**A day in the life**

1. A works with Superpowers, B with plain Claude Code, and C with Codex. The space's sidebar shows the three people and their agents side by side
2. A opens a draft PR and writes the plan, and a one-liner "changing the payment model signature" shows up next to A. B's agent sees it through a hook before editing
3. A and B talk about how to handle payments in a channel. B checks with their own agent in a DM whether their memory is right, and posts the code evidence the agent found to the channel
4. A's change and B's work get merged ahead of time and the tests run, and B's tests break. Omagari posts to the channel: "A's and B's work breaks when merged. A debate is open"
5. In the post attached to the alert, A's and B's agents state their stances with evidence, and find a version on an experiment branch where both sides' tests pass
6. The result goes up as a decision PR. If nobody objects for a day, it's merged and becomes a decision record in the repo
7. The next day C skims what got decided in the decision inbox, and C's Codex reads the repo's decision files and works from them

## 6. The space

```
Workspace → Repo → Channel
Chat channel → Chat
Forum channel → Post → Chat
```

- **An agent next to each person**: the sidebar shows a person and their agents together. There's one agent per executor (Claude Code, Codex), so a person who uses both shows up with two (ADR-0015). An agent isn't a notification bot. It's a member with an owner
- **Status line**: a one-line "doing ~" next to the name. The owner's agent writes it itself when it starts work, when its direction changes, and when it finishes. If nothing's written, we show the draft PR title or the file being edited instead
- **Chat channel**: conversation between people. An agent only speaks in when its owner `@call`s it or posts a DM Q&A, and it shows up folded to a single line so it doesn't cover the conversation between people. Omagari's alerts come in as one-line system messages, and you start a conversation or a post right from that message
- **Talking to my agent (DMs and @calls)**: in each channel or post there's one conversation with each of my agents, and the agent answers by looking at that channel's conversation and the repo. Only the visibility differs for each Q&A.

  |                     | Who sees it                   | When to use it                                                                                                             |
  | ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | DM (default)        | Only me                       | To check on your own: "Am I right?", "Is there evidence for this claim?"                                                   |
  | Post to the channel | Everyone sees the Q&As I pick | To bring the evidence you found in a DM into the conversation. The question goes up too, so you can't post only the answer |
  | `@call`             | Everyone, from the start      | To ask something everyone wants to know, right away                                                                        |

  A posted Q&A shows whose agent it is, and which branch and commit it looked at to answer. Only the owner can call an agent.

- **Forum channel → Post**: the unit for discussing and settling things. You can promote any stretch of any chat to a post
- **Decision inbox**: decisions whose objection window is open, decisions confirmed while I was away, decisions that need my judgment, and what a stand-in said for me
- **Decision view**: see decisions by topic and follow their sources and what replaced them
- **Workspace → Repo**: a workspace is one GitHub account (an organization or a person) and holds several of that account's repos. People and teams follow GitHub permissions as they are. Channels can sit under a repo or under a workspace (ADR-0043)

When one person runs several works at once, the status shows one line per work (branch). Even works by the same person get checked for conflicts if their branches differ, because running several agent sessions is the most common way to use it (ADR-0041).

## 7. What happens in the space

Five things connect into one flow in the space.

1. **You see the current situation**: who, which agent, and what they're doing shows in one line next to the name. An agent also looks at who's doing what nearby when it starts a session and before it edits a file, and asks the other agent directly if it's curious
2. **You get told when work collides**: if two people change the same spot in the same file, if one person's change looks like it will break someone else's work, or if two people are building the same thing, a one-liner goes to the channel. A guess is only announced, and when an actual merge run breaks, a debate opens
3. **You settle it right there**: in the debate post attached to the alert, each agent speaks for its owner's context and brings evidence. If tests can decide it, tests do. If not, verified evidence. If not even that, a person picks
4. **What's decided stays**: the conclusion goes up to the repo as a decision record (ADR). A hard-to-undo decision takes objections for a day, and with none, it's confirmed
5. **The next agent reads it**: a decision is a file in the repo, so any agent reads it. Facts you can check in code aren't stored separately. When you need one, you ask an agent and it reads it from the latest repo

How we detect, where we store, and in what order we build is in the Omagari v3 implementation tab.

## 8. Risks

- **Nobody moves over**: teams are already on Discord and Slack. Having everything in one place has to be worth more than the cost of moving
- **GitHub builds the space too**: GitHub has Agent HQ, which runs agents from several vendors in one place, and Copilot Memory. What's left for us is staying vendor-neutral and the flow between people
- **The debate doesn't help**: research says it's a bad starting point. So we build it last, and keep it only if it beats sending alerts alone
- **Conflicts are rare**: we measure first, and if they're rare we only build alerts and decision records
- **Alert overload**: we measure precision and narrow the conditions for calling a debate

## 9. What changed from v2

|                  | v2                                                          | v3                                                                                 |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Center           | Memory and conflict resolution                              | A space where people and agents are together                                       |
| Pieces           | Built the same way ourselves                                | Stick them together and only build the connections to the space                    |
| Calling a debate | Called when a definition-line comparison guesses a conflict | A guess only alerts. Called only on a merge-run result or a declaration            |
| End of a debate  | Confirmed right away when agents agree                      | Experiment → verified evidence → a person, in that order. The result is a proposal |
| Confirming       | Right away                                                  | An objection window only for hard-to-undo things, the rest right away              |
| Decision records | Our own status table                                        | Plain ADRs, landed through a decision PR                                           |
| Fact memory      | Judged by date                                              | Not stored. An agent reads the latest repo when needed                             |
| Duplicate work   | None                                                        | Alert added                                                                        |
| Docs             | Plan and implementation in one tab                          | Plan and implementation split                                                      |

## Sources

- [Crystal: Proactive Detection of Collaboration Conflicts](https://homes.cs.washington.edu/~mernst/pubs/vc-conflicts-fse2011.pdf)
- [CooperBench](https://arxiv.org/html/2601.13295v1)
- [Mintzberg's coordination mechanisms](https://kamyarshah.com/mintzbergs-organizational-structure-a-blueprint-for-business-efficiency-and-strategic-growth/)
- [How Apache projects use consensus](https://community.apache.org/blog/how_apache_projects_use_consensus.html)
- [Ship / Show / Ask](https://martinfowler.com/tags/version%20control.html)
- [Bezos's Type 1 and Type 2 decisions](https://productmindset.substack.com/p/bezos-decision-making-framework)
- [Debate or Vote](https://neurips.cc/virtual/2025/poster/116557)
- [Sycophancy in Multi-Agent Debate](https://arxiv.org/abs/2509.23055v1)
- [GitHub Copilot agentic memory](https://github.blog/2026-01-09-building-an-agentic-memory-system-for-github-copilot)
- [GitHub Agent HQ](https://github.blog/news-insights/product-news/welcome-home-agents/)
- [Room](https://github.com/rohanz/room)
- [mcp-git-coord](https://github.com/OperatingSystem-1/mcp-git-coord)
- [memlay](https://docs.rs/crate/memlay/0.1.3)
- [SyncVibe](https://github.com/Curious1008/syncvibe)
- [Rule of three](<https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)>)
