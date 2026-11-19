// Codex (#16): the executor attached as the second agent, and installing the same hook files in Codex's hook format.
// The executor uses the runner's real `codex`, and only the Codex CLI it calls is fake (test/fake-codex.ts).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { codex, runnerPaths } from "@omagari/runner";
import { idleAgents } from "../packages/web/src/idle-agents.ts";
import {
  eventually,
  fakeCodex,
  fakeExecutor,
  REPO,
  startWorld,
  tempRepo,
  writer,
} from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type Group = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };

/** A member's agents and their state. What to pick from is covered by model.test. */
const agentsOf = async (world: World, login: string) =>
  (await call(world.owner, api.members)).members
    .find((m) => m.login === login)
    ?.agents.map(({ executor, state }) => ({ executor, state }));

test("when asked, the runner starts codex exec read-only with no screen, and the next Q&A in the same channel resumes the same session", async (t) => {
  const fake = await fakeCodex(t);
  process.env.FAKE_CODEX_MCP = "docs,fs"; // MCP servers the owner set up in Codex
  t.after(() => delete process.env.FAKE_CODEX_MCP);
  const claude = fakeExecutor(() => "Claude's answer");
  const world = await startWorld({ executors: { "claude-code": claude.executor, codex } });
  t.after(world.stop);
  const folder = world.repo.folder;
  assert.deepEqual(await agentsOf(world, "owner"), [
    { executor: "claude-code", state: "online" },
    { executor: "codex", state: "online" },
  ]);
  const channel = await world.channel(world.owner, "payments");
  await call(world.owner, api.send, { channel, text: "Payments are in payment.ts" });
  const ask = async (message: string, executor: "codex" | "claude-code" = "codex") =>
    world.settled(world.owner, await world.ask(world.owner, channel, message, executor));

  assert.deepEqual((await ask("Where are payments?")).answer, {
    state: "answered",
    text: "Codex: Where are payments?",
    source: {
      branch: "main",
      commit: await world.repo.git("rev-parse", "HEAD"),
      dirty: false,
      repo: REPO,
    },
  });
  await call(world.owner, api.send, { channel, text: "Refunds are in refund.ts" });
  assert.equal((await ask("What about refunds?")).answer.state, "answered");
  // Even in the same channel, Claude Code has its own channel session.
  assert.equal((await ask("What about Claude?", "claude-code")).answer.state, "answered");

  const [first, second, ...more] = await fake.calls();
  assert.deepEqual(more, []);
  // The sandbox is given read-only without relying on the owner's settings. MCP servers, apps, and plugins that run outside the sandbox are turned off.
  // These come before resume, and the message is stdin.
  const readOnly = [
    "exec",
    "--json",
    "--sandbox=read-only",
    `--cd=${folder}`,
    "--disable=apps",
    "--disable=plugins",
    ...["-c", "mcp_servers.docs.enabled=false", "-c", "mcp_servers.fs.enabled=false"],
  ];
  assert.deepEqual(first?.args, [...readOnly, "-"]);
  const thread = second?.args.at(-2) ?? "";
  assert.deepEqual(second?.args, [...readOnly, "resume", thread, "-"]);
  assert.equal(first?.cwd, folder);
  // The first turn passes the channel conversation wrapped as data, and the next turn passes only what came after (ADR-0017).
  assert.match(
    first?.input ?? "",
    /<channel_messages channel="payments">\n<message from="owner \(owner\)" at="[^"]+">\nPayments are in payment\.ts\n<\/message>\n<\/channel_messages>\n\nWhere are payments\?$/,
  );
  assert.match(first?.input ?? "", /Answer in the language the question was asked in\./);
  assert.doesNotMatch(second?.input ?? "", /payment\.ts/);
  assert.match(
    second?.input ?? "",
    /Refunds are in refund\.ts\n<\/message>\n<\/channel_messages>\n\nWhat about refunds\?$/,
  );
  assert.equal(claude.calls[0]?.resume, undefined);

  // The resumed session is the one the first turn's thread.started reported. The run record keeps the executor and session.
  const runs = (await readFile((await runnerPaths(folder)).log, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    runs.map((run) => [run.executor, run.session]),
    [
      ["codex", thread],
      ["codex", thread],
      ["claude-code", "session-1"],
    ],
  );
  assert.match(thread, /^[0-9a-f-]{36}$/);
});

