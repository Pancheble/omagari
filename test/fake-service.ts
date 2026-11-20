// Fake launchctl and systemctl (ADR-0050). Tests put them first on PATH so `omagari setup` and `uninstall` don't register a real service on the machine running the tests.
// The first argument is the command it stands for. It appends that and the rest of the args to `FAKE_SERVICE_CALLS` (JSONL) and succeeds.
import { appendFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
appendFileSync(process.env.FAKE_SERVICE_CALLS ?? "", `${JSON.stringify([command, ...args])}\n`);
