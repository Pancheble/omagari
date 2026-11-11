// 실제 실행기 손 점검(이슈 #7). Claude Code와 Codex가 화면 없이 세션을 이어 가는지, 읽기 전용인지,
// 구독 로그인으로 도는지, 길어지면 자동 컴팩트가 일어나는지 본다.
// 구독 로그인이 있는 기기에서 사람이 돌린다. 이름이 *.test.ts가 아니라 CI(`npm test`)는 돌리지 않는다.
// 돌리는 법과 읽는 법: docs/executor-check.md
import { execFile } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { EXECUTOR_NAMES, ExecutorId } from "@omagari/contract";
import { claudeCode, codex as codexExecutor, runnerPaths } from "@omagari/runner";
import { startWorld, writer } from "./harness.ts";

/** 이것이 있으면 구독 대신 API 키로 돈다. 값은 읽지도 찍지도 않는다. */
const API_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"];
const keys = API_KEYS.filter((key) => process.env[key]);
if (keys.length > 0) {
  console.error(
    `구독 로그인을 보는 점검이라 API 키가 있으면 돌지 않는다. 이 셸에서 지우고 다시 돌려라: unset ${keys.join(" ")}`,
  );
  process.exit(2);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { quick: { type: "boolean", default: false } },
});
const picked = positionals.length > 0 ? positionals : ExecutorId.options;
for (const id of picked) {
  if (!ExecutorId.safeParse(id).success) {
    console.error(`모르는 실행기다: ${id}. 고를 수 있는 것: ${ExecutorId.options.join(", ")}`);
    process.exit(2);
  }
}

/** 한 턴의 상한. 러너와 같은 10분이다. */
const TURN_MS = 10 * 60_000;
/**
 * 자동 컴팩트를 싸게 보려고 창을 낮춘다. 기본은 모델의 맥락 한계(1M 모델은 약 967K)라 거기까지 채우면 비싸다.
 * Claude Code가 받는 가장 작은 창은 100K다(모델 설정 문서). 이 셸에 이미 있으면 그 값을 쓴다.
 */
process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ??= "100000";
const CLAUDE_WINDOW = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
/** Codex의 자동 컴팩트 문턱(`model_auto_compact_token_limit`, 설정 문서). */
const CODEX_COMPACT_LIMIT = 40_000;
/** 긴 세션에서 맥락을 채우는 턴의 최대 수. 이만큼 채워도 컴팩트가 없으면 없었다고 적는다. */
const FILLS = 10;
/** 읽기 전용 점검에서 만들라고 시키는 파일. */
const PROBE = "omagari-probe.txt";

const SAY = {
  remember: (secret: string) =>
    `점검용 메시지다. 암호는 ${secret}이다. 기억해 두고 "알았다"라고만 답하라.`,
  recall: "처음에 알려 준 암호가 무엇이었나? 암호만 답하라.",
  write: `점검용 메시지다. 이 레포 맨 위에 ${PROBE} 파일을 만들어 "probe"라고 쓰고, README.md 끝에 줄 하나를 더하라. 쓸 수 있는 도구를 모두 써서 해 보고, 했는지 못 했는지 한 줄로 답하라.`,
  read: (n: number) =>
    `점검용 메시지다. fill/${n}.txt를 처음부터 끝까지 읽고 마지막 줄만 그대로 답하라.`,
  fill: (text: string) =>
    `점검용 메시지다. 아래는 맥락을 채우려는 뜻 없는 글이다. 읽고 "OK"라고만 답하라.\n\n${text}`,
};

const execFileAsync = promisify(execFile);

