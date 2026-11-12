import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { eventually, startWorld, tempRepo, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type Handler = { type: string; command: string; timeout?: number };
type Group = { matcher?: string; hooks: Handler[] };
type Settings = Record<string, unknown> & { hooks: Record<string, Group[]> };

const SESSION = "11111111-2222-3333-4444-555555555555";
const EDIT_MATCHER = "Edit|Write|MultiEdit|NotebookEdit|Bash";

const settingsFile = (world: World) => join(world.claude, "settings.json");
const readSettings = async (world: World): Promise<Settings> =>
  JSON.parse(await readFile(settingsFile(world), "utf8"));

/**
 * Claude Code가 하듯 설정에서 `event`의 훅 가운데 `value`(도구 이름, 세션이 시작된 까닭)에 걸리는 명령을 고른다.
 * matcher가 없거나 "*"면 모두에 걸리고, 이름을 `|`로 이은 것이면 그 이름들에 걸린다. 이 테스트의 설정에 다른 꼴은 없다.
 */
function matching(settings: Settings, event: string, value: string) {
  return (settings.hooks[event] ?? [])
    .filter(({ matcher }) => !matcher || matcher === "*" || matcher.split("|").includes(value))
    .flatMap(({ hooks }) => hooks.map((handler) => handler.command));
}

const sessionStartInput = (cwd: string) => ({
  session_id: SESSION,
  transcript_path: join(cwd, "transcript.jsonl"),
  cwd,
  hook_event_name: "SessionStart",
  source: "startup",
});

const editInput = (cwd: string, file: string) => ({
  session_id: SESSION,
  transcript_path: join(cwd, "transcript.jsonl"),
  cwd,
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_input: { file_path: join(cwd, file), old_string: "pay", new_string: "pay()" },
  tool_use_id: "toolu_01",
});

/** 깔린 명령을 에이전트처럼 돌리고 넣은 글을 돌려준다. 훅은 0으로 끝나고 stderr에 쓰지 않는다. */
async function runInstalled(world: World, command: string, input: object, event: string) {
  const { code, stdout, stderr } = await world.shell(command, JSON.stringify(input));
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  if (stdout === "") return "";
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.equal(hookSpecificOutput.hookEventName, event);
  return hookSpecificOutput.additionalContext as string;
}

test("omagari install 하나로 Claude Code에 두 훅과 상태 한 줄 스킬이 깔리고, 새 작업 세션에서 깔린 두 훅이 돈다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await world.desk(await world.login("alice"));
  t.after(desk.remove);
  await writer(desk.folder)("pay.ts", "pay\n");

  const installed = await world.cli("install");
  assert.equal(installed.code, 0, installed.stderr);
  const skillFile = join(world.claude, "skills", "omagari-status", "SKILL.md");
  assert.ok(installed.stdout.startsWith(`Claude Code: ${settingsFile(world)}에`), installed.stdout);
  assert.ok(installed.stdout.includes(skillFile), installed.stdout);

  // 새 세션의 Claude Code가 읽는 설정. 세션 시작은 어떻게 시작했든(비우기와 컴팩트도) 걸리고, 편집 전 훅은 파일을 고치는 도구와 셸 명령에만 걸린다.
  const settings = await readSettings(world);
  for (const source of ["startup", "resume", "clear", "compact"]) {
    assert.equal(matching(settings, "SessionStart", source).length, 1, source);
  }
  for (const tool of EDIT_MATCHER.split("|")) {
    assert.equal(matching(settings, "PreToolUse", tool).length, 1, tool);
  }
  assert.deepEqual(matching(settings, "PreToolUse", "Read"), []);

  const [startCommand] = matching(settings, "SessionStart", "startup");
  assert.ok(startCommand);
  await eventually(async () =>
    assert.match(
      await runInstalled(world, startCommand, sessionStartInput(world.repo.folder), "SessionStart"),
      /<omagari-situation>\n- alice · 브랜치 "main" · "pay\.ts 수정 중" \(바뀐 파일로 만든 줄\)\n<\/omagari-situation>/,
    ),
  );
  const [editCommand] = matching(settings, "PreToolUse", "Edit");
  assert.ok(editCommand);
  assert.match(
    await runInstalled(world, editCommand, editInput(world.repo.folder, "pay.ts"), "PreToolUse"),
    /^Omagari: 고치려는 파일 "pay\.ts"을 다른 멤버의 작업도 바꾸고 있다[\s\S]*<omagari-nearby>\n- alice · 브랜치 "main" · /,
  );

  // 스킬의 설명은 늘 에이전트의 맥락에 있고, 본문은 에이전트가 스킬을 쓸 때 읽는다.
  const skill = await readFile(skillFile, "utf8");
  const [, frontmatter = "", body = ""] = skill.split(/^---\n/m);
  assert.match(frontmatter, /^name: omagari-status$/m);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
  for (const said of [
    "omagari status set",
    "시작할 때",
    "방향이 바뀔 때",
    "끝낼 때",
    `"끝: "`,
    "omagari status`로 본다",
  ]) {
    assert.ok(description.includes(said), `설명에 ${said}가 없다: ${description}`);
  }
  assert.match(body, /\*\*끝낼 때\*\*: `끝: <요약>`으로 쓴다/);
  assert.match(body, /^omagari status set "끝: .+"$/m);
});

