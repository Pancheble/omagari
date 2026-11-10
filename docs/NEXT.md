# Claude Code에서 시작하기

워크플로 문서의 흐름 그대로 가요. 따로 만든 명세 형식은 없고, 스킬이 내는 산출물(GLOSSARY.md, ADR, PRD, 이슈)이 곧 명세예요.

## 0. 준비: 한 번에 깔기

Claude Code를 이 폴더에서 열고 아래를 붙여 넣어요.

```text
이 레포에서 작업을 시작할 준비를 해 줘. 순서대로 하고, 끝나면 무엇이 깔렸는지 표로 보고해.
명령이 실패하면 추측으로 고치지 말고 그 도구의 --help나 README를 읽고 다시 해.

1. 레포 준비
   - git 저장소가 아니면 git init
   - ../room-reference가 없으면: git clone --depth 1 https://github.com/rohanz/room ../room-reference
     (읽기 전용 참고용이야. 이 레포 안에 넣지 마)

2. Matt Pocock 스킬 (이 프로젝트에만)
   - 먼저 npx skills@latest add --help 로 옵션을 확인해. 프로젝트 범위, 에이전트 선택, 묻지 않고 진행하는 옵션을 찾아.
   - npx skills@latest add mattpocock/skills 를 프로젝트 범위로 설치해.
     여러 에이전트가 같이 읽도록 .agents/skills/에 두고, Claude Code가 읽을 수 있게 연결해.
   - 필요한 것: grill-with-docs, PRD 만들기, 이슈로 쪼개기, handoff, git-guardrails-claude-code, tdd, setup-matt-pocock-skills
   - 이름이 바뀌었을 수 있어(to-prd → to-spec, to-issues → to-tickets). 깔린 폴더의 실제 이름을 확인해서 알려 줘.
   - 설치 뒤 /setup-matt-pocock-skills 를 이 레포에서 한 번 실행해.
     이슈 트래커는 GitHub, 문서 위치는 docs/, ADR은 docs/adr/ 로 답해.

3. gstack (전역)
   - bun이 없으면 먼저 설치해: curl -fsSL https://bun.sh/install | bash
   - ~/.claude/skills/gstack이 없으면:
     git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
   - 설치가 CLAUDE.md에 넣으라고 하는 내용은 AGENTS.md에 넣어. CLAUDE.md는 @AGENTS.md 한 줄로 둬.

4. 바닥 깔기
   - git-guardrails 훅을 이 프로젝트에 적용해.
   - .gitignore를 만들어(node_modules, .env, .DS_Store).
   - 포맷과 타입 검사 훅은 스택이 정해진 뒤에 달 거야. 지금은 하지 마.

5. GitHub 정리 (규칙은 AGENTS.md의 "Git과 GitHub 규칙"을 따라)
   - 훅 켜기: chmod +x .githooks/commit-msg && git config core.hooksPath .githooks
   - 원격 저장소가 없으면 만들어: gh repo create omagari --private --source . --remote origin
   - 머지 방식: gh repo edit --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
   - 라벨 만들기(gh label create, 이미 있으면 --force):
     type:feat, type:fix, type:docs, type:refactor, type:test, type:chore, type:ci, type:perf
     area:runner, area:server, area:web, area:cli, area:hooks, area:contract
     stage:0, stage:1, stage:2, stage:3, stage:4
     기본 라벨(bug, enhancement 등)은 지워.
   - 프로젝트 만들기: 권한이 없으면 gh auth refresh -s project 를 나에게 실행해 달라고 해.
     gh project create --owner @me --title "Omagari" 로 만들고 gh project link 로 이 레포에 연결해.
     Status에 In Review를 추가하고(Todo, In Progress, In Review, Done), 단일 선택 필드 Stage(0~4)와 Area를 만들어.
   - 프로젝트의 자동화(이슈 자동 추가, 머지되면 Done)는 명령으로 켤 수 없으면 내가 화면에서 켤 곳을 알려 줘.

6. 확인
   - 깔린 스킬 목록, 각 스킬을 부르는 명령, 건너뛴 것과 이유를 보고해.
   - docs/NEXT.md의 명령 이름이 실제와 다르면 고쳐.
   - 여기까지를 "chore: 작업 환경 준비"로 커밋하고 push해. Superpowers, CCPM, ECC는 깔지 마.
```

## 1. 정의: /grill-with-docs

```text
/grill-with-docs

docs/omagari-v3.md(기획)와 docs/omagari-v3-implementation.md(구현)가 내가 쓴 첫 안이야.
범위는 구현 문서 1장의 1단계(러너 → 서버 중계 → 관측 → 웹 화면)까지만.

구현 문서에는 Room 장치의 이름과 의도만 있어. 캐묻기 전에 ../room-reference 코드를 읽고,
관측, 상태 한 줄, 선점, 편지함과 피드, 묻고 기다리기, 세션 시작 훅과 편집 전 훅이
실제로 어떻게 동작하는지 확인해서, 우리 문서에 빠진 동작을 질문으로 꺼내 줘.

- Room은 PolyForm Noncommercial이야. 코드를 옮기지 말고 동작만 글로 남겨.
- Room과 우리 문서가 다르면 우리 문서를 따르고, 다른 점은 ADR로 남겨.
- 묻기 전에 AGENTS.md의 순서대로 찾아봐: 두 문서, Room 코드, 알려진 방법론과 라이브러리(웹 검색). 답이 있으면 묻지 말고 출처와 함께 스스로 답해. 내 결정이 필요한 것만, 네가 고를 답과 함께 물어.
- 문서로 확인이 안 되는 것(실행 중인 세션 포크, 화면 없는 세션의 자동 컴팩트)은 추측하지 말고 미정으로 남겨.
```

나오는 것: `GLOSSARY.md`(용어), `docs/adr/`(결정).

## 2. PRD: /to-spec

1단계 PRD를 만들어요. Room에서 확인한 장치의 동작이 여기 구현 결정으로 들어가요.

## 3. 쓰기: /to-tickets

수직 슬라이스 이슈로 쪼개요. 첫 이슈는 계약(러너와 서버 사이 메시지 타입, API 스키마, 계약 테스트)이고, 그다음이 러너예요.

## 4. 구현과 확인: gstack

이슈 하나 = 브랜치 하나 = 작은 PR 하나.

## 문서 원본

두 문서의 원본은 Claude의 "Omagari 기획 문서"(v3, v3 구현 탭)예요. 이 폴더의 파일은 2026-11-10에 뽑은 사본이라, 앞으로는 이 레포의 파일을 기준으로 고치면 돼요.
