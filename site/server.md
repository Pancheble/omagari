# Run a server

Self-hosting is fully supported. One person on the team runs the server, and everyone else connects with `omagari setup <address>` (see [Set up a machine](setup.md)). If you'd rather not run one, there's a free hosted beta at `https://app.omagari.org` (see [Getting started](getting-started.md)). Is it down? Check the [status page](https://status.omagari.org).

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

Then set `GITHUB_CLIENT_ID` to the App's client ID and `GITHUB_APP_SLUG` to its slug (the end of `https://github.com/apps/<slug>`). An admin of each accepted account installs the App on the workspace repos. A repo without the App is hidden from everyone's token, so Omagari treats it as no access. A public repo the App isn't installed on counts the same, even though GitHub still shows it to everyone: if the App isn't on that repo (for example the account installed it only on selected repos), nobody has push or Admin there for Omagari, and "Add a repo" leaves it out. With `GITHUB_APP_SLUG` set, the login screen, the "Add a repo" window, and the CLI then say to install the App, with the link.

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

## Access requests

A server can let people ask for their account instead of you adding it to `OMAGARI_REPO` ([ADR-0052](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0052-hosted-beta-on-the-dogfood-server-by-request.md)).

- `OMAGARI_OPERATORS` is the list of GitHub logins of the server's operators, separated by commas. Without it, the server takes no requests and works as before: someone with no push access to a workspace repo can't sign in.
- With operators set, someone with no workspace can still sign in. The web then shows "Request access": they name a GitHub account (an organization or their own) and send it. They see whether it's waiting, approved, or denied. They only ever see their own requests, never which accounts the server already has.
- Operators see waiting requests in the web under Settings → Server → Access requests, and approve or deny them. An approved account joins the accepted accounts right away, kept in the database, so it stays after restarts and deploys. Then a GitHub Admin of a repo under it adds the repo, and the workspace appears.
- `OMAGARI_REPO` still works alongside it. With operators set, it can be empty.
- `OMAGARI_TERMS_URL` and `OMAGARI_PRIVACY_URL` link the server's terms and privacy policy. When either is set, the request form links them and asks the person to agree before they can send it, and Settings → Info shows them. The hosted server's own pages are [Terms of use](terms.md) and [Privacy policy](privacy.md); they cover only that server, so another operator writes their own.
- On Fly, set them like the other settings: `fly secrets set OMAGARI_OPERATORS=<login> OMAGARI_TERMS_URL=<url> OMAGARI_PRIVACY_URL=<url> -a "$FLY_APP"`.

`OMAGARI_DB` (default `omagari.db`) and `PORT` (default 3000) change the database file and the port. If members open the web UI at a different address than the one the server listens on, set `OMAGARI_URL`. Decision PRs link back to posts using this address.

GitHub tokens (access and refresh) are stored encrypted ([ADR-0053](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0053-github-app-sign-in-and-encrypted-tokens.md)). `OMAGARI_TOKEN_KEY` is the secret that encrypts them: any long random string, for example `openssl rand -hex 32`. Without it, the server makes a key file next to the database (`omagari.db.key`) on first start and logs where. A self-hosted server needs no new setting. Plain tokens an older server left in the database are encrypted on start. If the key changes or the key file is lost, everyone is signed out and signs in again. The server doesn't crash. A key kept next to the database only protects copies made without that file, such as a leaked backup. On the hosted server, keep the key out of backups' reach: set it as a Fly secret (`fly secrets set OMAGARI_TOKEN_KEY=$(openssl rand -hex 32) -a "$FLY_APP"`), and don't put it on the volume the backup copies.

`OMAGARI_SOURCE_URL` sets the "Source code" link in the settings window (Info). It defaults to `https://github.com/omagari-dev/omagari`. If you change the server's code and let people use it over the network, point this at your fork (AGPL-3.0 section 13).

GIFs in chat ([ADR-0044](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0044-gif-from-giphy-through-server-reactions-in-contract.md)) turn on when `GIPHY_API_KEY` holds a [GIPHY developer key](https://developers.giphy.com/dashboard/). Without it, the composer has no GIF button. The server adds the key and searches GIPHY on the browser's behalf, so the key never reaches the web UI. The server stays under the beta key's 100 requests an hour. With a production key, raise the limit with `GIPHY_PER_HOUR`. On Fly, set it with `fly secrets set GIPHY_API_KEY=<key> -a "$FLY_APP"`.

If a web build exists (`npm run build -w @omagari/web` creates `packages/web/dist`), the server serves it at the same address and sends unknown paths to its first file. While developing, use `npm run web` (Vite). The health check is `GET /api/health`.

## Limits

Limits ([ADR-0052](https://github.com/omagari-dev/omagari/blob/dev/docs/adr/0052-hosted-beta-on-the-dogfood-server-by-request.md)) keep one person or team from using up a shared server. Each is a setting, and an unset one is no limit, so a server with none works as before. When one is hit, the server answers `429` with the error code `limited` and which limit it was, the web shows a banner naming it, and the CLI prints the same sentence.

| Setting | Limit | Hosted server |
| --- | --- | --- |
| `OMAGARI_LIMIT_REQUESTS` | API requests per person a minute | 120 |
| `OMAGARI_LIMIT_REPOS` | Repos per workspace. Adding one more is refused | 20 |
| `OMAGARI_LIMIT_STORAGE_MB` | Megabytes a workspace keeps: messages and Q&A, plus the file content and conflict snapshots its runners shared. Past it, new messages, post replies, and Q&A are refused; runners keep sharing, and their content drops after 30 days | 100 |
| `OMAGARI_LIMIT_GIFS` | GIF searches per workspace an hour, inside the server-wide `GIPHY_PER_HOUR` | 20 |

The hosted numbers come from the dogfood server on 2026-11-21: at most 2 repos in a workspace and under 50 KB stored per workspace (1.5 MB database). They leave lots of room above that, and five full workspaces still fit the 1 GB volume. 20 GIF searches an hour lets five workspaces share the beta key's 100. On Fly: `fly secrets set OMAGARI_LIMIT_REQUESTS=120 OMAGARI_LIMIT_REPOS=20 OMAGARI_LIMIT_STORAGE_MB=100 OMAGARI_LIMIT_GIFS=20 -a "$FLY_APP"`.

Request counts live in memory, so a restart starts them over. Only signed-in HTTP requests count; the live connections of the web and runners don't.

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

Litestream uploads every 10 seconds, so a total loss of the volume can lose the last 10 seconds of writes. That keeps the hosted backup inside the free request limit. The volume's daily snapshots are the second copy.

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