test("when Codex's turn fails, the Q&A fails with that reason, and the next Q&A answers again", async (t) => {
  const fake = await fakeCodex(t);
  const world = await startWorld({ executors: { codex } });
  t.after(world.stop);
  const channel = await world.channel(world.owner);
  const ask = async (message: string) =>
    world.settled(world.owner, await world.ask(world.owner, channel, message, "codex"));

  assert.deepEqual((await ask("fail")).answer, {
    state: "failed",
    error: {
      code: "executor_failed",
      message: "Codex couldn't answer (exit code 1): usage limit reached",
    },
  });
  assert.partialDeepStrictEqual((await ask("again")).answer, {
    state: "answered",
    text: "Codex: again",
  });
  // The failed turn leaves no session, so the next Q&A starts a new session.
  assert.deepEqual(
    (await fake.calls()).map((c) => c.args.includes("resume")),
    [false, false],
  );
});

test("the runner attaches the Codex agent only when codex is installed and logged in", async (t) => {
  await fakeCodex(t);
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  await world.signInCli(await world.login("alice"));
  const desk = await tempRepo();
  t.after(desk.remove);

  const out = world.launchCliIn(desk.folder, "runner");
  t.after(() => out.stop("SIGKILL"));
  await out.output(/Agents: Claude Code\n/);
  assert.deepEqual(await agentsOf(world, "alice"), [{ executor: "claude-code", state: "online" }]);
  await out.stop();

  // After logging in (what `codex login` leaves in CODEX_HOME), it attaches on the next start.
  await writer(world.codex)("auth.json", "{}");
  const signedIn = world.launchCliIn(desk.folder, "runner");
  t.after(() => signedIn.stop("SIGKILL"));
  await signedIn.output(/Agents: Claude Code, Codex\n/);
  await eventually(async () =>
    assert.deepEqual(await agentsOf(world, "alice"), [
      { executor: "claude-code", state: "online" },
      { executor: "codex", state: "online" },
    ]),
  );
});

/** Every session is a work session seen for the first time. It sees nearby work now without the pre-edit hook's memory. */
const fresh = () => crypto.randomUUID();

/** The input Codex gives a hook (the common and event fields from the Codex hooks docs). */
const codexInput = {
  sessionStart: (cwd: string, session = fresh()) => ({
    session_id: session,
    transcript_path: null,
    cwd,
    hook_event_name: "SessionStart",
    model: "gpt-5.5",
    source: "startup",
  }),
  applyPatch: (cwd: string, patch: string, session = fresh()) => ({
    session_id: session,
    transcript_path: null,
    cwd,
    hook_event_name: "PreToolUse",
    model: "gpt-5.5",
    permission_mode: "default",
    turn_id: "turn-1",
    tool_name: "apply_patch",
    tool_use_id: "call_1",
    tool_input: { command: patch },
  }),
};

/** The input Claude Code gives a hook. Used to compare whether Codex receives the same content. */
const claudeInput = {
  sessionStart: (cwd: string) => ({
    session_id: fresh(),
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    hook_event_name: "SessionStart",
    source: "startup",
  }),
  edit: (cwd: string, path: string) => ({
    session_id: fresh(),
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(cwd, path), old_string: "a", new_string: "b" },
    tool_use_id: "toolu_01",
  }),
};

const patch = (...files: string[]) => ["*** Begin Patch", ...files, "*** End Patch"].join("\n");

/** Runs the installed command as an agent and returns the text it injected. The hook exits with 0 and writes nothing to stderr. */
async function runInstalled(world: World, command: string, input: { hook_event_name: string }) {
  const { code, stdout, stderr } = await world.shell(command, JSON.stringify(input));
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  if (stdout === "") return "";
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.equal(hookSpecificOutput.hookEventName, input.hook_event_name);
  return hookSpecificOutput.additionalContext as string;
}

