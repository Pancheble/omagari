---
status: accepted
---

# 훅과 스킬은 기기의 사용자 설정에 깔고, 러너를 켠 적 없는 레포에서는 훅이 조용하다

PRD(#3)는 "훅과 스킬은 명령 하나로 깐다. 방법은 이슈에서 정한다"로 남겼다(이슈 #15). `omagari install`은 실행기의 사용자 설정에 깐다. Claude Code는 `~/.claude/settings.json`(`CLAUDE_CONFIG_DIR`이 있으면 그 아래)에 두 훅을, `~/.claude/skills/omagari-status/`에 스킬을 둔다([hooks](https://code.claude.com/docs/en/hooks), [skills](https://code.claude.com/docs/en/skills)). Codex(#16)도 자기 사용자 설정에 같은 방식으로 깐다.

- **사용자 설정에 까는 까닭**: 러너는 연결된 워크트리도 관측하고(#11), 훅은 Git 공용 폴더로 러너를 찾는다. 사용자 설정이어야 워크트리마다 따로 깔지 않아도 돈다. 훅 명령에는 이 기기의 Node와 훅 파일의 절대 경로가 들어가므로 레포에 올리는 `.claude/settings.json`에는 둘 수 없다. `.claude/settings.local.json`은 연결된 워크트리에 없고, 추적되지 않는 새 파일이라 관측이 서버로 올린다.
- **이미 있는 설정은 건드리지 않는다**: 이벤트마다 묶음 하나를 맨 뒤에 더한다. 다시 깔면 전에 깐 Omagari 훅(같은 실행기)만 빼고 새로 넣으므로 하나만 남는다. Node를 올리거나 레포를 옮겨 경로가 바뀌어도 그렇다. 읽을 수 없는 설정이면 쓰지 않고 멈춘다.
- **훅 명령은 실행기를 인자로 받는다**: `'<node>' '<훅 파일>' claude-code`. 훅은 그 실행기를 러너에 보내는 요청(`situation`, `nearby`)에 싣는다(ADR-0015). Codex는 같은 훅 파일을 `codex`로 깐다.
- **러너를 켠 적 없는 레포에서는 조용하다**: 사용자 설정의 훅은 이 기기의 모든 세션에서 돈다. 러너는 켤 때 `<git-common-dir>/omagari`를 만드는데, 그 폴더가 없으면 훅은 아무것도 넣지 않고 기억도 남기지 않는다. 그래서 Omagari를 쓰지 않는 레포에 "확인하지 못했다"가 들어가지 않는다. 한 번이라도 켰는데 지금 꺼져 있으면 지금처럼 "확인하지 못했다"를 넣는다.

## Considered Options

- **Claude Code 플러그인(Room)**: Room은 플러그인으로 깔고 훅 경로를 플러그인 폴더로 푼다. 플러그인은 캐시 폴더로 복사되어 돌므로 훅이 혼자 도는 파일이어야 하는데, Omagari의 훅은 빌드 없이 워크스페이스의 패키지를 가져다 쓴다(ADR-0014).
- **레포마다 `.claude/settings.local.json`**: Omagari를 쓰는 레포에서만 돌지만, 위의 까닭(워크트리, 관측)으로 버렸다.

## Consequences

- 훅 파일과 Node의 절대 경로를 쓰므로 레포를 옮기거나 Node를 바꾸면 `omagari install`을 다시 돌려야 한다.
- 스킬이 부르는 `omagari`는 PATH에 있어야 한다. 러너, CLI, 훅을 기기에 배포하는 방식(ADR-0014)과 함께 정한다. 1단계는 레포를 클론해 `main`에서 돌린다(2026-11-12, ADR-0019).
- 깐 것을 지우는 명령은 아직 없다. 사용자 설정에서 `hooks/src/main.ts' claude-code`(Codex는 `' codex`)로 끝나는 훅과 `skills/omagari-status`를 지우면 된다.
- Codex(2026-11-11, 이슈 #16)는 `$CODEX_HOME`(기본 `~/.codex`)의 `hooks.json`에 두 훅을, `skills/omagari-status/`에 같은 스킬을 둔다. `hooks.json`은 Claude Code의 설정과 같은 꼴이라 같은 병합을 쓴다. matcher는 정규식이고, 편집 전 훅은 Codex의 파일 편집 도구 `apply_patch`에만 건다(`^apply_patch$`). 훅은 패치의 파일 머리 줄(`*** Add/Update/Delete File:`, `*** Move to:`)에서 고칠 파일을 모두 읽는다([Codex hooks](https://learn.chatgpt.com/docs/hooks)). 스킬 자리는 Codex의 skill-installer가 까는 `$CODEX_HOME/skills`를 따랐다. 문서의 사용자 자리 `~/.agents/skills`도 Codex가 읽는다([Codex skills](https://learn.chatgpt.com/docs/build-skills)).
- Codex는 사용자가 `/hooks`에서 훅을 신뢰해야 돌린다. 신뢰는 훅의 해시에 걸려 Node나 레포를 옮겨 다시 깔면 다시 신뢰해야 한다. `omagari install`이 그렇게 알린다.
- 미정: Codex의 PreToolUse 입력에는 `agent_id`가 없고 서브에이전트도 부모의 `session_id`로 온다. 서브에이전트가 먼저 본 근처 작업을 메인 대화가 본 것으로 적는다(Claude Code는 가린다).
