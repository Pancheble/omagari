# Stage 7 grilling: questions, what we answered ourselves, what's open

The scope is the milestone "7 Hosted beta": run Omagari as a hosted service that teams can sign up for, next to self-hosting. The input is issue #342.

Where we looked, in the order AGENTS.md asks: `GLOSSARY.md`, ADR-0011, 0012, 0042, 0043, 0044, 0046, 0048, 0049, 0051, `site/server.md`, `site/faq.md`, the server's GitHub boundary (`packages/server/src/github.ts`: device flow, the `repo` scope, tokens in `sessions.github_token`), and how other AGPL projects run a hosted service next to self-hosting (Plausible, Stoat, formerly Revolt). Sources are at the end.

Running example used in every question: Jisu's team of three works in the private repo `acme/shop` under the GitHub organization `acme`. They don't want to run a server; they want to sign up on ours.

## 0. Decided

@Pancheble decided Q1–Q12 on 2026-11-20. The PRD is the body of #342.

| #   | Decided                                                                                                                                             | Recorded in |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Q1  | The hosted server signs in through a GitHub App, installed on chosen repos. Tokens are encrypted at rest. Self-hosted servers can keep an OAuth app | ADR-0053    |
| Q2  | Teams request access in the web, and the operator approves them. No redeploy                                                                        | ADR-0052    |
| Q3  | During the beta the hosted server is the dogfood server (Fly, follows `dev`, runners on npm `next`)                                                 | ADR-0052    |
| Q4  | The default share level stays `full`, and sharing a repo says plainly where the content goes                                                        | ADR-0054    |
| Q5  | An agent drafts the privacy policy and terms (English and Korean); @Pancheble reads, edits, and publishes them                                      | ADR-0054    |
| Q6  | Self-serve deletion for repos, workspaces, and accounts; changed-file content and patches are dropped by themselves                                 | ADR-0054    |
| Q7  | Free, with GitHub Sponsors. No paid plans or payments in stage 7                                                                                    | ADR-0052    |
| Q8  | Buy a domain                                                                                                                                        | ADR-0052    |
| Q9  | Apply for a GIPHY production key; limits per person and per workspace, which a self-hosted server can leave off                                     | ADR-0052    |
| Q10 | Continuous backup with Litestream, a monthly restore drill in CI, an Upptime status page, and a written incident plan                               | ADR-0055    |
| Q11 | The privacy policy names the operator by real name, with a contact address on the domain                                                            | ADR-0054    |
| Q12 | The domain is `omagari.org` (@Pancheble's pick)                                                                                                     | ADR-0052    |

## 1. What we asked

### Q1. GitHub access

Today sign-in asks for the OAuth `repo` scope: write access to every repo the person can reach, private ones included. If Jisu can also reach another company's repos, our server holds a token that can write to those too. The server code already works with a GitHub App's user token (device flow ignores the scope for an App). What changes: user tokens expire every 8 hours and are refreshed (the refresh token lasts 6 months), and an `acme` admin installs the App on `acme/shop` once.

- A. GitHub App: only installed repos, only the permissions we need (metadata, contents, issues, pull requests). Encrypt tokens at rest. Self-hosted servers can keep their OAuth app.
- B. Keep the OAuth app; only encrypt tokens.

Picked: A.

### Q2. How sign-up opens

Today only accounts on the server's accepted-accounts list (`OMAGARI_REPO`) get in.

- A. Request and approve: Jisu presses "Request access for acme" in the web, and the operator approves it without a redeploy. The approved accounts join the accepted-accounts list.
- B. Invite codes the operator hands out.
- C. Anyone who signs in gets a workspace.

Picked: A.

### Q3. Which server

- A. During the beta, the hosted server is the dogfood server: one Fly machine, follows `dev`, runners from npm `next`. Decide on a separate server that follows `main` when it opens wider.
- B. A second Fly app that follows `main` (about $5 a month more); new features land only with a release (ADR-0022).

Picked: A.

### Q4. Default share level

The default share level is `full`: the content of Jisu's changed files goes to the server so teammates' runners can run merge runs. On the hosted server that content sits on a server @Pancheble operates.

- A. Keep `full`, and say clearly when sharing a repo where the content goes and that `declared` sends paths only. The same on self-hosted servers.
- B. `declared` by default on the hosted server only.

Picked: A.

### Q5. Terms and privacy policy

Jisu's code and chat stay on our server, so both are needed. The operator is in Korea, so the Korean Personal Information Protection Act (PIPA) applies directly; it asks for a Korean privacy policy that names the person responsible. This isn't legal advice.

- A. An agent drafts both in English and Korean from the basics PIPA and GDPR ask for (what data, why, how long, where (Fly, Tokyo), how to delete, contact). @Pancheble reads, edits, and publishes them on the docs site. Free.
- B. Have a lawyer review the draft (costs money).
- C. A generator service; generic, the code part has to be added by hand.

Picked: A.

### Q6. Deletion and retention

- A. Buttons, plus automatic cleanup. A repo's GitHub Admin deletes the repo's data, the workspace can be deleted, and Jisu deletes her own account in personal settings. Changed-file content and debate patches are dropped once the branch is gone or after 30 days without change. Chat stays until it's deleted.
- B. Email the operator, who deletes by hand.

Picked: A.

### Q7. Money

Fly costs about $5 a month today. Taking payments in Korea usually needs a business registration.

- A. Free, with a GitHub Sponsors button (Stoat runs on donations this way). No paid features or payments in stage 7.
- B. Free, no sponsor button.
- C. Prepare a paid plan (Plausible's model); business registration and payments first.

Picked: A.

### Q8. Address

`omagari setup` will default to the hosted address (#342), so the address ships inside the npm package. Changing it later means everyone runs `setup` again.

- A. Buy a domain (about $10–15 a year; pointing it at Fly is free). Moving the server later keeps the address.
- B. Keep `*.fly.dev`.

Picked: A.

### Q9. Limits and GIFs

The GIPHY beta key allows 100 searches an hour for the whole server, so one busy team blocks everyone's GIFs. A production key is free but needs an application and review.

- A. Apply for a production key. Until then, split the hourly GIF budget per workspace. Add limits per person (requests) and per workspace (repos, stored size) that show the reason on screen when hit. A self-hosted server can leave them off.
- B. No GIFs on the hosted server; other limits as in A.
- C. No limits; approval is enough for now.

Picked: A.

### Q10. Operations

Today's backup is the Fly volume's daily snapshot, kept 5 days, and nothing says when the server is down.

- A. A bundle of free tools: Litestream streams the database to an object storage bucket on a free tier, and a CI job restores it once a month. Upptime (GitHub Actions and Pages) runs a status page and opens an issue when the server is down, which notifies @Pancheble. A written incident plan: note it on the status page, and email the affected workspaces' admins within 72 hours if personal data leaked. One machine and SQLite stay.
- B. Snapshots only.

Picked: A.

### Q11. Operator in the privacy policy

PIPA asks for the name or contact of the person responsible for personal information. This isn't legal advice.

- A. Real name and a `privacy@` address on the domain, forwarded for free to the existing inbox.
- B. `@Pancheble` and the domain address only.

Picked: A.

### Q12. Domain name

We offered `omagari.dev` (matches the organization `omagari-dev`, HTTPS-only TLD) and `omagari.app`. @Pancheble picked `omagari.org`. `.org` isn't HTTPS-only by itself, so the server sends HSTS. Availability is checked at purchase.

## 2. Answered ourselves

- **Workspace isolation before strangers.** The #239 audit follow-ups #317, #318, and #332 are closed.
- **Many workspaces in one web UI.** #238 is closed.
- **The server already runs with a GitHub App.** Device flow takes either kind of client ID; with an App the scope is ignored. What's missing is refreshing expired tokens and telling people to install the App.
- **Who can delete a workspace.** Omagari doesn't read org roles (ADR-0043, no `read:org`). So a person can delete a workspace only when they are a GitHub Admin of every repo in it. Repo data can be deleted by that repo's Admins.
- **Legal text only covers the hosted server.** A team that self-hosts is its own operator.
- **The legal pages are in English and Korean.** PIPA asks for a Korean policy. This is an exception to ADR-0045's "only the README has a Korean copy".

## 3. Open

- Which bucket Litestream uses (Tigris on Fly or Cloudflare R2). The person signing up picks one with a free tier; the code only needs an S3 URL.
- The numbers for the limits. The ticket picks defaults from the dogfood server's current usage.
- When the beta opens wider, and whether a second server that follows `main` comes then.

## Sources

- [GitHub: refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) (8 hours, refresh token 6 months, no client secret needed for device-flow tokens)
- [GitHub: expiring user-to-server tokens](https://developer.github.com/changes/2020-04-30-expiring-user-to-server-access-tokens-for-github-apps)
- [Plausible: self-hosting](https://plausible.io/docs/self-hosting) and [Community Edition](https://plausible.io/blog/community-edition) (AGPL, the managed service funds the work, some features cloud-first)
- [Stoat (formerly Revolt) FAQ](https://developers.stoat.chat/faq/) (AGPL, free hosted instance funded by donations)
- [Litestream: replicating to Tigris](https://litestream.io/guides/tigris/), [Fly: Litestream revamped](https://fly.io/blog/litestream-revamped/)
- [Upptime](https://github.com/upptime/upptime) (status page on GitHub Actions and Pages, free for public repos)
- [Baker McKenzie: PIPA and foreign operators](https://connectontech.bakermckenzie.com/south-korea-issues-guidelines-on-applying-the-personal-information-protection-act-to-foreign-business-operators/), [Chambers: Data Protection & Privacy 2026, South Korea](https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/south-korea)
