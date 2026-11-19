import assert from "node:assert/strict";
import { test } from "node:test";
import { giphyId, giphyUrl } from "./giphy.ts";

test("GIPHY 주소 하나뿐인 글만 GIF로 본다", () => {
  assert.equal(giphyId(giphyUrl("3o7TKSjRrfIPjeiVyM")), "3o7TKSjRrfIPjeiVyM");
  assert.equal(giphyId("https://giphy.com/gifs/cat-clap-3o7TKSjRrfIPjeiVyM"), "3o7TKSjRrfIPjeiVyM");
  assert.equal(giphyId("https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM"), "3o7TKSjRrfIPjeiVyM");
  assert.equal(
    giphyId("https://media2.giphy.com/media/v1.Y2lkPTc5/3o7TKSjRrfIPjeiVyM/200w.gif?cid=1&ct=g"),
    "3o7TKSjRrfIPjeiVyM",
  );
  // 다른 이미지 주소, 글이 섞인 것, http는 그림으로 그리지 않는다.
  assert.equal(giphyId("https://example.com/cat.gif"), undefined);
  assert.equal(giphyId("https://giphy.com.evil.example/gifs/abc"), undefined);
  assert.equal(giphyId(`봐 ${giphyUrl("abc")}`), undefined);
  assert.equal(giphyId("http://media.giphy.com/media/abc/giphy.gif"), undefined);
});
