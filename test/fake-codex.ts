// 가짜 Codex CLI. 테스트가 PATH 맨 앞에 두어 러너의 실제 `codex` 실행기가 이것을 부른다(harness의 `fakeCodex`).
// 문서의 JSONL(Codex 비대화 모드)을 낸다: `thread.started`(`thread_id`), `item.completed`(`agent_message`의 `text`), `turn.completed`.
// 받은 인자, 표준 입력, 작업 폴더를 `FAKE_CODEX_CALLS`(JSONL)에 한 줄씩 적는다.
// 답은 받은 글의 마지막 줄 앞에 "Codex: "를 붙인 것이다. 마지막 줄이 "실패"면 `turn.failed`를 내고 1로 끝난다.
// `codex login status`는 `$CODEX_HOME/auth.json`이 있을 때만 로그인한 것이다(실제 codex처럼 없으면 1로 끝난다).
// `codex mcp list --json`은 `FAKE_CODEX_MCP`(쉼표로 이은 이름)의 서버를 켜진 것으로 낸다.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  // 주인이 설정한 MCP 서버. 테스트가 `FAKE_CODEX_MCP`에 이름을 쉼표로 이어 준다.
  const names = process.env.FAKE_CODEX_MCP?.split(",").filter(Boolean) ?? [];
  console.log(JSON.stringify(names.map((name) => ({ name, enabled: true }))));
} else if (args[0] === "exec") {
  const input = readFileSync(0, "utf8");
  const calls = process.env.FAKE_CODEX_CALLS;
  if (calls) appendFileSync(calls, `${JSON.stringify({ args, input, cwd: process.cwd() })}\n`);
  const at = args.indexOf("resume");
  const thread = at >= 0 ? (args[at + 1] ?? "") : randomUUID();
  const last = input.trimEnd().split("\n").at(-1) ?? "";
  say({ type: "thread.started", thread_id: thread });
  say({ type: "turn.started" });
  if (last === "실패") {
    say({ type: "error", message: "Reconnecting... 1/5" });
    say({ type: "turn.failed", error: { message: "사용량 한도에 걸렸다" } });
    process.exitCode = 1;
  } else {
    say({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "생각" } });
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
  console.error(`가짜 codex가 모르는 명령이다: ${args.join(" ")}`);
  process.exitCode = 2;
}
