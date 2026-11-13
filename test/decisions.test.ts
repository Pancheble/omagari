import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, said, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string };

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);

/**
 * owner와 alice가 같은 줄을 고쳐 직접 충돌 알림을 세우고, 그 알림의 포스트를 연다.
 * 포스트와 알림 채널("부딪힘")과 alice를 돌려준다. 결정 PR은 GitHub 쪽 일이라 알림 종류는 무엇이든 된다.
 */
async function postOf(t: { after: (fn: () => Promise<void>) => void }, hourMs?: number) {
  const world = await startWorld({ observeMs: 50, followMs: 50, hourMs });
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
    status: "proposed",
    closes: decision.closes,
    deciders: [
      { login: "alice", name: "Alice Kim", agreed: true },
      { login: "owner", name: "owner", agreed: false },
    ],
    objections: [],
    early: false,
    at: decision.at,
  });
  // 창은 정리한 때부터 하루다.
  assert.equal(Date.parse(decision.closes ?? "") - Date.parse(decision.at), 24 * 3_600_000);

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

  // 포스트에 한 줄. 부딪힘 포럼에는 올리지 않는다(ADR-0027). 실시간으로도 간다. 포스트의 글 수에는 들지 않는다.
  const opened = `결정 opened: ${DECISION.title}`;
  assert.deepEqual(await lines(world.owner, post), [opened]);
  assert.deepEqual(await lines(world.owner, room), []);
  await eventually(() =>
    assert.deepEqual(
      web
        .messages()
        .filter((m) => m.kind === "decision")
        .map((m) => [m.channel, said(m)]),
      [[post, opened]],
    ),
  );
  const [summary] = (await call(world.owner, api.posts)).posts;
  assert.equal(summary?.count, 2);
  assert.equal(summary?.last?.line, "좋아요, 환불은 그 뒤에");

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
    assert.deepEqual(await lines(world.owner, room), []);
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

  // 리뷰 필수 같은 규칙으로 막히면 결정은 제안됨으로 남고, 막힌 까닭이 포스트에 한 줄로 선다. 주기마다 다시 해 봐도 줄은 하나다.
  const reason = "HTTP 405 At least 1 approving review is required by reviewers with write access.";
  fake.block(reason);
  const { decision } = await call(world.owner, api.proposeDecision, {
    post,
    ...DECISION,
    window: "now",
  });
  assert.equal(decision.state, "proposed");
  assert.equal(decision.status, "blocked");
  assert.equal(decision.reason, reason);
  assert.equal(fake.pulls[0]?.open, true);
  const blocked = [`결정 opened: ${DECISION.title}`, `결정 blocked: ${DECISION.title} (${reason})`];
  assert.deepEqual(await lines(world.owner, post), blocked);
  assert.deepEqual(await lines(world.owner, room), []);
  await sleep(200);
  assert.deepEqual(await lines(world.owner, post), blocked);

  // 막힘이 풀리면 다음 주기에 Omagari가 머지한다.
  fake.block();
  await eventually(async () =>
    assert.equal((await call(world.owner, api.decisions)).decisions[0]?.state, "accepted"),
  );
  assert.ok(fake.pulls[0]?.mergedAt);

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

/** 포스트의 결정 PR 줄을 일어난 일과 한 사람으로. */
const events = async (as: As, channel: string) =>
  (await call(as, api.history, { channel })).messages.flatMap((m) =>
    m.kind === "decision" ? [`${m.decision.title} ${m.event}${m.by ? ` ${m.by.login}` : ""}`] : [],
  );

/** 포스트에서 말하지 않은 멤버 bob. 결정자가 아니다. */
async function bobOf(world: Awaited<ReturnType<typeof postOf>>["world"]) {
  world.github.grant("bob");
  return world.login("bob");
}

const decisionNamed = async (as: As, title: string) => {
  const found = (await call(as, api.decisions)).decisions.find((d) => d.title === title);
  assert.ok(found, `결정이 없다: ${title}`);
  return found;
};

