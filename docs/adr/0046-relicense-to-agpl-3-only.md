---
status: accepted
---

# Relicense to AGPL-3.0-only

Omagari is a server. Anyone can take it, change it, and run it as a service for other people. Under MIT they don't have to share those changes. We want people who modify Omagari and run it as a service to share their changes with the people who use it. The network clause (section 13) of AGPL-3.0 covers that case. Decided on 2026-11-19 by @Pancheble (#324).

- **The license is AGPL-3.0-only.** `LICENSE` holds the GNU text unchanged, and every `package.json` has `"license": "AGPL-3.0-only"`. `-only` fixes the version, so a later AGPL version does not apply to Omagari unless we change the license again. `-or-later` would let anyone pick a future version we have not reviewed.
- **Versions already published stay MIT.** People who have them keep MIT. The new license applies from the commit that changes it. There are no release tags yet, so the first release (v0.1.0) is AGPL-3.0.
- **Running it unmodified has no obligations.** Section 13 only applies when someone changes the code and lets other users interact with that changed version over a network.
- **Teams' own repos are not affected.** Omagari watches the repos of teams that use it, but it does not copy or link their code into Omagari. Their code keeps its own license.
- **Dependencies are compatible.** Runtime dependencies are MIT, Apache-2.0, ISC, or OFL-1.1 (fonts). All of them can be combined with AGPL-3.0.
- **Contributions come in under AGPL-3.0 (inbound = outbound).** There is no CLA. Every commit so far is by @Pancheble, so no one else has to agree. If we later want to offer the code under another license too, we need a CLA or each contributor's consent.
- **The source link that section 13 asks for in the web UI** is a separate issue (#325). It lands with the settings window.

## Considered Options

- **Keep MIT**: rejected. It lets a modified server run as a closed service without sharing changes, which is the case we want to cover.
- **Apache-2.0**: rejected. It has no network clause, so it has the same gap as MIT.
- **FSL (Functional Source License)**: rejected. It is not an OSI-approved open source license, and it limits competing use for two years before it turns into Apache-2.0 or MIT. We want the open license from the start.
- **PolyForm Noncommercial**: rejected. It stops companies from using Omagari at all, and that cuts off the teams we want to use it.
- **AGPL-3.0-or-later**: rejected for now. `-only` keeps the terms fixed to the version we reviewed. We can revisit this if the FSF publishes a version we want to adopt.
