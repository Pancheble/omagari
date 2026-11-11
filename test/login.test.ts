import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  api,
  CONTRACT_VERSION,
  ContractFailure,
  call,
  encode,
  RUNNER_SOCKET,
  runnerToServer,
} from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { WebSocket } from "ws";
import { eventually, fakeExecutor, REPO, startWorld, tempRepo } from "./harness.ts";

test("push 권한이 있는 계정은 로그인하면 초대 없이 멤버가 된다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");

  const alice = await world.login("alice");
  assert.deepEqual(await world.agents(alice), { alice: "offline", owner: "online" });
});

test("push 권한이 없는 계정은 워크스페이스의 어떤 것도 읽지 못한다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await assert.rejects(world.login("stranger"), {
    code: "forbidden",
    message: new RegExp(`stranger는 ${REPO}에 push 권한이 없어`),
  });
  await assert.rejects(call(world.server, api.members), { code: "unauthorized" });
  await assert.rejects(call({ url: world.server.url, session: "made-up-session" }, api.members), {
    code: "unauthorized",
  });
  const desk = await tempRepo(); // 남이 레포를 받은 폴더
  t.after(desk.remove);
  await assert.rejects(
    startRunner({ serverUrl: world.server.url, folder: desk.folder, session: "made-up-session" }),
    { code: "unauthorized" },
  );
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("남겨 둔 세션으로 나와 워크스페이스를 다시 읽고, 로그아웃한 세션만 끝난다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  world.github.names.set("alice", "앨리스");
  const browser = await world.login("alice");
  const laptop = await world.login("alice"); // 같은 사람이 다른 브라우저에서

  assert.deepEqual(await call(browser, api.me), { login: "alice", name: "앨리스", repo: REPO });
  // 프로필 이름을 비워 둔 사람은 로그인이 이름이다.
  assert.deepEqual(await call(world.owner, api.me), { login: "owner", name: "owner", repo: REPO });

  await call(browser, api.logout);
  await assert.rejects(call(browser, api.me), { code: "unauthorized" });
  assert.equal((await call(laptop, api.me)).login, "alice");
  assert.deepEqual(await world.agents(laptop), { alice: "offline", owner: "online" });

  // 러너가 쓰는 세션으로 로그아웃하면 그 러너도 끊긴다.
  await call(world.owner, api.logout);
  const reason = await world.runner.ended;
  assert.ok(reason instanceof ContractFailure);
  assert.equal(reason.code, "unauthorized");
  assert.deepEqual(await world.agents(laptop), { alice: "offline" });
});

test("push 권한을 잃은 멤버는 다음 재확인 뒤 워크스페이스에서 빠지고 러너도 끊긴다", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  world.github.revoke("owner");
  await eventually(async () => assert.deepEqual(await world.agents(alice), { alice: "offline" }));
  await assert.rejects(call(world.owner, api.members), { code: "unauthorized" });
  const reason = await world.runner.ended;
  assert.ok(reason instanceof ContractFailure);
  assert.equal(reason.code, "forbidden");
  assert.equal(reason.message, `owner는 이제 ${REPO}에 push 권한이 없어 워크스페이스에서 빠졌다`);
});

