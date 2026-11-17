import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);

/** src/pay.ts를 두 작업이 같은 줄에서 고쳐 직접 충돌 포스트 하나를 세우고 그 라벨을 돌려준다. */
async function directLabels(labeler: string | undefined, branchLabeler?: string) {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  const fake = world.github;
  try {
    if (labeler !== undefined) fake.files.get("main")?.set(".github/labeler.yml", labeler);
    // 기본 브랜치가 아닌 판의 labeler.yml은 쓰지 않는다.
    if (branchLabeler !== undefined)
      fake.files.set("other", new Map([[".github/labeler.yml", branchLabeler]]));
    fake.createLabel("backend");
    fake.createLabel("docs");
    fake.createLabel("web");
    fake.createLabel("other");
    await eventually(async () =>
      assert.ok((await call(world.owner, api.labels)).labels.some((l) => l.name === "other")),
    );
    await writer(world.repo.folder)("src/pay.ts", text(BASE));
    await world.repo.git("add", ".");
    await world.repo.git("commit", "--message=base");
    await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
    fake.grant("alice");
    const alice = await world.login("alice");
    const desk = await world.desk(alice);
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
      const found = (await call(world.owner, api.posts)).posts.find(
        (p) => p.message.kind === "alert" && p.message.alert.kind === "direct",
      );
      assert.ok(found, "아직 포스트가 없다");
      return found;
    });
    await desk.remove();
    return post.labels;
  } finally {
    await world.stop();
  }
}

test("labeler.yml의 경로 규칙에 맞는 팀 라벨이 직접 충돌 포스트에 종류 라벨과 함께 붙는다", async () => {
  const labels = await directLabels(
    text([
      "backend:",
      "  - changed-files:",
      "    - any-glob-to-any-file: 'src/**'",
      "docs:",
      "  - changed-files:",
      "    - any-glob-to-any-file: 'docs/**'",
      "web:",
      "  - head-branch: ['^payment']",
    ]),
    text(["other:", "  - changed-files:", "    - any-glob-to-any-file: 'src/**'"]),
  );
  assert.deepEqual(labels, ["직접 충돌", "backend"]);
});

test("labeler.yml이 없거나 틀린 꼴이면 종류 라벨만 붙고 서버는 멈추지 않는다", async () => {
  assert.deepEqual(await directLabels(undefined), ["직접 충돌"]);
  assert.deepEqual(await directLabels("- 틀린\n- 꼴"), ["직접 충돌"]);
});

test("간접 충돌과 중복 구현은 심볼이 있는 파일에 맞는 팀 라벨이 붙는다", async (t) => {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  const fake = world.github;
  fake.files
    .get("main")
    ?.set(
      ".github/labeler.yml",
      text([
        "checkout:",
        "  - changed-files:",
        "    - any-glob-to-any-file: 'src/checkout.ts'",
        "money:",
        "  - changed-files:",
        "    - any-glob-to-any-file: 'src/money.ts'",
      ]),
    );
  fake.createLabel("checkout");
  fake.createLabel("money");
  await eventually(async () =>
    assert.ok((await call(world.owner, api.labels)).labels.some((l) => l.name === "money")),
  );
  const PAY =
    "export function pay(a: number) {\n  return a;\n}\nexport function refund(a: number) {\n  return -a;\n}\n";
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)(
    "src/checkout.ts",
    'import { pay, refund } from "./pay";\nexport const total = pay(1) + refund(2);\n',
  );
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
  // owner가 refund의 정의 줄을 바꾸고(alice는 checkout.ts에서 쓴다), 두 작업이 같은 이름의 새 함수 split을 다른 파일에 만든다.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("refund(a: number)", "refund(a: number, why: string)"),
  );
  await writer(desk.folder)(
    "src/split.ts",
    "export function split(n: number) {\n  return [n];\n}\n",
  );
  await writer(world.repo.folder)("src/money.ts", "export const split = (t: number) => [t];\n");
  const labelsOf = async (kind: string) =>
    (await call(world.owner, api.posts)).posts.find(
      (p) => p.message.kind === "alert" && p.message.alert.kind === kind,
    )?.labels;
  await eventually(async () => {
    assert.deepEqual((await labelsOf("indirect"))?.slice(1), ["checkout"]);
    assert.deepEqual((await labelsOf("duplicate"))?.slice(1), ["money"]);
  });
});
