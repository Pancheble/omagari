// Local demo: starts Omagari so you can look around the screens. `node test/demo.ts`
// - It runs on a fake GitHub. The browser's "Log in with GitHub" is approved by itself after 1.5 seconds and you come in as "me".
// - My runner is plugged into this device's real Claude Code (and Codex too if it is installed and logged in). DMs really answer and use subscription usage.
//   Only the pre-seeded Q&A and other people's questions get fixed answers.
// - It pre-seeds every state of the screen: four members and their devices, two chat channels, labels (Discuss and FYI, team labels) and three forums
//   ("Discuss", the edited "FYI", the member-made "Payment team") plus "Other posts", nine alerts in the forums (direct conflict, indirect conflict,
//   duplicate work, declared contract change, resolved), post text and DMs, asking others and their answers, and seven decision PRs (proposed, objection, reopened, accepted,
//   discarded, merge stalled, merge blocked). A decision draft isn't saved so it can't be pre-seeded. In the post "Minsu Park · Hajun Choi", press Summarize.
// - DEMO_AGENT=fake: my agent also gives fixed answers. A draft shows "writing" for 5 seconds. It uses no usage.
// - DEMO_RUNNER=off: turns my runner off after everything is seeded. You see the draft's "runner off".
// - The verdicts of merge-run (ADR-0036) don't run the check command; they upload fixed ones. Fake runners of three members (Daeun Jung, Woojin Oh, Sora Han) put an indirect conflict (estimated) against my work and upload verdicts,
//   and the forum gets posts with: running, broken (with and without output), can't tell, four couldn't-runs (no check command, no sandbox,
//   timeout, direct conflict), a past result, released by pass, and a decision PR open so there are two bands. My runner doesn't run these alerts (it sets the quiet time to forever).
// - Debate (ADR-0040, #202): fake runners (Daeun Jung, Woojin Oh, Sora Han, Minji Kim, Jiho Yoon) put indirect conflicts among themselves and I ask for a debate, so the "refund" posts in the "FYI" forum get
//   a hidden first round, a rebuttal round, waiting (calling a proxy), proxy, choosing turn (changed stance, changed without a reason, three experiments), a human-chosen conclusion, decided by experiment,
//   decided by evidence and an opted-out seat, ended without submitting, and expired. "points" has a request made without grounds (not opened), and "invoice" has a debate between me and Sora Han.
//   Posts confirmed as broken (such as "tax") already have a debate opened by themselves. Expiry is made by pulling the opened time back in the DB.
// - DEMO_SETUP=new: a member whose runner never connected and who shared nothing, so you see "Connect your computer" and the repo Share notice (#354).
//   Combine with DEMO_RUNNER=off. (Only the DB rows are cleared; the stopped runner stays out.)
// - DEMO_MERGE_CHECK=off|no_sandbox: sets my runner's merge-run in the settings window to off or no sandbox. If not given, it is on.
// - DEMO_CHECK=none: doesn't put a check command (.omagari.json) on the default branch. You see "no check command" in the settings window.
// - Workspaces and repos (ADR-0043, #238): the workspace "omagari-test" has two repos (space, other) and a repo ("billing") where "me" is Admin but hasn't added it,
//   and another account's workspace "other-team" (repo code). Each repo has a chat channel, a forum only other sees ("other Discuss"), and a forum that sees both repos ("Release").
//   other-team is a personal account (the avatar on the name row is a circle).
// - A person's name is "name (login)", and only me, Minsu Park, and Seoyeon Lee have a profile photo (a drawn picture) (#288).
// - DEMO_AS=minsu: logs the browser in as Minsu Park, who is not an Admin (push access only to space in omagari-test, and to code in other-team). There is no add or remove repo.
//   Going to other's channel address (printed in the console) shows "You can't see this repo". In other-team Minsu Park is alone, so the alone case (mockup 100-A) shows.
// - GIPHY_API_KEY=<key>: turns on GIFs with the real GIPHY (ADR-0044). If not given, the input has no GIF button.
//   DEMO_GIPHY=fake: look at the GIF area without a key. Regardless of the search words it gives eight public GIPHY GIFs (the pictures are fetched from GIPHY).
// - When you quit (Ctrl+C) it deletes the temporary repo and DB. It isn't named *.test.ts so npm test and CI don't run it.
// - A fake GitHub issue is opened for each post and the text goes there as comments. The post "Minsu Park · Hajun Choi" receives comments made on GitHub and the changed title and labels.
// - It ends with GitHub merging blocked (to show "merge blocked"). After that every merge Omagari does is blocked.
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

