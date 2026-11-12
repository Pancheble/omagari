// Codex(#16): 두 번째 에이전트로 붙는 실행기와, 같은 훅 파일을 Codex의 훅 형식으로 까는 것.
// 실행기는 러너의 실제 `codex`를 쓰고, 그것이 부르는 Codex CLI만 가짜(test/fake-codex.ts)다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { codex, runnerPaths } from "@omagari/runner";
import { eventually, fakeCodex, fakeExecutor, startWorld, tempRepo, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type Group = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };

/** 멤버의 에이전트와 그 상태. 고를 거리는 model.test가 본다. */
const agentsOf = async (world: World, login: string) =>
  (await call(world.owner, api.members)).members
    .find((m) => m.login === login)
    ?.agents.map(({ executor, state }) => ({ executor, state }));

test("Codex에게 물으면 러너가 codex exec를 읽기 전용으로 화면 없이 띄우고, 같은 채널의 다음 문답은 resume으로 같은 세션을 잇는다", async (t) => {
  const fake = await fakeCodex(t);
  process.env.FAKE_CODEX_MCP = "docs,fs"; // 주인이 Codex에 설정해 둔 MCP 서버
  t.after(() => delete process.env.FAKE_CODEX_MCP);
  const claude = fakeExecutor(() => "Claude의 답");
  const world = await startWorld({ executors: { "claude-code": claude.executor, codex } });
  t.after(world.stop);
  const folder = world.repo.folder;
  assert.deepEqual(await agentsOf(world, "owner"), [
    { executor: "claude-code", state: "online" },
    { executor: "codex", state: "online" },
  ]);
  const channel = await world.channel(world.owner, "결제");
  await call(world.owner, api.send, { channel, text: "결제는 payment.ts에 있다" });
  const ask = async (message: string, executor: "codex" | "claude-code" = "codex") =>
    world.settled(world.owner, await world.ask(world.owner, channel, message, executor));

  assert.deepEqual((await ask("결제는 어디서?")).answer, {
    state: "answered",
    text: "Codex: 결제는 어디서?",
    source: { branch: "main", commit: await world.repo.git("rev-parse", "HEAD"), dirty: false },
  });
  await call(world.owner, api.send, { channel, text: "환불은 refund.ts" });
  assert.equal((await ask("환불은?")).answer.state, "answered");
  // 같은 채널이어도 Claude Code는 자기 채널 세션이다.
  assert.equal((await ask("Claude는?", "claude-code")).answer.state, "answered");

  const [first, second, ...more] = await fake.calls();
  assert.deepEqual(more, []);
  // 샌드박스는 주인의 설정에 기대지 않고 읽기 전용으로 준다. 샌드박스 밖에서 도는 MCP 서버, 앱, 플러그인은 끈다.
  // 이것들은 resume 앞에 오고, 메시지는 표준 입력이다.
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
  // 첫 턴은 채널 대화를 데이터로 감싸 넘기고, 다음 턴은 그 뒤의 것만 넘긴다(ADR-0017).
  assert.match(
    first?.input ?? "",
    /<channel_messages channel="결제">\n<message from="owner \(owner\)" at="[^"]+">\n결제는 payment\.ts에 있다\n<\/message>\n<\/channel_messages>\n\n결제는 어디서\?$/,
  );
  assert.doesNotMatch(second?.input ?? "", /payment\.ts/);
  assert.match(
    second?.input ?? "",
    /환불은 refund\.ts\n<\/message>\n<\/channel_messages>\n\n환불은\?$/,
  );
  assert.equal(claude.calls[0]?.resume, undefined);

  // 이어 간 세션은 첫 턴의 thread.started가 알린 것이다. 실행 기록에 실행기와 세션이 남는다.
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

test("Codex의 턴이 실패하면 문답이 그 이유로 실패하고, 다음 문답은 다시 답한다", async (t) => {
  const fake = await fakeCodex(t);
  const world = await startWorld({ executors: { codex } });
  t.after(world.stop);
  const channel = await world.channel(world.owner);
  const ask = async (message: string) =>
    world.settled(world.owner, await world.ask(world.owner, channel, message, "codex"));

  assert.deepEqual((await ask("실패")).answer, {
    state: "failed",
    error: {
      code: "executor_failed",
      message: "Codex가 답하지 못했다(종료 코드 1): 사용량 한도에 걸렸다",
    },
  });
  assert.partialDeepStrictEqual((await ask("다시")).answer, {
    state: "answered",
    text: "Codex: 다시",
  });
  // 실패한 턴은 세션을 남기지 않아 다음 문답이 새 세션을 띄운다.
  assert.deepEqual(
    (await fake.calls()).map((c) => c.args.includes("resume")),
    [false, false],
  );
});

test("러너는 codex가 깔려 있고 로그인했을 때만 Codex 에이전트를 붙인다", async (t) => {
  await fakeCodex(t);
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  await world.signInCli(await world.login("alice"));
  const desk = await tempRepo();
  t.after(desk.remove);

  const out = world.launchCliIn(desk.folder, "runner");
  t.after(() => out.stop("SIGKILL"));
  await out.output(/에이전트: Claude Code\n/);
  assert.deepEqual(await agentsOf(world, "alice"), [{ executor: "claude-code", state: "online" }]);
  await out.stop();

  // 로그인하면(`codex login`이 CODEX_HOME에 남기는 것) 다시 켤 때 붙는다.
  await writer(world.codex)("auth.json", "{}");
  const signedIn = world.launchCliIn(desk.folder, "runner");
  t.after(() => signedIn.stop("SIGKILL"));
  await signedIn.output(/에이전트: Claude Code, Codex\n/);
  await eventually(async () =>
    assert.deepEqual(await agentsOf(world, "alice"), [
      { executor: "claude-code", state: "online" },
      { executor: "codex", state: "online" },
    ]),
  );
});

/** 매 세션이 처음 보는 작업 세션이다. 편집 전 훅의 기억 없이 지금 근처 작업을 본다. */
const fresh = () => crypto.randomUUID();

/** Codex가 훅에 주는 입력(Codex hooks 문서의 공통 필드와 이벤트 필드). */
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

/** Claude Code가 훅에 주는 입력. Codex가 같은 내용을 받는지 견줄 때 쓴다. */
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

/** 깔린 명령을 에이전트처럼 돌리고 넣은 글을 돌려준다. 훅은 0으로 끝나고 stderr에 쓰지 않는다. */
async function runInstalled(world: World, command: string, input: { hook_event_name: string }) {
  const { code, stdout, stderr } = await world.shell(command, JSON.stringify(input));
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  if (stdout === "") return "";
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.equal(hookSpecificOutput.hookEventName, input.hook_event_name);
  return hookSpecificOutput.additionalContext as string;
}

test("omagari install이 Codex에도 두 훅과 상태 한 줄 스킬을 깔고 /hooks에서 신뢰하라고 알리며, 깔린 훅은 Codex의 입력으로 Claude Code와 같은 글을 넣는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await world.desk(await world.login("alice"));
  t.after(desk.remove);
  await writer(desk.folder)("pay.ts", "pay\n");
  const hooksFile = join(world.codex, "hooks.json");
  const skillFile = join(world.codex, "skills", "omagari-status", "SKILL.md");

  const installed = await world.cli("install");
  assert.equal(installed.code, 0, installed.stderr);
  const [, codexLine, ...more] = installed.stdout.trimEnd().split("\n");
  assert.deepEqual(more, []);
  assert.ok(
    codexLine?.startsWith(`Codex: ${hooksFile}에 세션 시작 훅과 편집 전 훅을, ${skillFile}에`),
  );
  assert.match(codexLine ?? "", /Codex에서 \/hooks를 열어 두 훅을 신뢰해야 돈다/);
  assert.equal(
    await readFile(skillFile, "utf8"),
    await readFile(join(world.claude, "skills", "omagari-status", "SKILL.md"), "utf8"),
  );

  // Codex의 matcher는 정규식이다. 세션 시작은 어떻게 시작했든, 편집 전 훅은 apply_patch와 셸 명령(편지함을 넘기려고)에만 걸린다.
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

  // 같은 상황에서 Claude Code의 훅과 같은 글을 넣는다.
  const claude = JSON.parse(await readFile(join(world.claude, "settings.json"), "utf8")).hooks;
  const claudeStart = claude.SessionStart.at(-1).hooks[0].command;
  const folder = world.repo.folder;
  const situation = await eventually(async () => {
    const said = await runInstalled(world, start ?? "", codexInput.sessionStart(folder));
    assert.match(said, /<omagari-situation>\n- alice · 브랜치 "main" · "pay\.ts 수정 중"/);
    return said;
  });
  assert.equal(await runInstalled(world, claudeStart, claudeInput.sessionStart(folder)), situation);
  const nearby = await runInstalled(
    world,
    edit ?? "",
    codexInput.applyPatch(folder, patch("*** Update File: pay.ts", "@@", "-pay", "+pay()")),
  );
  assert.match(nearby, /^Omagari: 고치려는 파일 "pay\.ts"을 다른 멤버의 작업도 바꾸고 있다/);
  const claudeEdit = claude.PreToolUse.at(-1).hooks[0].command;
  assert.equal(await runInstalled(world, claudeEdit, claudeInput.edit(folder, "pay.ts")), nearby);

  // 다시 깔아도 하나만 남는다.
  const first = await readFile(hooksFile, "utf8");
  assert.equal((await world.cli("install")).code, 0);
  assert.equal(await readFile(hooksFile, "utf8"), first);
});

