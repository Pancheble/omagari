#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { text } from "node:stream/consumers";
import { CONTRACT_VERSION, cliToRunner, decode, encode, runnerToCli } from "@omagari/contract";
import { type RunRecord, runnerPaths } from "@omagari/runner";
import manifest from "../package.json" with { type: "json" };

const USAGE = `사용법:
  omagari --version
  omagari runner ask <메시지>   이 레포의 러너 세션에 묻는다. 다음 질문은 같은 세션으로 이어진다
  omagari runner log            러너가 실행한 것을 본다`;

// 명령은 그것을 만드는 이슈가 더한다: 러너 켜기와 로그인(#8), status(#12), 훅과 스킬 깔기(#15).
const [command, sub, ...rest] = process.argv.slice(2);
try {
  if (command === "--version") {
    console.log(`omagari ${manifest.version} (contract ${CONTRACT_VERSION})`);
  } else if (command === "runner" && sub === "ask" && rest.length > 0) {
    console.log(await ask(rest.join(" ")));
  } else if (command === "runner" && sub === "log") {
    await log();
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

/** 이 폴더의 레포에 짝지어진 러너에 묻고 답을 돌려준다. */
async function ask(message: string) {
  const { socket } = await runnerPaths(process.cwd());
  const connection = connect(socket);
  connection.end(encode(cliToRunner, "ask", { message }));
  const frame = await text(connection).catch(() => {
    throw new Error(`러너가 꺼져 있다: ${socket}`);
  });
  const decoded = decode(runnerToCli, frame);
  if ("error" in decoded) throw new Error(`러너의 답을 읽지 못했다: ${decoded.error.message}`);
  const { message: reply } = decoded;
  if (reply.kind === "error") throw new Error(`러너가 답하지 못했다: ${reply.payload.message}`);
  return reply.payload.text;
}

/** 실행 기록을 한 줄에 하나씩 보인다. 기록은 이 기기에만 있다. */
async function log() {
  const { log } = await runnerPaths(process.cwd());
  const lines = await readFile(log, "utf8").catch(() => "");
  if (!lines) return console.log("러너가 실행한 것이 아직 없다");
  for (const line of lines.trimEnd().split("\n")) {
    const run: RunRecord = JSON.parse(line);
    const outcome = run.error ? `실패: ${run.error}` : "답함";
    console.log(
      `${run.at}  세션 ${run.session ?? "(새 세션)"}  도구 ${run.tools.join(",")}  받은 것 ${JSON.stringify(run.message)}  ${outcome}`,
    );
  }
}
