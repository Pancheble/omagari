# 실제 실행기 손 점검

이슈 #7. 구독 로그인이 있어야 해서 CI에 넣지 못하는 확인을 `test/real-executors.ts` 하나로 손으로 돌린다. 이름이 `*.test.ts`가 아니라 `npm test`와 CI는 이것을 돌리지 않는다.

## 무엇을 보나

| 점검 | Claude Code | Codex |
| --- | --- | --- |
| 구독 로그인 | API 키 환경 변수 없이 돌고, `claude auth status`가 claude.ai 로그인이다 | API 키 환경 변수 없이 돌고, `codex login status`가 ChatGPT 로그인이다 |
| 세션 이어 가기 | 첫 턴에 암호를 주고, 이어 간 둘째 턴이 그 암호를 답한다 | 같다. `codex exec resume <id>`로 잇는다 |
| 읽기 전용 | 이어 간 세션에 파일을 만들고 README.md를 고치라고 시킨 뒤에도 작업 폴더가 그대로다(`git status --ignored`가 비고 HEAD가 같다) | 같다. 러너가 주는 `-s read-only`로 돈다 |
| 긴 세션(관찰) | 큰 파일을 하나씩 읽혀 맥락을 키우며 자동 컴팩트를 기다린다 | 뜻 없는 글을 메시지로 넣어 키운다 |

긴 세션은 통과·실패가 없다. 자동 컴팩트가 일어났는지, 일어났으면 몇 토큰에서 몇 토큰으로 줄었는지, 요약에 첫 턴의 암호가 남았는지, 컴팩트 뒤의 턴이 그 암호를 기억하는지 적는다. Codex는 `codex exec fork`가 있는지도 적는다(`codex exec --help`).

**어떻게 도나**