/** 실행 파일을 돌려 종료 코드와 출력을 받는다. 0이 아닌 종료도 결과다. 표준 입력에 `input`을 넣고 닫는다. */
async function sh(file: string, args: string[], options: { cwd?: string; input?: string } = {}) {
  const run = execFileAsync(file, args, {
    cwd: options.cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: TURN_MS,
  });
  run.child.stdin?.end(options.input ?? "");
  try {
    return { code: 0, ...(await run) };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof failed.code !== "number") throw error; // 뜨지 못했거나(없는 실행 파일) 시간 상한에 죽었다
    return { code: failed.code, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

const progress = (line: string) =>
  console.error(`${new Date().toISOString().slice(11, 19)} ${line}`);
const short = (text: string, length = 120) => text.replace(/\s+/g, " ").trim().slice(0, length);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const secret = () => randomBytes(4).toString("hex");

/** 맥락을 채울 뜻 없는 글. 줄마다 번호가 붙고 마지막 줄은 `끝 <name>`이다. */
const SYLLABLES = "ka lo mi ne su ta ri po ve zu ha ji".split(" ");
const syllable = () => SYLLABLES[randomInt(SYLLABLES.length)];
const filler = (name: string, lines: number) =>
  `${Array.from(
    { length: lines },
    (_, i) =>
      `${name}-${i + 1}: ${Array.from({ length: 10 }, () => syllable() + syllable() + syllable()).join(" ")}`,
  ).join("\n")}\n끝 ${name}\n`;

/** 점검 하나의 결과. `ok`가 null이면 통과·실패가 아니라 관찰이다. */
type Check = { name: string; ok: boolean | null; detail: string };
type World = Awaited<ReturnType<typeof startWorld>>;

/** 점검 하나를 돌려 `checks`에 적는다. 던지면 실패로 적고 다음 점검으로 간다. */
async function attempt(checks: Check[], name: string, check: () => Promise<Omit<Check, "name">>) {
  progress(`  ${name}`);
  try {
    checks.push({ name, ...(await check()) });
  } catch (error) {
    checks.push({ name, ok: false, detail: `점검이 멈췄다: ${messageOf(error)}` });
  }
}

/** 작업 폴더가 `head` 커밋 그대로인지. 바뀌었으면 무엇이 바뀌었는지 돌려준다. */
async function changes(world: World, head: string) {
  const status = await world.repo.git(
    "status",
    "--porcelain",
    "--ignored",
    "--untracked-files=all",
  );
  const now = await world.repo.git("rev-parse", "HEAD");
  if (status === "" && now === head) return undefined;
  return `작업 폴더가 바뀌었다: ${short(status || `HEAD ${head} → ${now}`, 300)}`;
}

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};
type TranscriptEntry = {
  type?: string;
  subtype?: string;
  isCompactSummary?: boolean;
  compactMetadata?: { trigger?: string; preTokens?: number; postTokens?: number };
  message?: { content?: string | { text?: string }[]; usage?: Usage; model?: string };
};

/** Claude Code가 이 기기에 남긴 세션 기록(`<projects>/<폴더>/<세션>.jsonl`). 없으면 빈 목록이다. */
async function transcript(projects: string, session: string) {
  for (const folder of await readdir(projects).catch(() => [])) {
    const text = await readFile(join(projects, folder, `${session}.jsonl`), "utf8").catch(() => "");
    if (!text) continue;
    return text.split("\n").flatMap((line): TranscriptEntry[] => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
  return [];
}

/** 웹이 하듯 러너의 `executor` 에이전트에게 DM으로 묻고, 답과 그 턴의 세션 id(실행 기록)를 돌려준다. */
async function askRunner(world: World, channel: string, message: string, executor: ExecutorId) {
  const { log } = await runnerPaths(world.repo.folder);
  const pending = await world.ask(world.owner, channel, message, executor);
  const qa = await world.settled(world.owner, pending, TURN_MS + 60_000);
  if (qa.answer.state !== "answered") {
    throw new Error(qa.answer.state === "failed" ? qa.answer.error.message : "답이 오지 않았다");
  }
  // 러너는 답을 보내기 전에 실행 기록을 남긴다. 마지막 줄이 이 턴이다.
  const last = (await readFile(log, "utf8")).trimEnd().split("\n").at(-1) ?? "{}";
  return { text: qa.answer.text, session: JSON.parse(last).session as string };
}

/**
 * Claude Code: 러너의 실제 실행기(`claudeCode`)를 꽂은 러너에 웹이 하듯 DM으로 묻는다.
 * 채널 세션, 읽기 전용 도구, `--resume`, 턴 상한, 실행 기록이 모두 러너의 코드로 돈다.
 */
async function claude(world: World, head: string, quick: boolean) {
  const version = (await sh("claude", ["--version"])).stdout.trim();
  const status = JSON.parse((await sh("claude", ["auth", "status", "--json"])).stdout);
  const projects: string =
    status.projectsDirectory ??
    join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  const ask = (channel: string, message: string) =>
    askRunner(world, channel, message, "claude-code");
  const checks: Check[] = [];

  await attempt(checks, "구독 로그인", async () => ({
    ok:
      status.loggedIn === true &&
      status.authMethod === "claude.ai" &&
      status.apiProvider === "firstParty",
    detail: `API 키 환경 변수 없이 돌렸다. \`claude auth status\`: authMethod ${status.authMethod}, apiProvider ${status.apiProvider}, 플랜 ${status.subscriptionType}`,
  }));

  const channel = await world.channel(world.owner, "점검");
  const word = secret();
  await attempt(checks, "세션 이어 가기", async () => {
    const first = await ask(channel, SAY.remember(word));
    const second = await ask(channel, SAY.recall);
    return {
      ok: second.text.includes(word),
      detail: `둘째 턴이 첫 턴의 암호 ${word}를 물었더니 "${short(second.text)}". 세션 ${first.session} → ${second.session === first.session ? "그대로" : second.session}`,
    };
  });

  await attempt(checks, "읽기 전용", async () => {
    const answer = await ask(channel, SAY.write);
    const changed = await changes(world, head);
    return {
      ok: !changed,
      detail: `${changed ?? "작업 폴더가 그대로다"}. 이어 간 세션에 ${PROBE}를 만들고 README.md를 고치라고 시켰다. 답: "${short(answer.text)}"`,
    };
  });

  if (!quick) {
    await attempt(checks, "긴 세션", async () => {
      const long = await world.channel(world.owner, "긴 세션");
      const word = secret();
      const sessions = [(await ask(long, SAY.remember(word))).session];
      const entries = async () =>
        (await Promise.all([...new Set(sessions)].map((s) => transcript(projects, s)))).flat();
      let reads = 0;
      while (reads < FILLS && !(await entries()).some((e) => e.subtype === "compact_boundary")) {
        reads++;
        progress(`    fill/${reads}.txt`);
        sessions.push((await ask(long, SAY.read(reads))).session);
      }
      const recall = await ask(long, SAY.recall);
      sessions.push(recall.session);
      const all = await entries();
      if (all.length === 0) throw new Error(`세션 기록을 찾지 못했다: ${projects}`);
      const remembered = recall.text.includes(word)
        ? `마지막 턴에 첫 턴의 암호를 기억했다`
        : `마지막 턴에 첫 턴의 암호를 잊었다(답: "${short(recall.text)}")`;
      // 자동 컴팩트의 문턱은 모델마다 달라 어느 모델이었는지 함께 적는다.
      const models = [
        ...new Set(
          all.flatMap((e) => (e.message?.model?.startsWith("claude") ? [e.message.model] : [])),
        ),
      ];
      const where = `모델 ${models.join(", ") || "?"}, 세션 ${[...new Set(sessions)].join(" → ")}`;
      const boundary = all.find((e) => e.subtype === "compact_boundary");
      if (!boundary) {
        const usage = all.findLast((e) => e.type === "assistant" && e.message?.usage)?.message
          ?.usage;
        const context =
          (usage?.input_tokens ?? 0) +
          (usage?.cache_read_input_tokens ?? 0) +
          (usage?.cache_creation_input_tokens ?? 0);
        return {
          ok: null,
          detail: `파일 ${reads}개를 읽혀 맥락이 약 ${context} 토큰이 될 때까지 자동 컴팩트가 없었다. ${remembered}. ${where}`,
        };
      }
      const meta = boundary.compactMetadata ?? {};
      const content = all.find((e) => e.isCompactSummary)?.message?.content ?? "";
      const summary =
        typeof content === "string" ? content : content.map((c) => c.text ?? "").join("");
      return {
        ok: null,
        detail: `파일 ${reads}개를 읽힌 뒤 자동 컴팩트가 일어났다(trigger ${meta.trigger}, ${meta.preTokens} → ${meta.postTokens} 토큰). 그 자리에 요약 ${summary.length}자가 남았고 요약에 암호가 ${summary.includes(word) ? "있다" : "없다"}. ${remembered}. ${where}`,
      };
    });
  }
  return { version: `Claude Code ${version.split(" ")[0]}`, checks };
}

/** `codex exec --json`의 한 턴. `resume`을 주면 그 세션을 잇는다. `options`는 `resume`보다 앞에 둔다(전역 플래그가 아니다). */
async function codexTurn(folder: string, prompt: string, resume?: string, options: string[] = []) {
  const args = ["exec", "--json", ...options, ...(resume ? ["resume", resume] : []), "-"];
  const { code, stdout, stderr } = await sh("codex", args, { cwd: folder, input: prompt });
  type Event = {
    type?: string;
    thread_id?: string;
    message?: string;
    error?: { message?: string };
    item?: { type?: string; text?: string };
  };
  const events = stdout.split("\n").flatMap((line): Event[] => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const answer = events.findLast(
    (e) => e.type === "item.completed" && e.item?.type === "agent_message",
  )?.item?.text;
  const failed = events.find((e) => e.type === "turn.failed" || e.type === "error");
  if (code !== 0 || failed || typeof answer !== "string") {
    const why = failed?.error?.message ?? failed?.message ?? short(stderr.slice(-300), 300);
    throw new Error(`codex가 답하지 못했다(종료 코드 ${code}): ${why}`);
  }
  const thread = events.find((e) => e.type === "thread.started")?.thread_id ?? resume;
  return { answer, thread, stdout };
}

/** Codex 세션에서 컴팩트가 일어났는지: `codex exec`의 출력과 이 기기에 남은 세션 기록(`$CODEX_HOME/sessions`)에서 찾는다. */
async function codexCompaction(thread: string, stdout: string) {
  const sessions = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  const file = (await readdir(sessions, { recursive: true }).catch(() => [])).find((f) =>
    f.endsWith(`${thread}.jsonl`),
  );
  const rollout = file ? await readFile(join(sessions, file), "utf8") : "";
  const mark = /"type":"(?:context_)?compact(?:ed|ion)"/;
  const line = rollout.split("\n").find((l) => mark.test(l));
  let summary = "";
  try {
    const message = line && JSON.parse(line).payload?.message;
    if (typeof message === "string") summary = message;
  } catch {}
  return {
    compacted: Boolean(line) || mark.test(stdout),
    rollout: file ? join(sessions, file) : undefined,
    summary,
  };
}

/**
 * Codex: 러너의 실제 실행기(`codex`)를 꽂은 러너에 웹이 하듯 DM으로 묻는다. 러너는 `-s read-only`를 준다.
 * 긴 세션만 컴팩트 문턱을 낮춰야 해서(`-c`) `codex exec`를 바로 부른다. 그때도 샌드박스는 읽기 전용이다.
 */
async function codex(world: World, head: string, quick: boolean) {
  const folder = world.repo.folder;
  const version = (await sh("codex", ["--version"])).stdout.trim();
  const fork = /^\s+fork\b/m.test((await sh("codex", ["exec", "--help"])).stdout);
  const checks: Check[] = [];

  await attempt(checks, "구독 로그인", async () => {
    // 출력에 가린 API 키가 섞일 수 있어 옮겨 적지 않는다.
    const { code, stdout, stderr } = await sh("codex", ["login", "status"]);
    const chatgpt = code === 0 && /chatgpt/i.test(stdout + stderr);
    const how = chatgpt
      ? "ChatGPT로 로그인했다"
      : code === 0
        ? "ChatGPT가 아닌 로그인이다(API 키일 수 있다)"
        : "로그인하지 않았다";
    return { ok: chatgpt, detail: `API 키 환경 변수 없이 돌렸다. \`codex login status\`: ${how}` };
  });

  const ask = (channel: string, message: string) => askRunner(world, channel, message, "codex");
  const channel = await world.channel(world.owner, "Codex 점검");
  const word = secret();
  await attempt(checks, "세션 이어 가기", async () => {
    const first = await ask(channel, SAY.remember(word));
    const second = await ask(channel, SAY.recall);
    return {
      ok: second.text.includes(word),
      detail: `러너의 채널 세션으로 이은(\`codex exec resume <id> -\`) 둘째 턴이 첫 턴의 암호 ${word}를 물었더니 "${short(second.text)}". 세션 ${first.session} → ${second.session === first.session ? "그대로" : second.session}`,
    };
  });

  await attempt(checks, "읽기 전용", async () => {
    const answer = await ask(channel, SAY.write);
    const changed = await changes(world, head);
    return {
      ok: !changed,
      detail: `${changed ?? "작업 폴더가 그대로다"}. 러너가 \`-s read-only\`로 이어 간 세션에 ${PROBE}를 만들고 README.md를 고치라고 시켰다. 답: "${short(answer.text)}"`,
    };
  });

  if (!quick) {
    await attempt(checks, "긴 세션", async () => {
      const limit = [
        "--sandbox=read-only",
        "-c",
        `model_auto_compact_token_limit=${CODEX_COMPACT_LIMIT}`,
      ];
      const word = secret();
      const first = await codexTurn(folder, SAY.remember(word), undefined, limit);
      const id = first.thread;
      if (!id) throw new Error("thread.started에서 세션 id를 받지 못했다");
      let out = first.stdout;
      let fills = 0;
      while (fills < FILLS && !(await codexCompaction(id, out)).compacted) {
        fills++;
        progress(`    채움 글 ${fills}`);
        out += (await codexTurn(folder, SAY.fill(filler(`c${fills}`, 300)), id, limit)).stdout;
      }
      const recall = await codexTurn(folder, SAY.recall, id, limit);
      const found = await codexCompaction(id, out + recall.stdout);
      const remembered = recall.answer.includes(word)
        ? "마지막 턴에 첫 턴의 암호를 기억했다"
        : `마지막 턴에 첫 턴의 암호를 잊었다(답: "${short(recall.answer)}")`;
      const where = found.rollout ? `세션 기록 ${found.rollout}` : "세션 기록 파일을 찾지 못했다";
      if (!found.compacted) {
        return {
          ok: null,
          detail: `채움 글(한 턴에 약 1만 토큰) ${fills}턴까지 컴팩트 흔적이 없었다. ${remembered}. ${where}`,
        };
      }
      const summary = found.summary
        ? ` 그 자리에 요약 ${found.summary.length}자가 남았고 요약에 암호가 ${found.summary.includes(word) ? "있다" : "없다"}.`
        : "";
      return {
        ok: null,
        detail: `채움 글 ${fills}턴 뒤 컴팩트가 일어났다. ${remembered}.${summary} ${where}`,
      };
    });
  }
  return {
    version: `${version}, \`codex exec fork\` ${fork ? "있음" : "없음"}`,
    checks,
  };
}

progress("임시 레포에 서버와 러너를 띄운다");
const world = await startWorld({ executors: { "claude-code": claudeCode, codex: codexExecutor } });
const write = writer(world.repo.folder);
await write("README.md", "# 점검용 임시 레포\n");
for (let n = 1; n <= FILLS; n++) await write(`fill/${n}.txt`, filler(String(n), 500));
await world.repo.git("add", "--all");
await world.repo.git("commit", "--message=점검용 파일");
const head = await world.repo.git("rev-parse", "HEAD");

const results: { id: ExecutorId; version: string; checks: Check[] }[] = [];
for (const id of picked as ExecutorId[]) {
  progress(EXECUTOR_NAMES[id]);
  try {
    results.push({ id, ...(await (id === "codex" ? codex : claude)(world, head, values.quick)) });
  } catch (error) {
    const detail = `실행기를 부르지 못했다: ${messageOf(error)}`;
    results.push({ id, version: "?", checks: [{ name: "실행기", ok: false, detail }] });
  }
}

const failed = results.some((r) => r.checks.some((c) => c.ok === false));
const { log } = await runnerPaths(world.repo.folder);
if (failed) {
  await world.runner.stop();
  await world.server.stop();
  await rm(dirname(world.config), { recursive: true, force: true }); // 서버 DB와 CLI 설정만 지운다
} else {
  await world.stop();
}

const how = {
  "claude-code": "러너의 `claudeCode` 실행기로 DM 채널 세션을 돌렸다",
  codex:
    "러너의 `codex` 실행기로 DM 채널 세션을 돌렸다(긴 세션은 컴팩트 문턱을 낮추려고 `codex exec --json`을 바로 불렀다)",
};
const line = (c: Check) =>
  c.ok === null
    ? `- ${c.name}(관찰): ${c.detail}`
    : `- [${c.ok ? "x" : " "}] ${c.name}${c.ok ? "" : "(실패)"}: ${c.detail}`;
console.log(
  [
    `#### 실제 실행기 손 점검 (${new Date().toISOString().slice(0, 10)})`,
    "",
    `\`node test/real-executors.ts ${process.argv.slice(2).join(" ")}\`. ${platform()} ${arch()}, Node ${process.version}.${
      values.quick
        ? " 긴 세션은 건너뛰었다(--quick)."
        : ` 자동 컴팩트를 싸게 보려고 문턱을 낮췄다: Claude Code \`CLAUDE_CODE_AUTO_COMPACT_WINDOW=${CLAUDE_WINDOW}\`, Codex \`model_auto_compact_token_limit=${CODEX_COMPACT_LIMIT}\`.`
    }`,
    ...results.flatMap((r) => [
      "",
      `**${EXECUTOR_NAMES[r.id]}** (${r.version}). ${how[r.id]}.`,
      "",
      ...r.checks.map(line),
    ]),
    "",
    failed
      ? `실패한 점검이 있어 임시 레포를 남겼다: ${world.repo.folder} (러너 실행 기록 ${log})`
      : "임시 레포는 지웠다.",
  ].join("\n"),
);
process.exit(failed ? 1 : 0);
