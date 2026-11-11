#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { api, CONTRACT_VERSION, ContractFailure, call } from "@omagari/contract";
import { readRepo, startRunner } from "@omagari/runner";
import manifest from "../package.json" with { type: "json" };

// 명령은 그것을 만드는 이슈가 더한다: 묻기(#6), status(#12), 훅과 스킬 깔기(#15).
const USAGE = `사용법:
  omagari runner     레포 폴더에서 러너를 켠다. 처음이면 GitHub 기기 인증으로 로그인한다
  omagari --version

서버는 OMAGARI_SERVER로 준다(기본 http://127.0.0.1:3000).`;

const server = process.env.OMAGARI_SERVER ?? "http://127.0.0.1:3000";
// 서버마다의 세션. GitHub 토큰은 여기에 없다. 서버만 든다.
const sessionsFile = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "omagari",
  "sessions.json",
);

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

async function runner() {
  const folder = process.cwd();
  await readRepo(folder); // Git 레포가 아니면 로그인하기 전에 멈춘다
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

try {
  if (process.argv[2] === "--version") {
    console.log(`omagari ${manifest.version} (contract ${CONTRACT_VERSION})`);
  } else if (process.argv[2] === "runner") {
    await runner();
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
