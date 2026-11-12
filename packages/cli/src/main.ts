#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import {
  ago,
  api,
  CONTRACT_VERSION,
  ContractFailure,
  call,
  EXECUTOR_NAMES,
  ShareLevel,
} from "@omagari/contract";
import { checkoutVersion } from "@omagari/contract/version";
import {
  callRunner,
  observationNotice,
  type RunRecord,
  readRepo,
  runnerPaths,
  startRunner,
} from "@omagari/runner";
import { install } from "./install.ts";

const USAGE = `사용법:
  omagari --version             이 체크아웃의 버전(git 태그)과 계약 버전을 본다
  omagari runner [--share <수준>]
                                레포 폴더에서 러너를 켠다. 처음이면 GitHub 기기 인증으로 로그인한다
                                공유 수준은 full(기본), declared(경로만), intent(상태 한 줄만). 고른 것은 이 레포에 남는다
  omagari runner ask <메시지>   이 레포의 러너 세션에 묻는다. 다음 질문은 같은 세션으로 이어진다
  omagari runner log            러너가 실행한 것을 본다
  omagari status                지금 상황을 본다: 멤버, 작업, 상태 한 줄, 바뀐 파일
  omagari status set <한 줄>    지금 브랜치의 작업에 상태 한 줄을 쓴다
  omagari metrics [--days <날 수>]
                                지난 날들(기본 14일) 날마다 들어온 멤버 수와 문답 수를 본다
  omagari install               이 기기의 에이전트(Claude Code, Codex)에 세션 시작 훅, 편집 전 훅, 상태 한 줄 스킬을 깐다
                                이미 있는 설정은 그대로 두고, 다시 돌려도 하나만 깔린다

서버는 OMAGARI_SERVER로 준다(기본 http://127.0.0.1:3000).`;

const server = process.env.OMAGARI_SERVER ?? "http://127.0.0.1:3000";
// 서버마다의 세션. GitHub 토큰은 여기에 없다. 서버만 든다.
const sessionsFile = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "omagari",
  "sessions.json",
);

const [command, sub, ...rest] = process.argv.slice(2);
try {
  if (command === "--version") {
    console.log(`omagari ${checkoutVersion()} (contract ${CONTRACT_VERSION})`);
  } else if (command === "runner" && (sub === undefined || sub.startsWith("--"))) {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: { share: { type: "string" } },
    });
    await runner(values.share);
  } else if (command === "runner" && sub === "ask" && rest.length > 0) {
    console.log(await ask(rest.join(" ")));
  } else if (command === "runner" && sub === "log") {
    await log();
  } else if (command === "status" && sub === undefined) {
    await status();
  } else if (command === "status" && sub === "set" && rest.length > 0) {
    await setStatus(rest.join(" "));
  } else if (command === "metrics" && (sub === undefined || sub.startsWith("--"))) {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: { days: { type: "string" } },
    });
    await metrics(values.days);
  } else if (command === "install" && sub === undefined) {
    for (const line of await install()) console.log(line);
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

/**
 * 이 레포의 공유 수준. 고르면 레포(연결된 워크트리 포함)에 남기고, 안 고르면 남긴 것을, 남긴 것도 없으면 full을 쓴다.
 * 남겨 두지 않으면 수준을 낮춘 주인이 그냥 다시 켰을 때 모르는 채로 내용이 나간다.
 */
async function shareLevel(folder: string, chosen: string | undefined) {
  const { share: file } = await runnerPaths(folder);
  const level =
    chosen ??
    (await readFile(file, "utf8").then(
      (saved) => saved.trim(),
      (error) => {
        if (error.code === "ENOENT") return "full";
        throw error; // 남긴 것을 못 읽었는데 full로 내보내지 않는다
      },
    ));
  const parsed = ShareLevel.safeParse(level);
  if (!parsed.success) {
    const from = chosen === undefined ? ` (${file})` : "";
    throw new Error(`공유 수준은 full, declared, intent 가운데 하나다: ${level}${from}`);
  }
  if (chosen !== undefined) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${parsed.data}\n`);
  }
  return parsed.data;
}

/** 이 폴더에서 러너를 켜고, 끄거나 서버가 거절할 때까지 돈다. */
async function runner(chosen: string | undefined) {
  const folder = process.cwd();
  await readRepo(folder); // Git 레포가 아니면 로그인하기 전에 멈춘다
  const share = await shareLevel(folder, chosen);
  // 로그인하고 붙기 전에, 그러니 아무것도 나가기 전에 무엇이 나가는지 알린다.
  console.log(observationNotice(share));
  const saved = (await readSessions())[server];
  const start = async (session: string) =>
    startRunner({ serverUrl: server, folder, session, share });
  const running = await start(saved ?? (await login())).catch(async (error) => {
    // 남겨 둔 세션이 끝났으면 한 번 다시 로그인한다.
    if (!saved || !(error instanceof ContractFailure) || error.code !== "unauthorized") throw error;
    await saveSession(undefined);
    return start(await login());
  });
  console.log(`러너가 켜졌다: ${running.login}의 에이전트, ${running.repo} ↔ ${running.folder}`);
  // Codex는 깔려 있고 로그인했을 때만 붙는다. 무엇이 붙었는지 주인이 바로 본다.
  console.log(`에이전트: ${running.executors.map((id) => EXECUTOR_NAMES[id]).join(", ")}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, running.stop);
  const reason = await running.ended;
  if (reason) throw reason;
  console.log("러너를 껐다");
}

