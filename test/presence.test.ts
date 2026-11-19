import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  api,
  type ContractError,
  ContractFailure,
  call,
  MAX_STATUS_MESSAGE_CHARS,
} from "@omagari/contract";
import { eventually, startWorld } from "./harness.ts";

type As = { url: string; session?: string };
const memberOf = async (as: As, login: string) =>
  (await call(as, api.members)).members.find((member) => member.login === login);
const failsWith = (code: ContractError["code"]) => (error: unknown) =>
  error instanceof ContractFailure && error.code === code;

test("with at least one web window open a member is online, with none they are offline, and other members follow without refreshing", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice")?.presence;

  // Logged in but opened no window.
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "offline");
  const first = await world.live(alice);
  await eventually(() => assert.equal(seen(), "online"));
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "online");

  // Closing one window leaves them online if another is left.
  const second = await world.live(alice);
  await first.close();
  await sleep(200);
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "online");

  await second.close();
  await eventually(() => assert.equal(seen(), "offline"));
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "offline");
});

test("away and do-not-disturb return to online after the chosen time. With no time set, they stay until changed by hand", async (t) => {
  const expiry = 1000;
  const world = await startWorld({ presenceDurations: { "15m": expiry } });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await world.live(alice);
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice")?.presence;
  /** All of alice's presence states received over the live connection. On a slow device, a short time can end before it's received, so it looks at what has passed. */
  const history = () =>
    watching.received.flatMap((m) =>
      m.kind === "members" ? [m.payload.members.find((x) => x.login === "alice")?.presence] : [],
    );
  await eventually(() => assert.equal(seen(), "online"));

  const before = Date.now();
  const { until } = await call(alice, api.setPresence, {
    presence: "away",
    duration: "15m",
  });
  const at = Date.parse(until ?? "");
  assert.ok(at >= before + expiry && at <= Date.now() + expiry, `return time: ${until}`);
  await eventually(() => assert.ok(history().includes("away")));
  await eventually(() => assert.equal(seen(), "online"), expiry + 10_000);
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "online");

  // Choosing again discards the earlier time. A do-not-disturb chosen to stay until changed by hand remains after the earlier time passes.
  await call(alice, api.setPresence, { presence: "away", duration: "15m" });
  assert.deepEqual(await call(alice, api.setPresence, { presence: "dnd" }), {
    until: null,
  });
  await eventually(() => assert.equal(seen(), "dnd"));
  await sleep(expiry + 300);
  assert.equal(seen(), "dnd");
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "dnd");

  // A time that isn't shortened is the contract's time.
  const hour = Date.now();
  const long = await call(alice, api.setPresence, {
    presence: "dnd",
    duration: "1h",
  });
  const back = Date.parse(long.until ?? "") - hour;
  assert.ok(back >= 60 * 60_000 && back < 60 * 60_000 + 5_000, `not one hour later: ${long.until}`);

  // Choosing online returns right away. Online has no time.
  assert.deepEqual(await call(alice, api.setPresence, { presence: "online", duration: "3d" }), {
    until: null,
  });
  await eventually(() => assert.equal(seen(), "online"));
});

test("choosing to appear offline looks exactly like someone who really left offline in other members' API and live connection, and returns when the time passes", async (t) => {
  const expiry = 1000;
  const world = await startWorld({ presenceDurations: { "1h": expiry } });
  t.after(world.stop);
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  const bob = await world.login("bob"); // opened no window
  await world.live(alice);
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice");
  await eventually(() => assert.equal(seen()?.presence, "online"));
  await call(alice, api.setStatusMessage, {
    message: "in a meeting",
    emoji: null,
  });
  await call(bob, api.setStatusMessage, {
    message: "in a meeting",
    emoji: null,
  });

  await call(alice, api.setPresence, { presence: "invisible" });
  await eventually(() => assert.equal(seen()?.presence, "offline"));
  // alice, who keeps a window open, and bob, who has none, are the same except for the id. What was chosen and the return time are nowhere.
  const strip = ({ login: _, name: __, ...rest }: { login: string; name: string }) => rest;
  const views = await Promise.all([memberOf(world.owner, "alice"), memberOf(world.owner, "bob")]);
  const [hidden, gone] = views.map((view) => strip(view as { login: string; name: string }));
  assert.deepEqual(hidden, gone);
  assert.deepEqual(strip(seen() as { login: string; name: string }), gone);
  assert.doesNotMatch(JSON.stringify(watching.received), /invisible|until/);
  // It looks offline to the person who chose it, too.
  assert.equal((await memberOf(alice, "alice"))?.presence, "offline");

  // Choosing with a time returns when that time passes.
  await call(alice, api.setPresence, { presence: "invisible", duration: "1h" });
  await eventually(() => assert.equal(seen()?.presence, "online"), expiry + 10_000);
});

