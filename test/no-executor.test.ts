import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { startWorld } from "./harness.ts";

// 실행기를 하나도 알리지 않은 러너(멤버 기기에 Claude Code도 Codex도 없음)는 답할 수 있는 러너가 아니다.
// 그런 러너가 붙어 있어도 질문을 보내려는 서버가 끊기면 안 된다.

test("실행기 없는 러너가 붙은 멤버에게 묻는 것은 보내지 않고, 서버는 계속 답한다", async (t) => {
  const world = await startWorld();
  t.after(world.stop);
  // bob의 러너는 실행기를 하나도 알리지 않는다.
  world.github.grant("bob");
  const bobAs = await world.login("bob");
  const bob = await world.desk(bobAs, undefined, {});
  t.after(bob.remove);

  const asked = await world.cli("ask", "bob", "charge()에 재시도를 넣나요?");
  assert.equal(asked.code, 0, asked.stderr);
  // 실행기가 없으니 답할 러너가 없다: 보내지 않고 오프라인으로 남겨 둔다.
  assert.match(asked.stdout, /^bob's runner is offline, so question #\d+ is waiting\./);

  // 서버가 살아 있다: 다른 멤버의 요청이 그대로 답을 받는다.
  const members = await call(world.owner, api.members);
  assert.ok(members.members.some((m) => m.login === "bob"));
});
