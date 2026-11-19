import assert from "node:assert/strict";
import { test } from "node:test";
import type { Channel } from "@omagari/contract";
import { ALL, placeIn, placeOf } from "./places.ts";

const chat = (repo?: string) => ({ id: "c", name: "c", kind: "chat", repo }) as Channel;
const forum = (repos?: string[]) =>
  ({ id: "f", name: "f", kind: "forum", filter: { importance: "discuss", repos } }) as Channel;

test("with two or more repos, repo channels and one-repo forums sit in that repo and the rest sit in All", () => {
  const repos = ["a/one", "a/two"];
  assert.equal(placeOf(chat("a/two"), repos), "a/two");
  assert.equal(placeOf(chat(), repos), ALL);
  assert.equal(placeOf(forum(["a/one"]), repos), "a/one");
  assert.equal(placeOf(forum(["a/one", "a/two"]), repos), ALL);
  assert.equal(placeOf(forum(), repos), ALL);
});

test("with one repo there is no All, so workspace channels and forums sit in that repo too", () => {
  assert.equal(placeOf(chat(), ["a/one"]), "a/one");
  assert.equal(placeOf(forum(), ["a/one"]), "a/one");
});

test("if the picked place is gone or there is one repo, go to the first repo", () => {
  assert.equal(placeIn(["a/one", "a/two"], "a/two"), "a/two");
  assert.equal(placeIn(["a/one", "a/two"], ALL), ALL);
  assert.equal(placeIn(["a/one", "a/two"], "a/gone"), "a/one");
  assert.equal(placeIn(["a/one", "a/two"], undefined), "a/one");
  assert.equal(placeIn(["a/one"], ALL), "a/one");
});
