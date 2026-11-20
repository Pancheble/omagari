// Installs Omagari's two hooks (session start, pre-edit) and the status line skill into this machine's agents (ADR-0016).
// Each executor gets them in its own user settings. There is one hook file and one skill; the hook tells executors apart by its argument.
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutorId } from "@omagari/contract";

/** The hook file next to this one: `.ts` in a clone, `.js` in the npm package (ADR-0048). */
const HOOK = fileURLToPath(
  new URL(`../../hooks/src/main${extname(import.meta.filename)}`, import.meta.url),
);
/** The one skill given to every executor. Claude Code and Codex read the same SKILL.md format. */
const SKILL = fileURLToPath(new URL("../skills/omagari-status/SKILL.md", import.meta.url));
/** Seconds before the agent cuts a hook off. Hooks finish within 3 seconds on their own, so this is only an upper bound. */
const TIMEOUT = 10;

/** Installs hooks and the skill for each executor on this machine and returns one line per install. */
export async function install() {
  return [await claudeCode(), await codex()];
}

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** Takes Omagari's hooks and the status line skill out of each executor and returns one line per executor. Other settings stay as they were. */
export async function uninstall() {
  const lines = [];
  for (const [name, home, file, executor] of [
    ["Claude Code", claudeHome(), "settings.json", "claude-code"],
    ["Codex", codexHome(), "hooks.json", "codex"],
  ] as const) {
    const removed = await removeHooks(join(home, file), executor);
    await rm(join(home, "skills", "omagari-status"), { recursive: true, force: true });
    lines.push(
      `${name}: ${removed ? "removed" : "no"} Omagari hooks in ${join(home, file)}; removed the status line skill.`,
    );
  }
  return lines;
}

async function claudeCode() {
  const home = claudeHome();
  const settings = join(home, "settings.json");
  // SessionStart has no matcher. It must also run when a session is cleared or compacted, so the pre-edit hook's memory gets reset.
  // PreToolUse matches file-editing tools, plus shell commands (Bash) to deliver the inbox. The hook filters on its own too, but this keeps other tools from starting it.
  await mergeHooks(settings, "claude-code", {
    SessionStart: {},
    PreToolUse: { matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash" },
  });
  const skill = join(home, "skills", "omagari-status", "SKILL.md");
  await mkdir(dirname(skill), { recursive: true });
  await copyFile(SKILL, skill);
  return `Claude Code: installed the session-start and pre-edit hooks in ${settings} and the status line skill in ${skill}. They take effect from new work sessions.`;
}

/**
 * Codex reads `hooks.json` and `skills/` in `$CODEX_HOME` (default `~/.codex`) (Codex hooks, where skill-installer installs).
 * The user has to trust the installed hooks in Codex's `/hooks` before they run. Trust is tied to each hook's hash, so if the path changes and you reinstall, you have to trust them again.
 */
async function codex() {
  const home = codexHome();
  const hooks = join(home, "hooks.json");
  // SessionStart has no matcher, for the same reason as Claude Code. Codex matchers are regular expressions.
  // apply_patch is the only file-editing tool. Shell commands (Bash, exec_command) get the hook to deliver the inbox (stage 1 question A1, stage 2 question A7).
  await mergeHooks(hooks, "codex", {
    SessionStart: {},
    PreToolUse: { matcher: "^(apply_patch|Bash|exec_command)$" },
  });
  const skill = join(home, "skills", "omagari-status", "SKILL.md");
  await mkdir(dirname(skill), { recursive: true });
  await copyFile(SKILL, skill);
  return `Codex: installed the session-start and pre-edit hooks in ${hooks} and the status line skill in ${skill}. Open /hooks in Codex and trust both hooks for them to run (if reinstalling changes the command, trust them again).`;
}

/** Wraps it in single quotes so sh receives it as one word as-is. */
const sh = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/**
 * The hook command. It runs the hook with the same Node that runs this, and the hook sends the executor it got as an argument to the runner (ADR-0015).
 * The end is always the same, so if the path changes (Node upgraded or repo moved), reinstalling recognizes the old one and replaces it.
 */
const hookCommand = (executor: ExecutorId) => `${sh(process.execPath)} ${sh(HOOK)} ${executor}`;
const ours = (handler: unknown, executor: ExecutorId) =>
  isRecord(handler) &&
  typeof handler.command === "string" &&
  handler.command.endsWith(`/hooks/src/main.ts' ${executor}`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Puts Omagari's hook into the hook settings file (`{ hooks: { event: [{ matcher?, hooks: [hook...] }] } }`), one per event.
 * Leaves other settings and other hooks alone. It removes only the earlier Omagari hook (same executor) before adding the new one, so running it many times leaves one.
 * If the file's shape can't be read, it writes nothing and stops.
 */
async function mergeHooks(
  file: string,
  executor: ExecutorId,
  wanted: Record<string, { matcher?: string }>,
) {
  const { settings, hooks } = await readHookFile(file);
  for (const [event, group] of Object.entries(wanted)) {
    hooks[event] = [
      ...withoutOurs(file, hooks, event, executor),
      {
        ...group,
        hooks: [{ type: "command", command: hookCommand(executor), timeout: TIMEOUT }],
      },
    ];
  }
  settings.hooks = hooks;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Removes this executor's Omagari hooks from every event. Writes nothing if there were none.
 * Events and `hooks` that end up empty are removed, and so is a file that ends up as `{}` (setup may have created it).
 */
async function removeHooks(file: string, executor: ExecutorId) {
  const { settings, hooks } = await readHookFile(file);
  let found = false;
  for (const event of Object.keys(hooks)) {
    const kept = withoutOurs(file, hooks, event, executor);
    if (JSON.stringify(kept) === JSON.stringify(hooks[event])) continue;
    found = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (!found) return false;
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  else settings.hooks = hooks;
  if (Object.keys(settings).length === 0) await unlink(file);
  else await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
  return true;
}

/** The groups of `hooks[event]` without this executor's Omagari hook. A group that held only Omagari hooks is removed whole. */
function withoutOurs(
  file: string,
  hooks: Record<string, unknown>,
  event: string,
  executor: ExecutorId,
) {
  const groups = hooks[event] ?? [];
  if (!Array.isArray(groups)) throw refuse(file, `hooks.${event} is not an array`);
  return groups.flatMap((existing) => {
    if (!isRecord(existing) || !Array.isArray(existing.hooks)) return [existing];
    const rest = existing.hooks.filter((handler) => !ours(handler, executor));
    if (rest.length === existing.hooks.length) return [existing];
    return rest.length === 0 ? [] : [{ ...existing, hooks: rest }];
  });
}

const refuse = (file: string, why: string) =>
  new Error(`Did not touch ${file}: ${why}. Fix it and run it again`);

/** Reads a hook settings file (a missing one is `{}`). If its shape can't be read, throws and nothing gets written. */
async function readHookFile(file: string) {
  const text = await readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    throw refuse(file, "could not parse it as JSON");
  }
  if (!isRecord(settings)) throw refuse(file, "the top level is not an object");
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) throw refuse(file, "hooks is not an object");
  return { settings, hooks };
}
