// Hand check of the real executors (issue #7). Checks that Claude Code and Codex continue a session headlessly, are read-only,
// run on a subscription login, and auto-compact when a session gets long.
// A person runs it on a machine with a subscription login. Its name isn't *.test.ts, so CI (`npm test`) doesn't run it.
// How to run and read it: docs/executor-check.md
import { execFile } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { EXECUTOR_NAMES, ExecutorId } from "@omagari/contract";
import { claudeCode, codex as codexExecutor, runnerPaths } from "@omagari/runner";
import { startWorld, writer } from "./harness.ts";

/** If any of these is set, it runs on an API key instead of the subscription. The values are neither read nor printed. */
const API_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"];
const keys = API_KEYS.filter((key) => process.env[key]);
if (keys.length > 0) {
  console.error(
    `This check looks at the subscription login, so it won't run if an API key is set. Unset it in this shell and run again: unset ${keys.join(" ")}`,
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
    console.error(`Unknown executor: ${id}. Choices: ${ExecutorId.options.join(", ")}`);
    process.exit(2);
  }
}

/** Cap on one turn. Ten minutes, same as the runner. */
const TURN_MS = 10 * 60_000;
/**
 * Lowers the window to see auto-compact cheaply. By default it is the model's context limit (about 967K for a 1M model), and filling that far is expensive.
 * The smallest window Claude Code accepts is 100K (model config docs). If this shell already has it, that value is used.
 */
process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ??= "100000";
const CLAUDE_WINDOW = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
/** Codex's auto-compact threshold (`model_auto_compact_token_limit`, config docs). */
const CODEX_COMPACT_LIMIT = 40_000;
/** Max turns that fill the context in a long session. If compact doesn't happen even after filling this much, it is recorded as not having happened. */
const FILLS = 10;
/** The file the read-only check tells the agent to create. */
const PROBE = "omagari-probe.txt";

const SAY = {
  remember: (secret: string) =>
    `This is a check message. The password is ${secret}. Remember it and reply only "Got it".`,
  recall: "What was the password I told you first? Reply with the password only.",
  write: `This is a check message. Create a file ${PROBE} at the top of this repo, write "probe" in it, and add one line to the end of README.md. Try with every tool you can use, and reply in one line whether you did it or not.`,
  read: (n: number) =>
    `This is a check message. Read fill/${n}.txt from start to end and reply with only the last line, exactly as is.`,
  fill: (text: string) =>
    `This is a check message. What follows is meaningless text meant to fill the context. Read it and reply only "OK".\n\n${text}`,
};

const execFileAsync = promisify(execFile);

/** Runs an executable and gets the exit code and output. A non-zero exit is a result too. Writes `input` to stdin and closes it. */
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
    const failed = error as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
    };
    if (typeof failed.code !== "number") throw error; // it didn't start (no such executable) or was killed at the time cap
    return {
      code: failed.code,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}

const progress = (line: string) =>
  console.error(`${new Date().toISOString().slice(11, 19)} ${line}`);
const short = (text: string, length = 120) => text.replace(/\s+/g, " ").trim().slice(0, length);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const secret = () => randomBytes(4).toString("hex");

/** Meaningless text to fill the context. Each line is numbered and the last line is `END <name>`. */
const SYLLABLES = "ka lo mi ne su ta ri po ve zu ha ji".split(" ");
const syllable = () => SYLLABLES[randomInt(SYLLABLES.length)];
const filler = (name: string, lines: number) =>
  `${Array.from(
    { length: lines },
    (_, i) =>
      `${name}-${i + 1}: ${Array.from({ length: 10 }, () => syllable() + syllable() + syllable()).join(" ")}`,
  ).join("\n")}\nEND ${name}\n`;

/** The result of one check. If `ok` is null, it's an observation, not a pass or fail. */
type Check = { name: string; ok: boolean | null; detail: string };
type World = Awaited<ReturnType<typeof startWorld>>;

/** Runs one check and records it in `checks`. If it throws, records a failure and moves to the next check. */
async function attempt(checks: Check[], name: string, check: () => Promise<Omit<Check, "name">>) {
  progress(`  ${name}`);
  try {
    checks.push({ name, ...(await check()) });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: `The check stopped: ${messageOf(error)}`,
    });
  }
}

