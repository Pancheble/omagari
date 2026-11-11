import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { eventually, startWorld, tempRepo } from "./harness.ts";

/** 레포 폴더에 파일을 쓴다. 폴더가 없으면 만든다. */
const writer = (folder: string) => async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), content);
};

test("커밋한 것, 커밋하지 않은 것, 추적하지 않는 새 파일이 푸시 여부와 상관없이 그 작업의 변경으로 올라가고, 다른 멤버가 API로 본다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // 기본 브랜치에 이미 있는 파일(푸시됨)
  await write("kept.ts", "base\n");
  await write("gone.ts", "bye\n");
  await git("add", ".");
  await git("commit", "--message=base");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  const base = await git("rev-parse", "HEAD");

  await git("switch", "--create", "feat");
  await write("pushed.ts", "pushed\n");
  await git("add", "pushed.ts");
  await git("commit", "--message=pushed");
  await git("update-ref", "refs/remotes/origin/feat", "HEAD"); // 푸시한 커밋
  await write("committed.ts", "committed\n");
  await git("add", "committed.ts");
  await git("commit", "--message=committed"); // 푸시하지 않은 커밋
  await write("staged.ts", "staged\n");
  await git("add", "staged.ts");
  await write("kept.ts", "base\nchanged\n");
  await write("src/new.ts", "new\n");
  await rm(join(folder, "gone.ts"));

  await eventually(async () =>
    assert.deepEqual(await world.works(alice), [
      {
        login: "owner",
        branch: "feat",
        base,
        // 경로, 내용, 지웠는지만 온다. 정의 줄 같은 다른 것은 없다.
        files: [
          { path: "committed.ts", content: "committed\n" },
          { path: "gone.ts", deleted: true },
          { path: "kept.ts", content: "base\nchanged\n" },
          { path: "pushed.ts", content: "pushed\n" },
          { path: "src/new.ts", content: "new\n" },
          { path: "staged.ts", content: "staged\n" },
        ],
      },
    ]),
  );

  // 멤버가 아니면 볼 수 없다.
  await assert.rejects(call(world.server, api.works), { code: "unauthorized" });
  await assert.rejects(call({ url: world.server.url, session: "made-up-session" }, api.works), {
    code: "unauthorized",
  });
});

test("기준 커밋은 기본 브랜치(원격 추적)와 갈라진 지점이다. 그 뒤 기본 브랜치에 들어온 남의 변경은 섞이지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  const forkPoint = await git("rev-parse", "origin/main");

  // 로컬 main에만 있는 커밋은 기본 브랜치(원격 추적)에 없으니 이 작업의 변경이다.
  await write("local.ts", "local\n");
  await git("add", "local.ts");
  await git("commit", "--message=local");
  await git("switch", "--create", "feat");
  await write("mine.ts", "mine\n");
  await git("add", "mine.ts");
  await git("commit", "--message=mine");
  // 남이 기본 브랜치에 머지했고 주인이 fetch로 받았다.
  await git("switch", "--detach", forkPoint);
  await write("theirs.ts", "theirs\n");
  await git("add", "theirs.ts");
  await git("commit", "--message=theirs");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("switch", "feat");

  await eventually(async () =>
    assert.deepEqual(await world.works(world.owner), [
      {
        login: "owner",
        branch: "feat",
        base: forkPoint,
        files: [
          { path: "local.ts", content: "local\n" },
          { path: "mine.ts", content: "mine\n" },
        ],
      },
    ]),
  );
});

test("gitignore된 파일과 .env, .env.*는 추적되더라도 올라가지 않는다. .env.example은 올라간다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);

  await write(".gitignore", "secret.txt\nbuild/\n");
  await write("secret.txt", "gitignore된 파일\n");
  await write("build/out.js", "gitignore된 폴더\n");
  await write(".env", "TOKEN=tracked\n");
  await git("add", ".env");
  await git("commit", "--message=env"); // 추적되는 .env
  await write(".env", "TOKEN=changed\n");
  await write(".env.local", "TOKEN=local\n");
  await write("config/.env.production", "TOKEN=prod\n");
  await write(".env.d/keys", "TOKEN=dir\n");
  await write(".env.example", "TOKEN=\n");

  await eventually(async () =>
    assert.deepEqual(await world.works(world.owner), [
      {
        login: "owner",
        branch: "main",
        base: await git("rev-parse", "origin/main"),
        files: [
          { path: ".env.example", content: "TOKEN=\n" },
          { path: ".gitignore", content: "secret.txt\nbuild/\n" },
        ],
      },
    ]),
  );
});

test("바이너리와 크기 상한(파일 하나 512KiB, 합계 8MiB)을 넘는 파일은 경로만 올라간다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const write = writer(world.repo.folder);
  const KiB = 1024;

  await write("image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await write("latin1.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9])); // UTF-8이 아니다
  await write("utf16.txt", Buffer.from("hi", "utf16le")); // UTF-8로 읽히지만 NUL이 있다
  await write("bom.txt", "﻿첫 줄\n"); // BOM도 그대로 온다
  await write("edge.txt", "e".repeat(512 * KiB)); // 딱 상한: 내용이 온다
  await write("huge.txt", "h".repeat(512 * KiB + 1)); // 상한을 넘는다
  // 합계: edge.txt와 part-01~15까지가 8MiB 안이다. part-16, 17은 넘어 경로만, 그 뒤의 작은 small.txt는 들어간다.
  const parts = Array.from({ length: 17 }, (_, i) => `part-${String(i + 1).padStart(2, "0")}.txt`);
  for (const part of parts) await write(part, "p".repeat(500 * KiB));
  await write("small.txt", "s\n");

  await eventually(async () => {
    const [work] = await world.works(world.owner);
    assert.deepEqual(work?.files, [
      { path: "bom.txt", content: "﻿첫 줄\n" },
      { path: "edge.txt", content: "e".repeat(512 * KiB) },
      { path: "huge.txt", omitted: "too_large" },
      { path: "image.png", omitted: "binary" },
      { path: "latin1.txt", omitted: "binary" },
      ...parts.map((path, i) =>
        i < 15 ? { path, content: "p".repeat(500 * KiB) } : { path, omitted: "too_large" },
      ),
      { path: "small.txt", content: "s\n" },
      { path: "utf16.txt", omitted: "binary" },
    ]);
  });
});