test("이미 있는 설정과 훅은 그대로 두고 Omagari 훅만 더하며, 두 번 깔아도 경로가 바뀌어 다시 깔아도 하나만 남는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  // 이 레포가 쓰는 실제 설정(git-guardrails, Impeccable 훅)에 다른 설정과 예전에 다른 경로로 깐 Omagari 훅을 더한 것.
  const repo: Settings = JSON.parse(
    await readFile(new URL("../.claude/settings.json", import.meta.url), "utf8"),
  );
  const old = {
    type: "command",
    command: "'/old/node' '/old/omagari/packages/hooks/src/main.ts' claude-code",
    timeout: 10,
  };
  const lint = { type: "command", command: "~/bin/lint-on-edit" };
  const seed = {
    permissions: { allow: ["Bash(npm test)"] },
    ...repo,
    hooks: {
      ...repo.hooks,
      SessionStart: [...(repo.hooks.SessionStart ?? []), { hooks: [old] }],
      PreToolUse: [...(repo.hooks.PreToolUse ?? []), { matcher: "Edit|Write", hooks: [lint, old] }],
    },
  };
  await mkdir(world.claude, { recursive: true });
  await writeFile(settingsFile(world), JSON.stringify(seed, null, 2));

  assert.equal((await world.cli("install")).code, 0);
  const first = await readFile(settingsFile(world), "utf8");
  const { SessionStart = [], PreToolUse = [], ...others } = (await readSettings(world)).hooks;
  // 원래 있던 것은 그대로다. 예전 Omagari 훅만 빠졌다(그것만 든 묶음은 묶음째).
  assert.deepEqual(
    {
      ...(await readSettings(world)),
      hooks: {
        ...others,
        SessionStart: SessionStart.slice(0, -1),
        PreToolUse: PreToolUse.slice(0, -1),
      },
    },
    {
      ...seed,
      hooks: {
        ...repo.hooks,
        SessionStart: repo.hooks.SessionStart ?? [],
        PreToolUse: [...(repo.hooks.PreToolUse ?? []), { matcher: "Edit|Write", hooks: [lint] }],
      },
    },
  );
  // 새 Omagari 훅은 이벤트마다 맨 뒤에 하나다. 이 기기의 Node로 이 레포의 훅을 돌리고, 실행기를 넘긴다.
  const command = SessionStart.at(-1)?.hooks[0]?.command ?? "";
  assert.ok(command.startsWith(`'${process.execPath}' '`), command);
  assert.match(command, /\/packages\/hooks\/src\/main\.ts' claude-code$/);
  assert.doesNotMatch(command, /\/old\//);
  const ours = { type: "command", command, timeout: 10 };
  assert.deepEqual(SessionStart.at(-1), { hooks: [ours] });
  assert.deepEqual(PreToolUse.at(-1), { matcher: EDIT_MATCHER, hooks: [ours] });

  assert.equal((await world.cli("install")).code, 0);
  assert.equal(await readFile(settingsFile(world), "utf8"), first, "두 번째는 바꾸는 것이 없다");
});

test("읽을 수 없는 설정 파일은 건드리지 않고 멈춘다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  await mkdir(world.claude, { recursive: true });
  for (const broken of [
    '{ "hooks": { "PreToolUse": [',
    '{ "hooks": { "PreToolUse": {} } }',
    "[]",
  ]) {
    await writeFile(settingsFile(world), broken);
    const { code, stderr } = await world.cli("install");
    assert.equal(code, 1, broken);
    assert.ok(stderr.startsWith(`${settingsFile(world)}을 건드리지 않았다: `), stderr);
    assert.equal(await readFile(settingsFile(world), "utf8"), broken);
  }
});

test("이 기기의 모든 레포에서 돌지만, Omagari 러너를 켠 적 없는 Git 레포에서는 두 훅이 아무것도 넣지도 남기지도 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const other = await tempRepo();
  t.after(other.remove);
  await writer(other.folder)("pay.ts", "pay\n");
  assert.equal((await world.cli("install")).code, 0);
  const settings = await readSettings(world);

  const runs = [
    ...matching(settings, "SessionStart", "startup").map((command) => ({
      command,
      input: sessionStartInput(other.folder),
    })),
    ...matching(settings, "PreToolUse", "Edit").map((command) => ({
      command,
      input: editInput(other.folder, "pay.ts"),
    })),
  ];
  assert.equal(runs.length, 2);
  for (const { command, input } of runs) {
    const result = await world.shell(command, JSON.stringify(input), other.folder);
    assert.deepEqual(result, { code: 0, stdout: "", stderr: "" });
  }
  await assert.rejects(access(join(other.folder, ".git", "omagari")));
});
