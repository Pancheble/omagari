// 로컬 데모: 화면을 둘러보려고 Omagari를 띄운다. `node test/demo.ts`
// - 가짜 GitHub로 띄운다. 브라우저의 "GitHub으로 로그인"은 1.5초 뒤 저절로 승인되어 "나"로 들어온다.
// - 내 러너에는 이 기기의 실제 Claude Code(깔려 있고 로그인했으면 Codex도)를 꽂는다. DM은 실제로 답하고 구독 사용량을 쓴다.
//   미리 넣는 문답과 남의 질문에만 정해 둔 답을 낸다.
// - 화면의 모든 상태를 볼 수 있게 미리 넣는다: 멤버 넷과 그 기기, 채팅 채널 둘, 라벨(논의와 참고, 팀 라벨)과 포럼 셋
//   ("논의", 고친 "참고", 멤버가 만든 "결제 팀")과 "다른 포스트", 포럼의 알림 아홉(직접 충돌, 간접 충돌,
//   중복 구현, 선언된 계약 변경, 풀린 것), 포스트의 글과 DM, 남에게 묻기와 답, 결정 PR 일곱(제안됨, 이의, 다시 열림, 수락됨,
//   버림, 머지 멈춤, 머지 막힘). 결정 초안은 저장하지 않아 미리 넣지 못한다. 포스트 "박민수 · 최하준"에서 정리하기를 누른다.
// - DEMO_AGENT=fake: 내 에이전트도 정해 둔 답을 낸다. 초안은 5초 동안 "쓰는 중"이다. 사용량을 쓰지 않는다.
// - DEMO_RUNNER=off: 다 넣은 뒤 내 러너를 끈다. 초안의 "러너 꺼짐"을 본다.
// - 합쳐 돌려 보기(ADR-0036)의 판정은 검사 명령을 돌리지 않고 정해 둔 것을 올린다. 멤버 셋(정다은, 오우진, 한소라)의 가짜 러너가 내 작업과
//   간접 충돌(추정)을 걸고 판정을 올려, 포럼에 돌려 보는 중, 깨짐(출력 있음·없음), 가릴 수 없음, 돌리지 못함 넷(검사 명령 없음, 샌드박스 없음,
//   시간 초과, 직접 충돌), 지난 결과, 통과로 풀림, 결정 PR이 열려 띠가 둘인 포스트가 선다. 내 러너는 이 알림들을 돌리지 않는다(잠잠한 시간을 끝없이 둔다).
// - 토론(ADR-0040, #202): 가짜 러너(정다은, 오우진, 한소라, 김민지, 윤지호)끼리 간접 충돌을 걸고 내가 토론을 요청해, 포럼 "참고"의 "refund" 포스트들에
//   가린 첫 라운드, 반박 라운드, 기다리는 중(대행 부르기), 대행, 고를 차례(바꾼 입장, 사유 없이 바뀜, 실험 셋), 사람이 고른 결론, 실험으로 정함,
//   근거로 정함과 참여를 끈 자리, 내지 못해 끝남, 만료가 선다. "points"에는 근거 없이 낸 요청(열지 않음), "invoice"에는 나와 한소라의 토론이 있다.
//   깨짐으로 확인된 포스트("tax" 등)에는 토론이 저절로 열려 있다. 만료는 DB에서 연 시각을 당겨 만든다.
// - DEMO_MERGE_CHECK=off|no_sandbox: 설정 창의 내 러너의 합쳐 돌려 보기를 꺼 둠이나 샌드박스 없음으로 둔다. 안 주면 켜짐이다.
// - DEMO_CHECK=none: 기본 브랜치에 검사 명령(.omagari.json)을 두지 않는다. 설정 창의 "검사 명령 없음"을 본다.
// - 워크스페이스와 레포(ADR-0043, #238): 워크스페이스 "omagari-test"에 레포 둘(space, other)과 "나"가 Admin이지만 넣지 않은 레포(billing),
//   다른 계정의 워크스페이스 "other-team"(레포 code)이 있다. 레포마다 채팅 채널, other만 보는 포럼("other 논의"), 두 레포를 보는 포럼("릴리즈")이 있다.
//   other-team은 개인 계정이다(이름 줄의 아바타가 동그라미).
// - 사람 이름은 "이름 (로그인)"이고, 나·박민수·이서연만 프로필 사진(그린 그림)이 있다(#288).
// - DEMO_AS=minsu: 브라우저 로그인을 Admin이 아닌 박민수로 한다(omagari-test에서는 space에만, other-team의 code에 push 권한). 레포 넣기·빼기가 없다.
//   other의 채널 주소(콘솔에 찍는다)로 가면 "이 레포는 볼 수 없어요"가 보인다. other-team에는 박민수 혼자라 혼자일 때(시안 100-A)가 보인다.
// - GIPHY_API_KEY=<키>: 진짜 GIPHY로 GIF를 켠다(ADR-0044). 주지 않으면 입력 칸에 GIF 버튼이 없다.
//   DEMO_GIPHY=fake: 키 없이 GIF 칸을 본다. 찾는 말과 상관없이 GIPHY의 공개 GIF 여덟 개를 낸다(그림은 GIPHY에서 받는다).
// - 끝내면(Ctrl+C) 임시 레포와 DB를 지운다. 이름이 *.test.ts가 아니라 npm test와 CI는 돌리지 않는다.
// - 포스트마다 가짜 GitHub 이슈가 열리고 글이 댓글로 간다. 포스트 "박민수 · 최하준"에는 GitHub에서 단 댓글과 바꾼 제목·라벨이 들어온다.
// - GitHub 머지를 막아 둔 채로 끝난다("머지 막힘"을 보이려고). 그 뒤로 Omagari가 하는 머지는 모두 막힌다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import {
  api,
  call,
  type Debate,
  decode,
  encode,
  type MergeRun,
  RUNNER_SOCKET,
  runnerToServer,
  type Stance,
  serverToRunner,
} from "@omagari/contract";
import { claudeCode, codex, codexReady, type Executor } from "@omagari/runner";
import { realGiphy } from "@omagari/server";
import {
  eventually,
  fakeExecutor,
  fakeSandbox,
  REPO,
  REPO2,
  REPO3,
  startWorld,
  writer,
} from "./harness.ts";

