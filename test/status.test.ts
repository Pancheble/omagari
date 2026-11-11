import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { startRunner } from "@omagari/runner";
import { eventually, startWorld, tempRepo } from "./harness.ts";

/** 관측과 GitHub 읽기를 짧게 돈다. 기본값(3초, 1분)이면 단계마다 오래 기다린다. */
const FAST = { observeMs: 50, followMs: 50 };
/** 일어나지 않아야 하는 것을 확인할 때 기다리는 시간. 관측과 GitHub 읽기가 여러 번 돈다. */
const SETTLE_MS = 400;

type World = Awaited<ReturnType<typeof startWorld>>;
type Member = { url: string; session: string };

/** `as`의 눈으로 본 `login`의 작업 `branch`. 아직 관측되지 않았으면 던진다. */
async function workOf(world: World, branch: string, login = "owner", as: Member = world.owner) {
  const work = (await world.works(as)).find((w) => w.login === login && w.branch === branch);
  if (!work) throw new Error(`${login}의 작업 ${branch}가 아직 없다`);
  return work;
}

const write = async (folder: string, path: string, content = `${path}\n`) => {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), content);
};

/** 멤버의 레포 폴더 하나와 그 폴더에서 켠 러너. 멤버마다 기기가 따로다. */
async function desk(world: World, member: Member) {
  const repo = await tempRepo();
  const options = {
    serverUrl: world.server.url,
    folder: repo.folder,
    session: member.session,
    observeMs: 50,
  };
  let runner = await startRunner(options);
  return {
    ...repo,
    stop: () => runner.stop(),
    async start() {
      runner = await startRunner(options);
    },
    async remove() {
      await runner.stop();
      await repo.remove();
    },
  };
}

test("omagari status set으로 쓴 줄이 쓴 시각과 함께 그 작업의 상태 한 줄로 보이고, 같은 브랜치에 다시 쓰면 나중 것이 남는다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await world.repo.git("switch", "--create", "payment");

  // 로그인하지 않은 기기에서는 쓰지 못한다.
  const refused = await world.cli("status", "set", "결제 API 붙이는 중");
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /로그인하지 않았다/);

  await world.signInCli(world.owner);
  const before = Date.now();
  const first = await world.cli("status", "set", "결제 API 붙이는 중");
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /payment의 상태 한 줄을 썼다: 결제 API 붙이는 중/);
  const after = Date.now();

  const { line } = await eventually(() => workOf(world, "payment", "owner", alice));
  assert.ok(line?.source === "agent");
  assert.equal(line.text, "결제 API 붙이는 중");
  const at = Date.parse(line.at);
  assert.ok(before <= at && at <= after, `쓴 시각 ${line.at}`);

  // 두 번째 작업 세션이 같은 브랜치에 쓴다. 줄바꿈과 겹친 공백은 한 줄로 접힌다.
  const second = await world.cli("status", "set", "결제 실패를", "다시 시도하게\n고치는 중");
  assert.equal(second.code, 0, second.stderr);
  const later = await workOf(world, "payment", "owner", alice);
  assert.equal(later.line?.source, "agent");
  assert.equal(later.line?.text, "결제 실패를 다시 시도하게 고치는 중");
});

test("보이는 줄은 오프라인 → 에이전트가 쓴 줄 → 초안 PR 제목 → 고치는 파일 → 줄 없음 순서로 고른다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  await world.signInCli(world.owner);
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  const lineOf = async () => (await workOf(world, "payment")).line;

  // 바뀐 것이 없으면 줄이 없다.
  await eventually(async () => assert.equal(await lineOf(), null));

  // 고치는 파일. 첫 파일 이름과 나머지 개수다.
  for (const path of ["payment.ts", "src/cart.ts", "src/order.ts", "test/payment.test.ts"]) {
    await write(folder, path);
  }
  const files = { source: "files", text: "payment.ts 외 3개 수정 중" };
  await eventually(async () => assert.deepEqual(await lineOf(), files));

  // 초안이 아닌 PR의 제목은 쓰지 않는다. 초안 PR이면 그 제목이다.
  const pull = world.github.openPull("payment", "결제 모듈 붙이기", false);
  await sleep(SETTLE_MS);
  assert.deepEqual(await lineOf(), files);
  pull.draft = true;
  await eventually(async () =>
    assert.deepEqual(await lineOf(), { source: "pull", text: "결제 모듈 붙이기" }),
  );

  // 에이전트가 쓴 줄이 초안 PR 제목보다 먼저다.
  await world.cli("status", "set", "결제 실패 처리 고치는 중");
  await eventually(async () => assert.equal((await lineOf())?.source, "agent"));

  // 오프라인이 맨 앞이다. 그때의 줄과 관측은 떨어진 시각 기준으로 남는다.
  const offline = Date.now();
  await world.runner.stop();
  const work = await eventually(async () => {
    const work = await workOf(world, "payment");
    assert.ok(work.offlineSince !== null);
    return work;
  });
  assert.ok(Date.parse(work.offlineSince as string) >= offline);
  assert.equal(work.line?.source, "agent");
  assert.equal(work.line?.text, "결제 실패 처리 고치는 중");
  assert.equal(work.files.length, 4);
  assert.equal((await world.agents(world.owner)).owner, "offline");
});

