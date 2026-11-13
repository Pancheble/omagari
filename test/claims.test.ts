import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call, type ShareLevel } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };

const PAY = `export function charge(amount: number) {
  return amount;
}

export function refund(amount: number) {
  return -amount;
}
`;
const NOTES = `${Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
const SESSION = "11111111-2222-3333-4444-555555555555";

/** 기준 커밋에 src/pay.ts와 src/notes.txt를 두고 origin/main을 올린다. 모두 같은 판에서 시작한다. */
async function base(world: World) {
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)("src/notes.txt", NOTES);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** 멤버 `login`의 기기. 내 레포를 받은 것처럼 내 main 위에서 `branch`를 시작한다(conflicts.test와 같다). */
async function clone(world: World, login: string, branch: string, share?: ShareLevel) {
  world.github.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, share);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  await desk.start();
  // 러너가 그 브랜치를 관측해야 선점을 건다.
  await eventually(async () =>
    assert.ok(
      (await world.works(world.owner)).some((w) => w.login === login && w.branch === branch),
    ),
  );
  return { as, desk };
}

/** owner가 payment 브랜치로 옮기고 서버가 그것을 볼 때까지 기다린다. */
async function payment(world: World) {
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
}

/** `omagari <args>`를 `cwd`(기본은 owner의 레포)에서 돌려 성공한 출력을 돌려준다. */
async function omagari(world: World, args: string[], cwd = world.repo.folder) {
  const { code, stdout, stderr } = await world.cliIn(cwd, ...args);
  assert.equal(code, 0, stderr);
  return stdout;
}

/** 피드의 선점 소식을 "걸었다/풀었다 login branch path"로. */
async function claimNews(as: As) {
  const { news } = await call(as, api.feed);
  return news.flatMap((n) =>
    "claim" in n
      ? [`걸었다 ${n.claim.login} ${n.claim.branch} ${n.claim.path}`]
      : "released" in n
        ? [`풀었다 ${n.released.login} ${n.released.branch} ${n.released.path}`]
        : [],
  );
}

/**
 * 편집 전 훅(Edit)이나 세션 시작 훅을 돌려 넣은 글을 돌려준다. 늘 0으로 끝나고 도구 호출을 막는 결정을 내지 않는다.
 * `agent`를 주면 서브에이전트의 호출이라 기억 없이 본다.
 */
async function hook(world: World, options: { cwd?: string; path?: string; agent?: string } = {}) {
  const cwd = options.cwd ?? world.repo.folder;
  const input = options.path
    ? {
        session_id: SESSION,
        cwd,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: `${cwd}/${options.path}`, old_string: "a", new_string: "b" },
        ...(options.agent && { agent_id: options.agent, agent_type: "Explore" }),
      }
    : { session_id: SESSION, cwd, hook_event_name: "SessionStart", source: "startup" };
  const { code, stdout, stderr } = await world.hook(JSON.stringify(input), { cwd });
  assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
  if (stdout === "") return "";
  const { hookSpecificOutput } = JSON.parse(stdout);
  assert.deepEqual(Object.keys(hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
  return hookSpecificOutput.additionalContext as string;
}

/** 넣은 글에서 `<tag>` 블록 안의 줄. 없으면 비어 있다. */
const block = (output: string, tag: string) =>
  output.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0]?.split("\n") ?? [];

test("심볼, 줄 범위, 폴더, 새 파일 전체로 선점한다. 겹치지 않는 선점은 다른 멤버의 피드에만 남는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  await payment(world);
  world.github.grant("alice");
  const alice = await world.login("alice");

  assert.match(
    await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"]),
    /^payment의 선점을 걸었다: "src\/pay.ts"의 "refund" 줄 5-7\n/,
  );
  assert.match(
    await omagari(world, ["claim", "src/notes.txt", "--lines", "2-4"]),
    /^payment의 선점을 걸었다: "src\/notes.txt" 줄 2-4\n/,
  );
  assert.match(
    await omagari(world, ["claim", "src/refund/"]),
    /^payment의 선점을 걸었다: 폴더 "src\/refund\/"\n/,
  );
  // 기준 커밋에 없던 새 파일은 경로만 주면 파일 전체가 잡힌다. 하위 폴더에서 준 경로도 레포 최상위에서 본 것으로 걸린다.
  await writer(world.repo.folder)("src/new.ts", "export const a = 1;\n");
  assert.match(
    await omagari(world, ["claim", "new.ts"], `${world.repo.folder}/src`),
    /^payment의 선점을 걸었다: "src\/new.ts" 파일 전체\n/,
  );

  // 기준 커밋에 있던 파일은 심볼이나 줄 범위로 좁혀 건다. 없는 심볼은 걸리지 않는다.
  const whole = await world.cli("claim", "src/pay.ts");
  assert.equal(whole.code, 1);
  assert.match(
    whole.stderr,
    /기준 커밋에 있던 파일은 심볼\(--symbol\)이나 줄 범위\(--lines\)로 건다/,
  );
  const missing = await world.cli("claim", "src/pay.ts", "--symbol", "nope");
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /src\/pay.ts에서 nope의 정의를 찾지 못했다/);

  // 다른 멤버는 편지함이 아니라 피드에서 본다.
  await eventually(async () =>
    assert.deepEqual(await claimNews(alice), [
      "걸었다 owner payment src/new.ts",
      "걸었다 owner payment src/refund/",
      "걸었다 owner payment src/notes.txt",
      "걸었다 owner payment src/pay.ts",
    ]),
  );
  assert.deepEqual(await claimNews(world.owner), []); // 내 것은 내 피드에 없다
});

test("omagari release로 하나나 모두를 푼다. 푼 것은 다른 멤버의 피드에 남는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  await payment(world);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"]);
  await omagari(world, ["claim", "src/notes.txt", "--lines", "2-4"]);

  assert.match(
    await omagari(world, ["release", "src/pay.ts", "--symbol", "refund"]),
    /^payment의 선점 1개를 풀었다:\n {2}"src\/pay.ts"의 "refund" 줄 5-7\n/,
  );
  assert.match(
    await omagari(world, ["release"]),
    /^payment의 선점 1개를 풀었다:\n {2}"src\/notes.txt" 줄 2-4\n/,
  );
  assert.match(await omagari(world, ["release"]), /^payment에 풀 선점이 없다\n/);
  assert.deepEqual((await claimNews(alice)).slice(0, 2).sort(), [
    "풀었다 owner payment src/notes.txt",
    "풀었다 owner payment src/pay.ts",
  ]);
});

test("남의 선점은 내 사본의 줄로 옮겨 편집 전 훅에 들어가고, 내 선점이 없으면 선점하라고 권한다. 겹친 선점도 걸리고 양쪽 편지함에 들어간다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const { desk } = await clone(world, "alice", "refund");
  t.after(desk.remove);
  await payment(world);

  // alice는 위에 세 줄을 더해 refund가 alice의 사본에서 8-10줄이다. owner의 사본에서는 5-7줄이다.
  await writer(desk.folder)("src/pay.ts", `// a\n// b\n// c\n${PAY}`);
  await eventually(async () =>
    assert.ok(
      (await world.works(world.owner)).some(
        (w) =>
          w.branch === "refund" &&
          w.files.some((f) => "content" in f && f.content.startsWith("// a")),
      ),
    ),
  );
  assert.match(
    await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"], desk.folder),
    /^refund의 선점을 걸었다: "src\/pay.ts"의 "refund" 줄 8-10\n/,
  );

  // owner가 그 파일을 고치려 하면 alice의 선점이 owner의 줄로 들어가고, 근처 작업이 있는데 owner의 선점이 없으니 선점하라고 권한다.
  const first = await eventually(async () => {
    const context = await hook(world, { path: "src/pay.ts" });
    assert.deepEqual(block(context, "omagari-claims"), [
      `- alice의 브랜치 "refund" · "src/pay.ts"의 "refund" 줄 5-7`,
    ]);
    return context;
  });
  assert.match(
    first,
    /선점한 곳 안은 고치지 말고 기다리거나 그 사람에게 물어본다\. 막지는 않는다\./,
  );
  assert.match(
    first,
    /내 작업은 "src\/pay.ts"을 선점하지 않았다\. 고치기 전에 고칠 곳을 선점한다: omagari claim/,
  );
  // 달라진 것이 없으면 다시 넣지 않는다.
  assert.equal(await hook(world, { path: "src/pay.ts" }), "");

  // 겹쳐도 걸린다. 겹친 alice의 선점이 owner의 줄로 함께 보인다.
  const claimed = await omagari(world, ["claim", "src/pay.ts", "--lines", "6"]);
  assert.match(claimed, /^payment의 선점을 걸었다: "src\/pay.ts" 줄 6\n/);
  assert.match(
    claimed,
    /겹친 다른 멤버의 선점.*\n {2}alice의 브랜치 "refund" · "src\/pay.ts"의 "refund" 줄 5-7\n/,
  );

  // 양쪽 작업의 편지함에 겹침이 들어간다. 줄은 각자의 사본 기준이다.
  await eventually(async () =>
    assert.deepEqual(block(await hook(world, { cwd: desk.folder }), "omagari-inbox"), [
      `- 선점이 겹친다: 내 선점 "src/pay.ts"의 "refund" 줄 8-10와 owner의 브랜치 "payment"의 선점 "src/pay.ts" 줄 6. 줄은 각자의 사본 기준이다. 겹친 곳은 기다리거나 상대에게 물어본다.`,
    ]),
  );
  // owner의 것은 omagari claim의 응답 끝에 먼저 실렸을 수 있다. 그러면 훅에는 다시 들어가지 않는다.
  const ownerSees = `- 선점이 겹친다: 내 선점 "src/pay.ts" 줄 6와 alice의 브랜치 "refund"의 선점 "src/pay.ts"의 "refund" 줄 8-10. 줄은 각자의 사본 기준이다. 겹친 곳은 기다리거나 상대에게 물어본다.`;
  await eventually(async () =>
    assert.ok(
      block(claimed, "omagari-inbox").includes(ownerSees) ||
        block(await hook(world, {}), "omagari-inbox").includes(ownerSees),
    ),
  );

  // 이제 owner도 그 파일을 선점했으니 선점하라는 권유 없이 남의 선점만 다시 들어간다.
  const after = await hook(world, { path: "src/pay.ts" });
  assert.deepEqual(block(after, "omagari-claims"), [
    `- alice의 브랜치 "refund" · "src/pay.ts"의 "refund" 줄 5-7`,
  ]);
  assert.doesNotMatch(after, /omagari claim/);

  // 폴더 선점은 그 아래 파일을 고칠 때 들어간다.
  await omagari(world, ["claim", "src/"], desk.folder);
  await eventually(async () =>
    assert.deepEqual(
      block(await hook(world, { path: "src/notes.txt", agent: "a1" }), "omagari-claims"),
      [`- alice의 브랜치 "refund" · 폴더 "src/"`],
    ),
  );
});

