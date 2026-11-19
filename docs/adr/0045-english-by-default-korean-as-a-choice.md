---
status: accepted
---

# English by default, Korean as a personal choice

Omagari is a public repo, and we want people outside the first Korean team to read it, run it, and contribute. Until stage 5, everything was in Korean: code comments, docs, the UI, commits. Decided on 2026-11-19 by @Pancheble in the stage 6 grilling (#283, `docs/stage6-questions.md`):

- **Repo docs are in English.** README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue and PR templates, the repo About. Only the README has a Korean copy (`README.ko.md`), updated in the same PR whenever the README changes.
- **What you read to work is in English; history stays as written.** AGENTS.md, GLOSSARY.md, DESIGN.md, the product and implementation docs, code comments, and test names move to English. ADR 0001–0044 and the `stageN-questions.md` logs stay in Korean. ADRs are records, and their file names are already English. New ADRs are in English.
- **Commits, PRs, and issues are in English** once the ticket that moves the repo rules to English is merged. Past history is not rewritten. The commit hook and the PR title check never required Korean, so only their messages change.
- **The web UI starts in English for everyone.** Korean is a personal setting, stored on the server so it follows the person across devices. We don't follow the browser language.
- **Anything written once and shared is in English only.** That covers GitHub labels, issue and decision PR bodies Omagari writes, text injected into agents (hooks, runner instructions, the status skill), and CLI output. The server renames the existing Korean labels on GitHub (a rename keeps them on issues). Runner sessions answer in the language of the question. Alerts in channels are stored as data, so each viewer sees them in their own language.
- **Tone is plain and Discord-like in both languages**: 해요체 in Korean, second person and contractions in English, short, no jokes.
- **English names for glossary terms** sit next to each term in GLOSSARY.md and mostly match the code (`Work`, `Claim`, `MergeRun`, `Verdict`).

## Considered Options

- **Follow the browser language** (Discord, Slack): rejected. @Pancheble wants everyone to land in English first.
- **Workspace language for shared text**: GitHub text would follow a workspace setting. Rejected, since one language is simpler, and bots like Dependabot and Renovate write in English anyway.
- **Translate everything, ADRs included**: rejected as rewriting records nobody needs to change.
- **Keep Korean copies of all community files**: rejected, because two copies drift. Contributors already work in English issues and PRs.