test("고른 길이대로 창이 닫히고 이의가 없으면 Omagari가 머지한다", async (t) => {
  // 한 시간을 50ms로 줄인다: 1시간 50ms, 직접 3시간 150ms, 하루 1.2초, 3일 3.6초.
  const HOUR = 50;
  const { world, alice, post } = await postOf(t, HOUR);
  await call(alice, api.send, { channel: post, text: "결제 쪽을 먼저 머지할게요" });
  const windows = [
    ["1시간", "hour", 1],
    ["직접 3시간", { amount: 3, unit: "hour" }, 3],
    ["하루", "day", 24],
    ["3일", "three_days", 72],
  ] as const;
  for (const [title, window, hours] of windows) {
    const { decision } = await call(world.owner, api.proposeDecision, {
      post,
      ...DECISION,
      title,
      window,
    });
    assert.deepEqual(decision.window, window);
    assert.equal(Date.parse(decision.closes ?? "") - Date.parse(decision.at), hours * HOUR);
    assert.match(
      world.github.pulls.at(-1)?.body ?? "",
      new RegExp(`이의 창: ${title.replace("직접 ", "")}`),
    );
  }
  for (const [title, , hours] of windows) {
    const decision = await eventually(async () => {
      const found = await decisionNamed(world.owner, title);
      assert.equal(found.status, "accepted");
      return found;
    }, 20_000);
    assert.equal(decision.early, false);
    assert.equal(decision.closes, null);
    // 창이 닫히기 전에는 머지하지 않았다.
    const pull = world.github.pulls.find((p) => p.number === decision.pull.number);
    assert.ok(Date.parse(pull?.mergedAt ?? "") >= Date.parse(decision.at) + hours * HOUR);
    assert.ok((await events(world.owner, post)).includes(`${title} merged`));
  }
});

