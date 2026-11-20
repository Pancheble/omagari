---
status: accepted
---

# The hosted beta is the dogfood server at omagari.org; teams request access and the operator approves

@Pancheble asked whether everyone could just use our server, the way everyone uses Discord's (#342). One server already holds many workspaces (ADR-0043), and runners stay on members' machines, so only the server is hosted. Self-hosting stays first-class: nothing here makes a self-hosted server worse. Decided on 2026-11-20 by @Pancheble in the stage 7 grilling (`docs/stage7-questions.md` Q2, Q3, Q7, Q8, Q9, Q12).

- **The hosted server is the dogfood server during the beta.** One Fly machine that follows `dev` (ADR-0042), and runners install npm `next` (ADR-0048). The web says it's a beta. Whether a second server that follows `main` comes when the beta opens wider is decided then.
- **Access is requested and approved.** A person who signs in under an account the server doesn't accept can request that account (an organization or their own). The server's operators, a list in the server settings, see the requests in the web and approve or deny them. An approved account joins the accepted-accounts list without a redeploy; the `OMAGARI_REPO` setting still works as before. Requests need agreeing to the terms and privacy policy, when the server has them.
- **Free, with GitHub Sponsors.** No paid features and no payments in stage 7. Payments in Korea usually need a business registration first.
- **The address is `app.omagari.org`.** `omagari setup` with no address uses it. A domain keeps the address when the server moves. `.org` isn't on the HSTS preload list by itself, so the server sends HSTS.
- **Limits are settings.** Per person (requests) and per workspace (repos, stored size, GIF searches an hour). When a limit is hit, the web and CLI say which one. Unset means no limit, so a self-hosted server works as before. The hosted server sets them.
- **GIFs need a GIPHY production key.** Until it comes, the hosted server splits the beta key's hourly budget across workspaces.

## Considered Options

- **Invite codes**: one more thing to make and hand out.
- **Anyone who signs in gets a workspace**: strangers' code and our costs come in before the limits and legal text are tested. ADR-0043 rejected this for the dogfood server too.
- **A separate hosted server that follows `main`**: about $5 a month more, and new features wait for a release (ADR-0022).
- **Paid plans like Plausible**: needs a business registration and payment provider first.
- **Keep `*.fly.dev`**: free, but the address changes if we leave Fly, and it ships in the npm package.
- **`omagari.dev`**: matches the organization name and is HTTPS-only by itself. @Pancheble picked `.org`.
- **No GIFs on the hosted server**: the GIF button is part of the Discord feel (ADR-0044).

## Consequences

- The dogfood server's database holds strangers' data, so schema and deploy mistakes reach them. Backups and restores matter more (ADR-0055).
- The npm package ships the hosted address. Self-hosters pass their own address to `setup`, as today.
- A person buys the domain, enrolls in GitHub Sponsors, and applies for the GIPHY key.
