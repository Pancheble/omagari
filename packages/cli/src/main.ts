#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import {
  ago,
  api,
  CHECK_FILE,
  CONTRACT_VERSION,
  ContractFailure,
  call,
  DEFINITION_KINDS,
  EXECUTOR_NAMES,
  ExecutorId,
  PLAN_KINDS,
  Plan,
  ShareLevel,
  VERDICT_LABELS,
} from "@omagari/contract";
import { checkoutVersion } from "@omagari/contract/version";
import {
  alertLine,
  type CheckRecord,
  callRunner,
  checkNotice,
  claimNews,
  claimOwner,
  claimPlace,
  inboxNotice,
  observationNotice,
  type RunRecord,
  readCheck,
  readRepo,
  runnerPaths,
  startRunner,
} from "@omagari/runner";
import { install } from "./install.ts";

const USAGE = `사용법:
  omagari --version             이 체크아웃의 버전(git 태그)과 계약 버전을 본다
  omagari runner [--share <수준>] [--merge-check on|off]
                                레포 폴더에서 러너를 켠다. 처음이면 GitHub 기기 인증으로 로그인한다
                                공유 수준은 full(기본), declared(경로만), intent(상태 한 줄만). 고른 것은 이 레포에 남는다
                                --merge-check는 합쳐 돌려 보기를 켜고(on, 기본) 끈다(off). 고른 것은 이 레포에 남는다
  omagari runner check          지금 폴더의 내 작업(커밋하지 않은 변경 포함)에 기본 브랜치의 ${CHECK_FILE}에 적힌 검사 명령을
                                샌드박스 안에서 한 번 돌려 통과, 깨짐, 돌리지 못함을 본다. 이 기기에서 검사 명령이 도는지 확인한다
  omagari runner ask <메시지>   이 레포의 러너 세션에 묻는다. 다음 질문은 같은 세션으로 이어진다
  omagari runner log            러너가 실행한 것을 본다
  omagari status                지금 상황을 본다: 멤버, 작업, 상태 한 줄, 바뀐 파일, 최근 소식(피드)
  omagari status set <한 줄>    지금 브랜치의 작업에 상태 한 줄을 쓴다
  omagari claim <경로> [--symbol <이름> | --lines <시작>-<끝>] [--plan <종류>[:<심볼>] [--detail <한 줄>]]
                                지금 브랜치의 작업이 고칠 곳을 선점한다. 경로가 폴더(끝이 /)면 그 아래 전부, 새로 만든 파일은 파일 전체다
                                남의 선점과 겹쳐도 걸리고, 겹치면 양쪽 작업의 편지함에 들어간다. 아무것도 막지 않는다
                                --plan은 바꿀 계약을 선언한다: rename(이름 바꾸기), signature(시그니처 변경), delete(삭제), add(추가)
                                심볼은 --symbol의 것이고, 다르면 종류 뒤에 :<심볼>로 적는다. 그 심볼을 쓰는 다른 작업에 코드를 바꾸기 전에 알린다
                                같은 심볼에 새 계획을 걸면 옛 계획을 대체한다. 이루지 못한 채 풀면 알림을 받은 작업에 "취소됨"이 간다
  omagari release [<경로> [--symbol <이름> | --lines <시작>-<끝>]]
                                지금 브랜치의 작업의 선점을 푼다. 경로가 없으면 모두 푼다
  omagari impact <심볼>          그 심볼을 내 사본에서 쓰는 곳과, 그 정의 줄을 바꾸고 있거나 바꾸겠다고 선언한 다른 멤버의 작업을 본다
                                메서드는 클래스.메서드나 메서드 이름으로 묻는다. 이름으로 이어 같은 이름의 다른 심볼도 잡힌다
  omagari ask <멤버> <질문> [--executor claude-code|codex]
                                지금 브랜치의 작업에서 다른 멤버의 에이전트에게 묻고 바로 돌아온다. 답은 이 작업의 편지함으로 온다
                                받는 쪽 러너가 읽기 전용으로 자기 폴더를 읽고 답한다. 실행기를 고르지 않으면 그 멤버의 에이전트 하나가 답한다
                                받는 쪽이 꺼 두었으면 "받지 않는다", 러너가 오프라인이면 남겨 두었다가 돌아오면 답한다(14일 뒤 만료)
  omagari wait <질문 번호> | --path <경로> [--timeout <초>]
                                질문의 답이 편지함에 오거나, 그 경로에 걸린 다른 멤버의 선점이 풀리기를 기다린다. 한 번에 하나다
                                기본 30초, 최대 100초. 시간이 다 되면 "답 없음"이고, 답이나 승인이 아니다
  omagari metrics [--days <날 수>]
                                지난 날들(기본 14일) 날마다 들어온 멤버 수와 문답 수를 본다
  omagari install               이 기기의 에이전트(Claude Code, Codex)에 세션 시작 훅, 편집 전 훅, 상태 한 줄 스킬을 깐다
                                이미 있는 설정은 그대로 두고, 다시 돌려도 하나만 깔린다

서버는 OMAGARI_SERVER로 준다(기본 http://127.0.0.1:3000).
러너를 켜는 것 말고 모든 명령은 응답 끝에 지금 브랜치의 편지함에 밀린 소식을 싣는다.`;

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
      options: { share: { type: "string" }, "merge-check": { type: "string" } },
    });
    await runner(values.share, values["merge-check"]);
  } else if (command === "runner" && sub === "ask" && rest.length > 0) {
    console.log(await ask(rest.join(" ")));
  } else if (command === "runner" && sub === "check" && rest.length === 0) {
    process.exitCode = await check();
  } else if (command === "runner" && sub === "log") {
    await log();
  } else if (command === "status" && sub === undefined) {
    await status();
  } else if (command === "status" && sub === "set" && rest.length > 0) {
    await setStatus(rest.join(" "));
  } else if (command === "claim" && sub !== undefined && !sub.startsWith("--")) {
    await claim(sub);
  } else if (command === "release") {
    await release(sub?.startsWith("--") ? undefined : sub);
  } else if (command === "impact" && sub !== undefined && rest.length === 0) {
    await impact(sub);
  } else if (command === "ask" && sub !== undefined && !sub.startsWith("--")) {
    process.exitCode = await askMember(sub);
  } else if (command === "wait") {
    await wait();
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
// 러너를 켜는 명령은 끝날 때까지 돌므로 싣지 않는다.
if (!(command === "runner" && (sub === undefined || sub.startsWith("--")))) await mailbox();

/**
 * 응답 끝에 지금 브랜치의 편지함에 밀린 소식을 싣고, 실은 것을 러너에 넘겼다고 알린다. 훅이 없는 에이전트도 받는다.
 * 레포 밖이거나, 브랜치가 아니거나, 러너가 꺼져 있거나, 밀린 것이 없으면 아무것도 싣지 않는다.
 */
async function mailbox() {
  const branch = await promisify(execFile)("git", ["symbolic-ref", "--quiet", "--short", "HEAD"])
    .then(({ stdout }) => stdout.trim())
    .catch(() => undefined);
  if (!branch) return;
  const reply = await callRunner(process.cwd(), "inbox", { branch }).catch(() => undefined);
  if (reply?.kind !== "inbox") return;
  const { login, items, disconnectedAt } = reply.payload;
  const notice = inboxNotice(items, { login, branch }, disconnectedAt);
  if (!notice) return;
  console.log(`\n${notice.text}`);
  await callRunner(process.cwd(), "delivered", { ids: notice.ids }).catch(() => {});
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
 * 이 레포에 남겨 두는 주인의 선택(공유 수준, 합쳐 돌려 보기). 고르면 레포(연결된 워크트리 포함)의 `file`에 남기고,
 * 안 고르면 남긴 것을, 남긴 것도 없으면 `values`의 첫째(기본값)를 쓴다. `name`은 틀린 값을 알릴 때 쓰는 이름(조사까지)이다.
 * 남겨 두지 않으면 공유 수준을 낮추거나 합쳐 돌려 보기를 끈 주인이 그냥 다시 켰을 때 모르는 채로 기본값으로 돌아간다.
 */
async function remembered<T extends string>(
  file: string,
  chosen: string | undefined,
  name: string,
  values: readonly T[],
) {
  const value =
    chosen ??
    (await readFile(file, "utf8").then(
      (saved) => saved.trim(),
      (error) => {
        if (error.code === "ENOENT") return values[0];
        throw error; // 남긴 것을 못 읽었는데 기본값으로 가지 않는다
      },
    ));
  const found = values.find((v) => v === value);
  if (found === undefined) {
    const from = chosen === undefined ? ` (${file})` : "";
    throw new Error(`${name} ${values.join(", ")} 가운데 하나다: ${value}${from}`);
  }
  if (chosen !== undefined) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${found}\n`);
  }
  return found;
}

/** 이 폴더에서 러너를 켜고, 끄거나 서버가 거절할 때까지 돈다. */
async function runner(chosen: string | undefined, chosenMergeCheck: string | undefined) {
  const folder = process.cwd();
  await readRepo(folder); // Git 레포가 아니면 로그인하기 전에 멈춘다
  const paths = await runnerPaths(folder);
  const share = await remembered(paths.share, chosen, "공유 수준은", ShareLevel.options);
  const mergeCheck = await remembered(paths.mergeCheck, chosenMergeCheck, "합쳐 돌려 보기는", [
    "on",
    "off",
  ]);
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
  // 검사 명령은 기본 브랜치에서 읽으므로 서버가 받아들인 원격을 안 뒤에 알린다. 합쳐 돌려 보기는 붙은 뒤에도 잠잠해지기를 기다려야 돈다.
  console.log(checkNotice(await readCheck(running.folder, running.remote), mergeCheck === "on"));
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

/** 초로 적은 걸린 시간. 위의 명령이 먼저 돌아 모듈 상수가 아니라 함수 선언으로 둔다. */
function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}초`;
}

/**
 * 지금 폴더의 내 작업에 기본 브랜치의 검사 명령을 샌드박스 안에서 한 번 돌린다. 러너가 돌린다.
 * 통과면 0, 깨짐이나 돌리지 못함이면 1로 끝난다. 통과가 아니면 출력의 끝부분을 보인다.
 */
async function check() {
  const folder = (
    await promisify(execFile)("git", ["rev-parse", "--show-toplevel"]).catch(() => {
      throw new Error("Git 레포가 아닌 폴더다. 작업 폴더에서 써라");
    })
  ).stdout.trim();
  const reply = await callRunner(process.cwd(), "check", { folder }).catch((error) => {
    if (error instanceof ContractFailure) throw new Error(`러너가 답하지 못했다: ${error.message}`);
    throw error;
  });
  if (reply.kind !== "checked") throw new Error(`러너가 묻지 않은 것으로 답했다: ${reply.kind}`);
  const { verdict, reason, branch, config, ms, output } = reply.payload;
  if (config) {
    console.log(`검사 명령: ${config.check} (기본 브랜치 ${branch}의 ${CHECK_FILE})`);
    if (config.setup) console.log(`준비 명령: ${config.setup}`);
  }
  console.log(`판정: ${VERDICT_LABELS[verdict]} (${seconds(ms)})`);
  if (reason) console.log(`  ${reason}`);
  if (verdict !== "pass" && output) console.log(`출력의 끝부분:\n${output.replace(/^/gm, "  ")}`);
  return verdict === "pass" ? 0 : 1;
}

/** 실행 기록을 한 줄에 하나씩 보인다. 기록은 이 기기에만 있다. */
async function log() {
  const { log } = await runnerPaths(process.cwd());
  const lines = await readFile(log, "utf8").catch(() => "");
  if (!lines) return console.log("러너가 실행한 것이 아직 없다");
  for (const line of lines.trimEnd().split("\n")) {
    const run: RunRecord | CheckRecord = JSON.parse(line);
    if ("kind" in run) {
      const why = run.reason ? `: ${run.reason}` : "";
      const setup = run.setup ? `  준비 명령 ${JSON.stringify(run.setup)}` : "";
      console.log(
        `${run.at}  검사 명령 ${JSON.stringify(run.check ?? "")}${setup}  폴더 ${run.folder}  판정 ${VERDICT_LABELS[run.verdict]}${why}  ${seconds(run.ms)}`,
      );
      continue;
    }
    const outcome = run.error ? `실패: ${run.error}` : `답함 ${JSON.stringify(run.answer ?? "")}`;
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
  const [{ members }, { works }, { news }] = await Promise.all([
    call(as, api.members),
    call(as, api.works),
    call(as, api.feed),
  ]);
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
  // 피드: 내 작업이 걸리지 않은 소식. 내 작업의 것은 편지함으로 온다.
  if (news.length > 0) console.log("최근 소식(내 작업이 걸리지 않은 것, 새것부터):");
  for (const item of news) {
    const line =
      "alert" in item
        ? alertLine(item.alert)
        : "claim" in item
          ? claimNews(item.claim, false)
          : claimNews(item.released, true);
    console.log(`  ${line.slice(2)} (${ago(item.at)})`);
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

/**
 * 선점과 풀기의 대상: 지금 브랜치와, 레포 최상위에서 본 경로, `--symbol`이나 `--lines`. 경로는 지금 폴더에서 본 것으로 받는다.
 * 폴더는 끝의 `/`를 남긴다.
 */
async function target(path: string | undefined) {
  const { values } = parseArgs({
    args: process.argv.slice(path === undefined ? 3 : 4),
    options: {
      symbol: { type: "string" },
      lines: { type: "string" },
      plan: { type: "string" },
      detail: { type: "string" },
    },
  });
  const git = (...args: string[]) =>
    promisify(execFile)("git", args).then(({ stdout }) => stdout.trim());
  const branch = await git("symbolic-ref", "--quiet", "--short", "HEAD").catch(() => {
    throw new Error("브랜치에 있지 않다. 작업의 브랜치를 체크아웃한 폴더에서 써라");
  });
  const top = await git("rev-parse", "--show-toplevel");
  let lines: { from: number; to: number } | undefined;
  if (values.lines !== undefined) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(values.lines);
    if (!match) throw new Error(`줄 범위는 <시작>-<끝>이나 <줄>로 준다: ${values.lines}`);
    lines = { from: Number(match[1]), to: Number(match[2] ?? match[1]) };
  }
  const relativePath =
    path === undefined ? undefined : relative(top, resolve(path)) + (path.endsWith("/") ? "/" : "");
  if (relativePath?.startsWith("..")) throw new Error(`레포 밖의 경로다: ${path}`);
  return {
    plan: plan(values),
    branch,
    ...(relativePath !== undefined && { path: relativePath }),
    ...(values.symbol !== undefined && { symbol: values.symbol }),
    ...(lines && { lines }),
  };
}

/** `--plan <종류>[:<심볼>]`과 `--detail <한 줄>`을 계획으로. 심볼을 적지 않으면 `--symbol`의 것이다. */
function plan(values: { symbol?: string; plan?: string; detail?: string }) {
  if (values.plan === undefined) {
    if (values.detail !== undefined) throw new Error("--detail은 --plan과 함께 준다");
    return undefined;
  }
  const [kind = "", symbol = values.symbol] = values.plan.split(/:(.*)/s);
  const parsed = Plan.safeParse({
    kind,
    symbol,
    ...(values.detail !== undefined && { detail: values.detail }),
  });
  if (!parsed.success)
    throw new Error(
      `계획은 --plan <${Object.keys(PLAN_KINDS).join("|")}>[:<심볼>]로 준다. 심볼을 적지 않으면 --symbol의 것이다: ${values.plan}`,
    );
  return parsed.data;
}

/** 지금 브랜치의 작업에 선점을 건다. 러너가 서버에 건다. 겹친 남의 선점이 있으면 함께 보인다. */
async function claim(path: string) {
  const { branch, path: at, plan, ...rest } = await target(path);
  const reply = await callRunner(process.cwd(), "claim", {
    branch,
    path: at ?? path,
    ...rest,
    ...(plan && { plan }),
  }).catch((error) => {
    if (error instanceof ContractFailure) throw new Error(`선점을 걸지 못했다: ${error.message}`);
    throw error;
  });
  if (reply.kind !== "claimed") throw new Error(`러너가 묻지 않은 것으로 답했다: ${reply.kind}`);
  const { claim, overlaps } = reply.payload;
  console.log(`${branch}의 선점을 걸었다: ${claimPlace(claim)}`);
  if (overlaps.length === 0) return;
  console.log(
    "겹친 다른 멤버의 선점(줄은 내 사본 기준). 양쪽 편지함에 들어갔다. 겹친 곳은 기다리거나 물어본다:",
  );
  for (const other of overlaps) console.log(`  ${claimOwner(other)} · ${claimPlace(other)}`);
}

/** 지금 브랜치의 작업의 선점을 푼다. 경로가 없으면 모두 푼다. */
async function release(path: string | undefined) {
  const { plan, ...found } = await target(path);
  if (plan) throw new Error("--plan은 omagari claim에만 준다");
  const reply = await callRunner(process.cwd(), "release", found).catch((error) => {
    if (error instanceof ContractFailure) throw new Error(`선점을 풀지 못했다: ${error.message}`);
    throw error;
  });
  if (reply.kind !== "released") throw new Error(`러너가 묻지 않은 것으로 답했다: ${reply.kind}`);
  const { claims } = reply.payload;
  if (claims.length === 0) return console.log(`${found.branch}에 풀 선점이 없다`);
  console.log(`${found.branch}의 선점 ${claims.length}개를 풀었다:`);
  for (const claim of claims) console.log(`  ${claimPlace(claim)}`);
}

/** 심볼을 쓰는 곳과 그 정의 줄을 바꾸는 다른 멤버의 작업을 보인다. 러너가 답한다. */
async function impact(symbol: string) {
  const reply = await callRunner(process.cwd(), "impact", { symbol }).catch((error) => {
    if (error instanceof ContractFailure) throw new Error(`러너가 답하지 못했다: ${error.message}`);
    throw error;
  });
  if (reply.kind !== "impact") throw new Error(`러너가 묻지 않은 것으로 답했다: ${reply.kind}`);
  const { uses, works, plans, disconnectedAt } = reply.payload;
  const CHANGE = { added: "새로 만듦", changed: "정의 줄을 바꿈", removed: "없앰" } as const;
  console.log(`심볼 ${symbol}\n쓰는 곳(내 사본, 이름으로 이어 다른 심볼일 수 있다):`);
  if (uses.length === 0) console.log("  없음");
  for (const { path, line } of uses) console.log(`  ${path}:${line}`);
  console.log("정의 줄을 바꾸고 있는 다른 멤버의 작업:");
  if (works.length === 0) console.log("  없음");
  for (const { login, branch, offlineSince, path, definition: d } of works) {
    const away = offlineSince ? ` · ${ago(offlineSince)} 기준` : "";
    const change = d.change ? CHANGE[d.change] : "";
    console.log(
      `  ${login} · ${branch} · ${path}:${d.line} ${DEFINITION_KINDS[d.kind]} ${d.name} ${change}${away}`,
    );
  }
  console.log("바꾸겠다고 선언한(계획을 붙인) 다른 멤버의 선점:");
  if (plans.length === 0) console.log("  없음");
  for (const claim of plans) console.log(`  ${claimOwner(claim)} · ${claimPlace(claim)}`);
  if (disconnectedAt)
    console.log(`러너가 ${ago(disconnectedAt)}부터 서버와 끊겨 있어, 그때까지 받은 것이다.`);
}

/** 날마다 들어온 멤버 수와 문답 수를 오래된 날부터 한 줄에 하루씩 보인다. */
async function metrics(days: string | undefined) {
  const reply = await call(await member(), api.metrics, {
    ...(days !== undefined && { days: Number(days) }),
  });
  console.log(`날짜(${reply.timeZone})  들어온 멤버  문답`);
  for (const { day, members, qas } of reply.days) console.log(`${day}  ${members}  ${qas}`);
}

/** 이 폴더에 체크아웃된 브랜치. 브랜치가 아니면 던진다. */
async function currentBranch() {
  return promisify(execFile)("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]).then(
    ({ stdout }) => stdout.trim(),
    () => {
      throw new Error("브랜치에 있지 않다. 작업의 브랜치를 체크아웃한 폴더에서 써라");
    },
  );
}

/**
 * 지금 브랜치의 작업에서 다른 멤버(`to`)의 에이전트에게 묻는다(ADR-0024). 러너가 서버에 보내고 바로 돌아온다. 답은 편지함으로 온다.
 * 받는 쪽이 받지 않으면 1로 끝난다.
 */
async function askMember(to: string) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(4),
    allowPositionals: true,
    options: { executor: { type: "string" } },
  });
  const text = positionals.join(" ");
  if (!text) throw new Error(USAGE);
  const executor = values.executor && ExecutorId.safeParse(values.executor).data;
  if (values.executor !== undefined && !executor)
    throw new Error(`실행기는 claude-code나 codex다: ${values.executor}`);
  const branch = await currentBranch();
  const reply = await callRunner(process.cwd(), "question", {
    branch,
    to,
    text,
    ...(executor && { executor }),
  }).catch((error) => {
    if (error instanceof ContractFailure) throw new Error(`묻지 못했다: ${error.message}`);
    throw error;
  });
  if (reply.kind !== "questioned") throw new Error(`러너가 묻지 않은 것으로 답했다: ${reply.kind}`);
  const result = reply.payload;
  if (result.state === "refused") {
    console.log(`${to}는 남의 질문을 받지 않는다(스위치를 꺼 두었다). 보내지 않았다.`);
    return 1;
  }
  const { id, executor: answerer } = result.question;
  const agent = `${to}의 ${answerer ? EXECUTOR_NAMES[answerer] : "에이전트"}`;
  console.log(
    result.state === "sent"
      ? `질문 #${id}를 ${agent}에게 보냈다. 답은 ${branch}의 편지함으로 온다.`
      : `${to}의 러너가 오프라인이라 질문 #${id}를 남겨 두었다. 돌아오면 답하고, 답은 ${branch}의 편지함으로 온다. 14일 안에 돌아오지 않으면 만료한다.`,
  );
  console.log(`기다리려면: omagari wait ${id}`);
  return 0;
}

/**
 * 질문의 답이 지금 브랜치의 편지함에 오거나, 경로에 걸린 다른 멤버의 선점이 풀리기를 기다린다. 한 번에 하나다.
 * 러너에 받아 둔 것을 짧게 되풀이해 묻는다. 시간이 다 되면 "답 없음"이고, 답이나 승인으로 치지 않는다.
 * 온 답은 끝에 싣는 편지함(`mailbox`)으로 넘긴다. 이미 넘겨받은 답은 기다리지 않는다.
 */
async function wait() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: { path: { type: "string" }, timeout: { type: "string" } },
  });
  // 기본 시간과 상한(초). Room의 기다리기와 같다(2단계 질문 A14). 위의 명령이 먼저 돌아 모듈 상수로 두지 않는다.
  const [WAIT_SECONDS, MAX_WAIT_SECONDS] = [30, 100];
  const seconds = values.timeout === undefined ? WAIT_SECONDS : Number(values.timeout);
  if (!(seconds > 0 && seconds <= MAX_WAIT_SECONDS)) {
    throw new Error(
      `기다리는 시간은 ${MAX_WAIT_SECONDS}초까지다(기본 ${WAIT_SECONDS}초): ${values.timeout}`,
    );
  }
  if (positionals.length + (values.path === undefined ? 0 : 1) !== 1) {
    throw new Error(
      "한 번에 하나만 기다린다: omagari wait <질문 번호> 또는 omagari wait --path <경로>",
    );
  }
  const id = Number(positionals[0]);
  if (values.path === undefined && !Number.isInteger(id))
    throw new Error(`질문 번호가 아니다: ${positionals[0]}`);
  const branch = await currentBranch();
  const top = (await promisify(execFile)("git", ["rev-parse", "--show-toplevel"])).stdout.trim();
  const path =
    values.path === undefined
      ? undefined
      : relative(top, resolve(values.path)) + (values.path.endsWith("/") ? "/" : "");
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (path === undefined) {
      const reply = await callRunner(process.cwd(), "inbox", { branch });
      if (
        reply.kind === "inbox" &&
        reply.payload.items.some((item) => item.kind === "answer" && item.question.id === id)
      ) {
        return console.log(`질문 #${id}의 답이 왔다. 아래 편지함에 있다.`);
      }
    } else {
      // 근처 작업 묻기의 실행기는 러너가 아직 쓰지 않는다(ADR-0015).
      const reply = await callRunner(process.cwd(), "nearby", {
        path,
        branch,
        executor: "claude-code",
      });
      if (reply.kind === "nearby" && reply.payload.claims.length === 0) {
        return console.log(`${path}에 걸린 다른 멤버의 선점이 없다(풀렸다).`);
      }
    }
    if (Date.now() >= deadline) {
      const what = path === undefined ? `질문 #${id}의 답을` : `${path}의 선점이 풀리기를`;
      return console.log(
        `답 없음: ${seconds}초 동안 ${what} 기다렸지만 오지 않았다. 답이나 승인으로 치지 않는다. 나중에 다시 기다리거나 다른 일을 한다.`,
      );
    }
    await sleep(Math.min(200, Math.max(0, deadline - Date.now())));
  }
}
