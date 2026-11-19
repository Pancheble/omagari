// A forum is a view filtered by importance or label (#190, ADR-0039). Posts use two that are in the DB of the stage-3 version (contract32.sql):
// a direct conflict (reference) and a confirmed indirect conflict (two labels, discuss).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { api, type ContractFailure, call } from "@omagari/contract";
import { eventually, startWorld } from "./harness.ts";

test("when a member creates, edits, and deletes forums, posts show up in each forum they match, and one that matches nowhere is an other post", async (t) => {
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
  const discuss = await id("Discuss");
  const reference = await id("FYI");

  // If two labels each match a different forum, the post shows in both forums. A label list matches if any one does. Forums are in name order.
  const guessed = (
    await call(alice, api.createForum, {
      name: " Guessed  conflict ",
      filter: { labels: ["Indirect conflict"] },
    })
  ).channel;
  assert.deepEqual(guessed, {
    id: guessed.id,
    name: "Guessed conflict",
    kind: "forum",
    filter: { labels: ["Indirect conflict"] },
  });
  const { channel: confirmed } = await call(alice, api.createForum, {
    name: "Verified",
    filter: { labels: ["No such label", "Confirmed"] },
  });
  assert.deepEqual(await forumsOf(), [[reference], [discuss, guessed.id, confirmed.id]]);
  // The web immediately gets the new forum and the alert line of the post whose visible forums changed.
  await eventually(() => {
    assert.ok(web.received.some((m) => m.kind === "channel" && m.payload.id === confirmed.id));
    const last = web.messages().findLast((m) => m.kind === "alert" && m.id === 2);
    assert.ok(last?.kind === "alert");
    assert.deepEqual(last.post.forums, [discuss, guessed.id, confirmed.id]);
  });

  // Changing a label's importance takes posts with that label out of the reference forum and shows them in the discuss forum. The web gets it right away too.
  await call(alice, api.editLabel, {
    name: "Direct conflict",
    next: { importance: "discuss" },
  });
  assert.deepEqual(await forumsOf(), [[discuss], [discuss, guessed.id, confirmed.id]]);
  await eventually(() => {
    const last = web.messages().findLast((m) => m.kind === "alert" && m.id === 1);
    assert.ok(last?.kind === "alert");
    assert.deepEqual(last.post.forums, [discuss]);
  });
  await call(alice, api.editLabel, {
    name: "Direct conflict",
    next: { importance: "reference" },
  });
  assert.deepEqual(await forumsOf(), [[reference], [discuss, guessed.id, confirmed.id]]);
  // Renaming a label makes forums that filter by that label follow the new name.
  await call(alice, api.editLabel, {
    name: "Indirect conflict",
    next: { name: "Probable conflict" },
  });
  assert.deepEqual(
    (await call(world.owner, api.channels)).channels.find((c) => c.id === guessed.id)?.filter,
    { labels: ["Probable conflict"] },
  );
  assert.deepEqual(await forumsOf(), [[reference], [discuss, guessed.id, confirmed.id]]);

  // You can't create a forum or channel with the same name (case-insensitive).
  for (const name of ["FYI", "Verified"])
    await assert.rejects(
      call(alice, api.createForum, { name, filter: { importance: "discuss" } }),
      { code: "conflict" } satisfies Partial<ContractFailure>,
    );
  await assert.rejects(call(alice, api.createChannel, { name: "Verified" }), {
    code: "conflict",
  } satisfies Partial<ContractFailure>);
  const general = await world.channel(world.owner, "General");
  await assert.rejects(
    call(alice, api.createForum, {
      name: "General",
      filter: { importance: "discuss" },
    }),
    { code: "conflict" } satisfies Partial<ContractFailure>,
  );

  // Edit the name and filter. Default forums can be edited too. A name of another channel is refused, and a non-forum is not found.
  const renamed = await call(alice, api.updateForum, {
    id: guessed.id,
    name: "Guess",
    filter: { importance: "reference" },
  });
  assert.deepEqual(renamed.channel, {
    id: guessed.id,
    name: "Guess",
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
        (m) => m.kind === "channel" && m.payload.id === guessed.id && m.payload.name === "Guess",
      ),
    ),
  );
  await assert.rejects(
    call(alice, api.updateForum, {
      id: guessed.id,
      name: "Discuss",
      filter: { importance: "discuss" },
    }),
    { code: "conflict" } satisfies Partial<ContractFailure>,
  );
  for (const other of [general, "alerts", "No such forum"])
    await assert.rejects(
      call(alice, api.updateForum, {
        id: other,
        name: "New name",
        filter: { importance: "discuss" },
      }),
      { code: "not_found" } satisfies Partial<ContractFailure>,
    );
  await call(alice, api.updateForum, {
    id: discuss as string,
    name: "Discuss",
    filter: { labels: ["Direct conflict"] },
  });
  assert.deepEqual(await forumsOf(), [[discuss, reference, guessed.id], [confirmed.id]]);

  // Deleting every forum, default ones included, leaves posts visible in no forum ("other posts"). The posts themselves remain.
  for (const forum of [discuss, reference, guessed.id, confirmed.id])
    assert.deepEqual(await call(alice, api.deleteForum, { id: forum as string }), {});
  assert.deepEqual(await forumsOf(), [[], []]);
  assert.deepEqual((await call(world.owner, api.channels)).channels, [
    { id: general, name: "General", kind: "chat" },
  ]);
  await eventually(() =>
    assert.ok(web.received.some((m) => m.kind === "forumDeleted" && m.payload.id === discuss)),
  );
  for (const gone of [discuss as string, general])
    await assert.rejects(call(alice, api.deleteForum, { id: gone }), {
      code: "not_found",
    } satisfies Partial<ContractFailure>);

  // A deleted default forum doesn't come back when restarted. A member creates it again.
  await world.restartServer();
  await eventually(async () =>
    assert.deepEqual(
      (await call(world.owner, api.channels)).channels.map((c) => c.name),
      ["General"],
    ),
  );
  await call(alice, api.createForum, {
    name: "Debate",
    filter: { importance: "discuss" },
  });
  assert.deepEqual(
    (await forumsOf()).map((f) => f.length),
    [0, 1],
  );

  // There is no "forum to post alerts in" API.
  const gone = await fetch(new URL("/api/alert-channel", world.owner.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${world.owner.session}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel: discuss }),
  });
  assert.equal(gone.status, 404);
  await web.close();
});
