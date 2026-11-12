import { CONTRACT_VERSION } from "@omagari/contract";
import { realGitHub, startServer } from "./index.ts";

const { OMAGARI_REPO, GITHUB_CLIENT_ID } = process.env;
if (!OMAGARI_REPO || !GITHUB_CLIENT_ID) {
  console.error(
    "OMAGARI_REPO(워크스페이스의 레포 owner/name)와 GITHUB_CLIENT_ID(기기 인증을 켠 GitHub 앱)를 주어라",
  );
  process.exit(1);
}

// HOST를 주지 않으면 이 기기 안에서만 듣는다. 배포할 때는 HOST=0.0.0.0처럼 준다.
const server = await startServer({
  repo: OMAGARI_REPO,
  github: realGitHub(GITHUB_CLIENT_ID),
  database: process.env.OMAGARI_DB ?? "omagari.db",
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
});
console.log(
  `Omagari 서버 ${server.version} (contract ${CONTRACT_VERSION}): ${server.url} (${OMAGARI_REPO})`,
);