- Claude Code는 러너의 코드로 돈다. 테스트 틀(`test/harness.ts`)처럼 임시 Git 레포 위에 실제 서버(가짜 GitHub)와 실제 러너를 띄우고, 러너에 실제 실행기 `claudeCode`를 꽂아 웹이 하듯 DM으로 묻는다. 채널 세션, 읽기 전용 도구(Read, Grep, Glob), `--resume`, 10분 상한, 실행 기록이 모두 러너의 것이다.
- Codex도 러너의 코드로 돈다(#16). 러너에 실제 실행기 `codex`를 꽂아 Codex 에이전트에게 DM으로 묻는다. 러너가 `codex exec --json -`(첫 턴)과 `codex exec --json resume <id> -`(이어 가는 턴)을 `-s read-only`로 띄우고 메시지를 표준 입력으로 넣는다. 긴 세션만 컴팩트 문턱을 낮춰야 해서 `codex exec`를 바로 부른다(샌드박스는 같이 읽기 전용).
- 임시 레포는 끝나면 지운다. 실패한 점검이 있으면 남기고 결과에 경로를 적는다.

## 돌리기 전에

- 구독으로 로그인해 둔다: `claude auth login`(claude.ai 계정), `codex login`(ChatGPT 계정).
- API 키를 지운다. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY` 가운데 하나라도 있으면 스크립트가 이름만 알리고 멈춘다. 값은 읽지도 찍지도 않는다.
- 레포 맨 위에서 `npm ci`를 해 둔다(Node 24 이상).
- 사용량: 짧은 점검은 실행기마다 세 턴이다. 긴 세션은 맥락을 Claude Code는 약 10만 토큰, Codex는 약 4만 토큰을 넘을 때까지 키우므로 구독 사용량이 꽤 든다. 모델은 각 실행기의 기본값을 쓴다(러너가 그렇게 띄운다).

## 돌리는 법

레포 맨 위에서:

```bash
node test/real-executors.ts > executor-check-result.md
```

- 진행은 터미널(stderr)에, 결과는 stdout에 나온다. 위처럼 받으면 결과만 파일에 남는다.
- 실행기 하나만: `node test/real-executors.ts claude-code` 또는 `node test/real-executors.ts codex`.
- 긴 세션을 빼고 빨리: `--quick`.

## 읽는 법

- `[x]`는 통과, `[ ] …(실패)`는 실패, `…(관찰)`은 통과·실패 없이 본 것이다. 실패가 하나라도 있으면 종료 코드가 1이다.
- 실패하면 임시 레포를 남기고 경로를 적는다. 그 안의 `.git/omagari/runs.jsonl`은 러너가 실행기에 넘긴 메시지와 세션 id다.
- 세션 기록은 결과에 적힌 세션 id로 찾는다. Claude Code는 `~/.claude/projects/<폴더>/<세션 id>.jsonl`이고 컴팩트는 `compact_boundary` 줄이다. Codex는 `~/.codex/sessions/…/rollout-…-<세션 id>.jsonl`이고 컴팩트는 `compacted` 줄이다.
- 자동 컴팩트 문턱은 낮춰서 본다. 기본 문턱은 모델의 맥락 한계라(1M 모델은 약 967K) 거기까지 채우면 비싸다. Claude Code는 받는 가장 작은 창인 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`, Codex는 `model_auto_compact_token_limit=40000`이다. 결과의 첫 줄에 쓴 값이 적힌다. Claude Code는 셸에 이 변수가 이미 있으면 그 값을 쓴다.
- 러너 세션은 이 기기의 사용자 설정(`~/.claude`, `~/.codex`)을 그대로 읽는다. Codex의 기본 샌드박스는 `~/.codex/config.toml`의 `sandbox_mode`를 따르지만, 러너는 `-s read-only`를 직접 주므로 그 값과 상관없다.

## 결과를 어디에 적나

결과 블록을 `docs/omagari-v3-implementation.md` 1장 "만들면서 확인할 것" 아래에 붙이고 다음을 고친다.

| 결과의 줄 | 고칠 곳 |
| --- | --- |
| Codex 세션 이어 가기, 읽기 전용, `codex exec fork` | 구현 1장 "만들면서 확인할 것"의 Codex 줄. 문서로 확인한 것 뒤에 손 점검 날짜와 결과를 붙인다 |
| Codex 구독 로그인 + 세션 이어 가기 | 구현 13장 미정 "Codex에서 구독 로그인으로 러너를 돌릴 수 있는지". 둘 다 통과면 `[x]`로 바꾸고 날짜를 적는다 |
| 긴 세션 둘 | 구현 1장 "만들면서 확인할 것"에 줄을 더하고, `docs/stage1-questions.md` 3장과 PRD #3 미정의 "자동 컴팩트가 일어나는가" 줄에 결과를 적는다 |
| `codex exec fork` 있음/없음 | `docs/stage1-questions.md` 3장 "Codex에 `codex exec`용 포크가 있는가". 명령이 있다는 것만 적는다. 이 점검은 포크를 돌려 보지 않는다 |
| 모두 | 이슈 #7의 "사람이 한 번 돌려 결과를 구현 문서에 적었다"를 체크한다 |

## #16(Codex 실행기)에 넘긴 것

#16이 러너에 반영했다(ADR-0003). 남겨 두는 까닭은 출처다.

- `codex exec`의 `--sandbox`/`-s`와 `--cd`/`-C`는 전역 플래그가 아니라 `resume`보다 앞에 둬야 한다. `--json`, `--skip-git-repo-check`, `--ephemeral`, `-o`는 전역이라 어디에 둬도 된다. `resume`의 플래그 표에는 `--sandbox`가 없다. 이 스크립트는 모두 `resume` 앞에 둔다.
- `--sandbox`의 기본값은 "설정을 따른다"다. 주인의 `config.toml`이 `workspace-write`면 기본이 읽기 전용이 아니다. Claude Code에서 `--allowedTools`에 기대지 않고 `--tools`로 줄인 것(ADR-0003)과 같은 까닭으로, 러너는 기본값에 기대지 않고 `-s read-only`를 직접 준다.
- 첫 턴의 세션 id는 `thread.started` 이벤트의 `thread_id`, 답은 마지막 `item.completed`(`item.type`이 `agent_message`)의 `text`다.

Sources: [Codex 비대화 모드](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex 명령 레퍼런스](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [codex-rs/exec/src/cli.rs](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs), [Codex 설정 예시](https://developers.openai.com/codex/config-sample), [Claude Code 환경 변수](https://code.claude.com/docs/en/env-vars), [Claude Code 모델 설정: 자동 컴팩트 창](https://code.claude.com/docs/en/model-config)