test("상대 내용을 읽을 수 없으면 줄에 대략이 붙고, 오프라인이 길면 오래됨이 되었다가 지워진다", async (t) => {
  // 7일 대신 1초로 줄인다.
  const world = await startWorld({ observeMs: 50, followMs: 50, forgetMs: 1000 });
  t.after(world.stop);
  await base(world);
  const { desk } = await clone(world, "bob", "docs", "intent");
  t.after(desk.remove);
  await payment(world);

  await omagari(world, ["claim", "src/notes.txt", "--lines", "2-3"], desk.folder);
  const seen = (context: string) => block(context, "omagari-claims");
  await eventually(async () =>
    assert.deepEqual(seen(await hook(world, { path: "src/notes.txt", agent: "a1" })), [
      `- bob의 브랜치 "docs" · "src/notes.txt" 줄 2-3(대략, 줄이 밀렸을 수 있다)`,
    ]),
  );

  await desk.stop();
  await eventually(async () =>
    assert.deepEqual(seen(await hook(world, { path: "src/notes.txt", agent: "a2" })), [
      `- bob의 브랜치 "docs" · "src/notes.txt" 줄 2-3(대략, 줄이 밀렸을 수 있다, 오래됨, 주인이 오래 오프라인이다)`,
    ]),
  );
  await eventually(async () =>
    assert.deepEqual(seen(await hook(world, { path: "src/notes.txt", agent: "a3" })), []),
  );
});

