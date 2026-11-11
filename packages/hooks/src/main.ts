#!/usr/bin/env node
// 훅은 어떤 경우에도 도구 호출을 막지 않는다. 글만 넣는다.
// 넣을 글은 세션 시작 훅(#13)과 편집 전 훅(#14)이 만든다. 지금은 입력을 읽고 아무것도 넣지 않는다.
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
