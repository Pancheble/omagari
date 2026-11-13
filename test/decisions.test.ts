import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, said, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string };

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);

/**
 * owner와 alice가 같은 줄을 고쳐 직접 충돌 알림을 세우고, 그 알림의 포스트를 연다.
 * 포스트와 알림 채널("부딪힘")과 alice를 돌려준다. 결정 PR은 GitHub 쪽 일이라 알림 종류는 무엇이든 된다.
 */
async function postOf(t: { after: (fn: () => Promise<void>) => void }) {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  await writer(world.repo.folder)("src/pay.ts", text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

  world.github.grant("alice");
  world.github.names.set("alice", "Alice Kim");
  const alice = await world.login("alice");
  const desk = await world.desk(alice);
  t.after(desk.remove);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "refund");
  await desk.start();
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
  await writer(world.repo.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "owner")));
  await writer(desk.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "alice")));

  const room = await eventually(async () => {
    const found = (await call(world.owner, api.channels)).channels.find((c) => c.name === "부딪힘");
    assert.ok(found, "아직 알림 채널이 없다");
    return found.id;
  });
  const alert = await eventually(async () => {
    const { messages } = await call(world.owner, api.history, { channel: room });
    const found = messages.find((m) => m.kind === "alert");
    assert.ok(found, "아직 알림이 없다");
    return found.id;
  });
  const post = (await call(world.owner, api.openPost, { alert })).post.channel;
  return { world, alice, room, post };
}

/** 채널의 결정 PR 줄들. */
const lines = async (as: As, channel: string) =>
  (await call(as, api.history, { channel })).messages
    .filter((m) => m.kind === "decision")
    .map(said);

const DECISION = {
  title: "환불은 결제 모듈을 거친다",
  context: "환불과 결제가 같은 줄을 고친다.",
  decision: "환불은 결제 모듈의 refund를 부른다.",
  consequences: "환불 브랜치가 결제 브랜치 뒤에 머지된다.",
};

