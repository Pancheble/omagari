// 포럼은 중요도나 라벨로 거른 보기다(#190, ADR-0039). 포스트는 3단계 판(contract32.sql)의 DB에 있는 둘을 쓴다:
// 직접 충돌(참고)과, 확인된 간접 충돌(라벨 둘, 논의).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, startWorld } from "./harness.ts";

test("멤버가 포럼을 만들고 고치고 지우면 포스트가 맞는 포럼마다 보이고, 어디에도 안 맞으면 다른 포스트다", async (t) => {
  const world = await startWorld({
    seed: await readFile(new URL("./contract32.sql", import.meta.url), "utf8"),
  });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const web = await world.live(world.owner);
  const forumsOf = async () => (await call(world.owner, api.posts)).posts.map((p) => p.forums);
  const id = async (name: string) =>
    (await call(world.owner, api.channels)).channels.find((c) => c.name === name)?.id;
  const discuss = await id("논의");
  const reference = await id("참고");

  // 라벨 둘이 각각 다른 포럼에 맞으면 두 포럼에 다 보인다. 라벨 목록은 하나라도 맞으면 된다. 포럼은 이름 순이다.
  const guessed = (
    await call(alice, api.createForum, { name: " 간접  충돌 ", filter: { labels: ["간접 충돌"] } })
  ).channel;
  assert.deepEqual(guessed, {
    id: guessed.id,
    name: "간접 충돌",
    kind: "forum",
    filter: { labels: ["간접 충돌"] },
  });
  const { channel: confirmed } = await call(alice, api.createForum, {
    name: "확인",
    filter: { labels: ["없는 라벨", "확인됨"] },
  });
  assert.deepEqual(await forumsOf(), [[reference], [guessed.id, discuss, confirmed.id]]);
  // 웹에는 새 포럼과, 보이는 포럼이 바뀐 포스트의 알림 줄이 바로 간다.
  await eventually(() => {
    assert.ok(web.received.some((m) => m.kind === "channel" && m.payload.id === confirmed.id));
    const last = web.messages().findLast((m) => m.kind === "alert" && m.id === 2);
    assert.ok(last?.kind === "alert");
    assert.deepEqual(last.post.forums, [guessed.id, discuss, confirmed.id]);
  });

  // 라벨의 중요도를 바꾸면 그 라벨을 단 포스트가 참고 포럼에서 빠지고 논의 포럼에 보인다. 웹에도 바로 간다.
  await call(alice, api.editLabel, { name: "직접 충돌", next: { importance: "discuss" } });
  assert.deepEqual(await forumsOf(), [[discuss], [guessed.id, discuss, confirmed.id]]);
  await eventually(() => {
    const last = web.messages().findLast((m) => m.kind === "alert" && m.id === 1);
    assert.ok(last?.kind === "alert");
    assert.deepEqual(last.post.forums, [discuss]);
  });
  await call(alice, api.editLabel, { name: "직접 충돌", next: { importance: "reference" } });
  assert.deepEqual(await forumsOf(), [[reference], [guessed.id, discuss, confirmed.id]]);
  // 라벨 이름을 바꾸면 그 라벨로 거르는 포럼도 새 이름을 따른다.
  await call(alice, api.editLabel, { name: "간접 충돌", next: { name: "추정 충돌" } });
  assert.deepEqual(
    (await call(world.owner, api.channels)).channels.find((c) => c.id === guessed.id)?.filter,
    { labels: ["추정 충돌"] },
  );
  assert.deepEqual(await forumsOf(), [[reference], [guessed.id, discuss, confirmed.id]]);

  // 같은 이름(대소문자를 가리지 않는다)의 포럼이나 채널은 만들지 못한다.
  for (const name of ["참고", "확인"])
    await assert.rejects(
      call(alice, api.createForum, { name, filter: { importance: "discuss" } }),
      { code: "conflict" } satisfies Partial<ContractFailure>,
    );
  await assert.rejects(call(alice, api.createChannel, { name: "확인" }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);
  const general = await world.channel(world.owner, "일반");
  await assert.rejects(
    call(alice, api.createForum, { name: "일반", filter: { importance: "discuss" } }),
    { code: "conflict" } satisfies Partial<ContractFailure>,
  );

  // 이름과 거르기를 고친다. 기본 포럼도 고친다. 다른 채널의 이름이면 거절하고, 포럼이 아니면 없는 것이다.
  const renamed = await call(alice, api.updateForum, {
    id: guessed.id,
    name: "추정",
    filter: { importance: "reference" },
  });
  assert.deepEqual(renamed.channel, {
    id: guessed.id,
    name: "추정",
    kind: "forum",
    filter: { importance: "reference" },
  });
  assert.deepEqual(await forumsOf(), [
    [reference, guessed.id],
    [discuss, confirmed.id],
  ]);
  await eventually(() =>
    assert.ok(
      web.received.some(
        (m) => m.kind === "channel" && m.payload.id === guessed.id && m.payload.name === "추정",
      ),
    ),
  );
  await assert.rejects(
    call(alice, api.updateForum, {
      id: guessed.id,
      name: "논의",
      filter: { importance: "discuss" },
    }),
    { code: "conflict" } satisfies Partial<ContractFailure>,
  );
  for (const other of [general, "alerts", "없는 포럼"])
    await assert.rejects(
      call(alice, api.updateForum, {
        id: other,
        name: "새 이름",
        filter: { importance: "discuss" },
      }),
      { code: "not_found" } satisfies Partial<ContractFailure>,
    );
  await call(alice, api.updateForum, {
    id: discuss as string,
    name: "논의",
    filter: { labels: ["직접 충돌"] },
  });
  assert.deepEqual(await forumsOf(), [[discuss, reference, guessed.id], [confirmed.id]]);

  // 기본 포럼까지 모두 지우면 포스트는 어느 포럼에도 보이지 않는다("다른 포스트"). 포스트 자체는 남는다.
  for (const forum of [discuss, reference, guessed.id, confirmed.id])
    assert.deepEqual(await call(alice, api.deleteForum, { id: forum as string }), {});
  assert.deepEqual(await forumsOf(), [[], []]);
  assert.deepEqual((await call(world.owner, api.channels)).channels, [
    { id: general, name: "일반", kind: "chat" },
  ]);
  await eventually(() =>
    assert.ok(web.received.some((m) => m.kind === "forumDeleted" && m.payload.id === discuss)),
  );
  for (const gone of [discuss as string, general])
    await assert.rejects(call(alice, api.deleteForum, { id: gone }), {
      code: "not_found",
    } satisfies Partial<ContractFailure>);

  // 지운 기본 포럼은 다시 띄워도 돌아오지 않는다. 멤버가 다시 만든다.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(
      (await call(world.owner, api.channels)).channels.map((c) => c.name),
      ["일반"],
    ),
  );
  await call(alice, api.createForum, { name: "논의", filter: { importance: "discuss" } });
  assert.deepEqual(
    (await forumsOf()).map((f) => f.length),
    [0, 1],
  );

  // "알림을 올릴 포럼" API는 없다.
  const gone = await fetch(new URL("/api/alert-channel", world.owner.url), {
    method: "POST",
    headers: { authorization: `Bearer ${world.owner.session}`, "content-type": "application/json" },
    body: JSON.stringify({ channel: discuss }),
  });
  assert.equal(gone.status, 404);
  await web.close();
});
