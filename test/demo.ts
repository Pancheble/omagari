// 로컬 데모: 화면을 둘러보려고 Omagari를 띄운다. `node test/demo.ts`
// - 가짜 GitHub로 띄운다. 브라우저의 "GitHub으로 로그인"은 1.5초 뒤 저절로 승인되어 "나"로 들어온다.
// - 내 러너에는 이 기기의 실제 Claude Code(깔려 있고 로그인했으면 Codex도)를 꽂는다. DM은 실제로 답하고 구독 사용량을 쓴다.
// - 민수라는 멤버와 채널 둘, 글 몇 개를 미리 넣는다. 끝내면(Ctrl+C) 임시 레포와 DB를 지운다.
// 이름이 *.test.ts가 아니라 npm test와 CI는 돌리지 않는다.
import { spawn } from "node:child_process";
import { api, call } from "@omagari/contract";
import { claudeCode, codex, codexReady } from "@omagari/runner";
import { startWorld } from "./harness.ts";

const executors = { "claude-code": claudeCode, ...((await codexReady()) ? { codex } : {}) };
const world = await startWorld({ executors });
const fake = world.github;
fake.names.set("owner", "나 (데모)");
fake.names.set("minsu", "박민수");

fake.grant("minsu");
const minsu = await world.login("minsu");
const pay = await world.channel(world.owner, "결제");
await world.channel(world.owner, "일반");
const say = (as: { url: string; session: string }, text: string) =>
  call(as, api.send, { channel: pay, text });
await say(minsu, "환불할 때 결제 모델의 amount를 그대로 쓰나요? 부분 환불이면 깨질 것 같은데요.");
await say(world.owner, "지금은 그대로 써요. 시그니처 바꾸면서 같이 보려고요.");
await say(minsu, "좋아요, 저는 웹훅 쪽만 볼게요.");

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
