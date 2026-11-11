// 이 기기의 에이전트에 Omagari의 두 훅(세션 시작, 편집 전)과 상태 한 줄 스킬을 깐다(ADR-0016).
// 실행기마다 자기 사용자 설정에 깐다. Codex(#16)는 `install`에 자기 것을 더하고 `mergeHooks`와 `SKILL`을 같이 쓴다.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutorId } from "@omagari/contract";

const HOOK = fileURLToPath(new URL("../../hooks/src/main.ts", import.meta.url));
/** 실행기 모두에게 주는 스킬 하나. 같은 SKILL.md 꼴을 Claude Code와 Codex가 읽는다. */
const SKILL = fileURLToPath(new URL("../skills/omagari-status/SKILL.md", import.meta.url));
/** 에이전트가 훅을 끊는 시간(초). 훅은 스스로 3초 안에 끝나므로 상한일 뿐이다. */
const TIMEOUT = 10;

/** 이 기기의 실행기마다 훅과 스킬을 깔고, 깐 것을 한 줄씩 돌려준다. */
export async function install() {
  return [await claudeCode()];
}

async function claudeCode() {
  const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const settings = join(home, "settings.json");
  // SessionStart는 matcher 없이 건다. 세션이 비워지거나(clear) 컴팩트될 때도 돌아야 편집 전 훅의 기억을 지운다.
  // PreToolUse는 파일을 고치는 도구에만 건다. 훅도 스스로 거르지만(EDIT_TOOLS), 다른 도구마다 훅을 띄우지 않는다.
  await mergeHooks(settings, "claude-code", {
    SessionStart: {},
    PreToolUse: { matcher: "Edit|Write|MultiEdit|NotebookEdit" },
  });
  const skill = join(home, "skills", "omagari-status", "SKILL.md");
  await mkdir(dirname(skill), { recursive: true });
  await copyFile(SKILL, skill);
  return `Claude Code: ${settings}에 세션 시작 훅과 편집 전 훅을, ${skill}에 상태 한 줄 스킬을 깔았다. 새 작업 세션부터 돈다.`;
}

/** sh가 한 낱말로 그대로 받게 작은따옴표로 감싼다. */
const sh = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

/**
 * 훅 명령. 이것을 돌린 Node로 훅을 돌리고, 훅은 인자로 받은 실행기를 러너에 보낸다(ADR-0015).
 * 경로가 바뀌어도(Node를 올렸거나 레포를 옮겼다) 다시 깔면 앞의 것을 알아보고 바꾸도록, 끝이 늘 같다.
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
 * 훅 설정 파일(`{ hooks: { 이벤트: [{ matcher?, hooks: [훅...] }] } }`)에 Omagari의 훅을 이벤트마다 하나씩 넣는다.
 * 다른 설정과 다른 훅은 건드리지 않는다. 전에 깐 Omagari 훅(같은 실행기)만 빼고 새로 넣으므로 몇 번 돌려도 하나다.
 * 읽을 수 없는 꼴이면 아무것도 쓰지 않고 멈춘다.
 */
async function mergeHooks(
  file: string,
  executor: ExecutorId,
  wanted: Record<string, { matcher?: string }>,
) {
  const text = await readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  const refuse = (why: string) =>
    new Error(`${file}을 건드리지 않았다: ${why}. 고친 뒤 다시 깔아라`);
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    throw refuse("JSON으로 읽지 못했다");
  }
  if (!isRecord(settings)) throw refuse("맨 바깥이 객체가 아니다");
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) throw refuse("hooks가 객체가 아니다");
  for (const [event, group] of Object.entries(wanted)) {
    const groups = hooks[event] ?? [];
    if (!Array.isArray(groups)) throw refuse(`hooks.${event}가 배열이 아니다`);
    const kept = groups.flatMap((existing) => {
      if (!isRecord(existing) || !Array.isArray(existing.hooks)) return [existing];
      const rest = existing.hooks.filter((handler) => !ours(handler, executor));
      // Omagari 훅만 들어 있던 묶음은 통째로 뺀다.
      return rest.length === 0 && existing.hooks.length > 0 ? [] : [{ ...existing, hooks: rest }];
    });
    hooks[event] = [
      ...kept,
      { ...group, hooks: [{ type: "command", command: hookCommand(executor), timeout: TIMEOUT }] },
    ];
  }
  settings.hooks = hooks;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}
