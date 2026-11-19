import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@omagari/contract";
import { realGitHub, startServer } from "./index.ts";

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

const { OMAGARI_REPO, GITHUB_CLIENT_ID } = process.env;
// 받을 GitHub 계정 목록(ADR-0043). 쉼표나 공백으로 나눈다. `owner/name`은 그 계정을 받고 그 레포를 켤 때마다 넣는다.
const accept = (OMAGARI_REPO ?? "").split(/[\s,]+/).filter(Boolean);
if (accept.length === 0 || !GITHUB_CLIENT_ID) {
  console.error(
    "OMAGARI_REPO(받을 GitHub 계정 목록. owner나 owner/name, 쉼표로 나눔)와 GITHUB_CLIENT_ID(기기 인증을 켠 GitHub 앱)를 주어라",
  );
  process.exit(1);
}

// HOST를 주지 않으면 이 기기 안에서만 듣는다. 배포할 때는 HOST=0.0.0.0처럼 준다.
const server = await startServer({
  accept,
  github: realGitHub(GITHUB_CLIENT_ID),
  database: process.env.OMAGARI_DB ?? "omagari.db",
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  // 빌드한 웹 화면이 있으면(`npm run build -w @omagari/web`, 배포 이미지) 같은 주소에서 낸다.
  webDir: existsSync(WEB_DIST) ? WEB_DIST : undefined,
  // 사람이 웹을 여는 주소. 결정 파일의 출처(포스트 링크)에 쓴다. 주지 않으면 서버가 듣는 주소다.
  // Fly에서는 주지 않아도 https://<앱 이름>.fly.dev다.
  publicUrl:
    process.env.OMAGARI_URL ??
    (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : undefined),
  // Fly는 머신에 FLY_APP_NAME을 넣는다. 그때만 앞단의 Fly-Client-IP를 믿는다.
  behindFly: Boolean(process.env.FLY_APP_NAME),
  // 토론의 라운드 수. 주지 않으면 세 라운드다.
  debateRounds: process.env.OMAGARI_DEBATE_ROUNDS
    ? Number(process.env.OMAGARI_DEBATE_ROUNDS)
    : undefined,
});
console.log(
  `Omagari 서버 ${server.version} (contract ${CONTRACT_VERSION}): ${server.url} (${accept.join(", ")})`,
);
