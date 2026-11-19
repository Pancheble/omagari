// 계약 선언(#87): 선점에 붙인 계획이 그 심볼을 쓰는 작업에 알림으로 가고, 대체되고, 이루지 못한 채 풀면 취소된다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Alert, api, call } from "@omagari/contract";
import { eventually, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;
type As = { url: string; session: string };
type Declared = Exclude<Alert, { kind: "direct" }> & { id: number };

const PAY = `export function pay(amount: number) {
  return amount;
}
export function refund(amount: number) {
  return -amount;
}
`;
const CHECKOUT = `import { pay, refund } from "./pay";
export const total = pay(1) + refund(2);
`;

/** 기준 커밋에 src/pay.ts와 src/checkout.ts를 두고 origin/main을 올린다. */
async function base(world: World) {
  await writer(world.repo.folder)("src/pay.ts", PAY);
  await writer(world.repo.folder)("src/checkout.ts", CHECKOUT);
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
}

/** alice의 기기: 내 main 위에서 refund 브랜치를 시작한다(conflicts.test와 같다). */
async function alice(world: World) {
  world.github.grant("alice");
  const as = await world.login("alice");
  const desk = await world.desk(as);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "refund");
  await desk.start();
  return desk;
}

/** owner가 payment 브랜치로 옮기고 서버가 그것을 볼 때까지 기다린다. */
async function payment(world: World) {
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
}

/** owner의 레포에서 `omagari <args>`를 돌려 성공한 출력. */
async function omagari(world: World, args: string[], cwd = world.repo.folder) {
  const { code, stdout, stderr } = await world.cliIn(cwd, ...args);
  assert.equal(code, 0, stderr);
  return stdout;
}

/** 선언된 계약 변경 알림들. */
async function declared(as: As): Promise<Declared[]> {
  const messages = (await call(as, api.posts)).posts.map((p) => p.message);
  return messages.flatMap((m) =>
    m.kind === "alert" && m.alert.kind === "declared" ? [{ id: m.id, ...m.alert } as Declared] : [],
  );
}

const inboxLines = (output: string) =>
  output.split("<omagari-inbox>\n")[1]?.split("\n</omagari-inbox>")[0]?.split("\n") ?? [];

/** `cwd`에서 `omagari status`를 거듭 돌려 편지함에 `line`이 넘겨질 때까지 기다린다. 넘겨받은 줄을 모두 돌려준다. */
async function receives(world: World, cwd: string, line: string, seen: string[] = []) {
  await eventually(async () => {
    seen.push(...inboxLines((await world.cliIn(cwd, "status")).stdout));
    assert.ok(seen.includes(line), JSON.stringify(seen));
  });
  return seen;
}

const OWNER = { login: "owner", name: "owner", branch: "payment" };
const ALICE = { login: "alice", name: "alice", branch: "refund" };
const USES = [
  { path: "src/checkout.ts", line: 1, role: "uses" },
  { path: "src/checkout.ts", line: 2, role: "uses" },
] as const;

