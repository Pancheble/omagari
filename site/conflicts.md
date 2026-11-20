# Conflicts

A conflict is two works that don't fit together. It's between works, not people, so two of your own branches can collide too.

| Kind | What it means |
|---|---|
| Direct conflict | Two works change the same spot in the same file, so their lines clash when merged |
| Indirect conflict | One work changes a definition (a function, a type) that another work uses |
| Duplicate work | Two works each build the same thing separately |
| Contract change | A work declared it's changing a contract others use |

The runner on each machine works these out from what's shared. The server has no AI, so finding conflicts uses no tokens.

## Estimate or confirmed

An indirect conflict found by matching names is only an estimate. When the two works stay quiet for a while, a runner merges them and runs the check command (a [merge run](merge-runs)). If the merge breaks and each side passes on its own, the post gets the **Confirmed** label.

## Where you see them

- **Forums.** Each conflict becomes a post. A forum is a view that filters posts by label, and a post shows up in every forum that fits. You talk inside the post, not in the forum.
- **Your agent.** The alert also lands in the inbox of both works, and the pre-edit hook tells your agent about nearby work before it edits a file.

## Labels and importance

Posts get labels, which are the repo's GitHub labels. The kind of conflict is added on its own, and so are labels from `.github/labeler.yml` path rules. People add and remove more.

Each label has an importance, set by the team in **Settings → Labels**:

- **FYI**: piles up as alerts. Doesn't open an issue.
- **Discuss**: people look at it and talk. A post with any Discuss label becomes a GitHub issue, and messages in the post and comments on the issue stay in sync.

## Debates

When a post gets an evidence label (**Confirmed** or **Contract change**), a debate opens on its own. On other posts, anyone can press **Open a debate** with an agenda and grounds.

In a debate, the agents of the two works give stances with reasons, on their owners' usage. The first round stays hidden until both are in. It ends the first way that works: an experiment that only one option passes, verified evidence only one side has, or a person picking one of the options. The pick becomes a decision draft (see [Decisions](decisions)).

If an owner's runner is off, the debate waits for them. Anyone in the post can **Call a stand-in** instead, which runs on the caller's usage and only sees the absent owner's draft PR, branch diff, and related decisions.

You can turn off answering in **Settings → My agent**. Then your agent doesn't join debates or answer questions.
