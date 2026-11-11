#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { setTimeout as sleep } from "node:timers/promises";
import {
  api,
  CONTRACT_VERSION,
  ContractFailure,
  call,
  cliToRunner,
  decode,
  encode,
  runnerToCli,
} from "@omagari/contract";
import {
  OBSERVATION_NOTICE,
  type RunRecord,
  readRepo,
  runnerPaths,
  startRunner,
} from "@omagari/runner";
import manifest from "../package.json" with { type: "json" };

const USAGE = `사용법:
  omagari --version
  omagari runner                레포 폴더에서 러너를 켠다. 처음이면 GitHub 기기 인증으로 로그인한다
  omagari runner ask <메시지>   이 레포의 러너 세션에 묻는다. 다음 질문은 같은 세션으로 이어진다
  omagari runner log            러너가 실행한 것을 본다

서버는 OMAGARI_SERVER로 준다(기본 http://127.0.0.1:3000).`;

const server = process.env.OMAGARI_SERVER ?? "http://127.0.0.1:3000";
// 서버마다의 세션. GitHub 토큰은 여기에 없다. 서버만 든다.
const sessionsFile = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "omagari",
  "sessions.json",
);

// 명령은 그것을 만드는 이슈가 더한다: status(#12), 훅과 스킬 깔기(#15).
const [command, sub, ...rest] = process.argv.slice(2);
try {
  if (command === "--version") {
    console.log(`omagari ${manifest.version} (contract ${CONTRACT_VERSION})`);
  } else if (command === "runner" && sub === undefined) {
    await runner();
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

async function readSessions(): Promise<Record<string, string>> {
  return JSON.parse(await readFile(sessionsFile, "utf8").catch(() => "{}"));
}

async function saveSession(session: string | undefined) {
  const sessions = { ...(await readSessions()), [server]: session };
  await mkdir(join(sessionsFile, ".."), { recursive: true, mode: 0o700 });
  await writeFile(sessionsFile, JSON.stringify(sessions, null, 2), { mode: 0o600 });
}

/** GitHub 기기 인증으로 로그인하고 세션을 남긴다. */
async function login() {
  const started = await call({ url: server }, api.login);
  console.log(`GitHub 로그인: ${started.verificationUri} 에서 코드 ${started.userCode} 를 넣어라`);
  for (;;) {
    await sleep(started.intervalMs);
    const polled = await call({ url: server }, api.loginPoll, { device: started.device });
    if ("session" in polled) {
      await saveSession(polled.session);
      console.log(`${polled.login}로 로그인했다`);
      return polled.session;
    }
  }
}

/** 이 폴더에서 러너를 켜고, 끄거나 서버가 거절할 때까지 돈다. */
async function runner() {
  const folder = process.cwd();
  await readRepo(folder); // Git 레포가 아니면 로그인하기 전에 멈춘다
  // 로그인하고 붙기 전에, 그러니 아무것도 나가기 전에 무엇이 나가는지 알린다.
  console.log(OBSERVATION_NOTICE);
  const saved = (await readSessions())[server];
  const start = async (session: string) => startRunner({ serverUrl: server, folder, session });
  const running = await start(saved ?? (await login())).catch(async (error) => {
    // 남겨 둔 세션이 끝났으면 한 번 다시 로그인한다.
    if (!saved || !(error instanceof ContractFailure) || error.code !== "unauthorized") throw error;
    await saveSession(undefined);
    return start(await login());
  });
  console.log(`러너가 켜졌다: ${running.login}의 에이전트, ${running.repo} ↔ ${running.folder}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, running.stop);
  const reason = await running.ended;
  if (reason) throw reason;
  console.log("러너를 껐다");
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
