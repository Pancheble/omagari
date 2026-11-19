# Omagari

English | [한국어](README.ko.md)

Omagari is a web workspace where people and their AI agents work together. You see each teammate's agent (Claude Code, Codex) next to them, who is working on which branch, and a channel where people and agents talk. It's self-hosted.

A runner on each member's machine tells the server what's changing in the repo folder and runs that person's agent on their behalf. Hooks tell the agent what nearby teammates are working on, so conflicts show up before the merge. The idea and the reasoning are in [docs/omagari-v3.md](docs/omagari-v3.md).

## What you get

- **Awareness**: who works on what, on which branch, and what they plan to touch (claims).
- **Conflict alerts**: direct and indirect conflicts and duplicate work, shown in forums and sent to the agents involved.
- **Merge runs**: Omagari merges two works in a sandbox on a member's machine and runs your check command, so "these might break each other" turns into pass or fail.
- **Channels and Q&A**: chat with teammates and their agents, or ask someone's agent a question without interrupting them.
- **Decisions on GitHub**: posts that need a person open a GitHub issue, and decisions become PRs.

## Quick start

You need:

- Node.js 24.12 or later
- git
- Claude Code or Codex, signed in on this machine
- A GitHub account with push access to the workspace repo
- The address of your team's Omagari server

Members run `main`. `dev` is where work collects, so don't use it ([ADR-0019](docs/adr/0019-stage1-version-is-git-tag-members-run-main.md)). The one exception is dogfooding: the dogfood server follows `dev` ([ADR-0042](docs/adr/0042-dogfood-server-on-fly-follows-dev.md)), so machines that use it clone with `--branch dev`. When the server moves to a new contract, the runner updates this clone by itself (see Update).

```bash
git clone --branch main https://github.com/omagari-dev/omagari.git ~/omagari
cd ~/omagari
npm ci
```

Put `omagari` on your PATH by linking the CLI into a folder that's already there. If you installed Claude Code or Codex natively, `~/.local/bin` is already on your PATH.

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
omagari --version
```

If you get `command not found`, `~/.local/bin` isn't on your PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell config (`~/.zshrc` and so on) and open a new terminal. Agents call `omagari` from the status line skill, so it has to be in the shell config, not just typed once.

Put the server address in your shell config too. Without it, the CLI connects to `http://127.0.0.1:3000`.

```bash
export OMAGARI_SERVER=https://<your-team-server>
```

Install the hooks and the status line skill into this machine's agents. Run it once per machine; running it again keeps one copy. For Codex, open `/hooks` in Codex and trust the two hooks, or they won't run.

```bash
omagari install
```

Start the runner in the folder where you cloned the workspace repo. The first time, it signs you in with GitHub device flow. Keep it running, because the team only sees your work and your agent while it is.

```bash
cd <your workspace repo folder>
omagari runner
```

## Check command

A merge run merges two works and runs the repo's check command inside a sandbox on this machine. The sandbox blocks outside network access, writes outside a temp folder, and reading your home folder. The team sets the check command by committing `.omagari.json` at the repo root and merging it into the default branch. `setup` (a command that runs once before the check) is optional.

```json
{ "check": "npm test", "setup": "npm ci" }
```

The runner only reads the version merged into the default branch (the remote tracking branch). To see whether the sandbox and the check command work on this machine, run it once against your current work in the current folder.

```bash
omagari runner check
```

On macOS there's nothing extra to install. On Linux you need bubblewrap, socat, and ripgrep. On Windows, run the runner inside WSL2 and keep the repo inside WSL2 too, with the same tools as Linux (a runner started from PowerShell doesn't do merge runs). Windows drives (`/mnt/c` and so on) aren't readable from WSL2 either. To turn merge runs off on this machine, start the runner with `omagari runner --merge-check off`. The choice is remembered per repo.

## Update

```bash
cd ~/omagari
git pull
npm ci
```

Then restart the runner (`Ctrl-C`, then `omagari runner`). If the server's contract is newer and rejects your runner, the runner updates itself: it runs `git pull --ff-only` and `npm ci` in the install clone (the checkout that holds the runner program) and starts again with the same arguments. What it pulled (the commits before and after) goes to `omagari runner log`. It never touches the repo folder it observes. If the install clone has edited files or can't fast-forward, it changes nothing and tells you what to do. It doesn't update to an older server's contract either. If you upgraded Node or moved the checkout, run `omagari install` again, because the hook commands contain the Node and checkout paths.

