---
status: accepted
---

# Hosted operations: Litestream backups with a monthly restore drill, an Upptime status page, and a written incident plan

The dogfood server is one Fly machine with one SQLite file, backed up by the volume's daily snapshots, kept 5 days (ADR-0042). Nothing tells anyone when it's down. With strangers' data on it, that isn't enough. Money is tight, so every piece is free. Decided on 2026-11-20 by @Pancheble (`docs/stage7-questions.md` Q10).

- **Litestream** streams the database to an S3-compatible bucket on a free tier (Tigris or Cloudflare R2, picked at sign-up). The volume snapshots stay as a second copy. Without the bucket settings, the server runs as today, so self-hosted servers aren't affected.
- **A monthly restore drill.** A scheduled GitHub Actions job restores the latest replica, starts a server on it, and checks the health endpoint. If it fails, the job fails and GitHub notifies @Pancheble.
- **A status page with Upptime** in its own public repo, on GitHub Pages at `status.omagari.org`. It checks the health endpoint every few minutes and opens an issue when the server is down.
- **An incident plan** in the repo docs: who does what when the server is down or data leaks. Post on the status page; if personal data leaked, email the affected workspaces' admins within 72 hours and report as PIPA and GDPR ask. The public text stays general.
- **One machine and SQLite stay.** We revisit when the database or load outgrows one machine.

## Considered Options

- **Volume snapshots only**: up to a day lost, and nobody has ever restored one.
- **A paid status page or monitoring service**: costs money; Upptime is free on a public repo.
- **Postgres or several machines**: more cost and moving parts than a beta needs.

## Consequences

- A person signs up for the bucket and puts its keys in Fly secrets and in the `dogfood` GitHub environment.
- A person creates the status repo; Upptime needs a token secret.
- Litestream syncs every 10s (`sync-interval`, on the replica) and checks L0 retention every 1m (`l0-retention-check-interval`, top level). The default 1s sync makes about 2.6 million PUTs a month under steady writes, past R2's free 1 million Class A requests (PutObject and ListObjects are Class A). At 10s, the worst case if every interval uploads or lists is about 259k L0 PUTs, 86k L1, 9k L2, 1k L3, 43k retention lists, and up to 96k compaction lists: about 494k a month, under the limit. The trade-off: if the volume is lost, up to 10 seconds of writes are gone from the replica. The volume snapshots stay as the second copy.

## Sources

- [Litestream: replicating to Tigris](https://litestream.io/guides/tigris/)
- [Fly: Litestream revamped](https://fly.io/blog/litestream-revamped/)
- [Upptime](https://github.com/upptime/upptime)
