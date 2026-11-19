import assert from "node:assert/strict";
import { test } from "node:test";
import { notRunWords } from "./verdict-words.ts";

test("no sandbox uses the name of whoever ran it and adds the install link (#183)", () => {
  assert.deepEqual(notRunWords("No sandbox tool: bubblewrap", "Jieun"), {
    text: "Jieun's machine has no sandbox tool",
    help: "sandbox",
  });
});

test("the other reasons it didn't run", () => {
  assert.deepEqual(notRunWords("The repo has no check command", "Jieun"), {
    text: "The repo has no check command",
    help: "check",
  });
  assert.deepEqual(notRunWords("The check command was cut off at the time limit", "Jieun"), {
    text: "Cut off after 5 minutes · doesn't count as a pass",
  });
  assert.deepEqual(notRunWords("", "Jieun"), { text: "Couldn't run it" });
});