test("이의(포스트와 GitHub 변경 요청)가 걸리면 창이 닫혀도 머지하지 않고, 모두 거둬지면 같은 길이로 다시 연다", async (t) => {
  const HOUR = 50; // 하루 1.2초
  const { world, alice, post } = await postOf(t, HOUR);
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "결제 쪽을 먼저 머지할게요" });
  const bob = await bobOf(world);
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });

  // 결정자가 아닌 bob도 이의를 낸다. 걸려 있는 동안 창은 없다.
  const objected = (await call(bob, api.respondToDecision, { id: decision.id, response: "object" }))
    .decision;
  assert.equal(objected.status, "objected");
  assert.equal(objected.closes, null);
  assert.deepEqual(
    objected.objections.map((o) => [o.login, o.via]),
    [["bob", "post"]],
  );
  // 같은 이의를 또 내도 그대로다.
  await call(bob, api.respondToDecision, { id: decision.id, response: "object" });

  // 남의 이의는 거두지 못한다.
  await assert.rejects(
    call(alice, api.respondToDecision, { id: decision.id, response: "withdraw" }),
    { code: "not_found" } satisfies Partial<ContractFailure>,
  );

  // GitHub에서 carol이 변경을 요청한다. 주기마다 읽어 이의로 센다.
  fake.review(decision.pull.number, "carol", "CHANGES_REQUESTED");
  await eventually(async () =>
    assert.deepEqual(
      (await decisionNamed(world.owner, DECISION.title)).objections.map((o) => [o.login, o.via]),
      [
        ["bob", "post"],
        ["carol", "github"],
      ],
    ),
  );

  // 하루(1.2초)가 지나도 머지하지 않는다.
  await sleep(24 * HOUR + 300);
  assert.equal((await decisionNamed(world.owner, DECISION.title)).state, "proposed");
  assert.equal(fake.pulls[0]?.open, true);

  // bob이 거둬도 carol의 것이 남아 아직 걸려 있다.
  const one = (await call(bob, api.respondToDecision, { id: decision.id, response: "withdraw" }))
    .decision;
  assert.equal(one.status, "objected");

  // carol이 변경 요청을 승인으로 바꾸면 모두 거둬져 창이 처음부터 같은 길이(하루)로 다시 열린다.
  const before = Date.now();
  fake.review(decision.pull.number, "carol", "APPROVED");
  const reopened = await eventually(async () => {
    const found = await decisionNamed(world.owner, DECISION.title);
    assert.equal(found.status, "reopened");
    return found;
  });
  assert.ok(Date.parse(reopened.closes ?? "") >= before + 24 * HOUR);
  assert.deepEqual(reopened.objections, []);
  const merged = await eventually(async () => {
    const found = await decisionNamed(world.owner, DECISION.title);
    assert.equal(found.status, "accepted");
    return found;
  }, 10_000);
  assert.equal(merged.early, false);
  assert.ok(Date.parse(fake.pulls[0]?.mergedAt ?? "") >= Date.parse(reopened.closes ?? ""));
  assert.deepEqual(await events(world.owner, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} objected bob`,
    `${DECISION.title} objected carol`,
    `${DECISION.title} withdrawn bob`,
    `${DECISION.title} withdrawn carol`,
    `${DECISION.title} merged`,
  ]);
});

test("결정자가 모두 동의하면 창이 남아도 바로 머지하지만, 이의가 걸려 있거나 GitHub이 막으면 머지하지 않는다", async (t) => {
  const { world, alice, post } = await postOf(t); // 창은 정말 하루다
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "결제 쪽을 먼저 머지할게요" });
  const bob = await bobOf(world);
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  assert.deepEqual(
    decision.deciders.map((d) => [d.login, d.agreed]),
    [
      ["alice", false],
      ["owner", true],
    ],
  );

  // 결정자가 아닌 bob의 동의는 거절된다.
  await assert.rejects(call(bob, api.respondToDecision, { id: decision.id, response: "agree" }), {
    code: "forbidden",
  } satisfies Partial<ContractFailure>);

  // bob의 이의가 걸려 있으면 alice가 동의해 모두 동의해도 머지하지 않는다.
  await call(bob, api.respondToDecision, { id: decision.id, response: "object" });
  const agreed = (await call(alice, api.respondToDecision, { id: decision.id, response: "agree" }))
    .decision;
  assert.equal(agreed.state, "proposed");
  assert.equal(agreed.status, "objected");
  assert.equal(
    agreed.deciders.every((d) => d.agreed),
    true,
  );
  assert.equal(fake.pulls[0]?.open, true);

  // 거두면 창이 다시 열리고, 모두 동의했으니 바로 머지한다. 일찍 닫았다고 보인다.
  const merged = (await call(bob, api.respondToDecision, { id: decision.id, response: "withdraw" }))
    .decision;
  assert.equal(merged.status, "accepted");
  assert.equal(merged.early, true);
  assert.ok(fake.pulls[0]?.mergedAt);
  assert.deepEqual(await events(world.owner, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} objected bob`,
    `${DECISION.title} agreed alice`,
    `${DECISION.title} withdrawn bob`,
    `${DECISION.title} merged`,
  ]);
  // 끝난 결정에는 더 응답하지 못한다.
  await assert.rejects(call(bob, api.respondToDecision, { id: decision.id, response: "object" }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);

  // 모두 동의해도 GitHub이 막으면 "머지 막힘"이다. 풀리면 머지한다.
  const reason = "HTTP 405 At least 1 approving review is required by reviewers with write access.";
  fake.block(reason);
  const second = (
    await call(world.owner, api.proposeDecision, { post, ...DECISION, title: "둘째 결정" })
  ).decision;
  const blocked = (await call(alice, api.respondToDecision, { id: second.id, response: "agree" }))
    .decision;
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason, reason);
  assert.ok(blocked.closes);
  fake.block();
  const done = await eventually(async () => {
    const found = await decisionNamed(world.owner, "둘째 결정");
    assert.equal(found.status, "accepted");
    return found;
  });
  assert.equal(done.early, true);
  assert.deepEqual((await events(world.owner, post)).slice(-4), [
    "둘째 결정 opened",
    "둘째 결정 agreed alice",
    "둘째 결정 blocked",
    "둘째 결정 merged",
  ]);
});

