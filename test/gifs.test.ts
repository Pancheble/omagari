import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { realGiphy } from "@omagari/server";
import { fakeGiphy, startWorld } from "./harness.ts";

const KEY = "giphy-secret-key";

/** One GIF GIPHY gives. Sizes come as strings. Some unused ones come mixed in. */
const giphyGif = (
  id: string,
  title: string,
  url = `https://media2.giphy.com/media/${id}/200w.gif`,
) => ({
  id,
  title,
  url: `https://giphy.com/gifs/${id}`,
  username: "someone",
  images: {
    fixed_width: { url, width: "200", height: "150", size: "1234" },
    original: {
      url: `https://media2.giphy.com/media/${id}/giphy.gif?api_key=${KEY}`,
    },
  },
});

test("with no GIPHY key on the server, GIFs are off", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  assert.equal((await call(world.owner, api.me)).gif, false); // the web doesn't show a GIF button
  await assert.rejects(call(world.owner, api.gifs, { query: "cat" }), {
    code: "not_found",
  });
});

test("GIF search has the server add the key and ask GIPHY, and only the URL, size and title go to the web", async (t) => {
  const giphy = await fakeGiphy(t);
  giphy.answer = (url) =>
    url.pathname === "/v1/gifs/trending"
      ? [giphyGif("Trend1", "trending")]
      : [
          giphyGif("Cat1", "clapping cat"),
          giphyGif("Bad1", "someone else's URL", "https://evil.example/cat.gif"),
          giphyGif("../x", "strange id"),
        ];
  const world = await startWorld({
    giphy: realGiphy(KEY, { base: giphy.url }),
  });
  t.after(world.stop);

  assert.equal((await call(world.owner, api.me)).gif, true);
  // A browser that isn't logged in can't search (others can't use the server's quota).
  await assert.rejects(call(world.server, api.gifs, { query: "cat" }), {
    code: "unauthorized",
  });

  const response = await fetch(new URL(api.gifs.path, world.server.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${world.owner.session}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: " congrats " }),
  });
  const raw = await response.text();
  assert.ok(!raw.includes(KEY), "the key must not go down to the web");
  assert.deepEqual(JSON.parse(raw), {
    gifs: [
      {
        id: "Cat1",
        title: "clapping cat",
        url: "https://media2.giphy.com/media/Cat1/200w.gif",
        width: 200,
        height: 150,
      },
    ],
  });
  const [search] = giphy.asked;
  assert.equal(search?.pathname, "/v1/gifs/search");
  assert.equal(search?.searchParams.get("api_key"), KEY);
  assert.equal(search?.searchParams.get("q"), "congrats");
  assert.equal(search?.searchParams.get("rating"), "r");

  // With no search words, it's trending GIFs.
  assert.deepEqual(
    (await call(world.owner, api.gifs, { query: "" })).gifs.map((gif) => gif.id),
    ["Trend1"],
  );
  assert.equal(giphy.asked[1]?.pathname, "/v1/gifs/trending");
});

test("the server doesn't ask GIPHY past its hourly limit", async (t) => {
  const giphy = await fakeGiphy(t);
  const world = await startWorld({
    giphy: realGiphy(KEY, { base: giphy.url, perHour: 2 }),
  });
  t.after(world.stop);

  await call(world.owner, api.gifs, { query: "a" });
  await call(world.owner, api.gifs, { query: "b" });
  await assert.rejects(call(world.owner, api.gifs, { query: "c" }), {
    code: "internal",
  });
  assert.equal(giphy.asked.length, 2);
});
