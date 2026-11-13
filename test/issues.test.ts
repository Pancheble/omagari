import assert from "node:assert/strict";
import { test } from "node:test";
import { api, call } from "@omagari/contract";
import { eventually, fakeExecutor, startWorld, writer } from "./harness.ts";

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const BASE = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`);

test("포스트 하나가 GitHub 이슈 하나다: 글은 댓글로 가고, 댓글은 글로 들어오고, 제목·라벨·닫힘을 따라간다", async (t) => {
  const world = await startWorld({
    observeMs: 50,
    followMs: 50,
    executor: fakeExecutor(() => "부분 환불은 refund()에서 계산해요").executor,
  });
  t.after(world.stop);
  const fake = world.github;
  await writer(world.repo.folder)("src/pay.ts", text(BASE));
  await world.repo.git("add", ".");
  await world.repo.git("commit", "--message=base");
  await world.repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

  fake.grant("alice");
  fake.names.set("alice", "Alice Kim");
  const alice = await world.login("alice");
  const desk = await world.desk(alice);
  t.after(desk.remove);
  await desk.stop();
  await desk.git("fetch", "--quiet", world.repo.folder, "main");
  await desk.git("reset", "--hard", "FETCH_HEAD");
  await desk.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await desk.git("switch", "--create", "refund");
  await desk.start();
  await world.repo.git("switch", "--create", "payment");
  await eventually(async () =>
    assert.ok((await world.works(world.owner)).some((w) => w.branch === "payment")),
  );
  await writer(world.repo.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "owner")));
  await writer(desk.folder)("src/pay.ts", text(BASE.toSpliced(2, 1, "alice")));

  // 알림이 서면 포스트의 이슈가 열린다. 알림의 두 사람 가운데 한 멤버의 이름으로, 종류 라벨을 달고, 본문에 포스트 링크가 있다.
  const post = await eventually(async () => {
    const [found] = (await call(world.owner, api.posts)).posts;
    assert.ok(found?.issue, "아직 이슈가 없다");
    return found;
  });
  assert.equal(fake.issues.length, 1);
  const [issue] = fake.issues;
  assert.ok(["owner", "alice"].includes(issue.author));
  assert.equal(issue.title, "pay.ts 직접 충돌");
  assert.deepEqual(issue.labels, ["직접 충돌"]);
  assert.match(issue.body, new RegExp(`/#${post.message.channel}/${post.alert}$`));
  assert.deepEqual(post.issue, {
    number: issue.number,
    url: `https://github.com/omagari-test/space/issues/${issue.number}`,
    title: "pay.ts 직접 충돌",
    labels: ["직접 충돌"],
    open: true,
  });

  // 포스트의 글은 쓴 사람의 이름으로 이슈 댓글이 된다.
  await call(world.owner, api.send, {
    channel: post.channel,
    text: "제가 결제 쪽을 먼저 머지할게요",
  });
  await call(alice, api.send, { channel: post.channel, text: "좋아요, 환불은 그 뒤에" });
  await eventually(() =>
    assert.deepEqual(
      issue.comments.map(({ login, body }) => [login, body]),
      [
        ["owner", "제가 결제 쪽을 먼저 머지할게요"],
        ["alice", "좋아요, 환불은 그 뒤에"],
      ],
    ),
  );

  // 포스트에 올린 문답은 올린 사람의 이름으로, AI가 쓴 답이라는 표시를 달고 간다.
  const qa = await world.settled(
    world.owner,
    await world.ask(world.owner, post.channel, "부분 환불은?"),
  );
  await call(world.owner, api.postQa, { qa: qa.id, text: "참고로 붙여요" });
  await eventually(() => {
    const last = issue.comments.at(-1);
    assert.equal(last?.login, "owner");
    assert.equal(
      last?.body,
      [
        "참고로 붙여요",
        "",
        "> [!NOTE]",
        "> 🤖 **AI가 쓴 답** · owner의 Claude Code",
        "> 물음: 부분 환불은?",
        "",
        "부분 환불은 refund()에서 계산해요",
      ].join("\n"),
    );
  });

  // GitHub에서 단 댓글은 포스트의 글로 들어온다. 멤버가 아니어도 된다. 사람이 제목과 라벨을 바꾸면 따라간다.
  fake.comment(issue.number, "carol", "QA 쪽에서도 환불을 봐요");
  issue.title = "refund의 reason 필드";
  issue.labels.push("결제");
  await eventually(async () => {
    const { messages } = await call(world.owner, api.history, { channel: post.channel });
    const last = messages.at(-1);
    assert.equal(last?.kind, "text");
    assert.deepEqual(last?.kind === "text" && [last.login, last.text, last.github], [
      "carol",
      "QA 쪽에서도 환불을 봐요",
      true,
    ]);
    const [now] = (await call(world.owner, api.posts)).posts;
    assert.equal(now.issue?.title, "refund의 reason 필드");
    assert.deepEqual(now.issue?.labels, ["직접 충돌", "결제"]);
  });
  // 들어온 댓글은 다시 올리지 않고, 올린 글은 두 번 올리지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(issue.comments.length, 4);

  // 알림이 풀리면 Omagari가 이슈를 닫는다.
  await writer(desk.folder)("src/pay.ts", text(BASE));
  await eventually(async () => {
    const [now] = (await call(world.owner, api.posts)).posts;
    assert.notEqual(now.message.kind === "alert" && now.message.alert.resolved, null);
    assert.equal(now.issue?.open, false);
  });
  assert.equal(issue.open, false);
});
