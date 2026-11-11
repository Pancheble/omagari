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

test("웹 창이 하나라도 열려 있으면 온라인이고, 하나도 없으면 오프라인이다. 다른 멤버는 새로 고치지 않아도 따라온다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice")?.presence;

  // 로그인만 하고 창을 열지 않았다.
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "offline");
  const first = await world.live(alice);
  await eventually(() => assert.equal(seen(), "online"));
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "online");

  // 창 하나를 닫아도 남은 창이 있으면 온라인이다.
  const second = await world.live(alice);
  await first.close();
  await sleep(200);
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "online");

  await second.close();
  await eventually(() => assert.equal(seen(), "offline"));
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "offline");
});

test("자리 비움과 방해 금지는 고른 시간이 지나면 온라인으로 돌아온다. 시간을 정하지 않으면 직접 바꿀 때까지 남는다", async (t) => {
  const expiry = 1000;
  const world = await startWorld({ presenceDurations: { "15m": expiry } });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await world.live(alice);
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice")?.presence;
  /** 실시간 연결로 받아 온 alice의 접속 상태 전부. 느린 기기에서 짧은 시간이 받기 전에 끝나도 지나간 것을 본다. */
  const history = () =>
    watching.received.flatMap((m) =>
      m.kind === "members" ? [m.payload.members.find((x) => x.login === "alice")?.presence] : [],
    );
  await eventually(() => assert.equal(seen(), "online"));

  const before = Date.now();
  const { until } = await call(alice, api.setPresence, { presence: "away", duration: "15m" });
  const at = Date.parse(until ?? "");
  assert.ok(at >= before + expiry && at <= Date.now() + expiry, `돌아올 시각: ${until}`);
  await eventually(() => assert.ok(history().includes("away")));
  await eventually(() => assert.equal(seen(), "online"), expiry + 10_000);
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "online");

  // 다시 고르면 앞의 시간은 버린다. 직접 바꿀 때까지 고른 방해 금지는 앞의 시간이 지나도 남는다.
  await call(alice, api.setPresence, { presence: "away", duration: "15m" });
  assert.deepEqual(await call(alice, api.setPresence, { presence: "dnd" }), { until: null });
  await eventually(() => assert.equal(seen(), "dnd"));
  await sleep(expiry + 300);
  assert.equal(seen(), "dnd");
  assert.equal((await memberOf(world.owner, "alice"))?.presence, "dnd");

  // 줄이지 않은 시간은 계약의 시간이다.
  const hour = Date.now();
  const long = await call(alice, api.setPresence, { presence: "dnd", duration: "1h" });
  const back = Date.parse(long.until ?? "") - hour;
  assert.ok(back >= 60 * 60_000 && back < 60 * 60_000 + 5_000, `1시간 뒤가 아니다: ${long.until}`);

  // 온라인을 고르면 바로 돌아온다. 온라인에는 시간이 없다.
  assert.deepEqual(await call(alice, api.setPresence, { presence: "online", duration: "3d" }), {
    until: null,
  });
  await eventually(() => assert.equal(seen(), "online"));
});

test("오프라인으로 보이기를 고르면 다른 멤버의 API와 실시간 연결에서 정말 나간 사람과 똑같이 오프라인이고, 시간이 지나면 돌아온다", async (t) => {
  const expiry = 1000;
  const world = await startWorld({ presenceDurations: { "1h": expiry } });
  t.after(world.stop);
  world.github.grant("alice");
  world.github.grant("bob");
  const alice = await world.login("alice");
  const bob = await world.login("bob"); // 창을 열지 않았다
  await world.live(alice);
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice");
  await eventually(() => assert.equal(seen()?.presence, "online"));
  await call(alice, api.setStatusMessage, { message: "회의 중" });
  await call(bob, api.setStatusMessage, { message: "회의 중" });

  await call(alice, api.setPresence, { presence: "invisible" });
  await eventually(() => assert.equal(seen()?.presence, "offline"));
  // 창을 열어 둔 alice와 창이 없는 bob은 아이디 말고는 같다. 고른 것이나 돌아올 시각은 어디에도 없다.
  const strip = ({ login: _, name: __, ...rest }: { login: string; name: string }) => rest;
  const views = await Promise.all([memberOf(world.owner, "alice"), memberOf(world.owner, "bob")]);
  const [hidden, gone] = views.map((view) => strip(view as { login: string; name: string }));
  assert.deepEqual(hidden, gone);
  assert.deepEqual(strip(seen() as { login: string; name: string }), gone);
  assert.doesNotMatch(JSON.stringify(watching.received), /invisible|until/);
  // 고른 사람 자신에게도 오프라인으로 보인다.
  assert.equal((await memberOf(alice, "alice"))?.presence, "offline");

  // 시간을 정해 고르면 그 시간이 지나 돌아온다.
  await call(alice, api.setPresence, { presence: "invisible", duration: "1h" });
  await eventually(() => assert.equal(seen()?.presence, "online"), expiry + 10_000);
});