/** Whether the working folder is exactly at commit `head`. If changed, returns what changed. */
async function changes(world: World, head: string) {
  const status = await world.repo.git(
    "status",
    "--porcelain",
    "--ignored",
    "--untracked-files=all",
  );
  const now = await world.repo.git("rev-parse", "HEAD");
  if (status === "" && now === head) return undefined;
  return `The working folder changed: ${short(status || `HEAD ${head} → ${now}`, 300)}`;
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
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
  };
  message?: {
    content?: string | { text?: string }[];
    usage?: Usage;
    model?: string;
  };
};

/** Session records Claude Code left on this machine (`<projects>/<folder>/<session>.jsonl`). An empty list if none. */
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

/** Asks the runner's `executor` agent by DM as the web does, and returns the answer and that turn's session id (run log). */
async function askRunner(world: World, channel: string, message: string, executor: ExecutorId) {
  const { log } = await runnerPaths(world.repo.folder);
  const pending = await world.ask(world.owner, channel, message, executor);
  const qa = await world.settled(world.owner, pending, TURN_MS + 60_000);
  if (qa.answer.state !== "answered") {
    throw new Error(qa.answer.state === "failed" ? qa.answer.error.message : "No answer came");
  }
  // The runner writes the run log before sending the answer. The last line is this turn.
  const last = (await readFile(log, "utf8")).trimEnd().split("\n").at(-1) ?? "{}";
  return { text: qa.answer.text, session: JSON.parse(last).session as string };
}

/**
 * Claude Code: asks by DM, as the web does, a runner with the runner's real executor (`claudeCode`) plugged in.
 * The channel session, read-only tools, `--resume`, the turn cap, and the run log all run on the runner's code.
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

  await attempt(checks, "Subscription login", async () => ({
    ok:
      status.loggedIn === true &&
      status.authMethod === "claude.ai" &&
      status.apiProvider === "firstParty",
    detail: `Ran without an API key environment variable. \`claude auth status\`: authMethod ${status.authMethod}, apiProvider ${status.apiProvider}, plan ${status.subscriptionType}`,
  }));

  const channel = await world.channel(world.owner, "Check");
  const word = secret();
  await attempt(checks, "Continuing a session", async () => {
    const first = await ask(channel, SAY.remember(word));
    const second = await ask(channel, SAY.recall);
    return {
      ok: second.text.includes(word),
      detail: `Asked the first turn's password ${word} in the second turn and got "${short(second.text)}". Session ${first.session} → ${second.session === first.session ? "same" : second.session}`,
    };
  });

  await attempt(checks, "Read-only", async () => {
    const answer = await ask(channel, SAY.write);
    const changed = await changes(world, head);
    return {
      ok: !changed,
      detail: `${changed ?? "The working folder is unchanged"}. Told the continued session to create ${PROBE} and edit README.md. Answer: "${short(answer.text)}"`,
    };
  });

  if (!quick) {
    await attempt(checks, "Long session", async () => {
      const long = await world.channel(world.owner, "Long session");
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
      if (all.length === 0) throw new Error(`Couldn't find the session records: ${projects}`);
      const remembered = recall.text.includes(word)
        ? `Remembered the first turn's password in the last turn`
        : `Forgot the first turn's password in the last turn (answer: "${short(recall.text)}")`;
      // The auto-compact threshold differs by model, so also record which model it was.
      const models = [
        ...new Set(
          all.flatMap((e) => (e.message?.model?.startsWith("claude") ? [e.message.model] : [])),
        ),
      ];
      const where = `model ${models.join(", ") || "?"}, session ${[...new Set(sessions)].join(" → ")}`;
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
          detail: `Had it read ${reads} files, and there was no auto-compact until the context reached about ${context} tokens. ${remembered}. ${where}`,
        };
      }
      const meta = boundary.compactMetadata ?? {};
      const content = all.find((e) => e.isCompactSummary)?.message?.content ?? "";
      const summary =
        typeof content === "string" ? content : content.map((c) => c.text ?? "").join("");
      return {
        ok: null,
        detail: `After having it read ${reads} files, auto-compact happened (trigger ${meta.trigger}, ${meta.preTokens} → ${meta.postTokens} tokens). A ${summary.length}-char summary was left there, and the password is ${summary.includes(word) ? "in" : "not in"} the summary. ${remembered}. ${where}`,
      };
    });
  }
  return { version: `Claude Code ${version.split(" ")[0]}`, checks };
}

/** One turn of `codex exec --json`. With `resume`, it continues that session. Put `options` before `resume` (it isn't a global flag). */
async function codexTurn(folder: string, prompt: string, resume?: string, options: string[] = []) {
  const args = ["exec", "--json", ...options, ...(resume ? ["resume", resume] : []), "-"];
  const { code, stdout, stderr } = await sh("codex", args, {
    cwd: folder,
    input: prompt,
  });
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
    throw new Error(`codex couldn't answer (exit code ${code}): ${why}`);
  }
  const thread = events.find((e) => e.type === "thread.started")?.thread_id ?? resume;
  return { answer, thread, stdout };
}

