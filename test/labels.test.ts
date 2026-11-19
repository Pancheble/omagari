import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("labels are the repo's GitHub labels and the team sets each label's importance: creating and editing changes GitHub, a discuss label opens an issue, and the labels of posts and issues follow each other", async (t) => {
  const world = await startWorld({ observeMs: 50, followMs: 50 });
  t.after(world.stop);
  const fake = world.github;

  // Create the default labels the repo lacks (the four kinds and Confirmed). A label made on GitHub also shows in the list on the next cycle, and a new label is reference.
  fake.createLabel("Payments", "0e8a16", "Payment module");
  await eventually(async () => {
    const { labels } = await call(world.owner, api.labels);
    assert.deepEqual(
      labels.map((l) => [l.name, l.importance]),
      [
        ["Confirmed", "discuss"],
        ["Contract change", "discuss"],
        ["Direct conflict", "reference"],
        ["Duplicate work", "reference"],
        ["Indirect conflict", "reference"],
        ["Payments", "reference"],
      ],
    );
    assert.deepEqual(sorted(fake.labels.map((l) => l.name)), [
      "Confirmed",
      "Contract change",
      "Direct conflict",
      "Duplicate work",
      "Indirect conflict",
      "Payments",
    ]);
  });
  assert.deepEqual((await call(world.owner, api.labels)).labels[5], {
    name: "Payments",
    color: "0e8a16",
    description: "Payment module",
    importance: "reference",
  });

  // A label made in Omagari is created on GitHub with the member's token. The same name (ignoring case) is rejected.
  const made = await call(world.owner, api.createLabel, {
    name: "Security review",
    color: "ff0000",
    description: "Security review",
  });
  assert.deepEqual(made.label, {
    name: "Security review",
    color: "ff0000",
    description: "Security review",
    importance: "reference",
  });
  assert.ok(fake.labels.some((l) => l.name === "Security review" && l.color === "ff0000"));
  await assert.rejects(
    call(world.owner, api.createLabel, { name: "Payments", color: "000000" }),
    (error: ContractFailure) => error.code === "conflict",
  );

  // Set up a direct-conflict post (reference).
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
    assert.ok(found, "no post yet");
    return found;
  });

  // A label put on a reference post exists only in Omagari. A label that doesn't exist can't be put on.
  const labeled = await call(alice, api.setPostLabels, {
    post: post.channel,
    labels: ["Direct conflict", "Security review"],
  });
  assert.deepEqual(labeled.post.labels, ["Direct conflict", "Security review"]);
  assert.equal(labeled.post.importance, "reference");
  await assert.rejects(
    call(alice, api.setPostLabels, {
      post: post.channel,
      labels: ["no such label"],
    }),
    (error: ContractFailure) => error.code === "not_found",
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fake.issues.length, 0);

  // Changing a label's importance to discuss makes posts with that label discuss, and opens an issue for a post's labels.
  const discussed = await call(alice, api.editLabel, {
    name: "Security review",
    next: { importance: "discuss" },
  });
  assert.equal(discussed.label.importance, "discuss");
  const issue = await eventually(() => {
    assert.equal(fake.issues.length, 1);
    return fake.issues[0];
  });
  assert.deepEqual(issue.labels, ["Direct conflict", "Security review"]);
  assert.equal((await directPost(world.owner))?.importance, "discuss");

  // Renaming or recoloring in Omagari changes the GitHub label, and the label name on the post follows. The importance stays.
  const renamed = await call(world.owner, api.editLabel, {
    name: "Security review",
    next: { name: "security", color: "000000" },
  });
  assert.deepEqual(renamed.label, {
    name: "security",
    color: "000000",
    description: "Security review",
    importance: "discuss",
  });
  assert.ok(fake.labels.some((l) => l.name === "security" && l.color === "000000"));
  assert.ok(!fake.labels.some((l) => l.name === "Security review"));
  assert.deepEqual((await directPost(world.owner))?.labels, ["Direct conflict", "security"]);

  // Adding and removing on the post changes the issue labels.
  await call(alice, api.setPostLabels, {
    post: post.channel,
    labels: ["security", "Payments"],
  });
  await eventually(() => assert.deepEqual(sorted(issue.labels), ["Payments", "security"]));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual((await directPost(world.owner))?.labels, ["security", "Payments"]);

  // Changing the issue labels on GitHub makes the post follow on the next cycle.
  issue.labels = ["security", "Direct conflict"];
  await eventually(async () =>
    assert.deepEqual(sorted((await directPost(world.owner))?.labels ?? []), [
      "Direct conflict",
      "security",
    ]),
  );

  // Renaming a label on GitHub follows as the same label (the importance stays). Even if the importance drops, the issue already opened stays.
  const security = fake.labels.find((l) => l.name === "security");
  assert.ok(security);
  security.name = "sec";
  issue.labels = issue.labels.map((l) => (l === "security" ? "sec" : l));
  await eventually(async () => {
    const { labels } = await call(world.owner, api.labels);
    assert.equal(labels.find((l) => l.name === "sec")?.importance, "discuss");
    assert.ok(!labels.some((l) => l.name === "security"));
    assert.deepEqual(sorted((await directPost(world.owner))?.labels ?? []), [
      "Direct conflict",
      "sec",
    ]);
  });
  await call(alice, api.editLabel, {
    name: "sec",
    next: { importance: "reference" },
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const now = await directPost(world.owner);
  assert.equal(now?.importance, "reference");
  assert.equal(now?.issue?.open, true);
  assert.equal(fake.issues.length, 1);
});

test("Korean default labels from before ADR-0045 are renamed to English on GitHub and in Omagari, and their posts and issues keep them", async (t) => {
  const world = await startWorld({
    followMs: 50,
    seed: await readFile(new URL("./contract47.sql", import.meta.url), "utf8"),
    setup: (fake) => {
      for (const name of ["직접 충돌", "확인됨", "중복 구현", "Duplicate work"])
        fake.createLabel(name);
      fake.issues.push({
        number: 101,
        title: "pay.ts",
        body: "",
        labels: ["직접 충돌", "확인됨"],
        open: true,
        author: "alice",
        comments: [],
      });
    },
  });
  t.after(world.stop);
  const fake = world.github;

  await eventually(async () => {
    assert.deepEqual(sorted(fake.labels.map((l) => l.name)), [
      "Confirmed",
      "Contract change",
      "Direct conflict",
      "Duplicate work",
      "Indirect conflict",
      "중복 구현",
    ]);
    // The post keeps its label and the importance the team set on the Korean one.
    assert.deepEqual(
      (await call(world.owner, api.posts)).posts.map((p) => [p.channel, p.labels, p.importance]),
      [["p1", ["Direct conflict"], "discuss"]],
    );
  });
  // A rename keeps the label on issues. The English "Duplicate work" was already there, so the Korean one stays a plain label.
  assert.deepEqual(fake.issues[0]?.labels, ["Direct conflict", "Confirmed"]);
  const { labels } = await call(world.owner, api.labels);
  assert.deepEqual(
    labels.map((l) => [l.name, l.importance]),
    [
      ["Confirmed", "discuss"],
      ["Contract change", "discuss"],
      ["Direct conflict", "discuss"],
      ["Duplicate work", "reference"],
      ["Indirect conflict", "reference"],
      ["중복 구현", "reference"],
    ],
  );
});
