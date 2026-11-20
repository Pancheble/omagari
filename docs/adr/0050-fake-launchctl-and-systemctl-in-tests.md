---
status: accepted
---

# Tests fake launchctl and systemctl

`omagari setup` now registers the background runner with launchd (macOS) or a systemd user unit (Linux, WSL2) (ADR-0049), and `omagari uninstall` removes it. Behavior tests run setup, so without a fake every test run would register a real service on the developer's machine or on CI. Decided on 2026-11-20 by @Pancheble in #352.

- The harness puts fake `launchctl` and `systemctl` first on the CLI's PATH, the same way it fakes `claude` and `codex`. They record their arguments and succeed.
- The CLI gets a temp `HOME`, so the launchd plist is written there and not in the real `~/Library/LaunchAgents`.
- Unit tests check the plist and unit text. The real registration is checked by hand on macOS, and the steps and result go in the PR.

## Considered Options

- **An environment switch that skips registration** (`OMAGARI_SERVICE=off`): no new fake, but the behavior tests would never see which service commands setup and uninstall run.