/** Whether compact happened in a Codex session: look in the output of `codex exec` and the session records left on this machine (`$CODEX_HOME/sessions`). */
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
 * Codex: asks by DM, as the web does, a runner with the runner's real executor (`codex`) plugged in. The runner passes `-s read-only`.
 * Only the long session has to lower the compact threshold (`-c`), so it calls `codex exec` directly. The sandbox is read-only then too.
 */
async function codex(world: World, head: string, quick: boolean) {
  const folder = world.repo.folder;
  const version = (await sh("codex", ["--version"])).stdout.trim();
  const fork = /^\s+fork\b/m.test((await sh("codex", ["exec", "--help"])).stdout);
  const checks: Check[] = [];

  await attempt(checks, "Subscription login", async () => {
    // The output may contain a masked API key, so it isn't copied over.
    const { code, stdout, stderr } = await sh("codex", ["login", "status"]);
    const chatgpt = code === 0 && /chatgpt/i.test(stdout + stderr);
    const how = chatgpt
      ? "Logged in with ChatGPT"
      : code === 0
        ? "Logged in, but not with ChatGPT (may be an API key)"
        : "Not logged in";
    return {
      ok: chatgpt,
      detail: `Ran without an API key environment variable. \`codex login status\`: ${how}`,
    };
  });

  const ask = (channel: string, message: string) => askRunner(world, channel, message, "codex");
  const channel = await world.channel(world.owner, "Codex check");
  const word = secret();
  await attempt(checks, "Continuing a session", async () => {
    const first = await ask(channel, SAY.remember(word));
    const second = await ask(channel, SAY.recall);
    return {
      ok: second.text.includes(word),
      detail: `Asked the first turn's password ${word} in the second turn, continued in the runner's channel session (\`codex exec resume <id> -\`), and got "${short(second.text)}". Session ${first.session} → ${second.session === first.session ? "same" : second.session}`,
    };
  });

  await attempt(checks, "Read-only", async () => {
    const answer = await ask(channel, SAY.write);
    const changed = await changes(world, head);
    return {
      ok: !changed,
      detail: `${changed ?? "The working folder is unchanged"}. Told the session the runner continued with \`-s read-only\` to create ${PROBE} and edit README.md. Answer: "${short(answer.text)}"`,
    };
  });

  if (!quick) {
    await attempt(checks, "Long session", async () => {
      const limit = [
        "--sandbox=read-only",
        "-c",
        `model_auto_compact_token_limit=${CODEX_COMPACT_LIMIT}`,
      ];
      const word = secret();
      const first = await codexTurn(folder, SAY.remember(word), undefined, limit);
      const id = first.thread;
      if (!id) throw new Error("Couldn't get the session id from thread.started");
      let out = first.stdout;
      let fills = 0;
      while (fills < FILLS && !(await codexCompaction(id, out)).compacted) {
        fills++;
        progress(`    Fill text ${fills}`);
        out += (await codexTurn(folder, SAY.fill(filler(`c${fills}`, 300)), id, limit)).stdout;
      }
      const recall = await codexTurn(folder, SAY.recall, id, limit);
      const found = await codexCompaction(id, out + recall.stdout);
      const remembered = recall.answer.includes(word)
        ? "Remembered the first turn's password in the last turn"
        : `Forgot the first turn's password in the last turn (answer: "${short(recall.answer)}")`;
      const where = found.rollout
        ? `session record ${found.rollout}`
        : "couldn't find the session record file";
      if (!found.compacted) {
        return {
          ok: null,
          detail: `No sign of compact up to ${fills} turns of fill text (about 10,000 tokens per turn). ${remembered}. ${where}`,
        };
      }
      const summary = found.summary
        ? ` A ${found.summary.length}-char summary was left there, and the password is ${found.summary.includes(word) ? "in" : "not in"} the summary.`
        : "";
      return {
        ok: null,
        detail: `Compact happened after ${fills} turns of fill text. ${remembered}.${summary} ${where}`,
      };
    });
  }
  return {
    version: `${version}, \`codex exec fork\` ${fork ? "present" : "absent"}`,
    checks,
  };
}

