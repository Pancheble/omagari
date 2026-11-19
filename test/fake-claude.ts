// Fake Claude Code CLI. Tests put it first on PATH so the runner's real `claudeCode` executor calls it (the harness's `fakeClaude`).
// `claude -p --output-format=stream-json` (one turn): prints `system`/`init` (`model`), `assistant`, and `result`, one per line.
//   The answer is the last line of the input with "Claude: " in front. The model is `--model`, or the default (Fable 5.2) if absent.
//   It appends the args, stdin, and working folder to `FAKE_CLAUDE_CALLS` (JSONL), one line per call.
// `claude -p --input-format=stream-json`: for the `initialize` control request, prints `models` in the shape the Agent SDK receives.
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const say = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`);
const flag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** Like the real Claude Code, it reports "default" together with names that point to the same model. */
const MODELS = [
  {
    value: "default",
    resolvedModel: "claude-fable-5-2",
    displayName: "Default (recommended)",
    supportedEffortLevels: EFFORTS,
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus 5.5",
    supportedEffortLevels: EFFORTS,
  },
  {
    value: "claude-fable-5-2",
    resolvedModel: "claude-fable-5-2",
    displayName: "Fable 5.2",
    supportedEffortLevels: EFFORTS,
  },
  { value: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
];

if (args.includes("--input-format=stream-json")) {
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    if (request.request?.subtype !== "initialize") continue;
    say({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.request_id,
        response: { commands: [], models: MODELS },
      },
    });
  }
} else if (args[0] === "-p") {
  const input = readFileSync(0, "utf8");
  const calls = process.env.FAKE_CLAUDE_CALLS;
  if (calls) appendFileSync(calls, `${JSON.stringify({ args, input, cwd: process.cwd() })}\n`);
  const model = flag("model") ?? "claude-fable-5-2";
  const session = flag("resume") ?? randomUUID();
  const text = `Claude: ${input.trimEnd().split("\n").at(-1) ?? ""}`;
  say({ type: "system", subtype: "init", session_id: session, model });
  say({ type: "assistant", message: { model, content: [{ type: "text", text }] } });
  say({ type: "result", subtype: "success", is_error: false, result: text, session_id: session });
} else {
  console.error(`fake claude doesn't know this command: ${args.join(" ")}`);
  process.exitCode = 2;
}
