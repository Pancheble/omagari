import assert from "node:assert/strict";
import { test } from "node:test";
import type { Channel } from "@omagari/contract";
import { ALL, placeIn, placeOf } from "./places.ts";

const chat = (repo?: string) => ({ id: "c", name: "c", kind: "chat", repo }) as Channel;
const forum = (repos?: string[]) =>
  ({ id: "f", name: "f", kind: "forum", filter: { importance: "discuss", repos } }) as Channel;

test("레포가 둘 이상이면 레포 채널과 레포 하나의 포럼은 그 레포에, 나머지는 전체에 선다", () => {
  const repos = ["a/one", "a/two"];
  assert.equal(placeOf(chat("a/two"), repos), "a/two");
  assert.equal(placeOf(chat(), repos), ALL);
  assert.equal(placeOf(forum(["a/one"]), repos), "a/one");
  assert.equal(placeOf(forum(["a/one", "a/two"]), repos), ALL);
  assert.equal(placeOf(forum(), repos), ALL);
});

test("레포가 하나뿐이면 전체가 없어 워크스페이스 채널과 포럼도 그 레포에 선다", () => {
  assert.equal(placeOf(chat(), ["a/one"]), "a/one");
  assert.equal(placeOf(forum(), ["a/one"]), "a/one");
});

test("고른 곳이 빠졌거나 레포가 하나뿐이면 첫 레포로 간다", () => {
  assert.equal(placeIn(["a/one", "a/two"], "a/two"), "a/two");
  assert.equal(placeIn(["a/one", "a/two"], ALL), ALL);
  assert.equal(placeIn(["a/one", "a/two"], "a/gone"), "a/one");
  assert.equal(placeIn(["a/one", "a/two"], undefined), "a/one");
  assert.equal(placeIn(["a/one"], ALL), "a/one");
});