test("포스트에서 결정을 정리하면 정리한 멤버 이름으로 결정 PR이 열리고, 사람이 머지하거나 닫으면 상태가 바뀐다", async (t) => {
  const { world, alice, room, post } = await postOf(t);
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "제가 결제 쪽을 먼저 머지할게요" });
  await call(world.owner, api.send, { channel: post, text: "좋아요, 환불은 그 뒤에" });
  const web = await world.live(world.owner);

  // 아무 멤버나 정리한다. 여기서는 alice다. 창을 고르지 않으면 하루라 바로 머지하지 않는다.
  const { decision } = await call(alice, api.proposeDecision, { post, ...DECISION });
  const path = "docs/decisions/0001-환불은-결제-모듈을-거친다.md";
  assert.deepEqual(decision, {
    id: decision.id,
    post,
    login: "alice",
    name: "Alice Kim",
    title: DECISION.title,
    path,
    pull: { number: 1, url: `https://github.com/omagari-test/space/pull/1` },
    window: "day",
    state: "proposed",
    at: decision.at,
  });

  // alice의 토큰으로 main에서 딴 브랜치에 커밋 하나, main으로 PR 하나.
  const [pull] = fake.pulls;
  assert.ok(pull);
  assert.equal(pull.author, "alice");
  assert.equal(pull.base, "main");
  assert.equal(pull.open, true);
  assert.equal(pull.draft, false);
  assert.equal(pull.title, `docs(decisions): ${DECISION.title}`);
  assert.match(pull.body ?? "", /이의 창: 하루/);
  assert.deepEqual(fake.commits, [
    { branch: pull.branch, message: pull.title, author: "alice", paths: [path, "AGENTS.md"] },
  ]);
  // 결정 파일: 번호와 제목, 결정자(포스트에서 말한 멤버, 말한 순서), 출처(포스트 링크), 맥락, 결정, 결과.
  const files = fake.files.get(pull.branch);
  assert.ok(files);
  assert.equal(
    files.get(path),
    [
      `# 0001. ${DECISION.title}`,
      "",
      "- 결정자: Alice Kim (@alice), owner (@owner)",
      `- 출처: ${world.server.url}/#${post}`,
      "",
      "## 맥락",
      "",
      DECISION.context,
      "",
      "## 결정",
      "",
      DECISION.decision,
      "",
      "## 결과",
      "",
      DECISION.consequences,
      "",
    ].join("\n"),
  );
  // 레포에 AGENTS.md가 없으니 결정 폴더를 가리키는 한 줄로 만든다. main은 그대로다.
  assert.match(files.get("AGENTS.md") ?? "", /^결정 기록은 `docs\/decisions\/`에 있다\./);
  assert.deepEqual([...(fake.files.get("main")?.keys() ?? [])], []);

  // 포스트와 알림 채널에 한 줄씩. 실시간으로도 간다. 포스트의 글 수에는 들지 않는다.
  const opened = `결정 opened: ${DECISION.title}`;
  assert.deepEqual(await lines(world.owner, post), [opened]);
  assert.deepEqual(await lines(world.owner, room), [opened]);
  await eventually(() =>
    assert.deepEqual(
      web
        .messages()
        .filter((m) => m.kind === "decision")
        .map((m) => [m.channel, said(m)]),
      [
        [post, opened],
        [room, opened],
      ],
    ),
  );
  assert.equal((await call(world.owner, api.posts)).posts[0]?.count, 2);

  // 첫 결정 PR이 열린 채 두 번째를 정리하면 다음 번호다. owner가 정리해 owner의 이름이다.
  const second = (
    await call(world.owner, api.proposeDecision, {
      post,
      ...DECISION,
      title: "결제 모듈의 refund는 금액을 받는다",
    })
  ).decision;
  assert.equal(second.path, "docs/decisions/0002-결제-모듈의-refund는-금액을-받는다.md");
  assert.equal(fake.pulls[1]?.author, "owner");

  // 사람이 GitHub에서 첫 PR을 머지하고 둘째 PR을 닫는다. Omagari가 읽어 상태를 바꾸고 한 줄씩 올린다.
  fake.merge(pull);
  fake.close(fake.pulls[1] as (typeof fake.pulls)[number]);
  await eventually(async () =>
    assert.deepEqual(
      (await call(alice, api.decisions)).decisions.map((d) => [d.title, d.state]),
      [
        [DECISION.title, "accepted"],
        ["결제 모듈의 refund는 금액을 받는다", "closed"],
      ],
    ),
  );
  const after = [
    opened,
    "결정 opened: 결제 모듈의 refund는 금액을 받는다",
    `결정 merged: ${DECISION.title}`,
    "결정 closed: 결제 모듈의 refund는 금액을 받는다",
  ];
  await eventually(async () => {
    assert.deepEqual(await lines(world.owner, post), after);
    assert.deepEqual(await lines(world.owner, room), after);
  });

  // main에 결정 폴더를 가리키는 AGENTS.md가 생겼으니 다음 결정 PR은 AGENTS.md를 건드리지 않는다.
  // 닫힌 결정의 번호는 비었으니 다시 쓴다. "바로"를 고르면 열자마자 Omagari가 머지한다.
  const now = (
    await call(alice, api.proposeDecision, {
      post,
      ...DECISION,
      title: "바로 머지할 결정",
      window: "now",
    })
  ).decision;
  assert.equal(now.path, "docs/decisions/0002-바로-머지할-결정.md");
  assert.equal(now.state, "accepted");
  const third = fake.pulls[2];
  assert.ok(third);
  assert.equal(third.open, false);
  assert.ok(third.mergedAt);
  assert.deepEqual(fake.commits[2]?.paths, [now.path]);
  assert.deepEqual(
    [...(fake.files.get("main")?.keys() ?? [])].sort(),
    ["AGENTS.md", path, now.path].sort(),
  );
  assert.deepEqual((await lines(world.owner, post)).slice(-2), [
    "결정 opened: 바로 머지할 결정",
    "결정 merged: 바로 머지할 결정",
  ]);
});

