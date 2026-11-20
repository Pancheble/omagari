# Run a server

Omagari is self-hosted, and there's no public server. One person on the team runs it, and everyone else points `OMAGARI_SERVER` at it (see [Set up a machine](setup.md)).

The server also runs `main`, and updating works like for members (`git pull`, `npm ci`, start again). The dogfood server follows `dev` and deploys to Fly.io by itself (see [Deploy to Fly.io](#deploy-to-flyio)). On start, it logs its version, like `Omagari server v0.1.0 (contract 9): ...`.

```bash
cp .env.example .env     # fill in OMAGARI_REPO and GITHUB_CLIENT_ID (don't commit .env)
HOST=0.0.0.0 npm run server
```

`OMAGARI_REPO` is the list of GitHub accounts the server accepts ([ADR-0043](adr/0043-workspace-is-a-github-account-people-follow-github.md)). Separate several with commas. Each entry is an account (`owner`) or a repo (`owner/name`).

- Each accepted account is one workspace (`api.workspaces`). Repos from different accounts go into different workspaces, and members, presence, channels, forums, posts, decisions, and metrics never mix between workspaces. A person who is in two picks one with the `Omagari-Workspace` header (for the live connection, `workspace` in hello). Without it, they get the first workspace they belong to. A database from the single-repo or single-workspace versions moves to the first workspace on start. The UI only works as before when there's one workspace (#238).
- A workspace only holds repos of its accounts. A repo's GitHub Admin adds one with `POST /api/repos/add` (`{ "repo": "owner/name" }`) and removes it with `POST /api/repos/remove`. Removing a repo doesn't delete its data, so adding it again brings it back. There's no UI for this yet (#238).
- A repo written as `owner/name` accepts that account, and the server adds it on every start. A new server where nobody can sign in yet gets its first repo this way. To keep a repo you removed through the API from coming back, delete it here too.
- The first `owner/name` is the repo of the single-repo version. If you start with a database from that version, its works, alerts, posts, labels, decisions, and check commands move to that repo, and sessions that were signed in stay signed in as members of it (GitHub permissions are checked again within 10 minutes).
- A member is someone with push access to at least one of the workspace's repos. People only see the repos they have push access to, rechecked at sign-in and every 10 minutes. A runner connects to a repo through the folder's GitHub remote. Run one runner per repo.
- APIs that are per repo (works, members, posts, labels, decisions, feed) pick the repo with the `Omagari-Repo: owner/name` header. Without it, they use the first repo the caller can see. The CLI sends the folder's remote.

`OMAGARI_DB` (default `omagari.db`) and `PORT` (default 3000) change the database file and the port. If members open the web UI at a different address than the one the server listens on, set `OMAGARI_URL`. Decision PRs link back to posts using this address.

`OMAGARI_SOURCE_URL` sets the "Source code" link in the settings window (Info). It defaults to `https://github.com/omagari-dev/omagari`. If you change the server's code and let people use it over the network, point this at your fork (AGPL-3.0 section 13).

GIFs in chat ([ADR-0044](adr/0044-gif-from-giphy-through-server-reactions-in-contract.md)) turn on when `GIPHY_API_KEY` holds a [GIPHY developer key](https://developers.giphy.com/dashboard/). Without it, the composer has no GIF button. The server adds the key and searches GIPHY on the browser's behalf, so the key never reaches the web UI. The server stays under the beta key's 100 requests an hour. With a production key, raise the limit with `GIPHY_PER_HOUR`. On Fly, set it with `fly secrets set GIPHY_API_KEY=<key> -a "$FLY_APP"`.

If a web build exists (`npm run build -w @omagari/web` creates `packages/web/dist`), the server serves it at the same address and sends unknown paths to its first file. While developing, use `npm run web` (Vite). The health check is `GET /api/health`.

## Deploy to Fly.io

The server runs on one small Fly.io machine (Tokyo, `nrt`). This is how the repo's dogfood server runs ([ADR-0042](adr/0042-dogfood-server-on-fly-follows-dev.md)). Settings are in `fly.toml` and the image is in `Dockerfile`. The app name and the account list aren't in the repo; put them in `.env` (start with `cp .env.example .env`). A person does the first deploy by hand.

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
