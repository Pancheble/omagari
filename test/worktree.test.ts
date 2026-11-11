import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { eventually, place, startWorld, writer } from "./harness.ts";

// 워크트리마다 Git을 여러 번 부르고 단계가 다섯이라, 다른 테스트와 함께 돌 때 기본 시간 제한(30초)에 가깝다.
test("등록한 폴더와 연결된 워크트리의 브랜치가 각각 작업으로 관측되고, 워크트리를 더하거나 지우면 관측이 따라온다", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld({ observeMs: 20 });
  t.after(world.stop);
  const { git, folder } = world.repo;
  const tree = await place(t);
  const base = await git("rev-parse", "origin/main");

  await writer(folder)("main.ts", "main\n");
  // 기본 브랜치와 갈라진 지점이 없는 워크트리(커밋 없는 orphan 브랜치)는 읽지 못한다. 그래도 나머지는 올라간다.
  await git("worktree", "add", "--detach", tree("pages"));
  await git("-C", tree("pages"), "switch", "--orphan", "pages");
  // 브랜치가 아닌(detached) 워크트리에는 작업이 없다.
  await git("worktree", "add", "--detach", tree("detached"));
  await git("worktree", "add", "-b", "feat-a", tree("a"));
  await writer(tree("a"))("a.ts", "a\n");
  await git("worktree", "add", "-b", "feat-b", tree("b"));
  await writer(tree("b"))("b.ts", "b\n");
  await git("-C", tree("b"), "add", "b.ts");
  await git("-C", tree("b"), "commit", "--message=b");

  await eventually(async () =>
    assert.deepEqual(await world.works(world.owner), [
      {
        login: "owner",
        branch: "feat-a",
        base,
        share: "full",
        files: [{ path: "a.ts", content: "a\n" }],
        line: { source: "files", text: "a.ts 수정 중" },
        offlineSince: null,
      },
      {
        login: "owner",
        branch: "feat-b",
        base,
        share: "full",
        files: [{ path: "b.ts", content: "b\n" }],
        line: { source: "files", text: "b.ts 수정 중" },
        offlineSince: null,
      },
      {
        login: "owner",
        branch: "main",
        base,
        share: "full",
        files: [{ path: "main.ts", content: "main\n" }],
        line: { source: "files", text: "main.ts 수정 중" },
        offlineSince: null,
      },
    ]),
  );

  const branches = async () => (await world.works(world.owner)).map((work) => work.branch);
  const follows = (expected: string[]) =>
    eventually(async () => assert.deepEqual(await branches(), expected));

  // 워크트리에서 브랜치를 바꾸면 그 브랜치가 작업이 된다.
  await git("-C", tree("a"), "switch", "--create", "feat-c");
  await follows(["feat-b", "feat-c", "main"]);

  // 워크트리를 더하면 따라온다.
  await git("worktree", "add", "-b", "feat-d", tree("d"));
  await follows(["feat-b", "feat-c", "feat-d", "main"]);

  // git worktree remove로 지우면 따라온다.
  await git("worktree", "remove", "--force", tree("a"));
  await follows(["feat-b", "feat-d", "main"]);

  // 폴더만 지워도(Git에는 prunable로 남는다) 따라온다.
  await rm(tree("b"), { recursive: true, force: true });
  await follows(["feat-d", "main"]);
});

test("내용 합계의 상한(8MiB)은 워크트리를 모두 합해 센다", async (t) => {
  const world = await startWorld({ observeMs: 20 });
  t.after(world.stop);
  const { git, folder } = world.repo;
  const tree = await place(t);
  await git("worktree", "add", "-b", "feat", tree("feat"));

  // 500KiB 파일 열 개씩. 둘을 합해 열여섯 개까지가 8MiB 안이다. 등록한 폴더를 먼저 센다.
  const parts = Array.from({ length: 10 }, (_, i) => `part-${String(i + 1).padStart(2, "0")}.txt`);
  const content = "p".repeat(500 * 1024);
  for (const part of parts) {
    await writer(folder)(part, content);
    await writer(tree("feat"))(part, content);
  }

  await eventually(async () => {
    const files = Object.fromEntries(
      (await world.works(world.owner)).map((work) => [work.branch, work.files]),
    );
    assert.deepEqual(files, {
      main: parts.map((path) => ({ path, content })),
      feat: parts.map((path, i) => (i < 6 ? { path, content } : { path, omitted: "too_large" })),
    });
  });
});
