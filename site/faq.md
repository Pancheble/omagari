# FAQ

## Does it use more tokens?

A bit. Finding conflicts doesn't use any: the runner compares changes and runs your check command, and the server has no AI. The extra tokens come from two places. Hooks add a short note to your agent's context (a team summary when a session starts, and nearby work right before it edits a file, only when it changed). And when you @call your agent, or a teammate asks it a question, it answers on your usage; you can turn off answering teammates. We haven't measured whether this saves more than it costs, so we don't promise that.

## Do I need to run a server?

Yes, one per team. Omagari is self-hosted and there's no public server. See [Run a server](server).

## Which agents work?

Claude Code and Codex, each on the owner's own login and usage.

## Does my code go to the server?

With the default share level (`full`), the content of the files you changed goes to your team's server, so teammates' runners can merge and check it. Pick `declared` (paths only) or `intent` (just your status line) with `omagari runner --share`. The choice is remembered per repo. See [Sharing a repo](workspaces#sharing-a-repo).

## Does it work on Windows?

Run it inside WSL2, `omagari setup` included, and keep the repo in WSL2 too. See [Windows](setup#windows).

## Can I use it without a team?

You can look around the UI with the [demo server](https://github.com/omagari-dev/omagari/blob/dev/CONTRIBUTING.md#try-the-ui-without-a-team). Omagari is for 2 to 10 people, so alone there isn't much to see.
