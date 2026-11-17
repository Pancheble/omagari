import assert from "node:assert/strict";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);
type As = { url: string; session: string };
const directPost = async (as: As) =>
  (await call(as, api.posts)).posts.find(
    (post) => post.message.kind === "alert" && post.message.alert.kind === "direct",
  );
const sorted = (names: string[]) => [...names].sort();

test("라벨은 레포의 GitHub 라벨이고 팀이 라벨마다 중요도를 정한다: 만들고 고치면 GitHub이 바뀌고, 논의가 되면 이슈가 열리고, 포스트와 이슈의 라벨이 서로 따라간다", async (t) => {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  const fake = world.github;

  // 레포에 없는 기본 라벨(종류 넷과 확인됨)을 만든다. GitHub에서 만든 라벨도 다음 주기에 목록에 보이고, 새 라벨은 참고다.
  fake.createLabel("결제", "0e8a16", "결제 모듈");
  await eventually(async () => {
    const { labels } = await call(world.owner, api.labels);
    assert.deepEqual(
      labels.map((l) => [l.name, l.importance]),
      [
        ["간접 충돌", "reference"],
        ["결제", "reference"],
        ["계약 변경", "discuss"],
        ["중복 구현", "reference"],
        ["직접 충돌", "reference"],
        ["확인됨", "discuss"],
      ],
    );
    assert.deepEqual(sorted(fake.labels.map((l) => l.name)), [
      "간접 충돌",
      "결제",
      "계약 변경",
      "중복 구현",
      "직접 충돌",
      "확인됨",
    ]);
  });
  assert.deepEqual((await call(world.owner, api.labels)).labels[1], {
    name: "결제",
    color: "0e8a16",
    description: "결제 모듈",
    importance: "reference",
  });

  // Omagari에서 만든 라벨은 멤버의 토큰으로 GitHub에 만들어진다. 같은 이름(대소문자 무시)은 거절한다.
  const made = await call(world.owner, api.createLabel, {
    name: "보안",
    color: "ff0000",
    description: "보안 검토",
  });
  assert.deepEqual(made.label, {
    name: "보안",
    color: "ff0000",
    description: "보안 검토",
    importance: "reference",
  });
  assert.ok(fake.labels.some((l) => l.name === "보안" && l.color === "ff0000"));
  await assert.rejects(
    call(world.owner, api.createLabel, { name: "결제", color: "000000" }),
    (error: ContractFailure) => error.code === "conflict",
  );

  // 직접 충돌 포스트를 세운다(참고).
  await writer(world.repo.folder)("src/pay.ts", text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
  fake.grant("alice");
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
  const post = await eventually(async () => {
    const found = await directPost(world.owner);
    assert.ok(found, "아직 포스트가 없다");
    return found;
  });

  // 참고 포스트에 붙인 라벨은 Omagari에만 있다. 없는 라벨은 붙이지 못한다.
  const labeled = await call(alice, api.setPostLabels, {
    post: post.channel,
    labels: ["직접 충돌", "보안"],
  });
  assert.deepEqual(labeled.post.labels, ["직접 충돌", "보안"]);
  assert.equal(labeled.post.importance, "reference");
  await assert.rejects(
    call(alice, api.setPostLabels, { post: post.channel, labels: ["없는 라벨"] }),
    (error: ContractFailure) => error.code === "not_found",
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fake.issues.length, 0);

  // 라벨의 중요도를 논의로 바꾸면 그 라벨을 단 포스트가 논의가 되고, 포스트의 라벨을 단 이슈가 열린다.
  const discussed = await call(alice, api.editLabel, {
    name: "보안",
    next: { importance: "discuss" },
  });
  assert.equal(discussed.label.importance, "discuss");
  const issue = await eventually(() => {
    assert.equal(fake.issues.length, 1);
    return fake.issues[0];
  });
  assert.deepEqual(issue.labels, ["직접 충돌", "보안"]);
  assert.equal((await directPost(world.owner))?.importance, "discuss");

  // Omagari에서 이름과 색을 고치면 GitHub 라벨이 바뀌고, 포스트의 라벨 이름도 따라 바뀐다. 중요도는 남는다.
  const renamed = await call(world.owner, api.editLabel, {
    name: "보안",
    next: { name: "security", color: "000000" },
  });
  assert.deepEqual(renamed.label, {
    name: "security",
    color: "000000",
    description: "보안 검토",
    importance: "discuss",
  });
  assert.ok(fake.labels.some((l) => l.name === "security" && l.color === "000000"));
  assert.ok(!fake.labels.some((l) => l.name === "보안"));
  assert.deepEqual((await directPost(world.owner))?.labels, ["직접 충돌", "security"]);

  // 포스트에서 붙이고 떼면 이슈 라벨이 바뀐다.
  await call(alice, api.setPostLabels, { post: post.channel, labels: ["security", "결제"] });
  await eventually(() => assert.deepEqual(sorted(issue.labels), ["security", "결제"]));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual((await directPost(world.owner))?.labels, ["security", "결제"]);

  // GitHub에서 이슈 라벨을 바꾸면 다음 주기에 포스트가 따라간다.
  issue.labels = ["security", "직접 충돌"];
  await eventually(async () =>
    assert.deepEqual(sorted((await directPost(world.owner))?.labels ?? []), [
      "security",
      "직접 충돌",
    ]),
  );

  // GitHub에서 라벨 이름을 바꾸면 같은 라벨로 따라간다(중요도가 남는다). 중요도가 내려가도 연 이슈는 그대로다.
  const security = fake.labels.find((l) => l.name === "security");
  assert.ok(security);
  security.name = "sec";
  issue.labels = issue.labels.map((l) => (l === "security" ? "sec" : l));
  await eventually(async () => {
    const { labels } = await call(world.owner, api.labels);
    assert.equal(labels.find((l) => l.name === "sec")?.importance, "discuss");
    assert.ok(!labels.some((l) => l.name === "security"));
    assert.deepEqual(sorted((await directPost(world.owner))?.labels ?? []), ["sec", "직접 충돌"]);
  });
  await call(alice, api.editLabel, { name: "sec", next: { importance: "reference" } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const now = await directPost(world.owner);
  assert.equal(now?.importance, "reference");
  assert.equal(now?.issue?.open, true);
  assert.equal(fake.issues.length, 1);
});