progress("Starting a server and runner on a temporary repo");
const world = await startWorld({
  executors: { "claude-code": claudeCode, codex: codexExecutor },
});
const write = writer(world.repo.folder);
await write("README.md", "# Temporary repo for the check\n");
for (let n = 1; n <= FILLS; n++) await write(`fill/${n}.txt`, filler(String(n), 500));
await world.repo.git("add", "--all");
await world.repo.git("commit", "--message=check file");
const head = await world.repo.git("rev-parse", "HEAD");

const results: { id: ExecutorId; version: string; checks: Check[] }[] = [];
for (const id of picked as ExecutorId[]) {
  progress(EXECUTOR_NAMES[id]);
  try {
    results.push({
      id,
      ...(await (id === "codex" ? codex : claude)(world, head, values.quick)),
    });
  } catch (error) {
    const detail = `Couldn't call the executor: ${messageOf(error)}`;
    results.push({
      id,
      version: "?",
      checks: [{ name: "Executor", ok: false, detail }],
    });
  }
}

const failed = results.some((r) => r.checks.some((c) => c.ok === false));
const { log } = await runnerPaths(world.repo.folder);
if (failed) {
  await world.runner.stop();
  await world.server.stop();
  await rm(dirname(world.config), { recursive: true, force: true }); // removes only the server DB and CLI config
} else {
  await world.stop();
}

const how = {
  "claude-code": "Ran a DM channel session with the runner's `claudeCode` executor",
  codex:
    "Ran a DM channel session with the runner's `codex` executor (the long session called `codex exec --json` directly to lower the compact threshold)",
};
const line = (c: Check) =>
  c.ok === null
    ? `- ${c.name} (observation): ${c.detail}`
    : `- [${c.ok ? "x" : " "}] ${c.name}${c.ok ? "" : " (failed)"}: ${c.detail}`;
console.log(
  [
    `#### Hand check of the real executors (${new Date().toISOString().slice(0, 10)})`,
    "",
    `\`node test/real-executors.ts ${process.argv.slice(2).join(" ")}\`. ${platform()} ${arch()}, Node ${process.version}.${
      values.quick
        ? " The long session was skipped (--quick)."
        : ` To see auto-compact cheaply, the threshold was lowered: Claude Code \`CLAUDE_CODE_AUTO_COMPACT_WINDOW=${CLAUDE_WINDOW}\`, Codex \`model_auto_compact_token_limit=${CODEX_COMPACT_LIMIT}\`.`
    }`,
    ...results.flatMap((r) => [
      "",
      `**${EXECUTOR_NAMES[r.id]}** (${r.version}). ${how[r.id]}.`,
      "",
      ...r.checks.map(line),
    ]),
    "",
    failed
      ? `A check failed, so the temporary repo was kept: ${world.repo.folder} (runner run log ${log})`
      : "The temporary repo was deleted.",
  ].join("\n"),
);
process.exit(failed ? 1 : 0);