test("omagari install also installs two hooks and a one-line status skill for Codex and tells you to trust them in /hooks, and the installed hooks inject the same text as Claude Code from Codex's input", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await world.desk(await world.login("alice"));
  t.after(desk.remove);
  await writer(desk.folder)("pay.ts", "pay\n");
  const hooksFile = join(world.codex, "hooks.json");
  const skillFile = join(world.codex, "skills", "omagari-status", "SKILL.md");

  const installed = await world.setup();
  assert.equal(installed.code, 0, installed.stderr);
  const [, codexLine] = installed.stdout.split("\n");
  assert.match(installed.stdout, /Open \/hooks in Codex and trust the two Omagari hooks/);
  assert.ok(
    codexLine?.startsWith(
      `Codex: installed the session-start and pre-edit hooks in ${hooksFile} and the status line skill in ${skillFile}`,
    ),
  );
  assert.match(codexLine ?? "", /Open \/hooks in Codex and trust both hooks for them to run/);
  assert.equal(
    await readFile(skillFile, "utf8"),
    await readFile(join(world.claude, "skills", "omagari-status", "SKILL.md"), "utf8"),
  );

  // Codex's matcher is a regex. Session start matches however it started, and the pre-edit hook matches only apply_patch and shell commands (to hand over the inbox).
  const { hooks }: { hooks: Record<string, Group[]> } = JSON.parse(
    await readFile(hooksFile, "utf8"),
  );
  const matching = (event: string, value: string) =>
    (hooks[event] ?? [])
      .filter(({ matcher }) => !matcher || matcher === "*" || new RegExp(matcher).test(value))
      .flatMap((group) => group.hooks.map((handler) => handler.command));
  for (const source of ["startup", "resume", "clear", "compact", "fork"]) {
    assert.equal(matching("SessionStart", source).length, 1, source);
  }
  for (const tool of ["apply_patch", "Bash", "exec_command"]) {
    assert.equal(matching("PreToolUse", tool).length, 1, tool);
  }
  for (const tool of ["mcp__fs__apply_patch", "update_plan", "Bashful"]) {
    assert.deepEqual(matching("PreToolUse", tool), [], tool);
  }
  const [start] = matching("SessionStart", "startup");
  const [edit] = matching("PreToolUse", "apply_patch");
  assert.match(start ?? "", /\/packages\/hooks\/src\/main\.ts' codex$/);
  assert.equal(edit, start);

  // In the same situation it injects the same text as Claude Code's hook.
  const claude = JSON.parse(await readFile(join(world.claude, "settings.json"), "utf8")).hooks;
  const claudeStart = claude.SessionStart.at(-1).hooks[0].command;
  const folder = world.repo.folder;
  const situation = await eventually(async () => {
    const said = await runInstalled(world, start ?? "", codexInput.sessionStart(folder));
    assert.match(said, /<omagari-situation>\n- alice · branch "main" · "Editing pay\.ts"/);
    return said;
  });
  assert.equal(await runInstalled(world, claudeStart, claudeInput.sessionStart(folder)), situation);
  const nearby = await runInstalled(
    world,
    edit ?? "",
    codexInput.applyPatch(folder, patch("*** Update File: pay.ts", "@@", "-pay", "+pay()")),
  );
  assert.match(
    nearby,
    /^Omagari: other Work is also changing the file you're about to edit, "pay\.ts"/,
  );
  const claudeEdit = claude.PreToolUse.at(-1).hooks[0].command;
  assert.equal(await runInstalled(world, claudeEdit, claudeInput.edit(folder, "pay.ts")), nearby);

  // Even after installing again, only one remains.
  const first = await readFile(hooksFile, "utf8");
  assert.equal((await world.setup()).code, 0);
  assert.equal(await readFile(hooksFile, "utf8"), first);
});

test("when one Codex patch edits several files, it injects nearby work per file, and does not inject the same thing again in the same session", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await world.desk(await world.login("alice"));
  t.after(desk.remove);
  const write = writer(desk.folder);
  await write("pay.ts", "pay\n");
  await write("old.ts", "old\n");
  await write("new.ts", "new\n");
  await write("gone.ts", "gone\n");
  const folder = world.repo.folder;
  const session = fresh();
  const preEdit = async (body: string, cwd = folder) => {
    const { code, stdout, stderr } = await world.hook(
      JSON.stringify(codexInput.applyPatch(cwd, body, session)),
      { executor: "codex", cwd },
    );
    assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
    return stdout === "" ? "" : JSON.parse(stdout).hookSpecificOutput.additionalContext;
  };
  const files = (context: string) =>
    [
      ...context.matchAll(
        /^Omagari: other Work is also changing the file you're about to edit, "([^"]+)"/gm,
      ),
    ].map(([, path]) => path);

  const body = patch(
    "*** Update File: pay.ts",
    "@@",
    "-pay",
    "+pay()",
    "*** Update File: old.ts",
    "*** Move to: new.ts",
    "@@",
    "-old",
    "+new",
    "*** Delete File: gone.ts",
    "*** Add File: free.ts", // a file nobody changes
    "+free",
    "*** Add File: ../outside.ts", // outside the repo is not for Omagari to see
    "+x",
  );
  // What was seen in the same session is not injected again, so if asked before the server knows all four files, only some are handed over and the rest never come. Wait until it knows, then ask (#153).
  const alice = await world.login("alice");
  await eventually(async () => {
    const seen = (await world.works(alice))
      .filter((w) => w.login === "alice")
      .flatMap((w) => w.files.map((f) => f.path));
    for (const path of ["pay.ts", "old.ts", "new.ts", "gone.ts"])
      assert.ok(seen.includes(path), path);
  });
  await eventually(async () =>
    assert.deepEqual(files(await preEdit(body)), ["pay.ts", "old.ts", "new.ts", "gone.ts"]),
  );
  // In the same session's next patch, the same nearby work as last time is not injected again.
  assert.equal(await preEdit(body), "");

  // The relative path of a session working in a subfolder is also asked as the path seen from the repo root.
  await write("src/a.ts", "a\n");
  await writer(folder)("src/.keep", "");
  await eventually(async () =>
    assert.deepEqual(
      files(await preEdit(patch("*** Update File: a.ts", "@@", "-a", "+b"), join(folder, "src"))),
      ["src/a.ts"],
    ),
  );
});