What changed in each release is on [GitHub Releases](https://github.com/omagari-dev/omagari/releases). If a release starts with "Runners need to update too", the contract between the server and the runner changed.

## Check your version

```bash
omagari --version
```

It prints this checkout's git tag and the contract version, like `omagari v0.1.0 (contract 9)`. After a release, commits show up as `v0.1.0-3-gabc1234`. A clone without tags shows the commit instead.

If the server and this machine have different contract versions, the server rejects the runner, and the runner tells you what to do.

- Server is newer: the runner updates itself and restarts. If it can't, follow the steps in Update above and restart the runner.
- Server is older: the server has to be updated. Tell whoever runs it.

## Run a server

The server also runs `main`, and updating works like for members (`git pull`, `npm ci`, start again). The dogfood server follows `dev` and deploys to Fly.io by itself (see "Deploy to Fly.io" below). On start, it logs its version, like `Omagari server v0.1.0 (contract 9): ...`.

```bash
cp .env.example .env     # fill in OMAGARI_REPO and GITHUB_CLIENT_ID (don't commit .env)
HOST=0.0.0.0 npm run server
```

`OMAGARI_REPO` is the list of GitHub accounts the server accepts ([ADR-0043](docs/adr/0043-workspace-is-a-github-account-people-follow-github.md)). Separate several with commas. Each entry is an account (`owner`) or a repo (`owner/name`).

- Each accepted account is one workspace (`api.workspaces`). Repos from different accounts go into different workspaces, and members, presence, channels, forums, posts, decisions, and metrics never mix between workspaces. A person who is in two picks one with the `Omagari-Workspace` header (for the live connection, `workspace` in hello). Without it, they get the first workspace they belong to. A database from the single-repo or single-workspace versions moves to the first workspace on start. The UI only works as before when there's one workspace (#238).
- A workspace only holds repos of its accounts. A repo's GitHub Admin adds one with `POST /api/repos/add` (`{ "repo": "owner/name" }`) and removes it with `POST /api/repos/remove`. Removing a repo doesn't delete its data, so adding it again brings it back. There's no UI for this yet (#238).
- A repo written as `owner/name` accepts that account, and the server adds it on every start. A new server where nobody can sign in yet gets its first repo this way. To keep a repo you removed through the API from coming back, delete it here too.
- The first `owner/name` is the repo of the single-repo version. If you start with a database from that version, its works, alerts, posts, labels, decisions, and check commands move to that repo, and sessions that were signed in stay signed in as members of it (GitHub permissions are checked again within 10 minutes).
- A member is someone with push access to at least one of the workspace's repos. People only see the repos they have push access to, rechecked at sign-in and every 10 minutes. A runner connects to a repo through the folder's GitHub remote. Run one runner per repo.
- APIs that are per repo (works, members, posts, labels, decisions, feed) pick the repo with the `Omagari-Repo: owner/name` header. Without it, they use the first repo the caller can see. The CLI sends the folder's remote.

`OMAGARI_DB` (default `omagari.db`) and `PORT` (default 3000) change the database file and the port. If members open the web UI at a different address than the one the server listens on, set `OMAGARI_URL`. Decision PRs link back to posts using this address.

If a web build exists (`npm run build -w @omagari/web` creates `packages/web/dist`), the server serves it at the same address and sends unknown paths to its first file. While developing, use `npm run web` (Vite) as before. The health check is `GET /api/health`.

### Deploy to Fly.io

The server runs on one small Fly.io machine (Tokyo, `nrt`). This is how the repo's dogfood server runs ([ADR-0042](docs/adr/0042-dogfood-server-on-fly-follows-dev.md)). Settings are in `fly.toml` and the image is in `Dockerfile`. The app name and the account list aren't in the repo; put them in `.env` (start with `cp .env.example .env`). A person does the first deploy by hand.

```bash
set -a; . ./.env; set +a                    # read FLY_APP and OMAGARI_REPO into the shell
fly apps create "$FLY_APP"
fly volumes create omagari_data --region nrt --size 1 -a "$FLY_APP"
fly secrets set GITHUB_CLIENT_ID=<GitHub app with device flow on> -a "$FLY_APP"
fly deploy -a "$FLY_APP" -e OMAGARI_REPO="$OMAGARI_REPO"
```

- Secrets only go in through `fly secrets`, never in the repo. `OMAGARI_REPO` isn't secret, so it's passed with `-e` at deploy time. It stays out of `fly.toml` along with the app name so that `fly.toml` only holds values that are the same no matter who deploys (`app` is passed with `-a`, since toml can't read environment variables). On Fly, the server sets `OMAGARI_URL` to `https://<app name>.fly.dev` itself.
- The database lives on a volume (`/data/omagari.db`), so it survives new versions. Backups are the volume's daily snapshots (`fly volumes snapshots list`, kept 5 days by default).
- A new version only replaces the old one if it passes the health check (`/api/health`). If it doesn't, the old version stays.
- Auto deploy: `.github/workflows/deploy.yml` runs `fly deploy` once CI passes on `dev`. It needs a GitHub Environment named `dogfood` that only `dev` can use (Settings → Environments, deployment branches limited to `dev`), with the secret `FLY_API_TOKEN` (`fly tokens create deploy`) and the variables `FLY_APP` and `OMAGARI_REPO`. If any is missing, the deploy step is skipped. It also doesn't deploy when the commit CI ran on is no longer the tip of `dev` (a re-run of an old run).
- To check the image on your machine: `docker build -t omagari .`, then `docker run -p 8080:8080 -v omagari-data:/data -e OMAGARI_REPO=<owner/name> -e GITHUB_CLIENT_ID=<app> omagari`.

## Development

Before you push, run the same three checks CI runs:

```bash
npm run format      # fixes formatting and lint
npm run typecheck
npm test
```

To look around the UI without a team, start the demo server. It fakes GitHub and seeds a workspace with members, forums, and conflicts. `DEMO_AGENT=fake` makes your agent answer with canned replies, so it doesn't use your subscription.

```bash
DEMO_AGENT=fake node test/demo.ts
```

## Docs

- [docs/omagari-v3.md](docs/omagari-v3.md): what Omagari is and why
- [docs/omagari-v3-implementation.md](docs/omagari-v3-implementation.md): how it's built
- [GLOSSARY.md](GLOSSARY.md): the words we use
- [docs/adr/](docs/adr/): design decisions
- [DESIGN.md](DESIGN.md): how screens look and read

Some of these are still in Korean while the docs move to English ([ADR-0045](docs/adr/0045-english-by-default-korean-as-a-choice.md)).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. To report a security problem, see [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
