import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);

/** Sets up one direct-conflict post by two works editing the same line of src/pay.ts, and returns its labels. */
async function directLabels(labeler: string | undefined, branchLabeler?: string) {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  const fake = world.github;
  try {
    if (labeler !== undefined) fake.files.get("main")?.set(".github/labeler.yml", labeler);
    // A labeler.yml from a branch that isn't the default branch isn't used.
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
      assert.ok(found, "no post yet");
      return found;
    });
    await desk.remove();
    return post.labels;
  } finally {
    await world.stop();
  }
}

test("team labels matching labeler.yml's path rules are attached to a direct-conflict post along with the kind label", async () => {
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
  assert.deepEqual(labels, ["Direct conflict", "backend"]);
});

test("with no labeler.yml or one of the wrong shape, only the kind label is attached and the server doesn't stop", async () => {
  assert.deepEqual(await directLabels(undefined), ["Direct conflict"]);
  assert.deepEqual(await directLabels("- wrong\n- shape"), ["Direct conflict"]);
});

test("even if labeler.yml takes long to process, it doesn't hold up the server, and is read without that glob", {
  timeout: 60_000,
}, async () => {
  const braces = Array.from({ length: 24 }, () => "{a,b}").join("");
  const labels = await directLabels(
    text([
      "backend:",
      "  - changed-files:",
      "    - any-glob-to-any-file: 'src/**'",
      "web:",
      "  - changed-files:",
      `    - any-glob-to-any-file: 'src/${braces}x'`,
      `note: ${" ".repeat(60_000)}a\u2028b`,
    ]),
  );
  assert.deepEqual(labels, ["Direct conflict", "backend"]);
  // A file that's too long isn't read.
  const long = text([
    "backend:",
    "  - changed-files:",
    "    - any-glob-to-any-file: 'src/**'",
    `#${"x".repeat(64 * 1024)}`,
  ]);
  assert.deepEqual(await directLabels(long), ["Direct conflict"]);
});

test("for indirect conflicts and duplicate implementations, team labels matching the file with the symbol are attached", async (t) => {
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
  // owner changes refund's definition line (alice uses it in checkout.ts), and two works make a new function split of the same name in different files.
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
