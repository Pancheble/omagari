import assert from "node:assert/strict";
import { test } from "node:test";
import { eventually, startWorld, writer } from "./harness.ts";

type World = Awaited<ReturnType<typeof startWorld>>;

const PAY = `export function pay(amount: number): void {
  charge(amount);
}

export function refund(id: string) {
  return id;
}

export class Wallet {
  open(owner: string) {}
}

export interface Receipt {
  id: string;
}
`;

/** `login`의 기기: 내 레포를 받은 것처럼 내 main 위에서 시작한다. 기준 커밋이 그 기기에도 있다. */
async function member(world: World, login: string, share?: "declared" | "intent") {
  world.github.grant(login);
  const desk = await world.desk(await world.login(login), share);
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  return desk;
}

async function base(world: World) {
  const { git, folder } = world.repo;
  await writer(folder)("src/pay.ts", PAY);
  await writer(folder)(
    "src/use.ts",
    `import { pay } from "./pay";\n\npay(1);\nnew Wallet().open("me");\n`,
  );
  await git("add", ".");
  await git("commit", "--message=base");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
}

test("관측에 바뀐 파일의 정의 줄이 실리고, 새로 생긴 정의와 정의 줄이 바뀐 것과 없어진 것을 가린다. 본문만 바뀐 것은 표시가 없다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  const { git, folder } = world.repo;
  const write = writer(folder);
  await write("lib/old.js", "function legacy(a) {}\n");
  await base(world);
  await git("switch", "--create", "feat");
  const pay = PAY.replace("charge(amount);", "charge(amount * 2);") // 본문만
    .replace("refund(id: string)", "refund(id: string, reason: string)") // 정의 줄
    .replace("  open(owner: string) {}\n", "") // 메서드를 없앤다
    .concat("\nexport const split = (amount: number) => [amount];\n"); // 새 정의
  await write("src/pay.ts", pay);
  await write("src/new.tsx", "export function Button() {\n  return <b />;\n}\n");
  await git("rm", "--quiet", "lib/old.js");
  // 다른 언어의 파일은 정의 줄 없이 지금처럼 올라간다.
  await write("tools/pay.py", "def pay(amount):\n    pass\n");
  await write("README.md", "# pay\n");

  await eventually(async () => {
    const [work] = await world.works(world.owner);
    assert.deepEqual(work?.files, [
      { path: "README.md", content: "# pay\n" },
      {
        path: "lib/old.js",
        deleted: true,
        definitions: [{ name: "legacy", kind: "function", line: 1, change: "removed" }],
      },
      {
        path: "src/new.tsx",
        content: "export function Button() {\n  return <b />;\n}\n",
        definitions: [{ name: "Button", kind: "function", line: 1, change: "added" }],
      },
      {
        path: "src/pay.ts",
        content: pay,
        definitions: [
          { name: "pay", kind: "function", line: 1 },
          { name: "refund", kind: "function", line: 5, change: "changed" },
          { name: "Wallet", kind: "class", line: 9 },
          { name: "Receipt", kind: "interface", line: 12 },
          { name: "split", kind: "function", line: 16, change: "added" },
          { name: "Wallet.open", kind: "method", line: 10, change: "removed" },
        ],
      },
      { path: "tools/pay.py", content: "def pay(amount):\n    pass\n" },
    ]);
  });

  // 본문만 바꾼 파일은 정의 줄이 실려도 바뀐 것으로 보이지 않는다.
  await git("checkout", "--", ".");
  await git("clean", "--quiet", "--force", "-d");
  await write("src/pay.ts", PAY.replace("charge(amount);", "charge(amount + 1);"));
  await eventually(async () => {
    const [work] = await world.works(world.owner);
    const pay = work?.files.find((f) => f.path === "src/pay.ts");
    assert.ok(pay && "definitions" in pay);
    assert.deepEqual(
      pay.definitions?.filter((d) => d.change),
      [],
    );
  });
});