test("레포 폴더에서 명령 하나로 로그인하고 러너를 켠다. 러너 쪽에는 GitHub 토큰이 남지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const desk = await tempRepo(); // alice가 레포를 받은 폴더
  t.after(desk.remove);

  const runner = world.launchCliIn(desk.folder, "runner");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/코드 (\S+)/);
  world.github.approve(code, "alice"); // 사람이 브라우저에서 코드를 넣었다
  await runner.output(new RegExp(`러너가 켜졌다: alice의 에이전트, ${REPO} ↔ ${desk.folder}`));
  assert.equal((await world.agents(world.owner)).alice, "online");

  // 떨어지면 오프라인이다.
  const stopped = await runner.stop("SIGINT");
  assert.equal(stopped.code, 0);
  await eventually(async () => assert.equal((await world.agents(world.owner)).alice, "offline"));

  // 서버는 GitHub 토큰을 받았지만, 러너 쪽(출력과 CLI가 남긴 파일)에는 하나도 없다.
  const files = await readdir(world.config, { recursive: true, withFileTypes: true });
  const saved = files.filter((f) => f.isFile()).map((f) => join(f.parentPath, f.name));
  assert.ok(saved.length > 0);
  const runnerSide = [stopped.stdout, stopped.stderr];
  for (const file of saved) runnerSide.push(await readFile(file, "utf8"));
  assert.ok(world.github.tokens.size > 0);
  for (const token of world.github.tokens.keys()) {
    assert.ok(!runnerSide.some((text) => text.includes(token)), "GitHub 토큰이 러너 쪽에 남았다");
  }

  // 다시 켜면 남겨 둔 세션으로 붙는다. 다시 로그인하지 않는다.
  const again = world.launchCliIn(desk.folder, "runner");
  t.after(() => again.stop("SIGKILL"));
  await again.output(/러너가 켜졌다: alice/);
  assert.doesNotMatch((await again.stop()).stdout, /GitHub 로그인/);
});

test("Git 레포가 아닌 폴더에서는 로그인하기 전에 이유를 말하고 켜지지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  const folder = await mkdtemp(join(tmpdir(), "omagari-not-git-"));
  t.after(() => rm(folder, { recursive: true, force: true }));

  const result = await world.cliIn(folder, "runner");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Git 레포가 아닌 폴더다/);
  assert.doesNotMatch(result.stdout, /GitHub 로그인/);
});

test("워크스페이스의 레포가 아닌 폴더에서는 이유를 말하고 켜지지 않는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const other = await tempRepo("someone/elsewhere");
  t.after(other.remove);

  const runner = world.launchCliIn(other.folder, "runner");
  t.after(() => runner.stop("SIGKILL"));
  const [, code] = await runner.output(/코드 (\S+)/);
  world.github.approve(code, "alice");
  const result = await runner.exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`이 폴더는 ${REPO}의 폴더가 아니다`));
  assert.equal((await world.agents(world.owner)).alice, "offline");
});

test("같은 레포에 러너를 하나 더 켜면 이유를 말하고 켜지지 않는다. 먼저 켠 러너는 그대로 답한다", async (t) => {
  const world = await startWorld({ executor: fakeExecutor().executor });
  t.after(world.stop);

  await assert.rejects(
    startRunner({
      serverUrl: world.server.url,
      folder: world.repo.folder,
      session: world.owner.session,
    }),
    /이 레포의 러너가 이미 켜져 있다/,
  );
  assert.equal((await world.cli("runner", "ask", "아직 있나?")).stdout, "가짜 답\n");
  assert.deepEqual(await world.agents(world.owner), { owner: "online" });
});

test("답하지 않는 러너 연결은 끊겨 그 에이전트가 오프라인이 된다", async (t) => {
  const world = await startWorld({ heartbeatMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // 잠든 기기 흉내: hello까지 마치고 ping에 답하지 않는 날 연결.
  const silent = new WebSocket(world.server.url.replace("http", "ws") + RUNNER_SOCKET, {
    autoPong: false,
  });
  t.after(() => silent.terminate());
  await once(silent, "open");
  silent.send(
    encode(runnerToServer, "hello", {
      session: alice.session,
      repos: [REPO],
      executors: ["claude-code"],
    }),
  );
  const [welcome] = await once(silent, "message");
  assert.partialDeepStrictEqual(JSON.parse(String(welcome)), {
    v: CONTRACT_VERSION,
    kind: "welcome",
    payload: { login: "alice", repo: REPO },
  });

  await once(silent, "close");
  await eventually(async () =>
    assert.deepEqual(await world.agents(alice), { alice: "offline", owner: "online" }),
  );
});

test("서버가 다시 뜨면 러너가 다시 붙는다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(await world.agents(world.owner), { owner: "online" }),
  );
});
