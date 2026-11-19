---
status: accepted
---

# Publish to npm: `latest` from release tags, `next` from `dev`

Installing Omagari should take two lines, `npm i -g omagari` and `omagari setup` (#347). ADR-0019 had members clone the repo and run `main`, and said a move to npm would put the version in package.json and supersede it. Decided on 2026-11-19 by @Pancheble in the #347 grilling.

- **One package, `omagari`, holds the CLI, the runner, and the hooks.** The name is free on npm (checked 2026-11-19). The server and the web stay out of it. Self-hosters keep running the server from a clone (`docs/server.md`).
- **The package ships JavaScript.** Node refuses to run TypeScript files under `node_modules` ([Node.js TypeScript docs](https://nodejs.org/api/typescript.html)). A build step that only runs when publishing turns the `.ts` sources into `.js`. Development and tests still run the `.ts` directly, without a build (ADR-0014).
- **The version comes from the tag at publish time.** package.json in the repo stays at `0.0.0`. The publish workflow writes the version into the package it builds. `omagari --version` shows the package version when installed from npm, and `git describe` when run from a clone, as before.
- **Release tags publish `latest`.** The release steps of ADR-0019 stay: fast-forward `dev` to `main`, tag `vX.Y.Z`, `gh release create`. Pushing the tag also publishes `X.Y.Z` to npm as `latest`. When to release still follows ADR-0022.
- **`dev` publishes `next`.** Every merge to `dev` that passes CI publishes `0.0.0-dev.<run number>` as `next`, the same moment the dogfood server deploys (ADR-0042). Dogfood machines install with `npm i -g omagari@next`, so the npm install path gets used every day before anyone else depends on it.
- **No npm token.** GitHub Actions publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), which also adds provenance. Someone with the npm account has to claim the package and register the workflow once.
- **The runner updates itself the way it was installed.** When the server's contract is newer (ADR-0042), a runner installed from npm runs `npm i -g omagari@<the dist-tag it came from>` and restarts. A runner run from a clone keeps `git pull --ff-only` and `npm ci`.

## Considered Options

- **Publish only releases to npm**, and keep dogfood machines on a clone: nobody would use the npm path (the build, the background runner, the npm update) until the first release.
- **Write the version in package.json and automate with release-please** (ADR-0019's own suggestion): release-please opens a release PR on every merge, and ADR-0022 says we release only when @Pancheble says so. Writing the version at publish keeps the repo at `0.0.0` (AGENTS.md) and needs no release PR.
- **Claude Code or Codex plugins**: two install paths, one per executor, and the runner still needs installing on its own.
- **Publishing `.ts` and running it with a loader** (tsx): adds a runtime dependency to every command, including the hooks that run on every agent edit.

## Consequences

- Supersedes ADR-0019's "members clone and run `main`" and its "version only from `git describe`". The rest of ADR-0019 (SemVer, manual release, release notes, "Runners need to update too") stays.
- `checkoutVersion()` and the clone self-update stay for clones. Contributors and self-hosters still run from a clone.
- The hook commands that `omagari install` writes point at the installed package, so a Node upgrade or reinstall still means running `omagari setup` again (ADR-0016).
- A `next` build can be broken for a while, the same as the dogfood server.
