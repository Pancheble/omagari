// Fake Codex CLI. Tests put it first on PATH so the runner's real `codex` executor calls it (the harness's `fakeCodex`).
// Prints the documented JSONL (Codex non-interactive mode): `thread.started` (`thread_id`), `item.completed` (`text` of `agent_message`), `turn.completed`.
// It appends the args, stdin, and working folder to `FAKE_CODEX_CALLS` (JSONL), one line per call.
// The answer is the last line of the input with "Codex: " in front. If the last line is "fail", it prints `turn.failed` and exits with 1.
// `codex login status` counts as logged in only when `$CODEX_HOME/auth.json` exists (like the real codex, it exits with 1 if not).
// `codex mcp list --json` reports the servers in `FAKE_CODEX_MCP` (comma-separated names) as enabled.
// `codex app-server` answers `initialize` and `model/list` over JSON-RPC (one hidden model and one default model are mixed in).
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const say = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (args[0] === "login" && args[1] === "status") {
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  if (existsSync(join(home, "auth.json"))) console.log("Logged in using ChatGPT");
  else {
    console.error("Not logged in");
    process.exitCode = 1;
  }
} else if (args.join(" ") === "mcp list --json") {
  // MCP servers the owner set up. Tests pass the names to `FAKE_CODEX_MCP` joined with commas.
  const names = process.env.FAKE_CODEX_MCP?.split(",").filter(Boolean) ?? [];
  console.log(JSON.stringify(names.map((name) => ({ name, enabled: true }))));
} else if (args[0] === "app-server") {
  const efforts = (...names: string[]) =>
    names.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }));
  const models = [
    {
      model: "gpt-6-luna",
      displayName: "GPT-6-Luna",
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: efforts("low", "medium", "high", "xhigh", "max"),
    },
    {
      model: "gpt-5.6-terra",
      displayName: "GPT-5.6-Terra",
      hidden: false,
      isDefault: false,
      supportedReasoningEfforts: efforts("low", "medium", "high", "xhigh", "max", "ultra"),
    },
    {
      model: "codex-auto-review",
      displayName: "Codex Auto Review",
      hidden: true,
      isDefault: false,
      supportedReasoningEfforts: efforts("low"),
    },
  ];
  for await (const line of createInterface({ input: process.stdin })) {
    const { id, method } = JSON.parse(line);
    if (method === "initialize") say({ id, result: { userAgent: "fake" } });
    if (method === "model/list") say({ id, result: { data: models, nextCursor: null } });
  }
} else if (args[0] === "exec") {
  const input = readFileSync(0, "utf8");
  const calls = process.env.FAKE_CODEX_CALLS;
  if (calls) appendFileSync(calls, `${JSON.stringify({ args, input, cwd: process.cwd() })}\n`);
  const at = args.indexOf("resume");
  const thread = at >= 0 ? (args[at + 1] ?? "") : randomUUID();
  const last = input.trimEnd().split("\n").at(-1) ?? "";
  say({ type: "thread.started", thread_id: thread });
  say({ type: "turn.started" });
  if (last === "fail") {
    say({ type: "error", message: "Reconnecting... 1/5" });
    say({ type: "turn.failed", error: { message: "usage limit reached" } });
    process.exitCode = 1;
  } else {
    say({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } });
    say({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: `Codex: ${last}` },
    });
    say({
      type: "turn.completed",
      usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
    });
  }
} else {
  console.error(`fake codex doesn't know this command: ${args.join(" ")}`);
  process.exitCode = 2;
}
