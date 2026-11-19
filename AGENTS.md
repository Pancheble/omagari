# Omagari working rules

## Look before you ask

Before you ask a person a question, look for the answer in this order. If you find it, use it and don't ask.

1. **This repo's docs**: `docs/omagari-v3.md`, `docs/omagari-v3-implementation.md`, `GLOSSARY.md`, `docs/adr/`
2. **Existing implementations**: how `../room-reference` (Room) and the tools listed in the docs' Sources solved the same problem
3. **Known methods and libraries**: search the web. Check whether a named method, a widely used library, or official docs already have the answer

Write down the answer you found along with its source. If the answer decides a design, record it as an ADR.

## What you can ask about

- Things only a person can decide, like taste or direction
- Things that are hard to undo and where either choice makes sense
- Answers you found that conflict with each other or with our docs

When you ask, say where you looked and which answer you would pick. Don't just ask a question.

## Other rules

- Room is PolyForm Noncommercial. Don't copy its code; look at its behavior and write new code.
- If the docs don't settle something, don't guess. Leave it as undecided.
- Before you build a new mechanism, check whether something existing can be reused (implementation doc, section 10).
- When you build or change a screen (`area:web`), read the root `DESIGN.md` first and follow it. If you must go against it, give the reason in the PR. Screen text follows the "Writing" section of `DESIGN.md`.
- When you name a person in an issue, PR, commit, comment, or doc, write `@handle` and don't add a title. "Owner" in GLOSSARY is a product term, so keep it as is.

## Code and commands

- The stack is in ADR-0014: Node.js 24 or later (runs `.ts` directly, no build), Hono, SQLite, WebSocket.
- Each piece lives in its own folder under `packages/`: `contract`, `server`, `runner`, `cli`, `hooks`, `web`. Messages between the runner and the server, and the API the web uses, are defined only in `packages/contract`. The other pieces import them from there.
- Behavior tests use the `test/harness.ts` framework. They start a real server and a real runner on a temporary Git repo and drive and check them only through the server API and the input and output of the CLI and hook binaries. Fakes are allowed in exactly four places: GitHub, GIPHY, the agent executor, and the merge-run sandbox. The sandbox may not run in CI, so it is faked there. The real sandbox is checked by hand (2026-11-14 @Pancheble decision, ADR-0033). GIPHY is faked because CI has no key; the real GIPHY is checked by hand (2026-11-19 @Pancheble decision, ADR-0044).
  - Use a raw WebSocket, like `test/contract.test.ts`, only to imitate a peer that breaks the contract (a hijacked server, or a connection pretending to be a runner).
  - The `npm ci` in the runner's self-update (`test/self-update.test.ts`) is also faked, because the real one needs a download. Check the real `npm ci` by hand (2026-11-18 @Pancheble allowed, #230).
- Before you push, run three checks: `npm run format` (fixes formatting and lint), `npm run typecheck`, and `npm test`. CI runs the same ones.

## Git and GitHub rules

- There are two branches. `dev` is the default, where work collects. `main` is the released version, which members and other teams' servers use. The dogfood server follows `dev` (ADR-0042). See ADR-0019.
- Branch work from `dev`. Open PRs against `dev`. Merge with squash only.
- Commit messages and PR titles use the form `prefix(scope): summary`. Prefixes: feat, fix, docs, refactor, test, chore, ci, perf. The scope is optional (lowercase letters, digits, hyphens). The summary is in English, 50 characters or fewer, with no period at the end. For a breaking change, add `!` after the prefix. The PR's title and body become the squash commit's title and body. `.githooks/commit-msg` checks commits, and the "PR title check" workflow checks PR titles.
- Changes to `README.md` come with the matching change to `README.ko.md` in the same PR.
- Maintainers release by hand (ADR-0019, ADR-0022). Don't open PRs against `main`.
- The version is a git tag. Keep `version` in package.json at `0.0.0` and don't bump it.
- Issues get `type:*`, `area:*`, `stage:*`, and `size:*` labels, plus a milestone. Add `ready-for-agent` only to issues an agent can do without a person.
- One issue = one branch = one PR. Branch names are `prefix/short-english-description`.
- If you change the Git rules, rebuild `.githooks/commit-msg` and the PR title check from the new rules in the same change, and check them with a good and a bad example.
- When you clone this repo fresh, run `git config core.hooksPath .githooks` once. When a session starts and this setting is off, turn it on.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: the root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