// ponytail: 러너가 한 번에 한 브랜치만 관측해(#11 전) 두 작업이 동시에 보이지는 않는다. 그래서 브랜치를 오가며 줄이 작업마다 따로인지 본다.
// #11이 워크트리를 관측하면 워크트리 둘에서 두 줄이 함께 보이는지로 바꾼다.
test("한 멤버가 여러 브랜치에서 일하면 상태 한 줄은 작업(브랜치)마다 따로다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  await world.signInCli(world.owner);
  const { git } = world.repo;

  await git("switch", "--create", "payment");
  await world.cli("status", "set", "결제 붙이는 중");
  await git("switch", "--create", "refund", "main");
  await world.cli("status", "set", "환불 붙이는 중");
  await eventually(async () =>
    assert.equal((await workOf(world, "refund")).line?.text, "환불 붙이는 중"),
  );

  await git("switch", "payment");
  await eventually(async () =>
    assert.equal((await workOf(world, "payment")).line?.text, "결제 붙이는 중"),
  );
});

test("그 브랜치가 머지되면 에이전트가 쓴 줄이 지워진다. 머지 뒤에 같은 브랜치에 쓴 줄은 남는다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  await world.signInCli(world.owner);
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  await write(folder, "payment.ts");
  const pull = world.github.openPull("payment", "결제 모듈 붙이기");
  await world.cli("status", "set", "결제 붙이는 중");
  const lineOf = async () => (await workOf(world, "payment")).line;
  await eventually(async () => assert.equal((await lineOf())?.source, "agent"));

  world.github.merge(pull);
  await eventually(async () =>
    assert.deepEqual(await lineOf(), { source: "files", text: "payment.ts 수정 중" }),
  );

  await world.cli("status", "set", "끝: 결제 모듈 붙임");
  await sleep(SETTLE_MS);
  const line = await lineOf();
  assert.equal(line?.source, "agent");
  assert.equal(line.text, "끝: 결제 모듈 붙임");
});

test("관측된 변경이 있다가 0이 되면 에이전트가 쓴 줄이 지워진다. 처음부터 변경이 없을 때 쓴 줄은 지워지지 않는다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  await world.signInCli(world.owner);
  const { git, folder } = world.repo;
  await git("switch", "--create", "payment");
  await eventually(() => workOf(world, "payment"));
  const lineOf = async () => (await workOf(world, "payment")).line;

  await world.cli("status", "set", "결제 붙이기 시작");
  await sleep(SETTLE_MS);
  assert.equal((await lineOf())?.text, "결제 붙이기 시작");

  await write(folder, "payment.ts");
  await eventually(async () => assert.equal((await workOf(world, "payment")).files.length, 1));
  assert.equal((await lineOf())?.text, "결제 붙이기 시작");

  await rm(join(folder, "payment.ts"));
  await eventually(async () => assert.equal(await lineOf(), null));
});

