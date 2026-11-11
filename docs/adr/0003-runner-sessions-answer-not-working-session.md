# 묻는 말에는 작업 세션이 아니라 러너 세션이 답한다

Room은 질문을 상대의 살아 있는 작업 세션에 넣고(편지함, 훅, 세션 깨우기), 그 세션이 하던 일을 멈추고 직접 답한다. Room에도 러너("on duty" 모드)가 있지만, 그것은 자기 이름을 가진 별도 참가자로 쓰기가 되는 샌드박스에서 돈다. Omagari는 DM, @호출, 질문, 토론 차례를 모두 주인 기기의 러너가 화면 없이 띄운 읽기 전용 러너 세션에 맡긴다(구현 1장 "왜 갈라 띄우나", 3장, 11장). 작업 세션에 말을 넣으면 작업이 끊기고 대화가 섞이며, 서버가 뚫렸을 때 러너가 띄운 세션이 주인의 파일을 고칠 수 있으면 피해가 모든 팀원 기기로 번지기 때문이다.

## Consequences

- 러너 세션은 주인이 지금 작업 세션에서 나누던 대화를 모른다. 실행 중인 세션을 포크해 맥락을 가져오는 방법은 확인되지 않아 미정이다.
- 읽기 전용은 실행기마다 다르게 건다. Claude Code는 `-p`에 허용할 도구만 지정하고, Codex는 `codex exec`에 읽기 전용 샌드박스를 준다.
- Codex에서는 `-s read-only`를 직접 준다(2026-11-11, 이슈 #16). `codex exec`의 기본은 읽기 전용 샌드박스라고 문서에 있지만([Codex 비대화 모드](https://learn.chatgpt.com/docs/non-interactive-mode)), 손 점검(#7)에서 기본값이 주인의 `~/.codex/config.toml`의 `sandbox_mode`를 따르는 것을 확인했다. Claude Code에서 `--allowedTools`에 기대지 않은 것과 같은 까닭이다. 샌드박스는 셸 명령과 `apply_patch`에만 걸리고 MCP 도구는 그 밖에서 돌므로, Claude Code에서 MCP 도구를 빼듯 주인이 설정한 MCP 서버를 하나씩 끄고(`codex mcp list --json`으로 찾아 `-c mcp_servers.<이름>.enabled=false`), 앱(커넥터)과 플러그인도 끈다(`--disable apps`, `--disable plugins`). Codex는 부작용을 알리는 앱·MCP 도구 호출에 승인을 받는데([Codex 보안](https://learn.chatgpt.com/docs/agent-approvals-security)), 알리지 않는 도구는 그대로 돌 수 있어 승인에 기대지 않았다. `-s`와 `-C`는 `resume`의 플래그가 아니라 그 앞에 둔다(`codex exec resume --help`, codex-cli 0.167.1).
- Claude Code에서 "허용할 도구만"은 `--tools`로 건다(2026-11-11, 이슈 #6). `--allowedTools`는 승인 없이 돌 도구를 정할 뿐이라, 주인의 설정에 `permissions.allow`가 있으면 목록에 없는 Bash도 돈다. `--tools`는 쓸 수 있는 도구 자체를 줄이지만 MCP 도구에는 손대지 않으므로 `--disallowedTools "mcp__*"`로 뺀다([CLI 레퍼런스](https://code.claude.com/docs/en/cli-reference), [비대화 실행](https://code.claude.com/docs/en/headless)). 러너 세션의 도구는 Read, Grep, Glob이다.
- 답하는 비용은 답하는 쪽 주인의 사용량에서 나간다.
