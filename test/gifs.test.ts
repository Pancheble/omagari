import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { realGiphy } from "@omagari/server";
import { fakeGiphy, startWorld } from "./harness.ts";

const KEY = "giphy-secret-key";

/** GIPHY가 주는 GIF 하나. 크기는 글자로 온다. 쓰지 않는 것도 섞여 온다. */
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
    original: { url: `https://media2.giphy.com/media/${id}/giphy.gif?api_key=${KEY}` },
  },
});

test("서버에 GIPHY 키가 없으면 GIF가 꺼져 있다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);

  assert.equal((await call(world.owner, api.me)).gif, false); // 웹은 GIF 버튼을 두지 않는다
  await assert.rejects(call(world.owner, api.gifs, { query: "cat" }), { code: "not_found" });
});

test("GIF 찾기는 서버가 키를 붙여 GIPHY에 묻고, 웹에는 주소·크기·제목만 간다", async (t) => {
  const giphy = await fakeGiphy(t);
  giphy.answer = (url) =>
    url.pathname === "/v1/gifs/trending"
      ? [giphyGif("Trend1", "인기")]
      : [
          giphyGif("Cat1", "박수 치는 고양이"),
          giphyGif("Bad1", "남의 주소", "https://evil.example/cat.gif"),
          giphyGif("../x", "이상한 id"),
        ];
  const world = await startWorld({ giphy: realGiphy(KEY, { base: giphy.url }) });
  t.after(world.stop);

  assert.equal((await call(world.owner, api.me)).gif, true);
  // 로그인하지 않은 브라우저는 찾지 못한다(서버의 한도를 남이 쓰지 못한다).
  await assert.rejects(call(world.server, api.gifs, { query: "cat" }), { code: "unauthorized" });

  const response = await fetch(new URL(api.gifs.path, world.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${world.owner.session}`, "content-type": "application/json" },
    body: JSON.stringify({ query: " 축하 " }),
  });
  const raw = await response.text();
  assert.ok(!raw.includes(KEY), "키가 웹에 내려가면 안 된다");
  assert.deepEqual(JSON.parse(raw), {
    gifs: [
      {
        id: "Cat1",
        title: "박수 치는 고양이",
        url: "https://media2.giphy.com/media/Cat1/200w.gif",
        width: 200,
        height: 150,
      },
    ],
  });
  const [search] = giphy.asked;
  assert.equal(search?.pathname, "/v1/gifs/search");
  assert.equal(search?.searchParams.get("api_key"), KEY);
  assert.equal(search?.searchParams.get("q"), "축하");
  assert.equal(search?.searchParams.get("rating"), "r");

  // 찾는 말이 없으면 인기 GIF다.
  assert.deepEqual(
    (await call(world.owner, api.gifs, { query: "" })).gifs.map((gif) => gif.id),
    ["Trend1"],
  );
  assert.equal(giphy.asked[1]?.pathname, "/v1/gifs/trending");
});

test("서버는 GIPHY의 시간당 한도를 넘겨 묻지 않는다", async (t) => {
  const giphy = await fakeGiphy(t);
  const world = await startWorld({ giphy: realGiphy(KEY, { base: giphy.url, perHour: 2 }) });
  t.after(world.stop);

  await call(world.owner, api.gifs, { query: "a" });
  await call(world.owner, api.gifs, { query: "b" });
  await assert.rejects(call(world.owner, api.gifs, { query: "c" }), { code: "internal" });
  assert.equal(giphy.asked.length, 2);
});
