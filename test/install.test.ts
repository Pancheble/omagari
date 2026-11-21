import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { eventually, startWorld, tempRepo, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type Handler = { type: string; command: string; timeout?: number };
type Group = { matcher?: string; hooks: Handler[] };
type Settings = Record<string, unknown> & { hooks: Record<string, Group[]> };

/**
 * Where setup registers the background runner on this machine, and the service commands setup and uninstall run (faked, ADR-0050).
 * On Linux without systemd nothing is registered.
 */
function service(world: World) {
  const uid = process.getuid?.();
  const label = "com.github.omagari-dev.runner";
  if (process.platform === "darwin") {
    const file = join(world.home, "Library", "LaunchAgents", `${label}.plist`);
    return {
      file,
      setup: [
        ["launchctl", "bootout", `gui/${uid}/${label}`],
        ["launchctl", "bootstrap", `gui/${uid}`, file],
      ],
      uninstall: [["launchctl", "bootout", `gui/${uid}/${label}`]],
    };
  }
  if (!existsSync("/run/systemd/system")) return { file: undefined, setup: [], uninstall: [] };
  const unit = "omagari-runner.service";
  return {
    file: join(world.config, "systemd", "user", unit),
    setup: [
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", unit],
      ["systemctl", "--user", "restart", unit],
    ],
    uninstall: [
      ["systemctl", "--user", "disable", "--now", unit],
      ["systemctl", "--user", "daemon-reload"],
    ],
  };
}

const SESSION = "11111111-2222-3333-4444-555555555555";
const EDIT_MATCHER = "Edit|Write|MultiEdit|NotebookEdit|Bash";

const settingsFile = (world: World) => join(world.claude, "settings.json");
const readSettings = async (world: World): Promise<Settings> =>
  JSON.parse(await readFile(settingsFile(world), "utf8"));

/**
 * Like Claude Code, pick the commands of the hooks for `event` in the settings that match `value` (the tool name, or why the session started).
 * A missing matcher or "*" matches everything; names joined with `|` match those names. This test's settings have no other shape.
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
  tool_input: {
    file_path: join(cwd, file),
    old_string: "pay",
    new_string: "pay()",
  },
  tool_use_id: "toolu_01",
});

/** Run the installed command like an agent and return the text it adds. The hook exits 0 and writes nothing to stderr. */
async function runInstalled(world: World, command: string, input: object, event: string) {
  const { code, stdout, stderr } = await world.shell(command, JSON.stringify(input));
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  if (stdout === "") return "";
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.equal(hookSpecificOutput.hookEventName, event);
  return hookSpecificOutput.additionalContext as string;
}

test("one omagari install sets up the two hooks and the status-line skill in Claude Code, and both hooks run in a new work session", async (t) => {
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

  // The settings a new Claude Code session reads. Session start matches however it started (clear and compact too); the before-edit hook matches only file-editing tools and shell commands.
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

  // The skill's description is always in the agent's context; the body is read when the agent uses the skill.
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
    assert.ok(description.includes(said), `description is missing ${said}: ${description}`);
  }
  assert.match(body, /\*\*When you finish\*\*: write `Done: <summary>`/);
  assert.match(body, /^omagari status set "Done: .+"$/m);
  // Asking and waiting: when to ask, when to wait, and no answer is not an answer or approval.
  assert.match(body, /^## Asking and waiting$/m);
  assert.match(body, /\*\*When to ask\*\*/);
  assert.match(body, /\*\*When to wait\*\*/);
  assert.match(body, /It doesn't count as an answer or an approval/);
  assert.match(body, /^omagari ask \S+ ".+"$/m);
  assert.match(body, /^omagari wait \d+$/m);
});

test("existing settings and hooks stay as they are and only the Omagari hook is added; installing twice leaves one even if the path changed", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  // The real settings this repo uses (git-guardrails, Impeccable hook), plus other settings and an Omagari hook installed earlier with a different path.
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
  // What was there stays. Only the old Omagari hook is gone (a group holding only that goes whole).
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
  // The new Omagari hook is last for each event. Run this repo's hook with this machine's Node and pass the runner.
  const command = SessionStart.at(-1)?.hooks[0]?.command ?? "";
  assert.ok(command.startsWith(`'${process.execPath}' '`), command);
  assert.match(command, /\/packages\/hooks\/src\/main\.ts' claude-code$/);
  assert.doesNotMatch(command, /\/old\//);
  const ours = { type: "command", command, timeout: 10 };
  assert.deepEqual(SessionStart.at(-1), { hooks: [ours] });
  assert.deepEqual(PreToolUse.at(-1), { matcher: EDIT_MATCHER, hooks: [ours] });

  assert.equal((await world.setup()).code, 0);
  assert.equal(
    await readFile(settingsFile(world), "utf8"),
    first,
    "the second run changes nothing",
  );
});

test("an unreadable settings file is left alone and the install stops", async (t) => {
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

test("hooks run in every repo on this machine, but in a Git repo that never ran the Omagari runner they add and leave nothing", async (t) => {
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

test("omagari setup with no address signs in to the default server", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  // Tests must not reach the hosted server, so the default is this test's server.
  process.env.OMAGARI_DEFAULT_SERVER = world.server.url;
  t.after(() => delete process.env.OMAGARI_DEFAULT_SERVER);

  const bare = world.launchBare("setup");
  t.after(() => bare.stop("SIGKILL"));
  const [, code] = await bare.output(/enter code (\S+)/);
  world.github.approve(code, "alice");
  const done = await bare.exited;
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /Logged in as alice/);
  assert.ok(done.stdout.includes(`\nServer: ${world.server.url}\n`), done.stdout);
});

test("omagari setup with an address signs in to that address, not the default", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  // A closed port as the default: if setup used it, the sign-in would fail.
  process.env.OMAGARI_DEFAULT_SERVER = "http://127.0.0.1:1";
  t.after(() => delete process.env.OMAGARI_DEFAULT_SERVER);

  const bare = world.launchBare("setup", world.server.url);
  t.after(() => bare.stop("SIGKILL"));
  const [, code] = await bare.output(/enter code (\S+)/);
  world.github.approve(code, "alice");
  const done = await bare.exited;
  assert.equal(done.code, 0, done.stderr);
  assert.ok(done.stdout.includes(`\nServer: ${world.server.url}\n`), done.stdout);
});

test("omagari setup <address> logs in on a clean home, installs the hooks and keeps the address, so status reaches that server even without OMAGARI_SERVER", async (t) => {
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

  // Once more: nothing changes, it doesn't log in again, and there is one hook.
  const before = await readFile(settingsFile(world), "utf8");
  const again = await world.cliBare("setup");
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /GitHub login/);
  assert.equal(await readFile(settingsFile(world), "utf8"), before);
});

test("omagari uninstall removes the hooks and skills and puts the agent config back to before setup, and only --sign-out deletes the session", async (t) => {
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
  // The background runner is registered to start at login with this machine's service manager.
  const expected = service(world);
  assert.deepEqual(await world.serviceCalls(), expected.setup);
  if (expected.file)
    assert.match(
      await readFile(expected.file, "utf8"),
      /runner(<\/string>\s*<string>|" ")background/,
    );

  const removed = await world.cli("uninstall");
  assert.equal(removed.code, 0, removed.stderr);
  assert.deepEqual(await world.serviceCalls(), [...expected.setup, ...expected.uninstall]);
  if (expected.file) await assert.rejects(access(expected.file));
  assert.equal(await readFile(settingsFile(world), "utf8"), `${seed}\n`);
  await assert.rejects(access(join(world.claude, "skills", "omagari-status")));
  // Codex, which had no config file, is left with no file either.
  await assert.rejects(access(join(world.codex, "hooks.json")));
  const sessions = join(world.config, "omagari", "sessions.json");
  assert.ok((await readFile(sessions, "utf8")).includes(world.server.url));

  const out = await world.cli("uninstall", "--sign-out");
  assert.equal(out.code, 0, out.stderr);
  assert.ok(!(await readFile(sessions, "utf8")).includes(world.server.url));
});
