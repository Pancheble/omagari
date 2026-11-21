import assert from "node:assert/strict";
import { test } from "node:test";
import { giphyImage, searchGiphy } from "./giphy.ts";

/** One GIF the way GIPHY answers: sizes as strings, query params on the URLs, renditions we don't use. */
const found = (id: string) => ({
  id,
  title: `${id} GIF`,
  url: `https://giphy.com/gifs/${id}`,
  images: {
    fixed_width: {
      url: `https://media2.giphy.com/media/v1.Y2lk/${id}/200w.gif?cid=abc&ep=v1&rid=200w.gif&ct=g`,
      width: "200",
      height: "150",
    },
    original: {
      url: `https://media3.giphy.com/media/v1.Y2lk/${id}/giphy.gif?cid=abc&ep=v1&rid=giphy.gif&ct=g`,
      width: "480",
      height: "360",
    },
  },
});

test("GIF search asks GIPHY from the browser and passes its URLs through untouched", async (t) => {
  const asked: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    asked.push(url);
    return Response.json({ data: [found("aaa"), { id: "broken" }, found("bbb")] });
  });

  const gifs = await searchGiphy("web-key", "고양이");
  assert.deepEqual(
    gifs.map((gif) => gif.id),
    ["aaa", "bbb"],
  );
  assert.deepEqual(gifs[0], {
    id: "aaa",
    title: "aaa GIF",
    preview: found("aaa").images.fixed_width.url,
    url: found("aaa").images.original.url,
    width: 200,
    height: 150,
  });
  assert.equal(asked[0]?.origin, "https://api.giphy.com");
  assert.equal(asked[0]?.pathname, "/v1/gifs/search");
  assert.deepEqual(Object.fromEntries(asked[0]?.searchParams ?? []), {
    api_key: "web-key",
    limit: "24",
    rating: "r",
    q: "고양이",
    lang: "ko",
  });

  await searchGiphy("web-key", "");
  assert.equal(asked[1]?.pathname, "/v1/gifs/trending");
  assert.equal(asked[1]?.searchParams.has("q"), false);
});

test("GIF search fails when GIPHY refuses (over its hourly limit)", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ meta: { status: 429 } }, { status: 429 }),
  );
  await assert.rejects(searchGiphy("web-key", "cat"));
});

test("a message that is one GIPHY image URL is drawn exactly as written", () => {
  const sent = found("3o7TKSjRrfIPjeiVyM").images.original.url;
  assert.equal(giphyImage(sent), sent);
  // Messages sent before ADR-0056 still show.
  const old = "https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif";
  assert.equal(giphyImage(old), old);
  // A pasted page link becomes its image.
  assert.equal(giphyImage("https://giphy.com/gifs/cat-clap-3o7TKSjRrfIPjeiVyM"), old);
  assert.equal(giphyImage("https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM"), old);
  // Other image URLs, text mixed in, and http are not drawn as pictures.
  assert.equal(giphyImage("https://example.com/cat.gif"), undefined);
  assert.equal(giphyImage("https://giphy.com.evil.example/gifs/abc"), undefined);
  assert.equal(giphyImage(`look ${old}`), undefined);
  assert.equal(giphyImage("http://media.giphy.com/media/abc/giphy.gif"), undefined);
});