test("레포의 AGENTS.md가 결정 폴더를 가리키지 않으면 한 줄을 더하고, 가리키면 건드리지 않는다", async (t) => {
  const { world, post } = await postOf(t);
  const fake = world.github;
  const main = fake.files.get("main") as Map<string, string>;
  main.set("AGENTS.md", "# 규칙\n\n테스트를 돌린다.\n");
  main.set("docs/decisions/0007-old.md", "# 0007. 예전 결정\n");

  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  assert.equal(decision.path, "docs/decisions/0008-환불은-결제-모듈을-거친다.md");
  const branch = fake.files.get(fake.pulls[0]?.branch ?? "");
  assert.equal(
    branch?.get("AGENTS.md"),
    "# 규칙\n\n테스트를 돌린다.\n\n결정 기록은 `docs/decisions/`에 있다. 일을 시작하기 전에 관련 결정을 읽는다.\n",
  );

  main.set("AGENTS.md", "결정은 docs/decisions 에 있다.\n");
  await call(world.owner, api.proposeDecision, { post, ...DECISION, title: "둘째" });
  assert.equal(
    fake.files.get(fake.pulls[1]?.branch ?? "")?.get("AGENTS.md"),
    "결정은 docs/decisions 에 있다.\n",
  );
});

test("바로 머지를 GitHub이 막으면 까닭을 포스트에 알리고, 토큰이 무효면 PR을 열지 못했다고 돌려준다", async (t) => {
  const { world, room, post } = await postOf(t);
  const fake = world.github;

  // 리뷰 필수 같은 규칙으로 막히면 결정은 제안됨으로 남고, 막힌 까닭이 포스트와 알림 채널에 한 줄로 선다.
  const reason = "HTTP 405 At least 1 approving review is required by reviewers with write access.";
  fake.block(reason);
  const { decision } = await call(world.owner, api.proposeDecision, {
    post,
    ...DECISION,
    window: "now",
  });
  assert.equal(decision.state, "proposed");
  assert.equal(fake.pulls[0]?.open, true);
  const blocked = [`결정 opened: ${DECISION.title}`, `결정 blocked: ${DECISION.title} (${reason})`];
  assert.deepEqual(await lines(world.owner, post), blocked);
  assert.deepEqual(await lines(world.owner, room), blocked);

  // 막힘이 풀린 뒤 사람이 머지하면 Omagari가 읽는다.
  fake.block();
  fake.merge(fake.pulls[0] as (typeof fake.pulls)[number]);
  await eventually(async () =>
    assert.equal((await call(world.owner, api.decisions)).decisions[0]?.state, "accepted"),
  );

  // 포스트가 아닌 채널이면 없다.
  await assert.rejects(call(world.owner, api.proposeDecision, { post: room, ...DECISION }), {
    code: "not_found",
  } satisfies Partial<ContractFailure>);

  // 정리한 멤버의 GitHub 토큰이 무효면(세션은 그대로) PR을 열지 못했다고 돌려주고 아무것도 남지 않는다.
  for (const [token, login] of fake.tokens) if (login === "owner") fake.tokens.delete(token);
  await assert.rejects(
    call(world.owner, api.proposeDecision, { post, ...DECISION, title: "열리지 않을 결정" }),
    (error: ContractFailure) => {
      assert.equal(error.code, "github_failed");
      assert.match(error.message, /owner의 GitHub 토큰으로 결정 PR을 열지 못했다: HTTP 401/);
      return true;
    },
  );
  assert.equal(fake.pulls.length, 1);
  assert.equal((await call(world.owner, api.decisions)).decisions.length, 1);
});
