# Privacy policy

<!-- DRAFT for @Pancheble to read, edit, and approve. Not legal advice. Remove this comment and fill every [PLACEHOLDER] before publishing. Follows the item order of the Korean PIPA Article 30 and Enforcement Decree Article 31. -->

[한국어](/ko/privacy)

This policy is for the **hosted Omagari server** at `app.omagari.org`. If your team runs its own server, your team's operator decides what's stored there, and this policy doesn't apply.

Last updated: [DATE — set when published] · In force from: [DATE]

## 1. Who we are

The operator of the hosted server, and the person responsible for personal information, is [OPERATOR REAL NAME — placeholder]. Contact: `privacy@omagari.org` (mail forwarding isn't set up yet, #391).

## 2. What we store and why

We store what the server needs to show your team who's working on what and to let you talk about it. Nothing here is for ads, and we don't sell it.

| What | Why |
| --- | --- |
| Your GitHub login and profile name | Sign-in, and showing you to your team |
| GitHub tokens (access and refresh), **encrypted** | Asking GitHub on your behalf: your push access, decision PRs, issues, labels, merges. The server keeps them; your machine never sees them |
| Access requests: the account, who asked, the result, who decided | Letting the operator approve accounts |
| Which repos you can push to, and which you shared | Showing you only your repos |
| Your work: branch names, the paths of changed files, and with share level `full`, the **content** of changed files | Finding conflicts between teammates' work and running merge checks |
| One-line status, presence, status message and emoji, your settings | Showing it to your team, and your settings across devices |
| Chat messages, Q&A, forum posts, reactions, and the debate patches (diffs up to 64 KB) | The conversation and decisions in the workspace |
| Which day you opened the app, per workspace (login and date) | Counting active use |
| GIF search words | Searching GIPHY for you (see section 5) |

We don't ask for your email, phone number, or payment details. The server sets no tracking cookies: the web app keeps your sign-in and a few picks in the browser's local storage.

## 3. How long we keep it

- **Changed-file content and debate patches**: deleted once their branch is gone or hasn't changed for **30 days**.
- **Chat, Q&A, and posts**: until they're deleted or the workspace, repo, or account is deleted.
- **Tokens and sessions**: until you sign out or delete your account. GitHub's own tokens expire after 8 hours and are refreshed; the refresh token lasts up to 6 months.
- **Daily visit records and access requests**: until the workspace or account is deleted. [CONFIRM: is a limit wanted, e.g. 12 months?]
- **Backups**: the database is copied continuously to a backup bucket, and the host's volume keeps daily snapshots for 5 days. Deleted data leaves backups after [BACKUP RETENTION — placeholder: not decided yet; set from the Litestream retention in #399/#391]. We don't restore a backup to bring back deleted data, except to recover from an outage; if we do, we delete again what was deleted.

## <a id="delete"></a>4. Deleting your data

You don't need to email us to delete.

- **Your account** (Settings): your tokens, sessions, profile, presence, works, and settings are deleted. Your old messages stay and show as a deleted member, so conversations still read. To have messages removed too, email us.
- **A repo's data**: a GitHub Admin of the repo removes the repo and deletes its data.
- **A workspace**: a person who is a GitHub Admin of every repo in it deletes the workspace. (Omagari doesn't read organization roles.)
- **Changed-file content and patches** also delete themselves after 30 days (section 3).

Deleted rows are overwritten in the database file, not just marked free. To uninstall the GitHub App, use your GitHub settings; that stops new data coming in.

## 5. Who else handles it

We use these services to run Omagari. They handle data on our behalf or receive it because you use the feature.

| Who | What for | What they get | Where |
| --- | --- | --- | --- |
| Fly.io | Runs the server and its disk | Everything the server stores | Tokyo, Japan (`nrt`) |
| [BACKUP BUCKET PROVIDER — placeholder: Tigris or Cloudflare R2, #391] | Backups of the database | A copy of the whole database | [REGION] |
| GitHub | Sign-in and repos | What the server asks it for; GitHub knows what you do there | USA and others |
| GIPHY | GIF search and GIF images | Your search words (sent by our server, with our key); your browser loads the images from GIPHY, so GIPHY sees that request like any web site | USA |

We give your data to no one else unless the law requires it. The people in your workspace see what you share with them: that's the point of the service.

**Moving data abroad.** The server is in Japan, backups and the services above may be elsewhere. By using the hosted server you agree to this. If you don't want it, don't use the hosted server: you can run your own.

## 6. Your rights

You can ask to see, fix, delete, or stop the handling of your personal information, and to withdraw your consent. Use the buttons in section 4 or email `privacy@omagari.org`. We answer within 10 days. If you're in the EU, you also have the rights GDPR gives you, including the right to complain to your data protection authority. You can also contact the Korean Personal Information Protection Commission (privacy.go.kr, 182).

## 7. How we keep it safe

GitHub tokens are encrypted at rest and their key isn't stored with the backups. The server uses HTTPS only. We keep the database and backups private and limit who can reach them to the operator. We have a written plan for outages and leaks. If personal data leaks, we tell affected workspaces' admins and the authorities in the time the law asks.

## 8. Children

The service is for developers and isn't meant for children under 14. We don't knowingly collect their data.

## 9. Changes

We'll put changes here with a new date, and say so in the web app when they matter. The old versions are in the repo history.