test("공유 수준이 declared나 intent면 정의 줄을 올리지 않는다. gitignore된 파일과 .env 계열은 정의 줄도 나가지 않는다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const alice = await member(world, "alice", "declared");
  t.after(alice.remove);
  const bob = await member(world, "bob", "intent");
  t.after(bob.remove);
  const changed = PAY.replace("refund(id: string)", "refund(id: number)");
  await writer(alice.folder)("src/pay.ts", changed);
  await writer(bob.folder)("src/pay.ts", changed);

  const { git, folder } = world.repo;
  await writer(folder)(".gitignore", "secret.ts\n");
  await writer(folder)("secret.ts", "export function hidden() {}\n");
  await writer(folder)(".env.ts", "export function token() {}\n");
  await writer(folder)("config/.env.local.js", "function key() {}\n");
  await git("add", ".gitignore");
  await git("add", "--force", ".env.ts");

  await eventually(async () => {
    const works = await world.works(world.owner);
    assert.deepEqual(
      works.map(({ login, share, files }) => ({ login, share, files })),
      [
        { login: "alice", share: "declared", files: [{ path: "src/pay.ts", omitted: "share" }] },
        { login: "bob", share: "intent", files: [] },
        { login: "owner", share: "full", files: [{ path: ".gitignore", content: "secret.ts\n" }] },
      ],
    );
  });
});

test("omagari impact가 내 사본에서 그 심볼을 쓰는 곳과, 그 정의 줄을 바꾸고 있는 다른 멤버의 작업을 보인다", async (t) => {
  const world = await startWorld({ observeMs: 50 });
  t.after(world.stop);
  await base(world);
  const { folder } = world.repo;
  // 다른 언어의 파일과 바이너리, 지운 파일이 있어도 깨지지 않는다.
  await writer(folder)("tools/pay.py", "pay(1)\n");
  await writer(folder)("docs/pay.md", "pay\n");
  await writer(folder)("web/view.jsx", "export const View = () => <Pay onPay={pay} />;\n");
  await writer(folder)("bin/blob.js", new Uint8Array([0, 1, 2, 112, 97, 121]));
  await writer(folder)(".env.js", "pay();\n");

  const alice = await member(world, "alice");
  t.after(alice.remove);
  const bob = await member(world, "bob");
  t.after(bob.remove);
  // alice는 pay의 정의 줄을 바꾸고, bob은 본문만 바꾼다.
  await writer(alice.folder)(
    "src/pay.ts",
    PAY.replace("pay(amount: number)", "pay(amount: bigint)"),
  );
  await writer(bob.folder)("src/pay.ts", PAY.replace("charge(amount);", "charge(amount); log();"));
  await writer(bob.folder)("src/other.py", "def pay(): pass\n");

  const impact = async (symbol: string) => {
    const { code, stdout, stderr } = await world.cli("impact", symbol);
    assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
    return stdout;
  };
  await eventually(async () =>
    assert.equal(
      await impact("pay"),
      `심볼 pay
쓰는 곳(내 사본, 이름으로 이어 다른 심볼일 수 있다):
  src/use.ts:1
  src/use.ts:3
  web/view.jsx:1
정의 줄을 바꾸고 있는 다른 멤버의 작업:
  alice · main · src/pay.ts:1 함수 pay 정의 줄을 바꿈
`,
    ),
  );
  // 메서드는 클래스.메서드나 메서드 이름으로 묻는다. 아무도 바꾸지 않으면 없음이다.
  const method = `  src/use.ts:4
정의 줄을 바꾸고 있는 다른 멤버의 작업:
  없음
`;
  assert.equal(
    await impact("Wallet.open"),
    `심볼 Wallet.open\n쓰는 곳(내 사본, 이름으로 이어 다른 심볼일 수 있다):\n${method}`,
  );
  assert.equal(
    await impact("nothing"),
    `심볼 nothing
쓰는 곳(내 사본, 이름으로 이어 다른 심볼일 수 있다):
  없음
정의 줄을 바꾸고 있는 다른 멤버의 작업:
  없음
`,
  );
});
