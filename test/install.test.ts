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

  const installed = await world.setup();
  assert.equal(installed.code, 0, installed.stderr);
  const skillFile = join(world.claude, "skills", "omagari-status", "SKILL.md");
  assert.ok(
    installed.stdout.startsWith(
      `Claude Code: installed the session-start and pre-edit hooks in ${settingsFile(world)}`,
    ),
    installed.stdout,
  );
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
      /<omagari-situation>\n- alice · branch "main" · "Editing pay\.ts" \(made from the changed files\)\n<\/omagari-situation>/,
    ),
  );
  const [editCommand] = matching(settings, "PreToolUse", "Edit");
  assert.ok(editCommand);
  assert.match(
    await runInstalled(world, editCommand, editInput(world.repo.folder, "pay.ts"), "PreToolUse"),
    /^Omagari: other Work is also changing the file you're about to edit, "pay\.ts"[\s\S]*<omagari-nearby>\n- alice · branch "main" · /,
  );

  // 스킬의 설명은 늘 에이전트의 맥락에 있고, 본문은 에이전트가 스킬을 쓸 때 읽는다.
  const skill = await readFile(skillFile, "utf8");
  const [, frontmatter = "", body = ""] = skill.split(/^---\n/m);
  assert.match(frontmatter, /^name: omagari-status$/m);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? "";
  for (const said of [
    "omagari status set",
    "when you start work",
    "when your direction changes",
    "when you finish",
    `"Done: "`,
    "`omagari status`",
    "omagari ask",
    "omagari wait",
  ]) {
    assert.ok(description.includes(said), `설명에 ${said}가 없다: ${description}`);
  }
  assert.match(body, /\*\*When you finish\*\*: write `Done: <summary>`/);
  assert.match(body, /^omagari status set "Done: .+"$/m);
  // 묻기와 기다리기: 언제 묻고 언제 기다리는지, 답 없음은 답이나 승인이 아니다.
  assert.match(body, /^## Asking and waiting$/m);
  assert.match(body, /\*\*When to ask\*\*/);
  assert.match(body, /\*\*When to wait\*\*/);
  assert.match(body, /It doesn't count as an answer or an approval/);
  assert.match(body, /^omagari ask \S+ ".+"$/m);
  assert.match(body, /^omagari wait \d+$/m);
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

  assert.equal((await world.setup()).code, 0);
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

  assert.equal((await world.setup()).code, 0);
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
    const { code, stderr } = await world.setup();
    assert.equal(code, 1, broken);
    assert.ok(stderr.startsWith(`Did not touch ${settingsFile(world)}: `), stderr);
    assert.equal(await readFile(settingsFile(world), "utf8"), broken);
  }
});

test("이 기기의 모든 레포에서 돌지만, Omagari 러너를 켠 적 없는 Git 레포에서는 두 훅이 아무것도 넣지도 남기지도 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const other = await tempRepo();
  t.after(other.remove);
  await writer(other.folder)("pay.ts", "pay\n");
  assert.equal((await world.setup()).code, 0);
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

test("omagari setup <주소>는 깨끗한 홈에서 로그인하고 훅을 깔고 주소를 남겨, OMAGARI_SERVER 없이도 status가 그 서버에 닿는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");

  const bare = world.launchBare("setup", `${world.server.url}/`);
  t.after(() => bare.stop("SIGKILL"));
  const [, code] = await bare.output(/enter code (\S+)/);
  world.github.approve(code, "alice");
  const done = await bare.exited;
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /Logged in as alice/);
  assert.match(done.stdout, /Open \/hooks in Codex and trust the two Omagari hooks/);
  assert.equal((await readSettings(world)).hooks.SessionStart?.length, 1);

  const status = await world.cliBare("status");
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /alice|owner/);

  // 한 번 더: 바뀌는 것이 없고, 다시 로그인하지 않으며, 훅은 하나다.
  const before = await readFile(settingsFile(world), "utf8");
  const again = await world.cliBare("setup");
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /GitHub login/);
  assert.equal(await readFile(settingsFile(world), "utf8"), before);
});

test("omagari uninstall은 훅과 스킬을 빼서 에이전트 설정을 setup 전으로 되돌리고, --sign-out이 있어야 세션을 지운다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  await mkdir(world.claude, { recursive: true });
  const seed = JSON.stringify(
    {
      theme: "dark",
      hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "lint" }] }] },
    },
    null,
    2,
  );
  await writeFile(settingsFile(world), `${seed}\n`);

  assert.equal((await world.setup()).code, 0);
  assert.notEqual(await readFile(settingsFile(world), "utf8"), `${seed}\n`);

  const removed = await world.cli("uninstall");
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(await readFile(settingsFile(world), "utf8"), `${seed}\n`);
  await assert.rejects(access(join(world.claude, "skills", "omagari-status")));
  // 설정 파일이 없던 Codex는 파일도 남지 않는다.
  await assert.rejects(access(join(world.codex, "hooks.json")));
  const sessions = join(world.config, "omagari", "sessions.json");
  assert.ok((await readFile(sessions, "utf8")).includes(world.server.url));

  const out = await world.cli("uninstall", "--sign-out");
  assert.equal(out.code, 0, out.stderr);
  assert.ok(!(await readFile(sessions, "utf8")).includes(world.server.url));
});
