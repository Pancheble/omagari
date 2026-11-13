// 로컬 데모: 화면을 둘러보려고 Omagari를 띄운다. `node test/demo.ts`
// - 가짜 GitHub로 띄운다. 브라우저의 "GitHub으로 로그인"은 1.5초 뒤 저절로 승인되어 "나"로 들어온다.
// - 내 러너에는 이 기기의 실제 Claude Code(깔려 있고 로그인했으면 Codex도)를 꽂는다. DM은 실제로 답하고 구독 사용량을 쓴다.
//   미리 넣는 문답과 남의 질문에만 정해 둔 답을 낸다.
// - 화면의 모든 상태를 볼 수 있게 미리 넣는다: 멤버 넷과 그 기기, 채팅 채널 둘, 부딪힘 포럼의 알림 아홉(직접 충돌, 간접 충돌,
//   중복 구현, 선언된 계약 변경, 풀린 것), 포스트의 글과 DM, 남에게 묻기와 답, 결정 PR 일곱(제안됨, 이의, 다시 열림, 수락됨,
//   버림, 머지 멈춤, 머지 막힘). 결정 초안은 저장하지 않아 미리 넣지 못한다. 포스트 "박민수 · 최하준"에서 정리하기를 누른다.
// - DEMO_AGENT=fake: 내 에이전트도 정해 둔 답을 낸다. 초안은 5초 동안 "쓰는 중"이다. 사용량을 쓰지 않는다.
// - DEMO_RUNNER=off: 다 넣은 뒤 내 러너를 끈다. 초안의 "러너 꺼짐"을 본다.
// - 끝내면(Ctrl+C) 임시 레포와 DB를 지운다. 이름이 *.test.ts가 아니라 npm test와 CI는 돌리지 않는다.
// - GitHub 머지를 막아 둔 채로 끝난다("머지 막힘"을 보이려고). 그 뒤로 Omagari가 하는 머지는 모두 막힌다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { api, call } from "@omagari/contract";
import { claudeCode, codex, codexReady, type Executor } from "@omagari/runner";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

type As = { url: string; session: string; login: string };

/** 미리 넣는 질문(문답이나 남의 질문)에 낼 답. 질문 글이 들어 있으면 이 답이다. */
const CANNED: [string, string][] = [
  [
    "부분 환불은 어디서 금액을 계산해?",
    "`src/pay.ts`의 `refund()`가 받은 금액을 그대로 음수로 돌려요. 이미 환불한 금액을 빼는 곳은 없어서, 부분 환불이 두 번 들어오면 남은 금액을 넘을 수 있어요.",
  ],
  [
    "지금 webhook 재시도 간격을 바꾸고 있나요",
    "아니요. 지금은 `src/ledger.ts`의 결제 기록만 고치고 있어요. 재시도 간격은 손대지 않았어요.",
  ],
];
const DRAFT = {
  title: "메일 발송은 큐를 거친다",
  context: "박민수와 최하준이 `src/mail.ts` 3번 줄을 함께 고쳤다.",
  decision: "메일은 바로 보내지 않고 큐에 넣는다. 최하준의 판을 남긴다.",
  consequences: "박민수의 브랜치는 큐 함수를 쓰도록 다시 맞춘다.",
};
const canned = (message: string) => CANNED.find(([q]) => message.includes(q))?.[1];
/**
 * 정해 둔 답이 있으면 그것을, 없으면 `real`을 부른다. `real`이 없으면 초안이나 짧은 답을 낸다.
 * 초안은 포스트의 대화(미리 넣은 질문도 든다)를 감싸 오므로 정해 둔 답과 맞추지 않는다.
 */
const scripted = (real?: Executor): Executor =>
  Object.assign(
    async (input: Parameters<Executor>[0]) => {
      const draft = input.message.includes('"consequences": "…"');
      const answer = draft ? undefined : canned(input.message);
      if (answer || !real) {
        if (draft) await sleep(5_000);
        const text = answer ?? (draft ? JSON.stringify(DRAFT) : "데모라 정해 둔 답이에요.");
        return { answer: text, session: input.resume ?? crypto.randomUUID() };
      }
      return real(input);
    },
    { choices: real?.choices },
  );