// 관측 주기는 러너의 기본값(3초) 그대로다. 단계마다 5초 안에 따라와야 하고, 단계가 다섯이라 시간 제한을 늘린다.
test("파일을 고치고, 커밋하고, 브랜치를 바꾸면 몇 초 안에 서버의 관측이 따라온다", {
  timeout: 60_000,
}, async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  const filesOf = async () =>
    Object.fromEntries((await world.works(world.owner)).map((work) => [work.branch, work.files]));
  const follows = (expected: object) =>
    eventually(async () => assert.deepEqual(await filesOf(), expected), 5000);

  await git("switch", "--create", "feat");
  await write("a.ts", "1\n");
  await follows({ feat: [{ path: "a.ts", content: "1\n" }] });
  await write("a.ts", "2\n");
  await follows({ feat: [{ path: "a.ts", content: "2\n" }] });

  // 커밋을 되돌리는 커밋을 하면 바뀐 것이 없어진다.
  await git("add", "a.ts");
  await git("commit", "--message=a");
  await git("revert", "--no-edit", "HEAD");
  await follows({ feat: [] });

  // 브랜치를 바꾸면 그 브랜치가 작업이 된다.
  await git("switch", "--create", "other", "origin/main");
  await write("b.ts", "b\n");
  await follows({ other: [{ path: "b.ts", content: "b\n" }] });

  // 브랜치가 아니면(detached HEAD) 작업이 없다.
  await git("switch", "--detach");
  await follows({});
});

test("러너는 작업 폴더의 어떤 파일도 바꾸지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk = await tempRepo(); // alice가 레포를 받은 폴더. 러너가 아직 본 적이 없다.
  t.after(desk.remove);
  const { git, folder } = desk;
  const write = writer(folder);

  await write("tracked.ts", "tracked\n");
  await git("add", "tracked.ts");
  await git("commit", "--message=tracked");
  await write("staged.ts", "staged\n");
  await git("add", "staged.ts");
  await write("untracked.ts", "untracked\n");
  // 내용은 그대로이고 시각만 바뀐 파일. git status라면 덤으로 인덱스를 고쳐 쓰는 상태다.
  const later = new Date(Date.now() + 60_000);
  await utimes(join(folder, "tracked.ts"), later, later);

  /** 폴더 안 모든 파일(.git 포함)의 경로, 내용, 수정 시각. 러너가 남기는 실행 기록 자리(.git/omagari)는 뺀다. */
  const snapshot = async () => {
    const entries = await readdir(folder, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => !relative(folder, path).startsWith(join(".git", "omagari")))
      .sort();
    return Promise.all(
      files.map(async (path) => [
        relative(folder, path),
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        (await stat(path)).mtimeMs,
      ]),
    );
  };
  const before = await snapshot();

  const runner = await startRunner({
    serverUrl: world.server.url,
    folder,
    session: alice.session,
    observeMs: 20,
  });
  t.after(runner.stop);
  await eventually(async () => {
    const [work] = (await world.works(alice)).filter((w) => w.login === "alice");
    assert.equal(work?.files.length, 3);
  });
  await sleep(200); // 관측이 여러 번 돈다
  await runner.stop();
  assert.deepEqual(await snapshot(), before);
});

test("러너를 켤 때 로그인하기 전에 무엇이 서버로 나가는지 주인에게 알린다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // alice가 레포를 받은 폴더
  t.after(desk.remove);
  await writer(desk.folder)("hello.ts", "hello\n");

  const runner = world.launchCliIn(desk.folder, "runner");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/코드 (\S+)/);
  world.github.approve(code, "alice");
  await runner.output(/러너가 켜졌다/);
  await eventually(async () =>
    assert.deepEqual(
      (await world.works(world.owner)).filter((work) => work.login === "alice"),
      [
        {
          login: "alice",
          branch: "main",
          base: await desk.git("rev-parse", "origin/main"),
          files: [{ path: "hello.ts", content: "hello\n" }],
        },
      ],
    ),
  );

  const { stdout } = await runner.stop();
  const notice = stdout.slice(0, stdout.indexOf("GitHub 로그인"));
  assert.match(notice, /바꾼 파일의 경로와 내용이 서버로 나가/);
  assert.match(notice, /커밋한 것, 커밋하지 않은 것, 추적하지 않는 새 파일/);
  assert.match(
    notice,
    /나가지 않는 것: gitignore된 파일과 \.env, \.env\.\*\(\.env\.example은 나간다\)/,
  );
  assert.match(notice, /경로만 나가는 것: 바이너리, 512KiB를 넘는 파일, 합계 8MiB를 넘는 몫/);
});