test("Codex's pre-edit hook injects nothing for shell commands or other tools", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await world.desk(await world.login("alice"));
  t.after(desk.remove);
  await writer(desk.folder)("pay.ts", "pay\n");
  const folder = world.repo.folder;
  const hook = async (input: object) => world.hook(JSON.stringify(input), { executor: "codex" });
  // First alice's observation arrives, so there is something to inject for a patch that edits pay.ts.
  await eventually(async () =>
    assert.match(
      (await hook(codexInput.applyPatch(folder, patch("*** Update File: pay.ts")))).stdout,
      /<omagari-nearby>\\n- alice /,
    ),
  );
  const shell = { ...codexInput.applyPatch(folder, ""), tool_name: "Bash" };
  for (const input of [
    {
      ...shell,
      tool_input: { command: `apply_patch <<'EOF'\n${patch("*** Update File: pay.ts")}\nEOF` },
    },
    { ...shell, tool_name: "exec_command", tool_input: { cmd: "sed -i '' s/pay/x/ pay.ts" } },
    { ...shell, tool_name: "update_plan", tool_input: { plan: [] } },
    codexInput.applyPatch(folder, "*** Begin Patch\n*** End Patch"),
  ]) {
    assert.deepEqual(await hook(input), { code: 0, stdout: "", stderr: "" }, input.tool_name);
  }
});

test("in a runner with two executors, a work's agent is the executor that last called a hook on that branch, and is unknown with observation only", async (t) => {
  const executors = {
    "claude-code": fakeExecutor(() => "").executor,
    codex: fakeExecutor(() => "").executor,
  };
  const world = await startWorld({ observeMs: 50, executors });
  t.after(world.stop);
  const folder = world.repo.folder;
  await world.repo.git("switch", "--create", "b");
  await writer(folder)("b.ts", "b\n");
  const owner = async () =>
    (await call(world.owner, api.members)).members.find((m) => m.login === "owner");
  const seen = async () => {
    const member = await owner();
    return {
      works: member?.works.map(({ branch, executor }) => ({ branch, executor })),
      idle: member && idleAgents(member).map((agent) => agent.executor),
    };
  };
  // There is only observation, with no hook or status set.
  await eventually(async () =>
    assert.deepEqual(await seen(), {
      works: [{ branch: "b", executor: null }],
      idle: ["claude-code", "codex"],
    }),
  );

  // Codex's session start hook was called on b. Codex drops out of the agents with no work.
  await world.hook(JSON.stringify(codexInput.sessionStart(folder)), { executor: "codex" });
  await eventually(async () =>
    assert.deepEqual(await seen(), {
      works: [{ branch: "b", executor: "codex" }],
      idle: ["claude-code"],
    }),
  );

  // If Claude Code's hook (the pre-edit hook of a shell command) is called on the same branch, it switches to that.
  const bash = {
    ...claudeInput.edit(folder, "b.ts"),
    tool_name: "Bash",
    tool_input: { command: "ls" },
  };
  await world.hook(JSON.stringify(bash));
  await eventually(async () =>
    assert.deepEqual(await seen(), {
      works: [{ branch: "b", executor: "claude-code" }],
      idle: ["codex"],
    }),
  );

  await world.signInCli(world.owner);
  const status = await world.cli("status");
  assert.match(status.stdout, /^ {2}"b" \(Claude Code\): /m, status.stderr);

  // It stays even if the server restarts.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual((await seen()).works, [{ branch: "b", executor: "claude-code" }]),
  );
});