test("선점에 계획을 붙이면 코드를 바꾸기 전에 쓰는 작업에 알림이 가고, 새 계획이 옛 것을 대체하고, 이루지 못한 채 풀면 취소됨이 간다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const desk = await alice(world);
  t.after(desk.remove);
  await payment(world);

  // 코드는 그대로 두고 refund의 시그니처 변경을 선언한다. 알림이 빨리 서면 이 명령의 응답 끝에 owner의 편지함 소식이 붙어 넘겨진다.
  const claimed = await omagari(world, [
    "claim",
    "src/pay.ts",
    "--symbol",
    "refund",
    "--plan",
    "signature",
    "--detail",
    "refund(amount, reason)",
  ]);
  assert.match(
    claimed,
    /^Claimed on payment: "refund" in "src\/pay.ts" lines 4-6 · plan: Signature change "refund" "refund\(amount, reason\)"\n/,
  );
  const signature = { kind: "signature", symbol: "refund", detail: "refund(amount, reason)" };
  const first = await eventually(async () => {
    const found = await declared(world.owner);
    assert.equal(found.length, 1, JSON.stringify(found));
    return found[0] as Declared;
  });
  assert.deepEqual(first, {
    id: first.id,
    kind: "declared",
    works: [ALICE, OWNER],
    symbols: [
      {
        name: "refund",
        places: [USES, [{ path: "src/pay.ts", line: 4, role: "declared" }]],
        plan: signature,
      },
    ],
    more: 0,
    resolved: null,
  });
  // 쓰는 쪽과 바꾸는 쪽 편지함 모두에 들어간다.
  await receives(
    world,
    desk.folder,
    `- Declared Contract change: my Work and owner's branch "payment". One side declared in its Claim that it will change the symbol (the code may not have changed yet), and the other side uses that name. "refund" (me: Uses "src/checkout.ts":1, "src/checkout.ts":2 / them: Declared a change "src/pay.ts":4 / plan: Signature change "refund" "refund(amount, reason)")`,
  );
  await receives(
    world,
    world.repo.folder,
    `- Declared Contract change: my Work and alice's branch "refund". One side declared in its Claim that it will change the symbol (the code may not have changed yet), and the other side uses that name. "refund" (me: Declared a change "src/pay.ts":4 / them: Uses "src/checkout.ts":1, "src/checkout.ts":2 / plan: Signature change "refund" "refund(amount, reason)")`,
    inboxLines(claimed),
  );

  // 쓰는 쪽의 omagari impact가 걸린 계획을 보인다.
  assert.match(
    await omagari(world, ["impact", "refund"], desk.folder),
    /Other members' Claims that declare a change \(with a plan attached\):\n {2}owner's branch "payment" · "refund" in "src\/pay.ts" lines 4-6 · plan: Signature change "refund" "refund\(amount, reason\)"\n/,
  );

  // 같은 심볼에 다른 곳(줄 범위)으로 새 계획을 걸면 옛 계획을 대체하고, 같은 알림이 새 계획으로 고쳐진다.
  await omagari(world, ["claim", "src/pay.ts", "--lines", "4-6", "--plan", "rename:refund"]);
  await eventually(async () => {
    const found = await declared(world.owner);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]?.id, first.id);
    assert.deepEqual(
      found[0]?.symbols.map((s) => s.plan),
      [{ kind: "rename", symbol: "refund" }],
    );
  });

  // 계획을 이루지 못한 채 풀면 알림을 받은 작업에 취소됨이 가고, 알림은 풀린다.
  // 모든 omagari 명령이 응답 끝에 편지함을 넘기므로 release의 응답도 owner가 본 것이다.
  const released = inboxLines(await omagari(world, ["release"]));
  const seen = await receives(
    world,
    desk.folder,
    `- Declared Contract change cancelled: owner's branch "payment" released the Claim on "refund" (plan: Rename) without carrying out the plan. If you changed anything to fit that plan, undo it or ask them.`,
  );
  await receives(
    world,
    desk.folder,
    `- Resolved: my Work and owner's branch "payment"'s Declared contract change`,
    seen,
  );
  assert.notEqual((await declared(world.owner))[0]?.resolved, null);
  // 바꾸는 쪽은 취소됨을 받지 않는다.
  const own = await receives(
    world,
    world.repo.folder,
    `- Resolved: my Work and alice's branch "refund"'s Declared contract change`,
    released,
  );
  assert.ok(!own.some((line) => line.includes("cancelled")), JSON.stringify(own));
});

test("계획대로 정의 줄을 바꾼 뒤 풀면 취소됨이 가지 않는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const desk = await alice(world);
  t.after(desk.remove);
  await payment(world);

  await omagari(world, ["claim", "src/pay.ts", "--symbol", "refund", "--plan", "signature"]);
  await eventually(async () => assert.equal((await declared(world.owner)).length, 1));
  // 계획대로 시그니처를 바꾸고, 서버가 그 정의 줄을 볼 때까지 기다린다.
  await writer(world.repo.folder)(
    "src/pay.ts",
    PAY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
  );
  await eventually(async () => {
    const work = (await world.works(world.owner)).find((w) => w.branch === "payment");
    const file = work?.files.find((f) => f.path === "src/pay.ts");
    assert.ok(
      file && "definitions" in file && file.definitions?.some((d) => d.change === "changed"),
    );
  });
  await omagari(world, ["release"]);
  const seen = await receives(
    world,
    desk.folder,
    `- Resolved: my Work and owner's branch "payment"'s Declared contract change`,
  );
  assert.ok(!seen.some((line) => line.includes("cancelled")), JSON.stringify(seen));
});

test("--plan은 종류가 맞아야 하고 심볼이 있어야 하며, release에는 주지 않는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  await payment(world);
  for (const args of [
    ["claim", "src/pay.ts", "--symbol", "refund", "--plan", "move"],
    ["claim", "src/pay.ts", "--lines", "4-6", "--plan", "delete"],
    ["claim", "src/pay.ts", "--symbol", "refund", "--detail", "x"],
    ["release", "--plan", "delete:refund"],
  ]) {
    const { code, stderr } = await world.cli(...args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /--plan|--detail/, args.join(" "));
  }
});