test("상태 메시지는 이모지를 쓸 수 있고, HTML은 쓴 그대로 글로 남고, 한도를 넘으면 거절하고, 빈 글이면 지운다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  const watching = await world.live(world.owner);
  const seen = () => watching.members().find((member) => member.login === "alice")?.message;

  const text = "🚀 배포 중 <script>alert(1)</script>";
  assert.deepEqual(await call(alice, api.setStatusMessage, { message: ` ${text}\n` }), {
    message: text,
  });
  await eventually(() => assert.equal(seen(), text));
  assert.equal((await memberOf(world.owner, "alice"))?.message, text);

  // 한도는 코드 포인트로 센다. 이모지 100개(UTF-16으로는 200)까지 된다.
  const full = "🎉".repeat(MAX_STATUS_MESSAGE_CHARS);
  assert.deepEqual(await call(alice, api.setStatusMessage, { message: full }), { message: full });
  await assert.rejects(
    call(alice, api.setStatusMessage, { message: `${full}!` }),
    failsWith("invalid_request"),
  );
  assert.equal((await memberOf(world.owner, "alice"))?.message, full);

  assert.deepEqual(await call(alice, api.setStatusMessage, { message: "  \n " }), {
    message: null,
  });
  await eventually(() => assert.equal(seen(), null));
});

test("멤버가 아니면 다른 사람의 접속 상태와 상태 메시지를 읽지도 바꾸지도 못한다. 권한을 잃으면 목록에서도 빠진다", async (t) => {
  const world = await startWorld({ recheckMs: 50 });
  t.after(world.stop);
  world.github.grant("alice");
  const alice = await world.login("alice");
  await call(alice, api.setStatusMessage, { message: "비밀 작업 중" });
  const window = await world.live(alice);

  // push 권한이 없는 계정은 들어오지 못한다.
  await assert.rejects(world.login("mallory"), failsWith("forbidden"));
  // 세션 없이, 또는 지어낸 세션으로는 읽지도 쓰지도 못한다.
  for (const as of [{ url: world.server.url }, { url: world.server.url, session: "made-up" }]) {
    await assert.rejects(call(as, api.members), failsWith("unauthorized"));
    await assert.rejects(
      call(as, api.setPresence, { presence: "away" }),
      failsWith("unauthorized"),
    );
    await assert.rejects(
      call(as, api.setStatusMessage, { message: "끼어들기" }),
      failsWith("unauthorized"),
    );
  }
  const intruder = await world.live({ session: "made-up" });
  assert.equal(await intruder.closed, 1008);
  assert.deepEqual(
    intruder.received.map((m) => m.kind),
    ["error"],
  );

  // 권한을 잃으면 세션이 끝나 창이 닫히고, 읽지 못하고, 다른 멤버의 목록에서 빠진다.
  world.github.revoke("alice");
  assert.equal(await window.closed, 1008);
  await assert.rejects(call(alice, api.members), failsWith("unauthorized"));
  const { members } = await call(world.owner, api.members);
  assert.deepEqual(
    members.map((member) => member.login),
    ["owner"],
  );
  assert.doesNotMatch(JSON.stringify(members), /비밀 작업 중/);
});
