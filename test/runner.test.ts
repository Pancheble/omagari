import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeExecutor, startWorld } from "./harness.ts";

test("asking from the terminal gets an answer from the runner session, and the next question continues in the same session", async (t) => {
  const fake = fakeExecutor((input) => `Answer: ${input.message}`);
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.deepEqual(await world.cli("runner", "ask", "What does this repo do?"), {
    code: 0,
    stdout: "Answer: What does this repo do?\n",
    stderr: "",
  });
  assert.equal(
    (await world.cli("runner", "ask", "Where are", "the tests?")).stdout,
    "Answer: Where are the tests?\n",
  );

  assert.deepEqual(
    fake.calls.map((call) => call.resume),
    [undefined, "session-1"],
  );
  for (const call of fake.calls) {
    // Read-only: no tool writes files or runs commands.
    assert.deepEqual(call.tools, ["Read", "Grep", "Glob"]);
    assert.equal(call.folder, world.repo.folder);
  }
});

test("when the executor fails or ends without an answer an error comes back, and the runner keeps answering in the same session", async (t) => {
  const fake = fakeExecutor((input) => {
    if (input.message === "Die") throw new Error("The executor died");
    return input.message === "Stay quiet" ? " \n" : "Answer";
  });
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.equal((await world.cli("runner", "ask", "First")).code, 0);

  const died = await world.cli("runner", "ask", "Die");
  assert.equal(died.code, 1);
  assert.match(died.stderr, /The executor died/);

  const silent = await world.cli("runner", "ask", "Stay quiet");
  assert.equal(silent.code, 1);
  assert.match(silent.stderr, /The executor finished without an answer/);

  assert.deepEqual(await world.cli("runner", "ask", "Again"), {
    code: 0,
    stdout: "Answer\n",
    stderr: "",
  });
  assert.equal(fake.calls.at(-1)?.resume, "session-1");
});

test("what the runner ran (when, in which session, what it received) stays on the owner's device and the owner sees it", async (t) => {
  const fake = fakeExecutor((input) => {
    if (input.message === "Die") throw new Error("The executor died");
    return "Answer";
  });
  const world = await startWorld({ executor: fake.executor });
  t.after(world.stop);

  assert.match((await world.cli("runner", "log")).stdout, /hasn't run anything yet/);
  await world.cli("runner", "ask", "First question");
  await world.cli("runner", "ask", "Die");

  const { code, stdout } = await world.cli("runner", "log");
  assert.equal(code, 0);
  const [first, second, ...more] = stdout.trimEnd().split("\n");
  assert.deepEqual(more, []);
  assert.match(
    first,
    /^\d{4}-\d\d-\d\dT\S+ {2}session session-1 {2}tools Read,Grep,Glob {2}received "First question" {2}answered "Answer"$/,
  );
  assert.match(second, /session session-1 .*received "Die" {2}failed: The executor died$/);
});
