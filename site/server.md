# Run a server

Omagari is self-hosted, and there's no public server. One person on the team runs it, and everyone else connects with `omagari setup <address>` (see [Set up a machine](setup.md)).

The server also runs `main`, and updating works like for members (`git pull`, `npm ci`, start again). The dogfood server follows `dev` and deploys to Fly.io by itself (see [Deploy to Fly.io](#deploy-to-flyio)). On start, it logs its version, like `Omagari server v0.1.0 (contract 9): ...`.

```bash
cp .env.example .env     # fill in OMAGARI_REPO and GITHUB_CLIENT_ID (don't commit .env)
HOST=0.0.0.0 npm run server
```

## GitHub sign-in

People sign in with GitHub's device flow: the web or CLI shows a code, and they enter it on GitHub. The server keeps the GitHub token; members' machines never see it. `GITHUB_CLIENT_ID` is the client ID of either a GitHub App or an OAuth app ([ADR-0053](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0053-github-app-sign-in-and-encrypted-tokens.md)). Both keep working, so pick one.

**A GitHub App** (what the hosted server uses) only reaches the repos an account's admin installed it on, with only the permissions below. Create one under Settings → Developer settings → GitHub Apps → New GitHub App (for an organization, in the organization's settings):

- Homepage URL: your server's address. Callback URL: leave it empty.
- Turn on **Enable Device Flow**. Leave **Expire user authorization tokens** on.
- Webhook: turn **Active** off. The server doesn't take webhooks.
- Repository permissions: **Metadata** read-only; **Contents**, **Issues**, and **Pull requests** read and write. Nothing else. The server uses them to check push access, open and merge decision PRs, open post issues, and edit labels.
- Where it can be installed: "Only on this account" for your own team, "Any account" if other accounts sign in too.

Then set `GITHUB_CLIENT_ID` to the App's client ID and `GITHUB_APP_SLUG` to its slug (the end of `https://github.com/apps/<slug>`). An admin of each accepted account installs the App on the workspace repos. A repo without the App is hidden from everyone's token, so Omagari treats it as no access. With `GITHUB_APP_SLUG` set, the login screen, the "Add a repo" window, and the CLI then say to install the App, with the link.

The App's tokens expire after 8 hours. The server keeps the refresh token (good for 6 months) and gets a new token before it calls GitHub, so people stay signed in. A device-flow token refreshes without a client secret, so the server needs none. If GitHub rejects the refresh (unused for 6 months, or the person revoked the App), the session ends: the web goes back to its login screen, and on the command line `omagari setup` signs in again.

**An OAuth app** still works the same as before: create one under Settings → Developer settings → OAuth Apps, turn on **Enable Device Flow**, and set `GITHUB_CLIENT_ID`. Leave `GITHUB_APP_SLUG` unset. Sign-in asks for the `repo` scope, which reaches every repo the person can, and its tokens don't expire. An organization with OAuth app access restrictions has to approve the app once.

Moving a server from an OAuth app to a GitHub App signs everyone out once: they sign in again with the App.

`OMAGARI_REPO` is the list of GitHub accounts the server accepts ([ADR-0043](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0043-workspace-is-a-github-account-people-follow-github.md)). Separate several with commas. Each entry is an account (`owner`) or a repo (`owner/name`).

- Each accepted account is one workspace (`api.workspaces`). Repos from different accounts go into different workspaces, and members, presence, channels, forums, posts, decisions, and metrics never mix between workspaces. A person who is in two picks one with the `Omagari-Workspace` header (for the live connection, `workspace` in hello). Without it, they get the first workspace they belong to. A database from the single-repo or single-workspace versions moves to the first workspace on start. The UI only works as before when there's one workspace (#238).
- A workspace only holds repos of its accounts. A repo's GitHub Admin adds one with `POST /api/repos/add` (`{ "repo": "owner/name" }`) and removes it with `POST /api/repos/remove`. Removing a repo doesn't delete its data, so adding it again brings it back. There's no UI for this yet (#238).
- A repo written as `owner/name` accepts that account, and the server adds it on every start. A new server where nobody can sign in yet gets its first repo this way. To keep a repo you removed through the API from coming back, delete it here too.
- The first `owner/name` is the repo of the single-repo version. If you start with a database from that version, its works, alerts, posts, labels, decisions, and check commands move to that repo, and sessions that were signed in stay signed in as members of it (GitHub permissions are checked again within 10 minutes).
- A member is someone with push access to at least one of the workspace's repos. People only see the repos they have push access to, rechecked at sign-in and every 10 minutes. A runner connects to a repo through the folder's GitHub remote. Run one runner per repo.
- APIs that are per repo (works, members, posts, labels, decisions, feed) pick the repo with the `Omagari-Repo: owner/name` header. Without it, they use the first repo the caller can see. The CLI sends the folder's remote.

`OMAGARI_DB` (default `omagari.db`) and `PORT` (default 3000) change the database file and the port. If members open the web UI at a different address than the one the server listens on, set `OMAGARI_URL`. Decision PRs link back to posts using this address.

`OMAGARI_SOURCE_URL` sets the "Source code" link in the settings window (Info). It defaults to `https://github.com/omagari-dev/omagari`. If you change the server's code and let people use it over the network, point this at your fork (AGPL-3.0 section 13).

GIFs in chat ([ADR-0044](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0044-gif-from-giphy-through-server-reactions-in-contract.md)) turn on when `GIPHY_API_KEY` holds a [GIPHY developer key](https://developers.giphy.com/dashboard/). Without it, the composer has no GIF button. The server adds the key and searches GIPHY on the browser's behalf, so the key never reaches the web UI. The server stays under the beta key's 100 requests an hour. With a production key, raise the limit with `GIPHY_PER_HOUR`. On Fly, set it with `fly secrets set GIPHY_API_KEY=<key> -a "$FLY_APP"`.

If a web build exists (`npm run build -w @omagari/web` creates `packages/web/dist`), the server serves it at the same address and sends unknown paths to its first file. While developing, use `npm run web` (Vite). The health check is `GET /api/health`.

## Deploy to Fly.io

The server runs on one small Fly.io machine (Tokyo, `nrt`). This is how the repo's dogfood server runs ([ADR-0042](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0042-dogfood-server-on-fly-follows-dev.md)). Settings are in `fly.toml` and the image is in `Dockerfile`. The app name and the account list aren't in the repo; put them in `.env` (start with `cp .env.example .env`). A person does the first deploy by hand.

```bash
set -a; . ./.env; set +a                    # read FLY_APP and OMAGARI_REPO into the shell
fly apps create "$FLY_APP"
fly volumes create omagari_data --region nrt --size 1 -a "$FLY_APP"
fly secrets set GITHUB_CLIENT_ID=<GitHub App or OAuth app with device flow on> GITHUB_APP_SLUG=<App slug, GitHub App only> -a "$FLY_APP"
fly deploy -a "$FLY_APP" -e OMAGARI_REPO="$OMAGARI_REPO"
```

- Secrets only go in through `fly secrets`, never in the repo. `OMAGARI_REPO` isn't secret, so it's passed with `-e` at deploy time. It stays out of `fly.toml` along with the app name so that `fly.toml` only holds values that are the same no matter who deploys (`app` is passed with `-a`, since toml can't read environment variables). On Fly, the server sets `OMAGARI_URL` to `https://<app name>.fly.dev` itself.
- The database lives on a volume (`/data/omagari.db`), so it survives new versions. The volume's daily snapshots (`fly volumes snapshots list`, kept 5 days by default) are one backup; [Litestream](#back-up-with-litestream) is the other.
- A new version only replaces the old one if it passes the health check (`/api/health`). If it doesn't, the old version stays.
- Auto deploy: `.github/workflows/deploy.yml` runs `fly deploy` once CI passes on `dev`. It needs a GitHub Environment named `dogfood` that only `dev` can use (Settings → Environments, deployment branches limited to `dev`), with the secret `FLY_API_TOKEN` (`fly tokens create deploy`) and the variables `FLY_APP` and `OMAGARI_REPO`. If any is missing, the deploy step is skipped. It also doesn't deploy when the commit CI ran on is no longer the tip of `dev` (a re-run of an old run).
- To check the image on your machine: `docker build -t omagari .`, then `docker run -p 8080:8080 -v omagari-data:/data -e OMAGARI_REPO=<owner/name> -e GITHUB_CLIENT_ID=<app> omagari`.

## Back up with Litestream

With bucket settings, the image runs [Litestream](https://litestream.io/) beside the server ([ADR-0055](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0055-hosted-operations-litestream-upptime-incident-plan.md)). It streams the database to an S3-compatible bucket (Tigris and Cloudflare R2 have free tiers). Without them, the image starts the server exactly as before, so self-hosting needs nothing.

| Setting | Meaning |
| --- | --- |
| `LITESTREAM_BUCKET` | Bucket name. Backup turns on only when this and both keys are set. |
| `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` | Bucket keys. Secrets: `fly secrets set ... -a "$FLY_APP"`. |
| `LITESTREAM_ENDPOINT` | The provider's S3 address. Leave empty for AWS S3. |
| `LITESTREAM_REGION` | Default `auto`. |
| `LITESTREAM_PATH` | Folder in the bucket. Default `omagari`. |

On start, if `/data/omagari.db` doesn't exist (a new machine or volume), the image first restores the latest replica. If there's no replica yet, it starts empty.

A monthly job (`.github/workflows/restore-drill.yml`) restores the latest replica, runs an integrity check, starts a server on it, and checks `/api/health`. It runs in the `dogfood` environment with the secrets `LITESTREAM_BUCKET`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` and the optional variables `LITESTREAM_ENDPOINT`, `LITESTREAM_REGION`, `LITESTREAM_PATH`. If a secret is missing it skips, and if the restore or the check fails the job fails. You can also run it from the Actions tab.

To restore by hand, stop the server, then run [`litestream restore`](https://litestream.io/reference/restore/) with the same settings (`-config litestream.yml` reads them from the environment):

```bash
export LITESTREAM_BUCKET=... LITESTREAM_ACCESS_KEY_ID=... LITESTREAM_SECRET_ACCESS_KEY=... LITESTREAM_ENDPOINT=... LITESTREAM_REGION=auto LITESTREAM_PATH=omagari
export OMAGARI_DB=/data/omagari.db
mv "$OMAGARI_DB" "$OMAGARI_DB.old"          # keep the broken file until the restore works
litestream restore -config litestream.yml "$OMAGARI_DB"
```

On Fly, run it in the machine with `fly ssh console -a "$FLY_APP"` (the image has `litestream` and `/app/litestream.yml`; use `-config /etc/litestream.yml`), then restart the machine. To restore to a point in time, add `-timestamp <RFC3339>`.
