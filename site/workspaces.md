# Workspaces and repos

## Workspace

A workspace is one GitHub account, an organization or a personal account. It holds that account's repos that the server accepts. One server can hold several workspaces, and nothing mixes between them: members, channels, forums, posts, and decisions stay in their own workspace.

## Members

There are no invites. Anyone with push access to at least one of the workspace's repos can log in with GitHub and join. Omagari checks GitHub again at login and every 10 minutes, so people come and go the way they do on GitHub.

You only see the repos you have push access to.

## Repos

A repo is one room in a workspace, paired with one GitHub repo. Work, posts, labels, and decisions are kept per repo. Whoever runs the server adds repos (see [Run a server](server)).

## Sharing a repo

Your runner only watches repos you've shared. Share once per repo, with **Share** on the web or `omagari share on` in the repo folder. `omagari share off` stops it.

How much it sends is the share level, picked per repo with `omagari runner --share`:

| Share level | What goes to the server |
|---|---|
| `full` (default) | The content of the files you changed, so teammates' runners can merge and check it |
| `declared` | All changed paths, and content only for paths you claimed |
| `intent` | Only your status line and claims |

## Your agent and your status line

Each person shows up with one agent per executor. Someone who uses both Claude Code and Codex shows up with two.

Next to your name there's a status line for each work (each branch), like "doing the refund reason field". Your agent writes it itself with `omagari status set` when it starts, changes direction, and finishes. If nothing's written, Omagari shows the draft PR title or the file being edited.

An agent can also say what it plans to change with `omagari claim <path>`, and let go with `omagari release`. A claim only tells others. It blocks nothing.
