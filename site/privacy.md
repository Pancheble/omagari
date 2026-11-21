# Privacy policy

[한국어](/ko/privacy)

This policy is for the **hosted Omagari server** at `app.omagari.org`. If your team runs its own server, your team's operator decides what's stored there, and this policy doesn't apply.

Last updated: 2026-11-21 · In force from: 2026-11-21

## 1. Who we are

The operator of the hosted server, and the person responsible for personal information, is Chan Baek. Contact: `privacy@omagari.org`.

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
- **Daily visit records, and pending or denied access requests**: for 12 months, or until the workspace or account is deleted if that comes first. Approved access requests are kept while the account stays accepted, so it stays accepted after a restart.
- **Backups**: the host's disk keeps daily snapshots for 5 days. Deleted data leaves the backups within 5 days. We'll update this policy before we add a backup outside the host. We don't restore a backup to bring back deleted data, except to recover from an outage; if we do, we delete again what was deleted.

## <a id="delete"></a>4. Deleting your data

You don't need to email us to delete.

- **Your account** (Settings): your tokens, sessions, profile, presence, works, and settings are deleted. Your old messages stay and show as a deleted member, so conversations still read. To have messages removed too, email us.
- **A repo's data**: a GitHub Admin of the repo removes the repo and deletes its data.
- **A workspace**: a person who is a GitHub Admin of every repo in it deletes the workspace. (Omagari doesn't read organization roles.)
- **Changed-file content and patches** also delete themselves after 30 days (section 3).

Deleted rows are overwritten in the database file, not just marked free. To uninstall the GitHub App, use your GitHub settings; that stops new data coming in.

## 5. Who else handles it, and moving data abroad

We use these services to run Omagari. We give your data to no one else unless the law requires it. The people in your workspace see what you share with them: that's the point of the service.

The server and these services are outside Korea, so personal information moves abroad. This is storage and handling needed to carry out our agreement with you, so under PIPA Article 28-8(1)3(a) we tell you the following here instead of asking for separate consent.

| | Fly.io | GitHub | GIPHY |
| --- | --- | --- | --- |
| Items sent | Everything the server stores (section 2) | GitHub login, tokens, repo names, and the decision PRs, issues, and labels the server writes to GitHub | Your computer's connection details (IP address, browser info). GIF search words are sent by our server with our key and aren't tied to your login or account, so we judge them not to be personal information |
| Country, when, how | Japan (the server is in Tokyo; the company is in the USA). Over the network, all the time you use the service | USA and others. Over the network, whenever you sign in or use a GitHub feature | USA. Over the network, whenever you search or view a GIF |
| Recipient and contact | Fly.io, Inc. · compliance@fly.io | GitHub, Inc. · privacy contact form (linked from GitHub's privacy statement) | GIPHY, Inc. · support@giphy.com |
| Their purpose and retention | Running the server and disk. Until we delete it; disk snapshots 5 days | Sign-in and repo access. Under GitHub's own policy | GIF search and images. Under GIPHY's own policy |
| How to refuse, and what happens | Don't use the hosted server; you can run your own. If you refuse, you can't use the hosted server | Same. You can't sign in without GitHub | Just don't use GIFs. Everything else works the same |

Contacts and retention come from each company's own policy: [Fly.io privacy statement](https://fly.io/legal/privacy-policy/), [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), GIPHY's [consent document](https://support.giphy.com/hc/en-us/articles/360032520632).

## 6. Your rights

You can ask to see, fix, delete, or stop the handling of your personal information, and to withdraw your consent. Use the buttons in section 4 or email `privacy@omagari.org`. We answer within 10 days. If you're in the EU, you also have the rights GDPR gives you, including the right to complain to your data protection authority. You can also contact the Korean Personal Information Protection Commission (privacy.go.kr, 182).

## 7. How we keep it safe

GitHub tokens are encrypted at rest and their key isn't stored with the backups. The server uses HTTPS only. We keep the database and backups private and limit who can reach them to the operator. We have a written plan for outages and leaks. If personal data leaks, we tell affected workspaces' admins and the authorities in the time the law asks.

## 8. Children

The service is for developers and isn't meant for children under 14. We don't knowingly collect their data.

## 9. Changes

We'll put changes here with a new date, and say so in the web app when they matter. The old versions are in the repo history.