/** 이 폴더의 레포에 짝지어진 러너에 묻고 답을 돌려준다. */
async function ask(message: string) {
  const reply = await callRunner(process.cwd(), "ask", { message }).catch((error) => {
    if (error instanceof ContractFailure) throw new Error(`러너가 답하지 못했다: ${error.message}`);
    throw error;
  });
  if (reply.kind !== "answer") throw new Error(`러너가 묻지 않은 것으로 답했다: ${reply.kind}`);
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

/** 남겨 둔 세션으로 서버를 부를 상대. 로그인은 러너를 켤 때 한다. */
async function member() {
  const session = (await readSessions())[server];
  if (!session) throw new Error("로그인하지 않았다. 레포 폴더에서 omagari runner를 먼저 켜라");
  return { url: server, session };
}

/** 멤버마다 에이전트와 작업을, 작업마다 상태 한 줄과 바뀐 파일을 보인다. */
async function status() {
  const AGENT = { online: "온라인", answering: "답하는 중", offline: "오프라인" } as const;
  const as = await member();
  const [{ members }, { works }] = await Promise.all([call(as, api.members), call(as, api.works)]);
  for (const { login, agents } of members) {
    const own = works.filter((work) => work.login === login);
    const since = own[0]?.offlineSince;
    // 에이전트는 실행기마다 하나다(ADR-0015). 러너를 켠 적이 없으면 없다.
    const shown =
      agents
        .map(({ executor, state }) => `${EXECUTOR_NAMES[executor]} ${AGENT[state]}`)
        .join(" · ") || "에이전트 없음";
    console.log(`${login} · ${shown}${since ? ` · ${ago(since)} 기준` : ""}`);
    if (own.length === 0) console.log("  작업 없음");
    for (const { branch, share, line, files } of own) {
      const shown =
        line === null
          ? share === "intent"
            ? "상태 한 줄 없음(공유 수준 intent라 바뀐 파일은 오지 않는다)"
            : "바뀐 것 없음"
          : line.source === "agent"
            ? `${line.text} (${ago(line.at)})`
            : line.source === "pull"
              ? `${line.text} (초안 PR)`
              : line.text;
      console.log(`  ${branch}: ${shown}`);
      for (const file of files) {
        const note = "deleted" in file ? " (지움)" : "omitted" in file ? " (경로만)" : "";
        console.log(`    ${file.path}${note}`);
      }
    }
  }
}

/** 이 폴더에 체크아웃된 브랜치의 작업에 상태 한 줄을 쓴다. */
async function setStatus(text: string) {
  const branch = await promisify(execFile)("git", ["symbolic-ref", "--quiet", "--short", "HEAD"])
    .then(({ stdout }) => stdout.trim())
    .catch(() => {
      throw new Error("브랜치에 있지 않다. 작업의 브랜치를 체크아웃한 폴더에서 써라");
    });
  const written = await call(await member(), api.setStatus, { branch, text });
  console.log(`${branch}의 상태 한 줄을 썼다: ${written.text}`);
}

/** 날마다 들어온 멤버 수와 문답 수를 오래된 날부터 한 줄에 하루씩 보인다. */
async function metrics(days: string | undefined) {
  const reply = await call(await member(), api.metrics, {
    ...(days !== undefined && { days: Number(days) }),
  });
  console.log(`날짜(${reply.timeZone})  들어온 멤버  문답`);
  for (const { day, members, qas } of reply.days) console.log(`${day}  ${members}  ${qas}`);
}