test("Codex의 패치 하나가 여러 파일을 고치면 파일마다 근처 작업을 넣고, 같은 세션에서 같은 것은 다시 넣지 않는다", async (t) => {
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
    [...context.matchAll(/^Omagari: 고치려는 파일 "([^"]+)"/gm)].map(([, path]) => path);

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
    "*** Add File: free.ts", // 아무도 바꾸지 않는 파일
    "+free",
    "*** Add File: ../outside.ts", // 레포 밖은 Omagari가 볼 것이 아니다
    "+x",
  );
  await eventually(async () =>
    assert.deepEqual(files(await preEdit(body)), ["pay.ts", "old.ts", "new.ts", "gone.ts"]),
  );
  // 같은 세션의 다음 패치에서는 지난번과 같은 근처 작업을 다시 넣지 않는다.
  assert.equal(await preEdit(body), "");

  // 하위 폴더에서 일하는 세션의 상대 경로도 레포 최상위에서 본 경로로 묻는다.
  await write("src/a.ts", "a\n");
  await writer(folder)("src/.keep", "");
  await eventually(async () =>
    assert.deepEqual(
      files(await preEdit(patch("*** Update File: a.ts", "@@", "-a", "+b"), join(folder, "src"))),
      ["src/a.ts"],
    ),
  );
});

test("Codex의 편집 전 훅은 셸 명령이나 다른 도구에는 아무것도 넣지 않는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await world.desk(await world.login("alice"));
  t.after(desk.remove);
  await writer(desk.folder)("pay.ts", "pay\n");
  const folder = world.repo.folder;
  const hook = async (input: object) => world.hook(JSON.stringify(input), { executor: "codex" });
  // 먼저 alice의 관측이 와서 pay.ts를 고치는 패치에는 넣을 것이 있다.
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
