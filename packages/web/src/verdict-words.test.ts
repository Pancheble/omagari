import assert from "node:assert/strict";
import { test } from "node:test";
import { notRunWords } from "./verdict-words.ts";

test("샌드박스 없음은 돌린 사람의 이름을 쓰고 까는 법을 붙인다(#183)", () => {
  assert.deepEqual(notRunWords("샌드박스 도구가 없다: bubblewrap", "지은"), {
    text: "지은의 기기에 샌드박스 도구가 없어요",
    help: "sandbox",
  });
});

test("돌리지 못한 나머지 까닭", () => {
  assert.deepEqual(notRunWords("검사 명령이 없다", "지은"), {
    text: "레포에 검사 명령이 없어요",
    help: "check",
  });
  assert.deepEqual(notRunWords("5분 상한을 넘었다", "지은"), {
    text: "5분이 넘어 끊었어요 · 통과로 치지 않아요",
  });
  assert.deepEqual(notRunWords("", "지은"), { text: "돌리지 못했어요" });
});