test("omagari status로 멤버, 작업, 상태 한 줄, 바뀐 파일을 본다. 오프라인인 멤버의 것은 몇 시간 전 기준인지 붙는다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  for (const name of ["alice", "bob"]) world.github.grant(name);
  const alice = await world.login("alice");
  await world.login("bob"); // 러너를 켠 적이 없는 멤버
  await world.signInCli(world.owner);

  const { git, folder } = world.repo;
  await write(folder, "gone.ts");
  await git("add", "gone.ts");
  await git("commit", "--message=gone");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("switch", "--create", "payment");
  await write(folder, "payment.ts");
  await rm(join(folder, "gone.ts"));
  await world.cli("status", "set", "결제 붙이는 중");

  const desk_ = await desk(world, alice);
  t.after(desk_.remove);
  await desk_.git("switch", "--create", "refund");
  await write(desk_.folder, "refund.ts");
  await eventually(() => workOf(world, "refund", "alice"));
  await desk_.stop();
  await eventually(async () =>
    assert.notEqual((await workOf(world, "refund", "alice")).offlineSince, null),
  );
  await eventually(async () => assert.equal((await workOf(world, "payment")).files.length, 2));

  const { code, stdout, stderr } = await world.cli("status");
  assert.equal(code, 0, stderr);
  assert.equal(
    stdout,
    [
      "alice · 에이전트 오프라인 · 방금 전 기준",
      "  refund: refund.ts 수정 중",
      "    refund.ts",
      "bob · 에이전트 오프라인",
      "  작업 없음",
      "owner · 에이전트 온라인",
      "  payment: 결제 붙이는 중 (방금 전)",
      "    gone.ts (지움)",
      "    payment.ts",
      "",
    ].join("\n"),
  );
});

test("오프라인이 되면 마지막 관측과 상태 한 줄이 떨어진 시각 기준으로 남는다. 서버가 다시 떠도 그 시각은 그대로고, 다시 붙으면 지금 것이 된다", async (t) => {
  const world = await startWorld(FAST);
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk_ = await desk(world, alice);
  t.after(desk_.remove);
  await desk_.git("switch", "--create", "refund");
  await write(desk_.folder, "refund.ts");
  await call(alice, api.setStatus, { branch: "refund", text: "환불 붙이는 중" });
  const refund = () => workOf(world, "refund", "alice");
  await eventually(async () => assert.equal((await refund()).files.length, 1));

  const stopped = Date.now();
  await desk_.stop();
  const { offlineSince } = await eventually(async () => {
    const work = await refund();
    assert.notEqual(work.offlineSince, null);
    return work;
  });
  assert.ok(Date.parse(offlineSince as string) >= stopped);
  const kept = await refund();
  assert.equal(kept.line?.text, "환불 붙이는 중");
  assert.deepEqual(kept.files, [{ path: "refund.ts", content: "refund.ts\n" }]);

  // 서버가 다시 떠도 떨어진 시각은 그대로다. 붙어 있던 owner의 러너는 다시 붙는다.
  await world.restartServer();
  // 꺼진 서버와의 연결이 끊긴 채 남아 있어 첫 요청이 실패할 수 있다.
  await eventually(async () => assert.equal((await refund()).offlineSince, offlineSince));
  await eventually(async () => assert.equal((await world.agents(alice)).owner, "online"));
  assert.equal((await workOf(world, "main")).offlineSince, null);

  await desk_.start();
  await eventually(async () => assert.equal((await refund()).offlineSince, null));
});

test("7일 동안 오프라인이면 그 멤버의 관측과 상태 한 줄이 지워진다", async (t) => {
  // 7일 대신 1초로 줄인다.
  const world = await startWorld({ ...FAST, forgetMs: 1000 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const desk_ = await desk(world, alice);
  t.after(desk_.remove);
  await desk_.git("switch", "--create", "refund");
  await write(desk_.folder, "refund.ts");
  await call(alice, api.setStatus, { branch: "refund", text: "환불 붙이는 중" });
  const refund = () => workOf(world, "refund", "alice");
  await eventually(async () => assert.equal((await refund()).files.length, 1));

  await desk_.stop();
  await eventually(async () => assert.notEqual((await refund()).offlineSince, null));
  await eventually(async () =>
    assert.deepEqual(
      (await world.works(world.owner)).map((work) => work.login),
      ["owner"], // 붙어 있는 멤버의 것은 남는다
    ),
  );

  // 다시 붙으면 관측은 새로 올라오지만 지워진 상태 한 줄은 돌아오지 않는다.
  await desk_.start();
  await eventually(async () =>
    assert.deepEqual((await refund()).line, { source: "files", text: "refund.ts 수정 중" }),
  );
});
