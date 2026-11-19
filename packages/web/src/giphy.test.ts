import assert from "node:assert/strict";
import { test } from "node:test";
import { giphyId, giphyUrl } from "./giphy.ts";

test("only text that is a single GIPHY URL counts as a GIF", () => {
  assert.equal(giphyId(giphyUrl("3o7TKSjRrfIPjeiVyM")), "3o7TKSjRrfIPjeiVyM");
  assert.equal(giphyId("https://giphy.com/gifs/cat-clap-3o7TKSjRrfIPjeiVyM"), "3o7TKSjRrfIPjeiVyM");
  assert.equal(giphyId("https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM"), "3o7TKSjRrfIPjeiVyM");
  assert.equal(
    giphyId("https://media2.giphy.com/media/v1.Y2lkPTc5/3o7TKSjRrfIPjeiVyM/200w.gif?cid=1&ct=g"),
    "3o7TKSjRrfIPjeiVyM",
  );
  // Other image URLs, text mixed in, and http are not drawn as pictures.
  assert.equal(giphyId("https://example.com/cat.gif"), undefined);
  assert.equal(giphyId("https://giphy.com.evil.example/gifs/abc"), undefined);
  assert.equal(giphyId(`look ${giphyUrl("abc")}`), undefined);
  assert.equal(giphyId("http://media.giphy.com/media/abc/giphy.gif"), undefined);
});
