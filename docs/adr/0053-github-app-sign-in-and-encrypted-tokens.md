---
status: accepted
---

# The hosted server signs in through a GitHub App, and GitHub tokens are encrypted at rest

Sign-in today asks for the OAuth `repo` scope: write access to every repo the person can reach, private ones included, and the server keeps the token in plain text. On a hosted server that means a stranger's token reaching their other employers' repos sits on our server. Decided on 2026-11-20 by @Pancheble (`docs/stage7-questions.md` Q1).

- **The hosted server uses a GitHub App.** An account's admin installs it on chosen repos. It asks only for what the server uses: metadata (read), contents, issues, and pull requests (read and write; decision PRs, post issues, labels, merges, the check command file). The user token it gets is limited to what both the App and the person can do.
- **Sign-in stays device flow.** The server code already accepts a GitHub App's client ID; the scope is ignored for an App. Tokens from an App expire after 8 hours. The server keeps the refresh token (valid 6 months) and refreshes before use. A device-flow token refreshes without a client secret, so the server still needs no secret from GitHub. When the refresh token is gone or rejected, the person signs in again.
- **Not installed means not visible.** If the App isn't installed on a repo, GitHub doesn't show it to the token, so Omagari treats it as no access and says to install the App on that account, with the link.
- **Self-hosted servers can keep an OAuth app.** Both kinds of client ID keep working. The docs show how to create either.
- **Tokens are encrypted at rest** on every server, hosted or not. A key from the server settings encrypts access and refresh tokens. A server without the key makes one next to the database on first start and logs where. Existing plain tokens are encrypted on start.

## Considered Options

- **Keep the OAuth app and only encrypt tokens**: one sign-up step shorter, but the token still reaches every repo the person can.
- **Act as the App installation instead of the person**: GitHub would show the bot as the author of decision PRs and post issues, not the member (ADR-0025, ADR-0032).
- **Require a key and refuse to start without one**: breaks existing self-hosted servers.

## Consequences

- Moving the dogfood server from its OAuth app to the GitHub App signs everyone out once. A person creates the App and swaps the client ID.
- An organization that turned on OAuth app access restrictions no longer needs the OAuth approval (ADR-0043); it installs the App instead.
- A key kept next to the database only protects copies of the database made without that file, like a leaked backup. The hosted server keeps the key in Fly secrets.

## Sources

- [GitHub: refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [GitHub: expiring user-to-server tokens](https://developer.github.com/changes/2020-04-30-expiring-user-to-server-access-tokens-for-github-apps)