/** The GIFs for `DEMO_GIPHY=fake`. Public GIFs found on giphy.com with "celebrate" (2026-11-19). The size only matches the area's ratio. */
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

/** Answers for pre-seeded questions (Q&A or other people's questions). If the question text contains one of these, this is the answer. */
const CANNED: [string, string][] = [
  [
    "Where is a partial refund's amount calculated?",
    "`refund()` in `src/pay.ts` returns the amount it received as a negative as is. Nothing subtracts what was already refunded, so if a partial refund comes in twice it can exceed the remaining amount.",
  ],
  [
    "Are you changing the webhook retry interval now",
    "No. Right now I'm only fixing the payment record in `src/ledger.ts`. I haven't touched the retry interval.",
  ],
];
const DRAFT = {
  title: "Mail sending goes through a queue",
  context: "Minsu Park and Hajun Choi edited line 3 of `src/mail.ts` together.",
  decision: "Mail isn't sent right away but put in a queue. Hajun Choi's version stays.",
  consequences: "Minsu Park's branch is realigned to use the queue function.",
};
/**
 * The debate stance (ADR-0040). The runner lines turns up in one line, so if a debate turn went to a real executor, the DMs behind it would wait that long.
 * So debates aren't sent to a real executor; they give a fixed stance.
 */
const STANCE = JSON.stringify({
  claim: "It's a demo, so this is a fixed stance.",
  evidence: ["src/pay.ts:1 the definition of pay()"],
  changed: false,
  reason: "",
});
const canned = (message: string) =>
  /Omagari opened a debate|debate Omagari opened/.test(message)
    ? STANCE
    : CANNED.find(([q]) => message.includes(q))?.[1];
/**
 * If there is a fixed answer, it gives that; if not, it calls `real`. If there is no `real`, it gives a draft or a short answer.
 * A draft comes wrapped around the post's conversation (the pre-seeded questions are in it too), so it isn't matched against the fixed answers.
 */