test("a status message can use emoji, HTML stays as written text, going over the limit is refused, and empty text clears it", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice")?.message;

  const text = "🚀 deploying <script>alert(1)</script>";
  assert.deepEqual(
    await call(alice, api.setStatusMessage, {
      message: ` ${text}\n`,
      emoji: null,
    }),
    {
      message: text,
      emoji: null,
    },
  );
  await eventually(() => assert.equal(seen(), text));
  assert.equal((await memberOf(world.owner, "alice"))?.message, text);

  // The limit counts code points. Up to 100 emoji (200 in UTF-16) fit.
  const full = "🎉".repeat(MAX_STATUS_MESSAGE_CHARS);
  assert.deepEqual(await call(alice, api.setStatusMessage, { message: full, emoji: null }), {
    message: full,
    emoji: null,
  });
  await assert.rejects(
    call(alice, api.setStatusMessage, { message: `${full}!`, emoji: null }),
    failsWith("invalid_request"),
  );
  assert.equal((await memberOf(world.owner, "alice"))?.message, full);

  assert.deepEqual(await call(alice, api.setStatusMessage, { message: "  \n ", emoji: null }), {
    message: null,
    emoji: null,
  });
  await eventually(() => assert.equal(seen(), null));
});

test("a status message's emoji is a separate slot from the text. It takes one emoji (one grapheme cluster), follows changes without a refresh, and stays after the server restarts", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const watching = await world.live(world.owner);
  const seen = () => {
    const member = watching.members().find((member) => member.login === "alice");
    return member && { emoji: member.emoji, message: member.message };
  };

  assert.deepEqual(
    await call(alice, api.setStatusMessage, {
      message: "in a meeting",
      emoji: "📅",
    }),
    {
      message: "in a meeting",
      emoji: "📅",
    },
  );
  await eventually(() => assert.deepEqual(seen(), { emoji: "📅", message: "in a meeting" }));

  // Choosing another emoji changes that slot. It isn't appended to the text.
  await call(alice, api.setStatusMessage, {
    message: "in a meeting",
    emoji: "🌴",
  });
  await eventually(() => assert.deepEqual(seen(), { emoji: "🌴", message: "in a meeting" }));

  // Skin tones, ZWJ sequences, flags, keycaps, and emoji newer than this runtime's Unicode version (🫫, Emoji 18) are accepted too, as one grapheme cluster.
  for (const emoji of ["👋🏽", "👩‍💻", "🇰🇷", "1️⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "🫫"]) {
    const saved = await call(alice, api.setStatusMessage, {
      message: "in a meeting",
      emoji,
    });
    assert.equal(saved.emoji, emoji);
  }

  // Anything that isn't an emoji, or is two or more, is refused, and what was there stays.
  await call(alice, api.setStatusMessage, {
    message: "in a meeting",
    emoji: "🌴",
  });
  for (const emoji of ["", " ", "a", "가", "😀😀", "🌴 vacation", " 🌴"]) {
    await assert.rejects(
      call(alice, api.setStatusMessage, { message: "in a meeting", emoji }),
      failsWith("invalid_request"),
      JSON.stringify(emoji),
    );
  }
  assert.equal((await memberOf(world.owner, "alice"))?.emoji, "🌴");

  // An emoji alone can be set. It stays after the server restarts.
  assert.deepEqual(await call(alice, api.setStatusMessage, { message: " ", emoji: "🎧" }), {
    message: null,
    emoji: "🎧",
  });
  await eventually(() => assert.deepEqual(seen(), { emoji: "🎧", message: null }));
  await world.restartServer();
  // The connection to the stopped server may remain broken, so the first request can fail.
  await eventually(async () => assert.equal((await memberOf(world.owner, "alice"))?.emoji, "🎧"));

  // Clearing only the emoji leaves the text, and clearing both leaves no status message.
  await call(alice, api.setStatusMessage, { message: "lunch", emoji: "🍜" });
  assert.deepEqual(await call(alice, api.setStatusMessage, { message: "lunch", emoji: null }), {
    message: "lunch",
    emoji: null,
  });
  await call(alice, api.setStatusMessage, { message: "", emoji: null });
  const view = await memberOf(world.owner, "alice");
  assert.deepEqual(view && { emoji: view.emoji, message: view.message }, {
    emoji: null,
    message: null,
  });
});

test("a non-member can neither read nor change another person's presence and status message. Losing access removes them from the list too", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await call(alice, api.setStatusMessage, {
    message: "working on a secret",
    emoji: null,
  });
  const window = await world.live(alice);

  // An account without push access can't get in.
  await assert.rejects(world.login("mallory"), failsWith("forbidden"));
  // Without a session, or with a made-up one, they can neither read nor write.
  for (const as of [{ url: world.server.url }, { url: world.server.url, session: "made-up" }]) {
    await assert.rejects(call(as, api.members), failsWith("unauthorized"));
    await assert.rejects(
      call(as, api.setPresence, { presence: "away" }),
      failsWith("unauthorized"),
    );
    await assert.rejects(
      call(as, api.setStatusMessage, { message: "butting in", emoji: null }),
      failsWith("unauthorized"),
    );
  }
  const intruder = await world.live({ session: "made-up" });
  assert.equal(await intruder.closed, 1008);
  assert.deepEqual(
    intruder.received.map((m) => m.kind),
    ["error"],
  );

  // Losing access ends the session and closes the windows, they can't read, and they drop out of other members' lists.
  world.github.revoke("alice");
  assert.equal(await window.closed, 1008);
  await assert.rejects(call(alice, api.members), failsWith("unauthorized"));
  const { members } = await call(world.owner, api.members);
  assert.deepEqual(
    members.map((member) => member.login),
    ["owner"],
  );
  assert.doesNotMatch(JSON.stringify(members), /working on a secret/);
});