const fakeAgent = process.env.DEMO_AGENT === "fake";
const executors = {
  "claude-code": scripted(fakeAgent ? undefined : claudeCode),
  ...(!fakeAgent && (await codexReady()) ? { codex } : {}),
};
// 머지 멈춤을 보이려고 한 멤버의 GitHub 토큰을 지운다. 권한 재확인이 그 멤버를 내보내지 않게 늦춘다.
const world = await startWorld({ executors, observeMs: 200, recheckMs: 2 ** 31 - 1 });
const fake = world.github;
const NAMES = { owner: "나 (데모)", minsu: "박민수", seoyeon: "이서연", hajun: "최하준" };
for (const [login, name] of Object.entries(NAMES)) fake.names.set(login, name);
// "나"는 이름을 정하기 전에 들어왔다. 다시 들어와 이름을 고친다.
await world.login("owner");

// 기준 커밋: 함수 둘과 그것을 쓰는 곳, 그리고 줄 열 개짜리 파일들.
const LINES = Array.from({ length: 10 }, (_, i) => `// line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;
const line3 = (who: string) => text(LINES.toSpliced(2, 1, `export const owner = "${who}";`));
const PAY = `export function pay(amount: number) {
  return amount;
}
export function refund(amount: number) {
  return -amount;
}
`;
const own = writer(world.repo.folder);
await own("src/pay.ts", PAY);
await own(
  "src/checkout.ts",
  'import { pay, refund } from "./pay";\nexport const total = pay(1) + refund(2);\n',
);
for (const file of ["config", "webhook", "ledger", "retry", "mail", "i18n"])
  await own(`src/${file}.ts`, text(LINES));
await world.repo.git("add", ".");
await world.repo.git("commit", "--message=base");
await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

/** 멤버 `login`의 기기: 내 main을 받아 `branch`에서 일한다. 받는 동안은 러너를 꺼 둔다. */
async function member(login: keyof typeof NAMES, branch: string, uses = false) {
  fake.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(as, undefined, {
    "claude-code": fakeExecutor((input) => canned(input.message) ?? "데모라 정해 둔 답이에요.")
      .executor,
  });
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  // pay와 refund를 쓰는 사람은 박민수뿐이다. 다른 사람에게 간접 충돌과 계약 변경 알림이 더 서지 않게 쓰는 곳을 지운다.
  if (!uses) {
    await desk.git("rm", "--quiet", "src/checkout.ts");
    await desk.git("commit", "--quiet", "--message=checkout 지우기");
  }
  await desk.start();
  return { as, desk, write: writer(desk.folder) };
}
const minsu = await member("minsu", "fix/webhook-retry", true);
const seoyeon = await member("seoyeon", "feat/i18n");
const hajun = await member("hajun", "feat/mail-queue");
await world.repo.git("switch", "--create", "feat/payment-model");
await eventually(async () =>
  assert.ok((await world.works(world.owner)).some((w) => w.branch === "feat/payment-model")),
);

// 채팅 채널과 글.
const pay = await world.channel(world.owner, "결제");
await world.channel(world.owner, "일반");
const say = (as: As, channel: string, text: string) => call(as, api.send, { channel, text });
await say(
  minsu.as,
  pay,
  "환불할 때 결제 모델의 amount를 그대로 쓰나요? 부분 환불이면 깨질 것 같은데요.",
);
await say(world.owner, pay, "지금은 그대로 써요. 시그니처 바꾸면서 같이 보려고요.");
await say(minsu.as, pay, "좋아요, 저는 웹훅 쪽만 볼게요.");

// 부딪힘: 같은 줄(직접 충돌), 정의 줄을 바꾼 함수를 쓰는 곳(간접 충돌), 같은 이름의 새 정의(중복 구현), 선점에 붙인 계획(선언된 계약 변경).
await own("src/config.ts", line3("owner"));
await own("src/webhook.ts", line3("owner"));
await own("src/ledger.ts", line3("owner"));
await own(
  "src/pay.ts",
  PAY.replace("refund(amount: number)", "refund(amount: number, reason: string)"),
);
await own("src/money.ts", "export const split = (total: number) => [total];\n");
await minsu.write("src/config.ts", line3("minsu"));
await minsu.write("src/retry.ts", line3("minsu"));
await minsu.write("src/mail.ts", line3("minsu"));
await minsu.write("src/split.ts", "export function split(n: number) {\n  return [n];\n}\n");
await seoyeon.write("src/webhook.ts", line3("seoyeon"));
await seoyeon.write("src/retry.ts", line3("seoyeon"));
await seoyeon.write("src/i18n.ts", line3("seoyeon"));
await hajun.write("src/ledger.ts", line3("hajun"));
await hajun.write("src/mail.ts", line3("hajun"));
await hajun.write("src/i18n.ts", line3("hajun"));
await world.signInCli(world.owner);
const claimed = await world.cli(
  "claim",
  "src/pay.ts",
  "--symbol",
  "pay",
  "--plan",
  "signature",
  "--detail",
  "pay(amount, currency)",
);
assert.equal(claimed.code, 0, claimed.stderr);

/** 부딪힘 포럼의 알림들. */
const alerts = async () => {
  const forum = (await call(world.owner, api.channels)).channels.find((c) => c.name === "부딪힘");
  if (!forum) return [];
  return (await call(world.owner, api.history, { channel: forum.id })).messages.flatMap((m) =>
    m.kind === "alert" ? [{ id: m.id, alert: m.alert }] : [],
  );
};
/** `a`와 `b` 사이의 `kind` 알림. 설 때까지 기다린다. */
const alertOf = (kind: string, a: string, b: string) =>
  eventually(async () => {
    const found = (await alerts()).find(
      ({ alert }) =>
        alert.kind === kind &&
        alert.resolved === null &&
        [a, b].every((login) => alert.works.some((w) => w.login === login)),
    );
    assert.ok(found, `아직 ${a}·${b}의 ${kind} 알림이 없다`);
    return found.id;
  }, 60_000);
/** 알림의 포스트를 열고 그 채널을 돌려준다. */
const postOf = async (alert: number) =>
  (await call(world.owner, api.openPost, { alert })).post.channel;

// 풀린 알림: 이서연과 최하준이 부딪혔다가 최하준이 되돌린다.
const i18n = await alertOf("direct", "seoyeon", "hajun");
await hajun.desk.git("checkout", "--", "src/i18n.ts");
await eventually(async () =>
  assert.notEqual((await alerts()).find((a) => a.id === i18n)?.alert.resolved, null),
);
const resolvedPost = await postOf(i18n);
await say(seoyeon.as, resolvedPost, "제가 i18n 키를 먼저 넣을게요.");
await say(hajun.as, resolvedPost, "그럼 저는 되돌려 둘게요.");

const DECISION = (title: string) => ({
  title,
  context: "두 작업이 같은 곳을 고쳤다.",
  decision: `${title}.`,
  consequences: "한쪽 브랜치를 다시 맞춘다.",
});
const propose = async (as: As, post: string, title: string, window?: "now") =>
  (await call(as, api.proposeDecision, { post, ...DECISION(title), ...(window ? { window } : {}) }))
    .decision;
const respond = (as: As, id: number, response: "agree" | "object" | "withdraw") =>
  call(as, api.respondToDecision, { id, response });

// 제안됨: 박민수가 정리했고 나는 동의나 이의를 낼 수 있다.
const direct = await postOf(await alertOf("direct", "owner", "minsu"));
await say(minsu.as, direct, "config의 타임아웃은 제가 바꾼 값으로 갈게요.");
await say(world.owner, direct, "좋아요. 저는 그 위에서 다시 맞출게요.");
await propose(minsu.as, direct, "결제 타임아웃은 30초로 둔다");

// 이의: 박민수가 정리했고 내가 이의를 냈다.
const indirect = await postOf(await alertOf("indirect", "owner", "minsu"));
await say(minsu.as, indirect, "refund()에 reason을 넣으면 checkout도 바꿔야 해요.");
await say(world.owner, indirect, "reason은 선택으로 두면 어떨까요?");
await respond(
  world.owner,
  (await propose(minsu.as, indirect, "refund는 reason을 꼭 받는다")).id,
  "object",
);

// 다시 열림: 이의를 냈다가 거뒀다.
const duplicate = await postOf(await alertOf("duplicate", "owner", "minsu"));
await say(minsu.as, duplicate, "split을 둘이 따로 만들었네요.");
await say(world.owner, duplicate, "제 것은 지울게요.");
const reopened = await propose(minsu.as, duplicate, "split은 src/split.ts 하나만 둔다");
await respond(world.owner, reopened.id, "object");
await respond(world.owner, reopened.id, "withdraw");

// 수락됨: 내가 "바로"로 정리해 바로 머지됐다.
const declared = await postOf(await alertOf("declared", "owner", "minsu"));
await say(world.owner, declared, "pay()에 currency를 넣을 거예요.");
await say(minsu.as, declared, "checkout은 제가 따라 바꿀게요.");
await propose(world.owner, declared, "pay는 currency를 받는다", "now");

// 버림: 내가 정리했다가 버렸다.
const webhook = await postOf(await alertOf("direct", "owner", "seoyeon"));
await say(seoyeon.as, webhook, "웹훅 서명 검사를 제가 넣고 있어요.");
await say(world.owner, webhook, "그럼 제 쪽은 빼죠.");
const discarded = await propose(world.owner, webhook, "웹훅 서명 검사는 결제 쪽에 둔다");
await call(world.owner, api.discardDecision, { id: discarded.id });

// 머지 멈춤: 최하준이 정리한 뒤 최하준의 GitHub 토큰이 듣지 않는다. 내가 동의해 모두 동의했지만 머지하지 못한다.
const ledger = await postOf(await alertOf("direct", "owner", "hajun"));
await say(hajun.as, ledger, "결제 기록 형식을 바꾸고 있어요.");
await say(world.owner, ledger, "형식은 하준 님 것으로 가요.");
const stalled = await propose(hajun.as, ledger, "결제 기록은 최하준의 형식을 따른다");
for (const [token, login] of fake.tokens) if (login === "hajun") fake.tokens.delete(token);
await respond(world.owner, stalled.id, "agree");

// 머지 막힘: GitHub이 리뷰 승인 없이는 머지를 막는다. 내가 "바로"로 정리했다.
const retry = await postOf(await alertOf("direct", "minsu", "seoyeon"));
await say(minsu.as, retry, "재시도 간격은 지수로 늘려요.");
await say(seoyeon.as, retry, "최대 5번까지만요.");
await say(world.owner, retry, "둘 다 좋아요. 정리해 둘게요.");
fake.block("HTTP 405 At least 1 approving review is required by reviewers with write access.");
await propose(world.owner, retry, "웹훅 재시도는 지수로 최대 5번", "now");

// 결정 없는 포스트: 글, 내 DM의 문답, 포스트에 올린 문답. 여기서 정리하기를 눌러 초안을 본다.
const mail = await postOf(await alertOf("direct", "minsu", "hajun"));
await say(minsu.as, mail, "메일을 바로 보내면 결제가 느려져요.");
await say(hajun.as, mail, "큐를 넣고 있어요. 제 판으로 가면 될 것 같아요.");
await say(world.owner, mail, "두 분 판을 보고 정리해 볼게요.");
const posted = await world.ask(world.owner, mail, CANNED[0][0]);
await world.settled(world.owner, posted);
await call(world.owner, api.postQa, { qa: posted.id, text: "참고로 붙여요" });
await world.settled(world.owner, await world.ask(world.owner, mail, CANNED[0][0]));

// 남에게 묻기와 답: 박민수의 에이전트가 내 에이전트에게 묻고, 내가 박민수의 에이전트에게 묻는다.
const asked = await world.cliIn(minsu.desk.folder, "ask", "owner", CANNED[1][0]);
assert.equal(asked.code, 0, asked.stderr);
const asking = await world.cli("ask", "minsu", CANNED[1][0]);
assert.equal(asking.code, 0, asking.stderr);
await eventually(async () => assert.ok((await call(world.owner, api.settings)).answered.count > 0));

if (process.env.DEMO_RUNNER === "off") await world.runner.stop();

// 미리 넣을 것을 다 넣은 뒤부터, 브라우저에서 연 기기 인증은 GitHub에서 코드를 넣는 대신 여기서 "나"로 승인한다.
const startDevice = fake.github.startDevice.bind(fake.github);
fake.github.startDevice = async () => {
  const device = await startDevice();
  setTimeout(() => {
    try {
      fake.approve(device.userCode, "owner");
    } catch {
      // 그사이 만료됐거나 이미 끝난 인증이다.
    }
  }, 1500);
  return device;
};

const PORT = process.env.DEMO_PORT ?? process.env.PORT ?? "5180";
const web = spawn("npx", ["vite", "--port", PORT, "--strictPort"], {
  cwd: new URL("../packages/web/", import.meta.url),
  stdio: "inherit",
  env: { ...process.env, OMAGARI_SERVER: world.server.url },
});
console.log(`Omagari 데모 서버: ${world.server.url}`);
console.log(`화면: http://localhost:${PORT} (실행기: ${Object.keys(executors).join(", ")})`);

// 신호가 거듭 와도 한 번만 끈다. 두 번 끄면 이미 닫힌 DB를 다시 닫다가 죽는다.
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  web.kill("SIGINT");
  await world.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