test("브랜치가 머지되거나 지워지면 그 작업의 선점이 저절로 풀린다", async (t) => {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  await base(world);
  const alice = await clone(world, "alice", "refund");
  t.after(alice.desk.remove);
  await payment(world);

  await omagari(world, ["claim", "src/pay.ts", "--symbol", "charge"]);
  await omagari(world, ["claim", "src/notes.txt", "--lines", "1"], alice.desk.folder);
  await eventually(async () =>
    assert.deepEqual(await claimNews(alice.as), ["걸었다 owner payment src/pay.ts"]),
  );

  // payment가 머지되면 owner의 선점이 풀린다.
  world.github.merge(world.github.openPull("payment", "결제", false));
  await eventually(async () =>
    assert.deepEqual(await claimNews(alice.as), [
      "풀었다 owner payment src/pay.ts",
      "걸었다 owner payment src/pay.ts",
    ]),
  );

  // refund를 지우면 alice의 선점이 풀린다.
  await alice.desk.git("switch", "main");
  await alice.desk.git("branch", "-D", "refund");
  await eventually(async () =>
    assert.deepEqual((await claimNews(world.owner))[0], "풀었다 alice refund src/notes.txt"),
  );
});

test("공유 수준 declared는 선점한 경로 안의 바뀐 파일만 내용을 올리고, 밖은 경로만 올린다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const { desk } = await clone(world, "alice", "refund", "declared");
  t.after(desk.remove);
  await writer(desk.folder)("src/pay.ts", PAY.replace("-amount", "0 - amount"));
  await writer(desk.folder)("src/notes.txt", NOTES.replace("line 1", "alice"));
  const files = async () =>
    Object.fromEntries(
      ((await world.works(world.owner)).find((w) => w.login === "alice")?.files ?? []).map((f) => [
        f.path,
        "content" in f ? "내용" : "omitted" in f ? f.omitted : "지움",
      ]),
    );
  await eventually(async () =>
    assert.deepEqual(await files(), { "src/notes.txt": "share", "src/pay.ts": "share" }),
  );

  await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund"], desk.folder);
  await eventually(async () =>
    assert.deepEqual(await files(), { "src/notes.txt": "share", "src/pay.ts": "내용" }),
  );
});

