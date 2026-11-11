#!/usr/bin/env node
import { CONTRACT_VERSION } from "@omagari/contract";
import manifest from "../package.json" with { type: "json" };

// 명령은 그것을 만드는 이슈가 더한다: 묻기(#6), 러너 켜기와 로그인(#8), status(#12), 훅과 스킬 깔기(#15).
if (process.argv[2] === "--version") {
  console.log(`omagari ${manifest.version} (contract ${CONTRACT_VERSION})`);
} else {
  console.error("사용법: omagari --version");
  process.exitCode = 1;
}
