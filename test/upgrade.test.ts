import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, said, startWorld } from "./harness.ts";

test("boots from a DB made by v0.1.0, reads old messages as they were, and posts a Q&A with text", async (t) => {
  const world = await startWorld({
    executor: fakeExecutor().executor,
    seed: await readFile(new URL("./v0.1.0.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");

  // The old post and the old Q&A posted without text are unchanged.
  const before = (await call(alice, api.history, { channel: "c0" })).messages;
  assert.deepEqual(before.map(said), ["예전 글", "QA: 예전에 올린 질문"]);
  assert.equal("text" in (before[1] ?? {}), false);

  const qa = await world.settled(world.owner, await world.ask(world.owner, "c0", "New question"));
  const { message } = await call(world.owner, api.postQa, {
    qa: qa.id,
    text: "Please take a look together",
  });
  assert.equal(message.kind === "qa" && message.text, "Please take a look together");
  assert.deepEqual((await call(alice, api.history, { channel: "c0" })).messages, [
    ...before,
    message,
  ]);
  // Also use the emoji of a status message added after that version.
  assert.deepEqual(
    await call(alice, api.setStatusMessage, { message: "In a meeting", emoji: "📅" }),
    {
      message: "In a meeting",
      emoji: "📅",
    },
  );

  // It stays the same after another restart (the already-fixed DB). The first request may fail because the connection to the stopped server is left broken.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual((await call(alice, api.history, { channel: "c0" })).messages.at(-1), message),
  );
});

test("posts in a DB without labels get a kind label and Confirmed, an already open issue is not closed when it becomes reference, and the conflict forum becomes the discuss forum", async (t) => {
  const world = await startWorld({
    followMs: 50,
    seed: await readFile(new URL("./contract32.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  for (const [number, title, labels] of [
    [101, "pay.ts direct conflict", ["직접 충돌"]],
    [102, "pay indirect conflict", ["간접 충돌", "확인됨"]],
  ] as const)
    world.github.issues.push({
      number,
      title,
      body: "",
      labels: [...labels],
      open: true,
      author: "alice",
      comments: [],
    });

  const { posts } = await call(world.owner, api.posts);
  assert.deepEqual(
    posts.map((post) => [post.labels, post.importance]),
    [
      [["Direct conflict"], "reference"],
      [["Indirect conflict", "Confirmed"], "discuss"],
    ],
  );
  // Even if issue syncing runs several times, the issue of a reference post stays open.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(
    world.github.issues.map((issue) => [issue.number, issue.open, issue.labels]),
    [
      [101, true, ["Direct conflict"]],
      [102, true, ["Indirect conflict", "Confirmed"]],
    ],
  );
  assert.deepEqual(
    (await call(world.owner, api.posts)).posts.map((post) => post.issue?.open),
    [true, true],
  );
  // The old "conflict" forum (f0) becomes the "Discuss" forum, which filters by "discuss", and a "FYI" forum is created (ADR-0039). Posts are shown by importance.
  const { channels } = await call(world.owner, api.channels);
  const reference = channels.find((c) => c.name === "FYI");
  assert.deepEqual(channels, [
    { id: "f0", name: "Discuss", kind: "forum", filter: { importance: "discuss" } },
    { id: reference?.id, name: "FYI", kind: "forum", filter: { importance: "reference" } },
  ]);
  assert.deepEqual(
    (await call(world.owner, api.posts)).posts.map((post) => post.forums),
    [[reference?.id], ["f0"]],
  );
  assert.equal("alertChannel" in (await call(world.owner, api.settings)), false);
});