type As = { url: string; session: string; login: string };

/** `DEMO_GIPHY=fake`의 GIF. giphy.com에서 "celebrate"로 찾은 공개 GIF다(2026-11-19). 크기는 칸 비율만 맞춘다. */
const DEMO_GIFS = (
  [
    ["s2qXK8wAvkHTO", "party birthday", 112],
    ["c1AfqKTvATepFDTpnY", "celebrate birthday", 200],
    ["BlVnrxJgTGsUw", "dancing happy", 150],
    ["1PMVNNKVIL8Ig", "80s excited", 160],
    ["geslvCFM31sFW", "dancing", 110],
    ["Na33dsU2umStO", "happy excited", 180],
    ["lsJCkIKV6AT28", "celebrate", 140],
    ["ePaw7nwYmSI1t389Sy", "confetti", 200],
  ] as const
).map(([id, title, height]) => ({
  id,
  title,
  url: `https://media.giphy.com/media/${id}/200w.gif`,
  width: 200,
  height,
}));

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
/**
 * 토론의 입장(ADR-0040). 러너는 턴을 한 줄로 세우므로, 토론 턴이 실제 실행기로 가면 뒤에 선 DM이 그만큼 기다린다.
 * 그래서 토론은 실제 실행기로 보내지 않고 정해 둔 입장을 낸다.
 */
const STANCE = JSON.stringify({
  claim: "데모라 정해 둔 입장이에요.",
  evidence: ["src/pay.ts:1 pay()의 정의"],
  changed: false,
  reason: "",
});
const canned = (message: string) =>
  /Omagari가 (토론을 열었다|연 토론)/.test(message)
    ? STANCE
    : CANNED.find(([q]) => message.includes(q))?.[1];
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

