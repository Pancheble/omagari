# Security policy

## Supported versions

| Version | Security fixes |
|---|---|
| Latest release (`main`) | Supported |
| `dev` | Supported (goes into the next release) |
| Older releases | Not supported |

## Reporting a vulnerability

If you find a security vulnerability, don't open a public issue or comment on a PR. Send it through the private channel below.

- GitHub [private vulnerability reporting](https://github.com/omagari-dev/omagari/security/advisories/new) (Security → Report a vulnerability)

Please include these so we can confirm it faster:

- The affected part (package, file, endpoint) and version (release tag or commit)
- Steps to reproduce, or a proof of concept
- The impact you expect

The maintainer @Pancheble receives and checks reports. We'll reply as soon as we can, and when we disclose after the fix, we'll ask whether you want to be named.

## Disclosure

We disclose a vulnerability after the fix is merged and any needed release is out. If the fix takes longer, we'll agree on a disclosure date with you.

## Hosted server incidents

If the hosted server (`app.omagari.org`) has an outage or a possible personal data leak, the operator follows the internal plan in [docs/hosted-incident-plan.md](docs/hosted-incident-plan.md).
