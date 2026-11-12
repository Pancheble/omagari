// 가짜 Claude Code CLI. 테스트가 PATH 맨 앞에 두어 러너의 실제 `claudeCode` 실행기가 이것을 부른다(harness의 `fakeClaude`).
// `claude -p --output-format=stream-json`(한 턴): `system`/`init`(`model`), `assistant`, `result`를 한 줄씩 낸다.
//   답은 받은 글의 마지막 줄 앞에 "Claude: "를 붙인 것이다. 모델은 `--model`, 없으면 기본(Fable 5.2)이다.
//   받은 인자, 표준 입력, 작업 폴더를 `FAKE_CLAUDE_CALLS`(JSONL)에 한 줄씩 적는다.
// `claude -p --input-format=stream-json`: 제어 요청 `initialize`에 Agent SDK가 받는 모양의 `models`를 낸다.
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const say = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`);
const flag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** 실제 Claude Code가 알려 주는 것처럼 "default"와, 같은 모델을 가리키는 이름이 함께 온다. */
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
  console.error(`가짜 claude가 모르는 명령이다: ${args.join(" ")}`);
  process.exitCode = 2;
}
