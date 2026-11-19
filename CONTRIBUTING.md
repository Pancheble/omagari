# Contributing

Thanks for taking an interest in Omagari. What we're building and why is in [docs/omagari-v3.md](docs/omagari-v3.md), and setup and running are in [README.md](README.md). Please read this page and the [Code of Conduct](CODE_OF_CONDUCT.md) before you contribute.

## Getting started

```bash
git clone https://github.com/omagari-dev/omagari.git
cd omagari
git config core.hooksPath .githooks
npm ci
```

`git config core.hooksPath .githooks` turns on the hook that checks commit message format. Run it once per clone.

## Branches and PRs

- Branch from `dev` and open PRs against `dev`. Don't open PRs against `main`, which is the released version.
- Name branches `prefix/short-english-description` (for example `fix/runner-reconnect`).
- Merges are squash only. The PR title becomes the merge commit message.
- One issue, one PR. Put `Closes #<number>` on the first line of the PR body.

## Commit and PR title format

```text
prefix(scope): summary
```

- Prefix: one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`.
- Scope (optional): lowercase letters, digits, and hyphens (for example `runner`, `web`, `contract`).
- Summary: English, 50 characters or fewer, no period at the end.
- For a breaking change, add `!` after the prefix (for example `feat(contract)!: ...`).

`.githooks/commit-msg` checks commits, and the "PR title check" workflow checks PR titles.

## Before you push

Run these three before you open a PR. CI runs the same ones.

```bash
npm run format      # fixes formatting and lint
npm run typecheck   # checks types
npm test            # runs the tests
```

Tests use the framework in `test/harness.ts`. It starts a real server and a real runner on a temporary Git repo, and drives and checks them only through the server API and the input and output of the CLI and hook binaries. If you fix a bug, add a test that catches it.

## Design docs

We keep decisions in the repo.

- Use the words in [GLOSSARY.md](GLOSSARY.md).
- Record decisions that change the design as ADRs in [docs/adr/](docs/adr/).
- When you build or change a screen, read [DESIGN.md](DESIGN.md) at the root first. If you have to go against it, give the reason in the PR.
- The stack is in [ADR-0014](docs/adr/0014-stack-node-hono-sqlite-websocket.md). Before you add a dependency, check whether something we already have does the job.

## Issues

- Use the issue forms for bugs and feature requests.
- Don't report security problems in public issues. Follow [SECURITY.md](SECURITY.md).
- For big changes, talk it through in an issue before you open a PR.

## License

Omagari is licensed under [AGPL-3.0](LICENSE). Contributions are licensed under AGPL-3.0 too. There's no CLA.