const scripted = (real?: Executor): Executor =>
  Object.assign(
    async (input: Parameters<Executor>[0]) => {
      const draft = input.message.includes('"consequences": "…"');
      const answer = draft ? undefined : canned(input.message);
      if (answer || !real) {
        if (draft) await sleep(5_000);
        const text =
          answer ?? (draft ? JSON.stringify(DRAFT) : "It's a demo, so this is a fixed answer.");
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
// To show merge stalled, delete one member's GitHub token. Delay the permission re-check so it doesn't drop that member.
// A post's issue (ADR-0032) is read from GitHub every cycle. In the demo, every 2 seconds.
let seeded = false;
const world = await startWorld({
  executors,
  observeMs: 200,
  recheckMs: FOREVER,
  followMs: 2_000,
  // Plug a fake sandbox into my runner so "merge-run" in the settings window shows as on. The fake doesn't confine commands.
  sandbox: process.env.DEMO_MERGE_CHECK === "no_sandbox" ? undefined : fakeSandbox().sandbox,
  mergeCheck: process.env.DEMO_MERGE_CHECK === "off" ? "off" : undefined,
  // Verdicts are uploaded as fixed below. Set the quiet time to forever so the runners don't really run them.
  quietMs: FOREVER,
  // Two workspaces: REPO's account and REPO3's account (ADR-0043).
  accept: [REPO, REPO3],
  giphy: process.env.GIPHY_API_KEY
    ? realGiphy(process.env.GIPHY_API_KEY)
    : process.env.DEMO_GIPHY === "fake"
      ? { search: async () => DEMO_GIFS }
      : undefined,
  // The server wraps GitHub's calls when it starts (#381), so the device auth hook goes in before that and waits for `seeded` below.
  setup: (github) => {
    const startDevice = github.github.startDevice.bind(github.github);
    github.github.startDevice = async () => {
      const device = await startDevice();
      if (seeded)
        setTimeout(() => {
          try {
            github.approve(device.userCode, process.env.DEMO_AS ?? "owner");
          } catch {
            // That auth expired in the meantime or has already ended.
          }
        }, 1500);
      return device;
    };
  },
});
const fake = world.github;
const NAMES = {
  owner: "Me (demo)",
  minsu: "Minsu Park",
  seoyeon: "Seoyeon Lee",
  hajun: "Hajun Choi",
  dahee: "Daeun Jung",
  woojin: "Woojin Oh",
  sora: "Sora Han",
  minji: "Minji Kim",
  jiho: "Jiho Yoon",
};
for (const [login, name] of Object.entries(NAMES)) fake.names.set(login, name);
// Drawn pictures instead of GitHub profile photos (#288). Only three have one; the rest show initials like people without a photo.
const photo = (from: string, to: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="20" cy="16" r="7" fill="#fff" opacity=".85"/><ellipse cx="20" cy="36" rx="13" ry="10" fill="#fff" opacity=".85"/></svg>`,
  )}`;
fake.avatars.set("owner", photo("#f59e0b", "#ef4444"));
fake.avatars.set("minsu", photo("#22c55e", "#0ea5e9"));
fake.avatars.set("seoyeon", photo("#a855f7", "#ec4899"));
// "Me" came in before setting a name. Come in again and fix the name.
await world.login("owner");

// The base commit: two functions and where they are used, and files of ten lines each.
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

/** Member `login`'s device: takes my main and works on `branch`. The runner is kept off while it takes it. */
async function member(login: "minsu" | "seoyeon" | "hajun", branch: string, uses = false) {
  fake.grant(login);
  const as = await world.login(login);
  const desk = await world.desk(
    as,
    undefined,
    {
      "claude-code": fakeExecutor(
        (input) => canned(input.message) ?? "It's a demo, so this is a fixed answer.",
      ).executor,
    },
    { quietMs: FOREVER },
  );
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", branch);
  // Only Minsu Park uses pay and refund. Delete where they are used so no more indirect conflict and contract change alerts stand for others.
  if (!uses) {
    await desk.git("rm", "--quiet", "src/checkout.ts");
    await desk.git("commit", "--quiet", "--message=remove checkout");
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

// Chat channels and messages.
const pay = await world.channel(world.owner, "Payments");
await world.channel(world.owner, "general");
const say = (as: As, channel: string, text: string) => call(as, api.send, { channel, text });
const { message: refundQuestion } = await say(
  minsu.as,
  pay,
  "When refunding, do you use the payment model's amount as is? A partial refund seems like it would break.",
);
await say(
  world.owner,
  pay,
  "I use it as is for now. I'll look at it together when I change the signature.",
);
const { message: webhookOnly } = await say(
  minsu.as,
  pay,
  "Sounds good, I'll only look at the webhook side.",
);
// Reactions (#293): the ones I added (pressed pills) and the ones others added.
for (const [as, emoji] of [
  [seoyeon.as, "🎉"],
  [world.owner, "🎉"],
  [hajun.as, "🎉"],
  [seoyeon.as, "👀"],
] as const)
  await call(as, api.react, { message: webhookOnly.id, emoji, on: true });
// Replies and quotes (#344): a reply to the first question (a line going to the original message), and a message with a `> **minsu**` quote block at the front.
await call(seoyeon.as, api.send, {
  channel: pay,
  text: "I'll block partial refunds with a test case.",
  replyTo: refundQuestion.id,
});
await say(
  hajun.as,
  pay,
  "> **minsu**\n> A partial refund seems like it would break.\n\nRight, it won't match the receipt amount either.",
);
// Thread (#345): replies under minsu's webhook message, and one also sent to the channel.
for (const [as, text, alsoInChannel] of [
  [hajun.as, "Does the retry interval use exponential backoff?", false],
  [minsu.as, "Yes, up to five tries.", false],
  [seoyeon.as, "Please make the backoff cap a setting.", true],
] as const)
  await call(as, api.send, { channel: pay, text, threadOf: webhookOnly.id, alsoInChannel });

// Collisions: the same line (direct conflict), where a function with a changed definition line is used (indirect conflict), a new definition with the same name (duplicate work), a plan attached to a claim (declared contract change).
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

/** The alerts. */
const alerts = async () =>
  (await call(world.owner, api.posts)).posts.flatMap(({ message: m }) =>
    m.kind === "alert" ? [{ id: m.id, alert: m.alert }] : [],
  );
/** The `kind` alert between `a` and `b`. Waits until it stands. */
const alertOf = (kind: string, a: string, b: string) =>
  eventually(async () => {
    const found = (await alerts()).find(
      ({ alert }) =>
        alert.kind === kind &&
        alert.resolved === null &&
        [a, b].every((login) => alert.works.some((w) => w.login === login)),
    );
    assert.ok(found, `there is no ${kind} alert for ${a}·${b} yet`);
    return found.id;
  }, 60_000);
/** Opens the alert's post and returns its channel. */
const postOf = async (alert: number) =>
  (await call(world.owner, api.openPost, { alert })).post.channel;

// Resolved alert: Seoyeon Lee and Hajun Choi collided, then Hajun Choi reverts.
const i18n = await alertOf("direct", "seoyeon", "hajun");
await hajun.desk.git("checkout", "--", "src/i18n.ts");
await eventually(async () =>
  assert.notEqual((await alerts()).find((a) => a.id === i18n)?.alert.resolved, null),
);
const resolvedPost = await postOf(i18n);
await say(seoyeon.as, resolvedPost, "I'll put in the i18n keys first.");
await say(hajun.as, resolvedPost, "Then I'll revert mine.");

const DECISION = (title: string) => ({
  title,
  context: "Two works edited the same place.",
  decision: `${title}.`,
  consequences: "One branch is realigned.",
});
const propose = async (as: As, post: string, title: string, window?: "now") =>
  (
    await call(as, api.proposeDecision, {
      post,
      ...DECISION(title),
      ...(window ? { window } : {}),
    })
  ).decision;
const respond = (as: As, id: number, response: "agree" | "object" | "withdraw") =>
  call(as, api.respondToDecision, { id, response });

// Proposed: Minsu Park summarized it and I can agree or object.
const direct = await postOf(await alertOf("direct", "owner", "minsu"));
await say(minsu.as, direct, "I'll go with my changed value for the config timeout.");
await say(world.owner, direct, "Okay. I'll realign on top of that.");
await propose(minsu.as, direct, "The payment timeout is 30 seconds");

// Objection: Minsu Park summarized it and I objected.
const indirect = await postOf(await alertOf("indirect", "owner", "minsu"));
await say(minsu.as, indirect, "If reason goes into refund(), checkout has to change too.");
await say(world.owner, indirect, "How about making reason optional?");
await respond(
  world.owner,
  (await propose(minsu.as, indirect, "refund always takes a reason")).id,
  "object",
);

// Reopened: I objected and then withdrew.
const duplicate = await postOf(await alertOf("duplicate", "owner", "minsu"));
await say(minsu.as, duplicate, "We each made split separately.");
await say(world.owner, duplicate, "I'll delete mine.");
const reopened = await propose(minsu.as, duplicate, "Keep only one split, in src/split.ts");
await respond(world.owner, reopened.id, "object");
await respond(world.owner, reopened.id, "withdraw");

// Accepted: I summarized it with "now" and it merged right away.
const declared = await postOf(await alertOf("declared", "owner", "minsu"));
await say(world.owner, declared, "I'm going to add currency to pay().");
await say(minsu.as, declared, "I'll change checkout to follow.");
await propose(world.owner, declared, "pay takes a currency", "now");

// Discarded: I summarized it and then discarded it.
const webhook = await postOf(await alertOf("direct", "owner", "seoyeon"));
await say(seoyeon.as, webhook, "I'm adding the webhook signature check.");
await say(world.owner, webhook, "Then I'll leave mine out.");
const discarded = await propose(
  world.owner,
  webhook,
  "The webhook signature check goes on the payment side",
);
await call(world.owner, api.discardDecision, { id: discarded.id });

// Merge stalled: after Hajun Choi summarized it, Hajun Choi's GitHub token doesn't work. I agreed and everyone agreed, but it can't merge.
const ledger = await postOf(await alertOf("direct", "owner", "hajun"));
await say(hajun.as, ledger, "I'm changing the payment record format.");
await say(world.owner, ledger, "Let's go with Hajun's format.");
const stalled = await propose(hajun.as, ledger, "The payment record follows Hajun Choi's format");
for (const [token, login] of fake.tokens) if (login === "hajun") fake.tokens.delete(token);
await respond(world.owner, stalled.id, "agree");

// Merge blocked: GitHub blocks merging without a review approval. I summarized it with "now".
const retry = await postOf(await alertOf("direct", "minsu", "seoyeon"));
await say(minsu.as, retry, "Grow the retry interval exponentially.");
await say(seoyeon.as, retry, "Up to 5 tries only.");
await say(world.owner, retry, "Both are fine. I'll summarize it.");
fake.block("HTTP 405 At least 1 approving review is required by reviewers with write access.");
await propose(world.owner, retry, "Webhook retries are exponential, up to 5 tries", "now");

// A post with no decision: text, Q&A in my DM, Q&A posted to the post. Press Summarize here to see the draft.
const mail = await postOf(await alertOf("direct", "minsu", "hajun"));
await say(minsu.as, mail, "Sending mail right away slows payment.");
await say(hajun.as, mail, "I'm adding a queue. Going with my version should work.");
await say(world.owner, mail, "I'll look at both versions and summarize.");
const posted = await world.ask(world.owner, mail, CANNED[0][0]);
await world.settled(world.owner, posted);
await call(world.owner, api.postQa, {
  qa: posted.id,
  text: "Attaching this for reference",
});
await world.settled(world.owner, await world.ask(world.owner, mail, CANNED[0][0]));

// Asking others and answers: Minsu Park's agent asks my agent, and I ask Minsu Park's agent.
const asked = await world.cliIn(minsu.desk.folder, "ask", "owner", CANNED[1][0]);
assert.equal(asked.code, 0, asked.stderr);
const asking = await world.cli("ask", "minsu", CANNED[1][0]);
assert.equal(asking.code, 0, asking.stderr);
await eventually(async () => assert.ok((await call(world.owner, api.settings)).answered.count > 0));

// Posts and GitHub issues (ADR-0032): a post's text goes to the issue as comments, and comments made on GitHub and a changed title and labels come into the post.
// Only Discuss posts open an issue (ADR-0039). A direct conflict is FYI, so set the team label "Needs decision" to Discuss and attach it to two posts.
await call(world.owner, api.createLabel, {
  name: "Needs decision",
  color: "d93f0b",
});
await call(world.owner, api.editLabel, {
  name: "Needs decision",
  next: { importance: "discuss" },
});
for (const post of [mail, direct])
  await call(world.owner, api.setPostLabels, {
    post,
    labels: ["Direct conflict", "Needs decision"],
  });
const issueOf = (post: string) =>
  eventually(async () => {
    const number = (await call(world.owner, api.posts)).posts.find((p) => p.channel === post)?.issue
      ?.number;
    const found = fake.issues.find((issue) => issue.number === number);
    assert.ok(found, "the post's issue isn't there yet");
    return found;
  }, 30_000);
const mailIssue = await issueOf(mail);
await eventually(() =>
  assert.ok(
    mailIssue.comments.some(
      (c) => c.login === "minsu" && c.body.startsWith("Sending mail right away"),
    ),
    "the post's text hasn't gone to the issue comments yet",
  ),
);
fake.comment(
  mailIssue.number,
  "jiwoo",
  "QA also saw the mail delay. I'd like it to go through a queue.",
);
mailIssue.title = "Should mail sending go through a queue";
// Labels and forums (ADR-0039, mockups 51~55): team labels "Payments" and "Urgent" (FYI), and the member-made forum "Payment team".
// The "FYI" forum is changed to show only duplicate work and indirect conflicts, so the direct conflict posts, which are FYI, stand in "Other posts".
await call(world.owner, api.createLabel, {
  name: "Payments",
  color: "0e8a16",
  description: "Payment flow",
});
await call(world.owner, api.createLabel, { name: "Urgent", color: "e99695" });
await call(world.owner, api.createForum, {
  name: "Payment team",
  filter: { labels: ["Payments", "Needs decision"] },
});
const reference = (await call(world.owner, api.channels)).channels.find((c) => c.name === "FYI");
assert.ok(reference);
await call(world.owner, api.updateForum, {
  id: reference.id,
  name: reference.name,
  filter: { labels: ["Duplicate work", "Indirect conflict"] },
});
mailIssue.labels.push("Payments");
(await issueOf(direct)).labels.push("Urgent");
await eventually(async () => {
  const { messages } = await call(world.owner, api.history, { channel: mail });
  assert.ok(
    messages.some((m) => m.kind === "text" && m.github && m.login === "jiwoo"),
    "the GitHub comment isn't in the post yet",
  );
});
console.log(
  `comments on issue #${mailIssue.number}: ${mailIssue.comments.map((c) => c.login).join(", ")}`,
);

// Verdicts of merge-run (ADR-0036). Fake runners of three members put an indirect conflict (estimated) against my work (feat/payment-model) and upload fixed verdicts.
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
  ✕ refund amount is negative (3 ms)
    Expected: -100
    Received: NaN
Tests: 1 failed, 11 passed`;
const SCENES: {
  who: "dahee" | "woojin" | "sora";
  branch: string;
  symbol: string;
  run?: MergeRun;
}[] = [
  {
    who: "dahee",
    branch: "feat/receipt",
    symbol: "receipt",
    run: run("running"),
  },
  {
    who: "woojin",
    branch: "feat/refund-flow",
    symbol: "refundFlow",
    run: run("broken", { ms: 8_400, output: FAILED }),
  },
  {
    who: "sora",
    branch: "feat/tax",
    symbol: "tax",
    run: run("broken", { ms: 7_100 }),
  },
  {
    who: "dahee",
    branch: "feat/coupon",
    symbol: "coupon",
    run: run("pass", { ms: 6_200 }),
  },
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
      reason: "There is no .omagari.json on the default branch (origin/main)",
    }),
  },
  {
    who: "dahee",
    branch: "feat/fee",
    symbol: "fee",
    run: run("not_run", { reason: "Sandbox tool missing: bubblewrap" }),
  },
  {
    who: "woojin",
    branch: "feat/ledger-v2",
    symbol: "ledgerV2",
    run: run("not_run", {
      reason:
        "The check command was cut off at the time limit. A cut-off run doesn't count as a pass",
      ms: 300_000,
    }),
  },
  {
    who: "sora",
    branch: "feat/currency",
    symbol: "currency",
    run: run("not_run", {
      reason: "Lines collide so they can't be merged: src/pay.ts",
    }),
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
// Debate (ADR-0040, #202). Fake runners put indirect conflicts (estimated) among themselves and I ask for a debate to open it. The fake runner gives a stance fixed per branch, round by round.
// If there is no script or none for that round, it doesn't give one and holds (the waiting seat). With "error" it answers that it couldn't give one.
type Fakes = "dahee" | "woojin" | "sora" | "minji" | "jiho";
const say1 = (claim: string, rest: Partial<Stance> = {}): Stance => ({
  claim,
  evidence: [
    {
      text: "src/pay.ts:4 the definition of refund(amount, reason)",
      mark: "verified",
    },
    {
      text: "If a partial refund comes in twice it exceeds the remaining amount",
      mark: "unverified",
    },
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
  // Hidden first round: only one side gave a stance.
  {
    name: "Hidden first round",
    a: {
      who: "dahee",
      branch: "feat/receipt-v2",
      script: [say1("Make the receipt after payment")],
    },
    b: { who: "woojin", branch: "feat/receipt-sync" },
  },
  // Rebuttal round: the first round was revealed and only one side gave a stance in the second.
  {
    name: "Rebuttal round",
    a: {
      who: "dahee",
      branch: "feat/coupon-v2",
      script: [
        say1("Subtract the coupon from the payment amount first"),
        say1("Subtract the coupon from the payment amount first", {
          changed: {},
        }),
      ],
    },
    b: {
      who: "sora",
      branch: "feat/coupon-tax",
      script: [
        say1("Apply the tax first and then subtract the coupon", {
          context: "none",
          model: "gpt-5.5",
        }),
      ],
    },
  },
  // Waiting: Minji Kim's runner is off. A proxy can be called.
  {
    name: "Waiting",
    a: {
      who: "woojin",
      branch: "feat/refund-v3",
      script: [say1("Refund only to the original payment method")],
    },
    b: { who: "minji", branch: "feat/refund-wallet" },
  },
  // Proxy: I called a proxy in Minji Kim's seat. Three rounds ended and it is the choosing turn, and the stance the proxy gave has "Proxy" inside its cover.
  {
    name: "Proxy",
    a: {
      who: "sora",
      branch: "feat/points-v2",
      script: [
        say1("Points are accrued separately from payment"),
        say1("Points are accrued separately from payment"),
        say1("Points are accrued separately from payment"),
      ],
    },
    b: { who: "minji", branch: "feat/points-wallet" },
  },
  // Choosing: all three rounds were given. There are a stance changed with a reason, a stance changed without a reason, and experiments (pass, broken, couldn't run).
  {
    name: "Choosing",
    a: {
      who: "dahee",
      branch: "feat/refund-reason",
      script: [
        say1("refund must take a reason", {
          experiment: experiment(
            "not_run",
            "There is no .omagari.json on the default branch (origin/main)",
          ),
        }),
        say1("reason is optional", {
          changed: {
            reason:
              "checkout calls it without reason in three places, so making it required would break them all",
          },
          experiment: experiment("broken"),
        }),
        say1("reason is optional", { experiment: experiment("pass") }),
      ],
    },
    b: {
      who: "woojin",
      branch: "feat/refund-audit",
      script: [
        say1("reason must be kept in the audit log", {
          context: "none",
          model: "gpt-5.5",
          effort: "medium",
        }),
        say1("reason must be kept in the audit log", {
          context: "none",
          model: "gpt-5.5",
          effort: "medium",
        }),
        say1("If reason is missing, keep 'unknown'", {
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
  // Human chose: I chose stance 1.
  {
    name: "Human chose",
    a: {
      who: "sora",
      branch: "feat/mail-v2",
      script: [
        say1("Mail goes through the queue"),
        say1("Mail goes through the queue"),
        say1("Mail goes through the queue"),
      ],
    },
    b: {
      who: "dahee",
      branch: "feat/mail-direct",
      script: [
        say1("Mail is sent right away"),
        say1("Mail is sent right away"),
        say1("Mail is sent right away"),
      ],
    },
  },
  // Decided by experiment: in the last round only one stance's experiment passed.
  {
    name: "Decided by experiment",
    a: {
      who: "woojin",
      branch: "feat/fee-v2",
      script: [
        say1("Round the fee"),
        say1("Round the fee"),
        say1("Round the fee", { experiment: experiment("pass") }),
      ],
    },
    b: {
      who: "sora",
      branch: "feat/fee-floor",
      script: [
        say1("Truncate the fee"),
        say1("Truncate the fee"),
        say1("Truncate the fee", { experiment: experiment("broken") }),
      ],
    },
  },
  // Decided by evidence: in the last round only one stance has verified evidence.
  {
    name: "Decided by evidence",
    a: {
      who: "dahee",
      branch: "feat/tax-v2",
      script: [
        say1("Read the tax rate from config"),
        say1("Read the tax rate from config"),
        say1("Read the tax rate from config"),
      ],
    },
    b: {
      who: "sora",
      branch: "feat/tax-const",
      script: [
        say1("Keep the tax rate as a constant"),
        say1("Keep the tax rate as a constant"),
        say1("Keep the tax rate as a constant", {
          evidence: [{ text: "The tax rate rarely changes", mark: "unverified" }],
        }),
      ],
    },
  },
  // Opted out: Jiho Yoon turned off the ask switch so doesn't show up. Only one side was decided on my grounds.
  {
    name: "Opted out",
    a: {
      who: "woojin",
      branch: "feat/invoice-v2",
      script: [say1("Invoice numbers restart every year")],
    },
    b: { who: "jiho", branch: "feat/invoice-seq" },
  },
  // Ended: neither seat could give a stance.
  {
    name: "Ended",
    a: { who: "sora", branch: "feat/ledger-v3", script: ["error"] },
    b: { who: "woojin", branch: "feat/ledger-split", script: ["error"] },
  },
  // Expired: 14 days passed with only one side given (the demo pulls the opened time back in the DB).
  {
    name: "Expired",
    a: {
      who: "dahee",
      branch: "feat/discount-v2",
      script: [say1("A discount doesn't overlap with a coupon")],
    },
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
          { code: "internal", message: "The executor didn't answer" },
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
      shareRepo: true,
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
// The debate pair is uploaded by the writing side's (a) runner. The alert stays even if Minji Kim's runner drops. Upload after taking all observations.
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
    assert.ok(found, `there is no Indirect conflict alert for ${branch} yet`);
    return found.id;
  }, 60_000);
const sceneAlerts = new Map<string, number>();
for (const scene of SCENES) sceneAlerts.set(scene.branch, await sceneAlert(scene.branch));
for (const scene of SCENES) {
  if (!scene.run) continue;
  const send = (run: MergeRun) =>
    fakeRunners.get(scene.who)?.send(
      encode(runnerToServer, "merged", {
        branch: scene.branch,
        theirs: MINE,
        run,
      }),
    );
  // The past result is a broken verdict first, and then the content changed. Upload again with the same fingerprint and only `stale` turned on.
  if (scene.run.stale) {
    send({ ...scene.run, stale: false });
    await sleep(500);
  }
  send(scene.run);
}
// Open the debates. Minji Kim turns off the runner (the waiting seat), and Jiho Yoon turns off the ask switch (the seat that doesn't show up).
fakeRunners.get("minji")?.close();
await call(await world.login("jiho"), api.setAskSwitch, { on: false });
const debatePosts = new Map<string, string>();
for (const scene of DEBATES) {
  const post = await postOf(await sceneAlert(scene.a.branch));
  debatePosts.set(scene.name, post);
  await call(world.owner, api.requestDebate, {
    post,
    agenda: "How refund() takes reason",
    grounds: "the definition of refund in src/pay.ts:4\ndocs/decisions/0007-audit-log.md",
  });
}
const debateOf = (name: string, check: (debate: Debate) => void) =>
  eventually(async () => {
    const post = debatePosts.get(name);
    const found = (await call(world.owner, api.posts)).posts.find((p) => p.channel === post);
    assert.ok(found?.debate, `${name}: there is no debate yet`);
    check(found.debate);
    return found.debate;
  }, 60_000);
// Proxy: I call a proxy in Minji Kim's seat. My runner gives the fixed stance.
const proxied = await debateOf("Proxy", (d) => assert.ok(d.seats.some((s) => s.away)));
await call(world.owner, api.proxyDebate, {
  post: debatePosts.get("Proxy") as string,
  seat: proxied.seats.findIndex((seat) => seat.login === "minji"),
});
// Human chose: when it is the choosing turn, I choose stance 1.
await debateOf("Human chose", (d) => assert.equal(d.state, "choosing"));
await call(world.owner, api.chooseDebate, {
  post: debatePosts.get("Human chose") as string,
  option: 0,
});
// Expired: after one side gives a stance, pull the opened time back to 15 days ago. The server ends it as expired on the next cycle.
await debateOf("Expired", (d) => assert.ok(d.seats.some((s) => s.state === "submitted")));
const database = new DatabaseSync(join(dirname(world.config), "omagari.db"));
database
  .prepare("UPDATE debates SET at = ? WHERE post = ?")
  .run(Date.now() - 15 * 86_400_000, debatePosts.get("Expired") as string);
database.close();
await debateOf("Expired", (d) => assert.equal(d.state, "expired"));
// Debate requests: a request made without grounds (not opened), and a request opened between me and Sora Han (I made it and Sora Han hasn't yet). Posts confirmed by a broken verdict have a debate opened by themselves.
await call(world.owner, api.requestDebate, {
  post: await postOf(sceneAlerts.get("feat/points") as number),
  agenda: "Whether to accrue points before payment",
  grounds: "",
});
await call(world.owner, api.requestDebate, {
  post: await postOf(sceneAlerts.get("feat/invoice") as number),
  agenda: "Whether to number invoices in pay()",
  grounds: "src/pay.ts:1 the definition of pay()",
});

// A post with a decision PR open: the verdict band and the decision band stand together.
const wallet = await postOf(sceneAlerts.get("feat/wallet") as number);
const woojin = await world.login("woojin");
await say(woojin, wallet, "wallet has to change to follow pay's signature.");
await say(world.owner, wallet, "Then let's merge the pay side first.");
await propose(woojin, wallet, "wallet follows pay's signature");

// Workspaces and repos (#238): "me" is Admin of space, other, and billing and adds other. Minsu Park has push access only to space, and Seoyeon Lee to space and other.
fake.admin("owner");
fake.admin("owner", REPO2);
fake.admin("owner", "omagari-test/billing");
fake.grant("owner", REPO2);
fake.grant("seoyeon", REPO2);
// other-team is a personal account (the avatar is a circle, mockup 101-3). With DEMO_AS=minsu, it is a workspace Minsu Park uses alone, so the alone case (100-A) shows.
fake.account(REPO3.split("/")[0] as string, { kind: "user", avatar: null });
if (process.env.DEMO_AS !== "minsu") fake.grant("owner", REPO3);
fake.grant("minsu", REPO3);
await call(world.owner, api.addRepo, { repo: REPO2 });
const repoChannel = async (name: string, repo: string) =>
  (await call(world.owner, api.createChannel, { name, repo })).channel.id;
await repoChannel("space-deploy", REPO);
const otherChannel = await repoChannel("other-deploy", REPO2);
await say(world.owner, otherChannel, "Let's talk about other repo's deploys here.");
await call(world.owner, api.createForum, {
  name: "other Discuss",
  filter: { importance: "discuss", repos: [REPO2] },
});
await call(world.owner, api.createForum, {
  name: "Release",
  filter: { importance: "discuss", repos: [REPO, REPO2] },
});
const team = {
  ...(process.env.DEMO_AS === "minsu" ? await world.login("minsu") : world.owner),
  workspace: REPO3.split("/")[0],
};
await say(
  team,
  (await call(team, api.createChannel, { name: "general" })).channel.id,
  "This is another team.",
);

if (process.env.DEMO_RUNNER === "off") await world.runner.stop();
if (process.env.DEMO_SETUP === "new") {
  const fresh = new DatabaseSync(join(dirname(world.config), "omagari.db"));
  fresh.exec("DELETE FROM runner_seen; DELETE FROM shares");
  fresh.close();
}

// Once everything pre-seeded is in, a device auth opened in the browser is approved as "me" instead of entering the code on GitHub (the hook is in `setup` above).
seeded = true;

const PORT = process.env.DEMO_PORT ?? process.env.PORT ?? "5180";
const web = spawn("npx", ["vite", "--port", PORT, "--strictPort"], {
  cwd: new URL("../packages/web/", import.meta.url),
  stdio: "inherit",
  env: { ...process.env, OMAGARI_SERVER: world.server.url },
});
console.log(`Omagari demo server: ${world.server.url}`);
console.log(
  `other repo's channel (view it with DEMO_AS=minsu to see "can't see"): #${otherChannel}`,
);
console.log(`screen: http://localhost:${PORT} (executors: ${Object.keys(executors).join(", ")})`);

// A signal that comes repeatedly turns it off only once. Turning it off twice dies closing an already closed DB.
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