const FOREVER = 2 ** 31 - 1;
const fakeAgent = process.env.DEMO_AGENT === "fake";
const executors = {
  "claude-code": scripted(fakeAgent ? undefined : claudeCode),
  ...(!fakeAgent && (await codexReady()) ? { codex } : {}),
};
// 머지 멈춤을 보이려고 한 멤버의 GitHub 토큰을 지운다. 권한 재확인이 그 멤버를 내보내지 않게 늦춘다.
// 포스트의 이슈(ADR-0032)는 주기마다 GitHub에서 읽는다. 데모에서는 2초마다다.
const world = await startWorld({
  executors,
  observeMs: 200,
  recheckMs: FOREVER,
  followMs: 2_000,
  // 설정 창의 "합쳐 돌려 보기"가 켜짐으로 보이게 내 러너에 가짜 샌드박스를 꽂는다. 가짜는 명령을 가두지 않는다.
  sandbox: process.env.DEMO_MERGE_CHECK === "no_sandbox" ? undefined : fakeSandbox().sandbox,
  mergeCheck: process.env.DEMO_MERGE_CHECK === "off" ? "off" : undefined,
  // 판정은 아래에서 정해 둔 것을 올린다. 러너들이 실제로 돌리지 않게 잠잠한 시간을 끝없이 둔다.
  quietMs: FOREVER,
  // 워크스페이스 둘: REPO의 계정과 REPO3의 계정(ADR-0043).
  accept: [REPO, REPO3],
  giphy: process.env.GIPHY_API_KEY
    ? realGiphy(process.env.GIPHY_API_KEY)
    : process.env.DEMO_GIPHY === "fake"
      ? { search: async () => DEMO_GIFS }
      : undefined,
});
const fake = world.github;
const NAMES = {
  owner: "나 (데모)",
  minsu: "박민수",
  seoyeon: "이서연",
  hajun: "최하준",
  dahee: "정다은",
  woojin: "오우진",
  sora: "한소라",
  minji: "김민지",
  jiho: "윤지호",
};
for (const [login, name] of Object.entries(NAMES)) fake.names.set(login, name);
// GitHub 프로필 사진(#288) 대신 그린 그림. 셋만 두고 나머지는 사진이 없는 사람처럼 이니셜이다.
const photo = (from: string, to: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="20" cy="16" r="7" fill="#fff" opacity=".85"/><ellipse cx="20" cy="36" rx="13" ry="10" fill="#fff" opacity=".85"/></svg>`,
  )}`;
fake.avatars.set("owner", photo("#f59e0b", "#ef4444"));
fake.avatars.set("minsu", photo("#22c55e", "#0ea5e9"));
fake.avatars.set("seoyeon", photo("#a855f7", "#ec4899"));
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
if (process.env.DEMO_CHECK !== "none")
  await own(".omagari.json", '{ "check": "npm test", "setup": "npm ci" }\n');
await world.repo.git("add", ".");
await world.repo.git("commit", "--message=base");
await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

/** 멤버 `login`의 기기: 내 main을 받아 `branch`에서 일한다. 받는 동안은 러너를 꺼 둔다. */
async function member(login: "minsu" | "seoyeon" | "hajun", branch: string, uses = false) {
  fake.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(
    as,
    undefined,
    {
      "claude-code": fakeExecutor((input) => canned(input.message) ?? "데모라 정해 둔 답이에요.")
        .executor,
    },
    { quietMs: FOREVER },
  );
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
const { message: refundQuestion } = await say(
  minsu.as,
  pay,
  "환불할 때 결제 모델의 amount를 그대로 쓰나요? 부분 환불이면 깨질 것 같은데요.",
);
await say(world.owner, pay, "지금은 그대로 써요. 시그니처 바꾸면서 같이 보려고요.");
const { message: webhookOnly } = await say(minsu.as, pay, "좋아요, 저는 웹훅 쪽만 볼게요.");
// 반응(#293): 내가 단 것(눌린 알약)과 남이 단 것.
for (const [as, emoji] of [
  [seoyeon.as, "🎉"],
  [world.owner, "🎉"],
  [hajun.as, "🎉"],
  [seoyeon.as, "👀"],
] as const)
  await call(as, api.react, { message: webhookOnly.id, emoji, on: true });
// 답장과 인용(#344): 첫 질문에 단 답장(원래 메시지로 가는 줄)과, `> **minsu**` 인용 블록이 앞에 붙은 글.
await call(seoyeon.as, api.send, {
  channel: pay,
  text: "부분 환불은 제가 테스트 케이스로 막아 둘게요.",
  replyTo: refundQuestion.id,
});
await say(
  hajun.as,
  pay,
  "> **minsu**\n> 부분 환불이면 깨질 것 같은데요.\n\n맞아요, 영수증 금액이랑도 안 맞을 거예요.",
);
// Thread (#345): replies under minsu's webhook message, and one also sent to the channel.
for (const [as, text, alsoInChannel] of [
  [hajun.as, "재시도 간격은 지수 백오프로 가요?", false],
  [minsu.as, "네, 최대 다섯 번까지요.", false],
  [seoyeon.as, "백오프 상한은 설정으로 빼 주세요.", true],
] as const)
  await call(as, api.send, { channel: pay, text, threadOf: webhookOnly.id, alsoInChannel });

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

/** 알림들. */
const alerts = async () =>
  (await call(world.owner, api.posts)).posts.flatMap(({ message: m }) =>
    m.kind === "alert" ? [{ id: m.id, alert: m.alert }] : [],
  );
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

// 포스트와 GitHub 이슈(ADR-0032): 포스트의 글은 이슈 댓글로 가고, GitHub에서 단 댓글과 바꾼 제목, 라벨이 포스트로 들어온다.
// 이슈는 논의 포스트만 연다(ADR-0039). 직접 충돌은 참고라, 팀 라벨 "결정 필요"를 논의로 두고 두 포스트에 붙인다.
await call(world.owner, api.createLabel, { name: "결정 필요", color: "d93f0b" });
await call(world.owner, api.editLabel, { name: "결정 필요", next: { importance: "discuss" } });
for (const post of [mail, direct])
  await call(world.owner, api.setPostLabels, { post, labels: ["Direct conflict", "결정 필요"] });
const issueOf = (post: string) =>
  eventually(async () => {
    const number = (await call(world.owner, api.posts)).posts.find((p) => p.channel === post)?.issue
      ?.number;
    const found = fake.issues.find((issue) => issue.number === number);
    assert.ok(found, "아직 포스트의 이슈가 없다");
    return found;
  }, 30_000);
const mailIssue = await issueOf(mail);
await eventually(() =>
  assert.ok(
    mailIssue.comments.some((c) => c.login === "minsu" && c.body.startsWith("메일을 바로")),
    "포스트의 글이 아직 이슈 댓글로 가지 않았다",
  ),
);
fake.comment(mailIssue.number, "jiwoo", "QA에서도 메일 지연을 봤어요. 큐로 가면 좋겠어요.");
mailIssue.title = "메일 발송을 큐로 보낼지";
// 라벨과 포럼(ADR-0039, 시안 51~55): 팀 라벨 "결제"와 "급함"(참고), 멤버가 만든 포럼 "결제 팀".
// "참고" 포럼은 중복 구현과 간접 충돌만 보게 고쳐, 참고인 직접 충돌 포스트가 "다른 포스트"에 선다.
await call(world.owner, api.createLabel, {
  name: "결제",
  color: "0e8a16",
  description: "결제 흐름",
});
await call(world.owner, api.createLabel, { name: "급함", color: "e99695" });
await call(world.owner, api.createForum, {
  name: "결제 팀",
  filter: { labels: ["결제", "결정 필요"] },
});
const reference = (await call(world.owner, api.channels)).channels.find((c) => c.name === "FYI");
assert.ok(reference);
await call(world.owner, api.updateForum, {
  id: reference.id,
  name: reference.name,
  filter: { labels: ["Duplicate work", "Indirect conflict"] },
});
mailIssue.labels.push("결제");
(await issueOf(direct)).labels.push("급함");
await eventually(async () => {
  const { messages } = await call(world.owner, api.history, { channel: mail });
  assert.ok(
    messages.some((m) => m.kind === "text" && m.github && m.login === "jiwoo"),
    "GitHub 댓글이 아직 포스트에 없다",
  );
});
console.log(
  `이슈 #${mailIssue.number}의 댓글: ${mailIssue.comments.map((c) => c.login).join(", ")}`,
);

// 합쳐 돌려 보기의 판정(ADR-0036). 멤버 셋의 가짜 러너가 내 작업(feat/payment-model)과 간접 충돌(추정)을 걸고 정해 둔 판정을 올린다.
const MINE = { login: "owner", branch: "feat/payment-model" };
const CHECK = "npm test";
const run = (verdict: MergeRun["verdict"], rest: Partial<MergeRun> = {}): MergeRun => ({
  verdict,
  check: CHECK,
  omitted: [],
  fingerprint: crypto.randomUUID(),
  stale: false,
  ...rest,
});
const FAILED = `FAIL src/checkout.test.ts
  ✕ 환불 금액은 음수다 (3 ms)
    Expected: -100
    Received: NaN
Tests: 1 failed, 11 passed`;
const SCENES: {
  who: "dahee" | "woojin" | "sora";
  branch: string;
  symbol: string;
  run?: MergeRun;
}[] = [
  { who: "dahee", branch: "feat/receipt", symbol: "receipt", run: run("running") },
  {
    who: "woojin",
    branch: "feat/refund-flow",
    symbol: "refundFlow",
    run: run("broken", { ms: 8_400, output: FAILED }),
  },
  { who: "sora", branch: "feat/tax", symbol: "tax", run: run("broken", { ms: 7_100 }) },
  { who: "dahee", branch: "feat/coupon", symbol: "coupon", run: run("pass", { ms: 6_200 }) },
  {
    who: "woojin",
    branch: "feat/points",
    symbol: "points",
    run: run("unclear", { ms: 9_900, alone: ["theirs"], output: FAILED }),
  },
  {
    who: "sora",
    branch: "feat/invoice",
    symbol: "invoice",
    run: run("not_run", {
      check: undefined,
      reason: "기본 브랜치(origin/main)에 .omagari.json이 없다",
    }),
  },
  {
    who: "dahee",
    branch: "feat/fee",
    symbol: "fee",
    run: run("not_run", { reason: "샌드박스 도구가 없다: bubblewrap" }),
  },
  {
    who: "woojin",
    branch: "feat/ledger-v2",
    symbol: "ledgerV2",
    run: run("not_run", {
      reason: "검사 명령을 시간 상한에서 끊었다. 끊긴 것은 통과로 치지 않는다",
      ms: 300_000,
    }),
  },
  {
    who: "sora",
    branch: "feat/currency",
    symbol: "currency",
    run: run("not_run", { reason: "줄이 부딪혀 합쳐지지 않는다: src/pay.ts" }),
  },
  {
    who: "dahee",
    branch: "feat/discount",
    symbol: "discount",
    run: run("broken", { ms: 5_300, output: FAILED, stale: true }),
  },
  {
    who: "woojin",
    branch: "feat/wallet",
    symbol: "wallet",
    run: run("broken", { ms: 6_000, output: FAILED }),
  },
];
// 토론(ADR-0040, #202). 가짜 러너끼리 간접 충돌(추정)을 걸고 내가 토론을 요청해 연다. 입장은 가짜 러너가 브랜치마다 정해 둔 것을 라운드마다 낸다.
// 대본이 없거나 그 라운드의 것이 없으면 내지 않고 붙든다(기다리는 자리). "error"면 내지 못했다고 답한다.
type Fakes = "dahee" | "woojin" | "sora" | "minji" | "jiho";
const say1 = (claim: string, rest: Partial<Stance> = {}): Stance => ({
  claim,
  evidence: [
    { text: "src/pay.ts:4 refund(amount, reason)의 정의", mark: "verified" },
    { text: "부분 환불이 두 번 들어오면 남은 금액을 넘는다", mark: "unverified" },
  ],
  context: "session",
  model: "claude-opus-5-5",
  effort: "high",
  ...rest,
});
const PATCH = `--- a/src/pay.ts
+++ b/src/pay.ts
@@ -4,3 +4,3 @@
-export function refund(amount: number, reason: string) {
+export function refund(amount: number, reason?: string) {
   return -amount;
 }
`;
const experiment = (verdict: "pass" | "broken" | "not_run", reason?: string) => ({
  patch: PATCH,
  verdict,
  ...(reason ? { reason } : { check: CHECK }),
  ms: verdict === "not_run" ? 0 : 41_000,
});
type Script = (Stance | "error")[];
const DEBATES: {
  name: string;
  a: { who: Fakes; branch: string; script?: Script };
  b: { who: Fakes; branch: string; script?: Script };
}[] = [
  // 가린 첫 라운드: 한쪽만 냈다.
  {
    name: "가린 첫 라운드",
    a: { who: "dahee", branch: "feat/receipt-v2", script: [say1("영수증은 결제 뒤에 만든다")] },
    b: { who: "woojin", branch: "feat/receipt-sync" },
  },
  // 반박 라운드: 첫 라운드는 공개됐고 둘째 라운드에 한쪽만 냈다.
  {
    name: "반박 라운드",
    a: {
      who: "dahee",
      branch: "feat/coupon-v2",
      script: [
        say1("쿠폰은 결제 금액에서 먼저 뺀다"),
        say1("쿠폰은 결제 금액에서 먼저 뺀다", { changed: {} }),
      ],
    },
    b: {
      who: "sora",
      branch: "feat/coupon-tax",
      script: [say1("세금을 먼저 매기고 쿠폰을 뺀다", { context: "none", model: "gpt-5.5" })],
    },
  },
  // 기다리는 중: 김민지의 러너가 꺼져 있다. 대행을 부를 수 있다.
  {
    name: "기다리는 중",
    a: { who: "woojin", branch: "feat/refund-v3", script: [say1("환불은 원래 결제 수단으로만")] },
    b: { who: "minji", branch: "feat/refund-wallet" },
  },
  // 대행: 김민지의 자리에 내가 대행을 불렀다. 세 라운드가 끝나 고를 차례이고, 대행이 낸 안은 덮개 안에 "대행"이 있다.
  {
    name: "대행",
    a: {
      who: "sora",
      branch: "feat/points-v2",
      script: [
        say1("포인트는 결제와 따로 쌓는다"),
        say1("포인트는 결제와 따로 쌓는다"),
        say1("포인트는 결제와 따로 쌓는다"),
      ],
    },
    b: { who: "minji", branch: "feat/points-wallet" },
  },
  // 고를 차례: 세 라운드 모두 냈다. 사유를 밝혀 바꾼 입장, 사유 없이 바뀐 입장, 실험(통과, 깨짐, 돌리지 못함)이 있다.
  {
    name: "고를 차례",
    a: {
      who: "dahee",
      branch: "feat/refund-reason",
      script: [
        say1("refund에 reason을 꼭 받는다", {
          experiment: experiment("not_run", "기본 브랜치(origin/main)에 .omagari.json이 없다"),
        }),
        say1("reason은 선택으로 받는다", {
          changed: {
            reason: "checkout이 reason 없이 부르는 곳이 세 군데라 필수로 바꾸면 다 깨진다",
          },
          experiment: experiment("broken"),
        }),
        say1("reason은 선택으로 받는다", { experiment: experiment("pass") }),
      ],
    },
    b: {
      who: "woojin",
      branch: "feat/refund-audit",
      script: [
        say1("reason은 감사 로그에 꼭 남겨야 한다", {
          context: "none",
          model: "gpt-5.5",
          effort: "medium",
        }),
        say1("reason은 감사 로그에 꼭 남겨야 한다", {
          context: "none",
          model: "gpt-5.5",
          effort: "medium",
        }),
        say1("reason 없이 오면 'unknown'으로 남긴다", {
          context: "none",
          model: "gpt-5.5",
          effort: "medium",
          changed: {},
          evidence: [
            { text: "docs/decisions/0007-audit-log.md", mark: "verified" },
            { text: "src/audit.ts:12 log()", mark: "missing" },
          ],
          experiment: experiment("pass"),
        }),
      ],
    },
  },
  // 사람이 골랐다: 내가 안 1을 골랐다.
  {
    name: "사람이 골랐다",
    a: {
      who: "sora",
      branch: "feat/mail-v2",
      script: [say1("메일은 큐를 거친다"), say1("메일은 큐를 거친다"), say1("메일은 큐를 거친다")],
    },
    b: {
      who: "dahee",
      branch: "feat/mail-direct",
      script: [say1("메일은 바로 보낸다"), say1("메일은 바로 보낸다"), say1("메일은 바로 보낸다")],
    },
  },
  // 실험으로 정했다: 마지막 라운드에 한 안의 실험만 통과했다.
  {
    name: "실험으로 정했다",
    a: {
      who: "woojin",
      branch: "feat/fee-v2",
      script: [
        say1("수수료는 반올림한다"),
        say1("수수료는 반올림한다"),
        say1("수수료는 반올림한다", { experiment: experiment("pass") }),
      ],
    },
    b: {
      who: "sora",
      branch: "feat/fee-floor",
      script: [
        say1("수수료는 버림한다"),
        say1("수수료는 버림한다"),
        say1("수수료는 버림한다", { experiment: experiment("broken") }),
      ],
    },
  },
  // 근거로 정했다: 마지막 라운드에 검증된 근거가 한 안에만 있다.
  {
    name: "근거로 정했다",
    a: {
      who: "dahee",
      branch: "feat/tax-v2",
      script: [
        say1("세율은 설정에서 읽는다"),
        say1("세율은 설정에서 읽는다"),
        say1("세율은 설정에서 읽는다"),
      ],
    },
    b: {
      who: "sora",
      branch: "feat/tax-const",
      script: [
        say1("세율은 상수로 둔다"),
        say1("세율은 상수로 둔다"),
        say1("세율은 상수로 둔다", {
          evidence: [{ text: "세율은 잘 바뀌지 않는다", mark: "unverified" }],
        }),
      ],
    },
  },
  // 참여를 껐다: 윤지호가 묻기 스위치를 꺼 나오지 않는다. 한쪽만 내 근거로 정해졌다.
  {
    name: "참여를 껐다",
    a: {
      who: "woojin",
      branch: "feat/invoice-v2",
      script: [say1("청구서 번호는 연도마다 다시 센다")],
    },
    b: { who: "jiho", branch: "feat/invoice-seq" },
  },
  // 끝났다: 두 자리 모두 내지 못했다.
  {
    name: "끝났다",
    a: { who: "sora", branch: "feat/ledger-v3", script: ["error"] },
    b: { who: "woojin", branch: "feat/ledger-split", script: ["error"] },
  },
  // 만료: 한쪽만 낸 채 14일이 지났다(데모는 DB에서 연 시각을 당긴다).
  {
    name: "만료",
    a: { who: "dahee", branch: "feat/discount-v2", script: [say1("할인은 쿠폰과 겹치지 않는다")] },
    b: { who: "woojin", branch: "feat/discount-stack" },
  },
];
const scriptOf = (branch: string) =>
  DEBATES.flatMap(({ a, b }) => [a, b]).find((side) => side.branch === branch)?.script;

for (const [login] of Object.entries(NAMES).filter(([l]) =>
  ["dahee", "woojin", "sora", "minji", "jiho"].includes(l),
))
  fake.grant(login);
const fakeRunners = new Map<string, WebSocket>();
for (const who of ["dahee", "woojin", "sora", "minji", "jiho"] as const) {
  const as = await world.login(who);
  const socket = new WebSocket(`${world.server.url.replace("http", "ws")}${RUNNER_SOCKET}`);
  fakeRunners.set(who, socket);
  const welcomed = Promise.withResolvers<void>();
  socket.addEventListener("message", ({ data }) => {
    if (JSON.parse(String(data)).kind === "welcome") welcomed.resolve();
    const decoded = decode(serverToRunner, String(data));
    if ("error" in decoded || decoded.message.kind !== "debate") return;
    const { id, payload } = decoded.message;
    const said = scriptOf(payload.branch)?.[payload.round - 1];
    if (said === "error")
      socket.send(
        encode(
          runnerToServer,
          "error",
          { code: "internal", message: "실행기가 답하지 않았다" },
          id,
        ),
      );
    else if (said) socket.send(encode(runnerToServer, "stance", said, id));
  });
  await new Promise((open) => socket.addEventListener("open", open, { once: true }));
  socket.send(
    encode(runnerToServer, "hello", {
      session: as.session,
      repos: [REPO],
      executors: ["claude-code"],
      choices: {},
      mergeCheck: "on",
    }),
  );
  await welcomed.promise;
  const mine = SCENES.filter((s) => s.who === who);
  const debating = DEBATES.flatMap(({ a, b }) => [a, b]).filter((side) => side.who === who);
  socket.send(
    encode(runnerToServer, "observation", {
      works: [...mine, ...debating].map((s) => ({
        branch: s.branch,
        base: "0".repeat(40),
        share: "full" as const,
        files: [],
      })),
    }),
  );
  socket.send(
    encode(runnerToServer, "conflicts", {
      pairs: mine.map((s) => ({
        kind: "indirect" as const,
        branch: s.branch,
        theirs: MINE,
        symbols: [
          {
            name: s.symbol,
            mine: [{ path: `src/${s.symbol}.ts`, line: 3, role: "uses" as const }],
            theirs: [{ path: "src/pay.ts", line: 1, role: "changed" as const }],
          },
        ],
      })),
    }),
  );
}
// 토론의 짝은 쓰는 쪽(a)의 러너가 올린다. 김민지의 러너가 떨어져도 알림이 남는다. 관측을 다 받은 뒤 올린다.
await sleep(500);
for (const who of ["dahee", "woojin", "sora"] as const)
  fakeRunners.get(who)?.send(
    encode(runnerToServer, "conflicts", {
      pairs: [
        ...SCENES.filter((s) => s.who === who).map((s) => ({
          kind: "indirect" as const,
          branch: s.branch,
          theirs: MINE,
          symbols: [
            {
              name: s.symbol,
              mine: [{ path: `src/${s.symbol}.ts`, line: 3, role: "uses" as const }],
              theirs: [{ path: "src/pay.ts", line: 1, role: "changed" as const }],
            },
          ],
        })),
        ...DEBATES.filter(({ a }) => a.who === who).map(({ a, b }) => ({
          kind: "indirect" as const,
          branch: a.branch,
          theirs: { login: b.who, branch: b.branch },
          symbols: [
            {
              name: "refund",
              mine: [{ path: "src/checkout.ts", line: 2, role: "uses" as const }],
              theirs: [{ path: "src/pay.ts", line: 4, role: "changed" as const }],
            },
          ],
        })),
      ],
    }),
  );
const sceneAlert = (branch: string) =>
  eventually(async () => {
    const found = (await alerts()).find(
      ({ alert }) => alert.kind === "indirect" && alert.works.some((w) => w.branch === branch),
    );
    assert.ok(found, `아직 ${branch}의 Indirect conflict 알림이 없다`);
    return found.id;
  }, 60_000);
const sceneAlerts = new Map<string, number>();
for (const scene of SCENES) sceneAlerts.set(scene.branch, await sceneAlert(scene.branch));
for (const scene of SCENES) {
  if (!scene.run) continue;
  const send = (run: MergeRun) =>
    fakeRunners
      .get(scene.who)
      ?.send(encode(runnerToServer, "merged", { branch: scene.branch, theirs: MINE, run }));
  // 지난 결과는 깨진 판정이 먼저 나고 그 뒤 내용이 바뀐 것이다. 같은 지문으로 `stale`만 켜서 다시 올린다.
  if (scene.run.stale) {
    send({ ...scene.run, stale: false });
    await sleep(500);
  }
  send(scene.run);
}
// 토론을 연다. 김민지는 러너를 끄고(기다리는 자리), 윤지호는 묻기 스위치를 끈다(나오지 않는 자리).
fakeRunners.get("minji")?.close();
await call(await world.login("jiho"), api.setAskSwitch, { on: false });
const debatePosts = new Map<string, string>();
for (const scene of DEBATES) {
  const post = await postOf(await sceneAlert(scene.a.branch));
  debatePosts.set(scene.name, post);
  await call(world.owner, api.requestDebate, {
    post,
    agenda: "refund()가 reason을 받는 방식",
    grounds: "src/pay.ts:4 refund의 정의\ndocs/decisions/0007-audit-log.md",
  });
}
const debateOf = (name: string, check: (debate: Debate) => void) =>
  eventually(async () => {
    const post = debatePosts.get(name);
    const found = (await call(world.owner, api.posts)).posts.find((p) => p.channel === post);
    assert.ok(found?.debate, `${name}: 아직 토론이 없다`);
    check(found.debate);
    return found.debate;
  }, 60_000);
// 대행: 김민지의 자리에 내가 대행을 부른다. 내 러너가 정해 둔 입장을 낸다.
const proxied = await debateOf("대행", (d) => assert.ok(d.seats.some((s) => s.away)));
await call(world.owner, api.proxyDebate, {
  post: debatePosts.get("대행") as string,
  seat: proxied.seats.findIndex((seat) => seat.login === "minji"),
});
// 사람이 골랐다: 고를 차례가 되면 내가 안 1을 고른다.
await debateOf("사람이 골랐다", (d) => assert.equal(d.state, "choosing"));
await call(world.owner, api.chooseDebate, {
  post: debatePosts.get("사람이 골랐다") as string,
  option: 0,
});
// 만료: 한쪽이 낸 뒤 연 시각을 15일 전으로 당긴다. 서버가 다음 주기에 만료로 끝낸다.
await debateOf("만료", (d) => assert.ok(d.seats.some((s) => s.state === "submitted")));
const database = new DatabaseSync(join(dirname(world.config), "omagari.db"));
database
  .prepare("UPDATE debates SET at = ? WHERE post = ?")
  .run(Date.now() - 15 * 86_400_000, debatePosts.get("만료") as string);
database.close();
await debateOf("만료", (d) => assert.equal(d.state, "expired"));
// 토론 요청: 근거 없이 낸 요청(열지 않음)과, 나와 한소라 사이에 연 요청(내가 냈고 한소라는 아직). 깨짐 판정으로 확인된 포스트에는 토론이 저절로 열려 있다.
await call(world.owner, api.requestDebate, {
  post: await postOf(sceneAlerts.get("feat/points") as number),
  agenda: "포인트 적립을 결제 전에 할지",
  grounds: "",
});
await call(world.owner, api.requestDebate, {
  post: await postOf(sceneAlerts.get("feat/invoice") as number),
  agenda: "청구서 번호를 pay()에서 매길지",
  grounds: "src/pay.ts:1 pay()의 정의",
});

// 결정 PR이 열린 포스트: 판정 띠와 결정 띠가 함께 선다.
const wallet = await postOf(sceneAlerts.get("feat/wallet") as number);
const woojin = await world.login("woojin");
await say(woojin, wallet, "wallet이 pay 시그니처를 따라 바뀌어야 해요.");
await say(world.owner, wallet, "그럼 pay 쪽을 먼저 머지하죠.");
await propose(woojin, wallet, "wallet은 pay 시그니처를 따른다");

// 워크스페이스와 레포(#238): "나"는 space, other, billing의 Admin이고 other를 넣는다. 박민수는 space에만, 이서연은 space와 other에 push 권한이 있다.
fake.admin("owner");
fake.admin("owner", REPO2);
fake.admin("owner", "omagari-test/billing");
fake.grant("owner", REPO2);
fake.grant("seoyeon", REPO2);
// other-team은 개인 계정이다(아바타가 동그라미, 시안 101-3). DEMO_AS=minsu면 박민수 혼자 쓰는 워크스페이스라 혼자일 때(100-A)가 보인다.
fake.account(REPO3.split("/")[0] as string, { kind: "user", avatar: null });
if (process.env.DEMO_AS !== "minsu") fake.grant("owner", REPO3);
fake.grant("minsu", REPO3);
await call(world.owner, api.addRepo, { repo: REPO2 });
const repoChannel = async (name: string, repo: string) =>
  (await call(world.owner, api.createChannel, { name, repo })).channel.id;
await repoChannel("space-배포", REPO);
const otherChannel = await repoChannel("other-배포", REPO2);
await say(world.owner, otherChannel, "other 레포의 배포 이야기는 여기서 해요.");
await call(world.owner, api.createForum, {
  name: "other 논의",
  filter: { importance: "discuss", repos: [REPO2] },
});
await call(world.owner, api.createForum, {
  name: "릴리즈",
  filter: { importance: "discuss", repos: [REPO, REPO2] },
});
const team = {
  ...(process.env.DEMO_AS === "minsu" ? await world.login("minsu") : world.owner),
  workspace: REPO3.split("/")[0],
};
await say(
  team,
  (await call(team, api.createChannel, { name: "일반" })).channel.id,
  "다른 팀이에요.",
);

if (process.env.DEMO_RUNNER === "off") await world.runner.stop();

// 미리 넣을 것을 다 넣은 뒤부터, 브라우저에서 연 기기 인증은 GitHub에서 코드를 넣는 대신 여기서 "나"로 승인한다.
const startDevice = fake.github.startDevice.bind(fake.github);
fake.github.startDevice = async () => {
  const device = await startDevice();
  setTimeout(() => {
    try {
      fake.approve(device.userCode, process.env.DEMO_AS ?? "owner");
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
console.log(`other 레포의 채널(DEMO_AS=minsu로 보면 "볼 수 없어요"): #${otherChannel}`);
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
