import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PREFS, type MemberView } from "@omagari/contract";
import type { LiveEvent } from "./live.ts";
import { type NoticeContext, noticeFor } from "./notify.ts";

const member = (login: string, presence = "online", executor?: string) =>
  ({ login, name: login, presence, works: [{ branch: "feat/x", executor }] }) as MemberView;

const ctx = (more: Partial<NoticeContext> = {}): NoticeContext => ({
  me: "jieun",
  prefs: DEFAULT_PREFS,
  members: [member("jieun"), member("minsu", "online", "claude-code")],
  allowed: true,
  looking: false,
  since: 10,
  asking: new Set([7]),
  postTitle: () => "refund.ts",
  ...more,
});

const alert = (importance: "discuss" | "reference", id = 11, works = ["jieun", "minsu"]) =>
  ({
    kind: "message",
    payload: {
      kind: "alert",
      id,
      channel: "post-1",
      alert: {
        kind: "direct",
        works: works.map((login) => ({ login, name: login, branch: "feat/x" })),
        files: [{ path: "src/refund.ts", lines: [[], []] }],
        more: 0,
        resolved: null,
      },
      post: { importance },
    },
  }) as unknown as LiveEvent;

const answer = (id = 7, visibility = "private") =>
  ({
    kind: "qa",
    payload: {
      id,
      channel: "general",
      executor: "codex",
      visibility,
      answer: { state: "answered", text: "It clamps at 0 since #212.\nMore." },
    },
  }) as unknown as LiveEvent;

const decision = (deciders: string[], login = "minsu", event = "opened") =>
  ({
    kind: "message",
    payload: {
      kind: "decision",
      id: 12,
      event,
      decision: {
        id: 3,
        post: "post-1",
        login,
        title: "Send refund mail from a queue",
        deciders: deciders.map((one) => ({ login: one })),
      },
    },
  }) as unknown as LiveEvent;

const debate = (seat: object, agenda = "") =>
  ({
    kind: "debate",
    payload: {
      post: "post-1",
      debate: {
        id: 5,
        state: "open",
        round: 1,
        seats: [{ login: "jieun", state: "waiting", ...seat }, { login: "minsu" }],
      },
      request: agenda ? { agenda } : null,
    },
  }) as unknown as LiveEvent;

test("a new Discuss conflict on my work notifies by default, naming the other side's agent and file", () => {
  assert.deepEqual(noticeFor(alert("discuss"), ctx()), {
    tag: "alert-11",
    title: "Conflict on your work",
    body: "minsu's Claude Code is also editing refund.ts",
    channel: "post-1",
  });
  // Without a known agent, just the person.
  assert.equal(
    noticeFor(alert("discuss"), ctx({ members: [member("jieun")] }))?.body,
    "minsu is also editing refund.ts",
  );
});

test("FYI conflicts only with FYI too; not someone else's work, not old alerts coming again, not with the kind off", () => {
  assert.equal(noticeFor(alert("reference"), ctx()), undefined);
  assert.ok(noticeFor(alert("reference"), ctx({ prefs: { ...DEFAULT_PREFS, notifyFyi: true } })));
  assert.equal(noticeFor(alert("discuss", 11, ["minsu", "hajun"]), ctx()), undefined);
  assert.equal(noticeFor(alert("discuss", 9), ctx()), undefined);
  assert.equal(
    noticeFor(alert("discuss"), ctx({ prefs: { ...DEFAULT_PREFS, notifyConflicts: false } })),
    undefined,
  );
});

test("an answer to what this tab asked notifies with its first line, and a DM opens the DM column", () => {
  assert.deepEqual(noticeFor(answer(), ctx()), {
    tag: "qa-7",
    title: "Your question got an answer",
    body: "Codex: It clamps at 0 since #212.",
    channel: "general",
    dm: true,
  });
  assert.equal(noticeFor(answer(7, "public"), ctx())?.dm, undefined);
  assert.equal(noticeFor(answer(8), ctx()), undefined);
  assert.equal(
    noticeFor(answer(), ctx({ prefs: { ...DEFAULT_PREFS, notifyAnswers: false } })),
    undefined,
  );
});

test("a decision I decide on, proposed by someone else, notifies; my own or one I'm not in doesn't", () => {
  assert.deepEqual(noticeFor(decision(["minsu", "jieun"]), ctx()), {
    tag: "decision-3",
    title: "Your call is needed",
    body: "Decision: Send refund mail from a queue",
    channel: "post-1",
  });
  assert.equal(noticeFor(decision(["minsu", "jieun"], "jieun"), ctx()), undefined);
  assert.equal(noticeFor(decision(["minsu"]), ctx()), undefined);
  assert.equal(noticeFor(decision(["minsu", "jieun"], "minsu", "agreed"), ctx()), undefined);
});

test("a debate notifies only when my seat waits and my runner is off", () => {
  assert.deepEqual(noticeFor(debate({ away: true }, "Queue or not"), ctx()), {
    tag: "debate-5-1",
    title: "Your call is needed",
    body: "Debate: Queue or not",
    channel: "post-1",
  });
  assert.equal(noticeFor(debate({ away: true }), ctx())?.body, "Debate: refund.ts");
  assert.equal(noticeFor(debate({}), ctx()), undefined);
  assert.equal(
    noticeFor(debate({ away: true }), ctx({ prefs: { ...DEFAULT_PREFS, notifyDecisions: false } })),
    undefined,
  );
});

test("nothing shows on Do not disturb, while looking at the tab, or when this browser is off", () => {
  assert.equal(noticeFor(alert("discuss"), ctx({ members: [member("jieun", "dnd")] })), undefined);
  assert.equal(noticeFor(answer(), ctx({ looking: true })), undefined);
  assert.equal(noticeFor(decision(["jieun"]), ctx({ allowed: false })), undefined);
});