test("#82의 편지함 표로 만든 DB로도 뜨고, 넘겨주지 않은 소식이 그대로 넘어간다", async (t) => {
  const works = JSON.stringify([
    { login: "alice", name: "alice", branch: "refund" },
    { login: "owner", name: "owner", branch: "main" },
  ]);
  const files = JSON.stringify([
    { path: "a.ts", lines: [[{ from: 1, to: 1 }], [{ from: 2, to: 2 }]] },
  ]);
  const world = await startWorld({
    seed: `
      CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, works TEXT NOT NULL,
        files TEXT NOT NULL, resolved INTEGER, updated INTEGER NOT NULL) STRICT;
      INSERT INTO alerts VALUES (1, 'pair', '${works}', '${files}', ${Date.now()}, ${Date.now()});
      CREATE TABLE inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, branch TEXT NOT NULL,
        alert INTEGER NOT NULL REFERENCES alerts (id), at INTEGER NOT NULL, UNIQUE (login, branch, alert)) STRICT;
      INSERT INTO inbox VALUES (7, 'owner', 'main', 1, ${Date.now()});`,
  });
  t.after(world.stop);
  await eventually(async () =>
    assert.deepEqual(block(await hook(world), "omagari-inbox"), [
      `- 풀렸다: 내 작업과 alice의 브랜치 "refund"의 직접 충돌`,
    ]),
  );
});
