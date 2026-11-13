import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { eventually, startWorld, tempRepo, writer } from "./harness.ts";

// 러너를 CLI로 다섯 번 켜고 끈다. 관측은 붙자마자 보내므로 주기(3초)를 기다리지 않지만, 단계가 많아 시간 제한을 늘린다.
test("주인이 러너마다 공유 수준을 고르고 다시 켜도 그 수준이 남는다. 기본은 full, declared는 경로만, intent는 작업만 올리고, 낮추면 올라간 내용이 서버에서 내려간다", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // alice가 레포를 받은 폴더
  t.after(desk.remove);
  const { git, folder } = desk;
  const write = writer(folder);

  await write("gone.ts", "gone\n");
  await git("add", "gone.ts");
  await git("commit", "--message=gone");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  const base = await git("rev-parse", "HEAD");
  await git("switch", "--create", "feat");
  await write("committed.ts", "커밋한 내용\n");
  await git("add", "committed.ts");
  await git("commit", "--message=committed");
  await write("draft.ts", "커밋하지 않은 내용\n");
  await write("image.png", new Uint8Array([0x89, 0x50, 0x00]));
  await write(".env.local", "TOKEN=secret\n"); // 어느 수준에서도 나가지 않는다
  await rm(join(folder, "gone.ts"));

  /** alice의 러너를 `omagari runner <args>`로 켠다. 처음이면 기기 인증으로 로그인한다. */
  const launch = async (...args: string[]) => {
    const runner = world.launchCliIn(folder, "runner", ...args);
    t.after(() => runner.stop("SIGKILL"));
    const [, code] = await runner.output(/코드 (\S+) |러너가 켜졌다/);
    if (code) {
      world.github.approve(code, "alice");
      await runner.output(/러너가 켜졌다/);
    }
    return runner;
  };
  /** 다른 멤버(owner)가 API로 보는 alice의 작업. 상태 한 줄은 쓴 시각을 빼고 본다. 러너가 켜져 있어 오프라인이 아니다. */
  const observed = (share: string, files: object[], line: object | null) =>
    eventually(async () =>
      assert.deepEqual(
        (await world.works(world.owner))
          .filter((work) => work.login === "alice")
          .map((work) => ({
            ...work,
            line: work.line && { source: work.line.source, text: work.line.text },
          })),
        [{ login: "alice", branch: "feat", base, share, files, line, offlineSince: null }],
      ),
    );
  /** alice의 에이전트가 이 폴더에서 `omagari status set`으로 상태 한 줄을 쓴다. */
  const setStatus = async (text: string) => {
    const { code, stderr } = await world.cliIn(folder, "status", "set", text);
    assert.equal(code, 0, stderr);
    return { source: "agent", text };
  };

  // 고르지 않으면 full: 내용까지 올라간다.
  let runner = await launch();
  await observed(
    "full",
    [
      { path: "committed.ts", content: "커밋한 내용\n" },
      { path: "draft.ts", content: "커밋하지 않은 내용\n" },
      { path: "gone.ts", deleted: true },
      { path: "image.png", omitted: "binary" },
    ],
    { source: "files", text: "committed.ts 외 3개 수정 중" },
  );
  let { stdout } = await runner.stop();
  assert.match(stdout, /관측\(공유 수준 full\)/);

  // declared로 낮추면 경로만 남고(선점한 경로가 없다), 이미 올라간 내용은 서버에서 내려간다. 선점한 경로의 내용은 claims.test가 본다.
  runner = await launch("--share", "declared");
  const declared = [
    { path: "committed.ts", omitted: "share" },
    { path: "draft.ts", omitted: "share" },
    { path: "gone.ts", deleted: true },
    { path: "image.png", omitted: "share" },
  ];
  await observed("declared", declared, { source: "files", text: "committed.ts 외 3개 수정 중" });
  ({ stdout } = await runner.stop());
  assert.match(
    stdout,
    /관측\(공유 수준 declared\): .*바꾼 파일의 경로가 서버로 나가 멤버들이 본다\. 내용은 그 브랜치가 선점\(omagari claim\)한 경로 안의 파일만 나간다/,
  );

  // 고르지 않고 다시 켜도 고른 수준이 남는다. 꺼진 동안 쓴 파일도 경로만 올라간다.
  await write("later.ts", "꺼진 동안 쓴 내용\n");
  runner = await launch();
  const later = [...declared, { path: "later.ts", omitted: "share" }];
  await observed("declared", later, { source: "files", text: "committed.ts 외 4개 수정 중" });
  const fixing = await setStatus("결제 흐름 고치는 중");
  await observed("declared", later, fixing);
  ({ stdout } = await runner.stop());
  assert.match(stdout, /관측\(공유 수준 declared\)/);

  // intent로 낮추면 경로도 내용도 내려가고 작업(브랜치)과 상태 한 줄만 남는다.
  // 파일이 오지 않을 뿐 바뀐 것이 0이 된 것이 아니라, 에이전트가 쓴 줄은 지워지지 않는다.
  runner = await launch("--share=intent");
  await observed("intent", [], fixing);
  await observed("intent", [], await setStatus("환불 흐름으로 넘어가는 중"));
  ({ stdout } = await runner.stop());
  assert.match(stdout, /관측\(공유 수준 intent\): .*바꾼 파일의 경로도 내용도 나가지 않는다/);

  // 없는 수준은 받지 않고, 러너도 켜지 않는다.
  const wrong = await world.cliIn(folder, "runner", "--share", "everything");
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /공유 수준은 full, declared, intent 가운데 하나다: everything/);

  // 다시 올리면 내용이 올라간다.
  runner = await launch("--share", "full");
  await observed(
    "full",
    [
      { path: "committed.ts", content: "커밋한 내용\n" },
      { path: "draft.ts", content: "커밋하지 않은 내용\n" },
      { path: "gone.ts", deleted: true },
      { path: "image.png", omitted: "binary" },
      { path: "later.ts", content: "꺼진 동안 쓴 내용\n" },
    ],
    { source: "agent", text: "환불 흐름으로 넘어가는 중" },
  );
  await runner.stop();
});