test("정리한 사람만 결정을 고쳐 같은 PR에 커밋을 더하거나 버려 PR을 닫는다", async (t) => {
  const { world, alice, post } = await postOf(t);
  const fake = world.github;
  const bob = await bobOf(world);
  await call(alice, api.send, { channel: post, text: "결제 쪽을 먼저 머지할게요" });
  await call(bob, api.send, { channel: post, text: "저도 봤어요" });
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  await call(alice, api.respondToDecision, { id: decision.id, response: "agree" });

  // 정리한 사람이 아니면 고치지도 버리지도 못한다.
  const revision = { ...DECISION, decision: "환불은 결제 모듈의 refund(amount)를 부른다." };
  await assert.rejects(call(alice, api.reviseDecision, { id: decision.id, ...revision }), {
    code: "forbidden",
  } satisfies Partial<ContractFailure>);
  await assert.rejects(call(alice, api.discardDecision, { id: decision.id }), {
    code: "forbidden",
  } satisfies Partial<ContractFailure>);

  // 고치면 같은 브랜치에 커밋이 더해진다. 다른 결정자의 동의는 지워지고 창은 다시 하루다.
  const pull = fake.pulls[0];
  assert.ok(pull);
  const before = Date.now();
  const revised = (await call(world.owner, api.reviseDecision, { id: decision.id, ...revision }))
    .decision;
  assert.equal(fake.pulls.length, 1);
  assert.deepEqual(
    fake.commits.map((c) => [c.branch, c.author]),
    [
      [pull.branch, "owner"],
      [pull.branch, "owner"],
    ],
  );
  assert.deepEqual(fake.commits[1]?.paths, [decision.path]);
  assert.match(fake.files.get(pull.branch)?.get(decision.path) ?? "", /refund\(amount\)/);
  assert.deepEqual(
    revised.deciders.map((d) => [d.login, d.agreed]),
    [
      ["alice", false],
      ["bob", false],
      ["owner", true],
    ],
  );
  assert.ok(Date.parse(revised.closes ?? "") >= before + 24 * 3_600_000);

  // 버리면 PR이 닫히고 결정은 기본 브랜치에 남지 않는다.
  const closed = (await call(world.owner, api.discardDecision, { id: decision.id })).decision;
  assert.equal(closed.status, "closed");
  assert.equal(closed.closes, null);
  assert.equal(pull.open, false);
  assert.equal(pull.mergedAt, undefined);
  assert.equal(fake.files.get("main")?.has(decision.path), false);
  assert.deepEqual(await events(world.owner, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} agreed alice`,
    `${DECISION.title} revised owner`,
    `${DECISION.title} closed owner`,
  ]);
  await assert.rejects(call(world.owner, api.discardDecision, { id: decision.id }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);
});

test("정리한 사람의 토큰이 무효면 머지가 멈추고 알리며, 다시 로그인하면 이어 간다", async (t) => {
  const HOUR = 20; // 하루 480ms
  const { world, alice, post } = await postOf(t, HOUR);
  const fake = world.github;
  await call(alice, api.send, { channel: post, text: "결제 쪽을 먼저 머지할게요" });
  const { decision } = await call(world.owner, api.proposeDecision, { post, ...DECISION });
  // owner의 세션은 그대로 두고 GitHub 토큰만 무효로 한다.
  for (const [token, login] of fake.tokens) if (login === "owner") fake.tokens.delete(token);

  const stalled = await eventually(async () => {
    const found = await decisionNamed(alice, DECISION.title);
    assert.equal(found.status, "stalled");
    return found;
  });
  assert.match(stalled.reason ?? "", /^HTTP 401/);
  assert.equal(fake.pulls[0]?.open, true);
  // 주기마다 다시 해 봐도 줄은 하나다.
  await sleep(300);
  assert.deepEqual(await events(alice, post), [
    `${DECISION.title} opened`,
    `${DECISION.title} stalled`,
  ]);

  // owner가 다시 로그인하면 새 토큰으로 머지한다.
  await world.login("owner");
  const merged = await eventually(async () => {
    const found = await decisionNamed(alice, DECISION.title);
    assert.equal(found.status, "accepted");
    return found;
  });
  assert.equal(merged.id, decision.id);
  assert.equal(merged.early, false);
  assert.ok(fake.pulls[0]?.mergedAt);
});
