# Omagari 작업 규칙

## 묻기 전에 먼저 찾는다

사람에게 질문하기 전에 아래 순서로 답을 찾는다. 찾으면 묻지 않고 그 답을 쓴다.

1. **이 레포의 문서**: `docs/omagari-v3.md`, `docs/omagari-v3-implementation.md`, `GLOSSARY.md`, `docs/adr/`
2. **이미 있는 구현**: `../room-reference`(Room)와 문서의 Sources에 적힌 도구가 같은 문제를 어떻게 풀었는지
3. **알려진 방법론과 라이브러리**: 웹에서 검색한다. 이름 붙은 방법론, 널리 쓰는 라이브러리, 공식 문서가 이미 답을 갖고 있는지 본다

찾은 답은 출처와 함께 적는다. 설계를 정하는 답이면 ADR로 남긴다.

## 물어도 되는 것

- 취향이나 방향처럼 사람만 정할 수 있는 것
- 되돌리기 어려운데 어느 쪽도 말이 되는 것
- 찾은 답끼리 서로 다르거나, 우리 문서와 어긋나는 것

물을 때는 어디를 찾아봤는지와 내가 고를 답을 함께 적는다. 질문만 던지지 않는다.

## 그 밖에

- Room은 PolyForm Noncommercial이다. 코드를 옮기지 말고 동작만 보고 새로 쓴다.
- 문서로 확인이 안 되는 것은 추측으로 채우지 말고 미정으로 남긴다.
- 새 장치를 만들기 전에 붙여 쓸 수 있는 것이 있는지 먼저 찾는다(구현 문서 10장).
- 화면(`area:web`)을 만들거나 고칠 때는 먼저 루트의 `DESIGN.md`를 읽고 따른다. 어긋나게 가야 하면 PR에 이유를 적는다.
- 이슈, PR, 커밋, 댓글, 문서에서 사람을 가리킬 때는 `@핸들`로 쓰고 호칭은 붙이지 않는다. GLOSSARY의 "주인"은 제품 용어라 그대로 쓴다.

## 코드와 명령

- 스택은 ADR-0014에 있다: Node.js 24 이상(빌드 없이 `.ts`를 그대로 실행), Hono, SQLite, WebSocket.
- 조각은 `packages/` 아래에 하나씩 있다: `contract`, `server`, `runner`, `cli`, `hooks`, `web`. 러너와 서버 사이의 메시지와 웹이 쓰는 API는 `packages/contract`에만 정의하고, 나머지 조각은 그것을 가져다 쓴다.
- 동작 테스트는 `test/harness.ts`의 틀로 쓴다. 실제 서버와 실제 러너를 임시 Git 레포 위에 띄우고, 서버 API와 CLI·훅 실행 파일의 입출력으로만 조작하고 확인한다. 가짜는 GitHub, 에이전트 실행기, 합쳐 돌려 보기의 샌드박스 세 곳에만 둔다. 샌드박스는 CI에서 돌지 않을 수 있어 가짜로 두고, 실제 샌드박스는 손 점검으로 본다(2026-11-14 @Pancheble 결정, ADR-0033).
  - 계약을 어기는 상대(뚫린 서버, 러너인 척하는 연결)를 흉내 낼 때만 `test/contract.test.ts`처럼 날 WebSocket을 쓴다.
  - 러너가 스스로 받기(`test/self-update.test.ts`)의 `npm ci`도 가짜로 둔다. 진짜는 내려받기가 필요해서다. 진짜 `npm ci`는 손 점검으로 본다(2026-11-18 @Pancheble 허용, #230).
- 올리기 전에 셋을 돌린다: `npm run format`(포맷과 린트 고치기), `npm run typecheck`, `npm test`. CI도 같은 것을 돌린다.

## Git과 GitHub 규칙

- 브랜치는 `dev`(기본, 작업이 모이는 곳)와 `main`(릴리즈한 판. 멤버와 다른 팀이 띄우는 서버가 받아 쓴다. 도그푸딩 서버는 `dev`를 따른다, ADR-0042) 두 갈래다(ADR-0019).
- 작업 브랜치는 `dev`에서 따고, PR은 `dev`로 연다. 머지는 스쿼시만 한다.
- 커밋과 PR 제목은 `접두사(범위): 요약` 형식이다. 접두사는 feat, fix, docs, refactor, test, chore, ci, perf. 범위는 선택(소문자, 숫자, 하이픈). 요약은 한국어로 50자 안쪽, 끝에 마침표를 찍지 않는다. 깨지는 변경은 접두사 뒤에 `!`. 스쿼시 커밋의 제목과 본문은 PR 제목과 PR 본문이 된다. 커밋은 `.githooks/commit-msg`가, PR 제목은 "PR 제목 검사" 워크플로가 검사한다.
- 릴리즈는 메인테이너가 손으로 한다(ADR-0019, ADR-0022). `main`에는 PR을 열지 않는다.
- 버전은 git 태그다. package.json의 `version`은 `0.0.0`으로 두고 올리지 않는다.
- 이슈에는 `type:*`, `area:*`, `stage:*`, `size:*` 라벨과 마일스톤을 붙인다. 에이전트가 바로 할 수 있는 이슈에만 `ready-for-agent`를 함께 붙인다.
- 이슈 하나 = 브랜치 하나 = PR 하나. 브랜치 이름은 `접두사/짧은-영문-설명`.
- Git 규칙을 바꾸면 같은 변경에서 `.githooks/commit-msg`와 PR 제목 검사도 새 규칙에서 다시 만들고, 맞는 예와 틀린 예로 확인한다.
- 이 레포를 새로 클론하면 `git config core.hooksPath .githooks`를 한 번 실행한다. 세션을 시작할 때 이 설정이 꺼져 있으면 켠다.

## Agent skills

### Issue tracker

이슈는 이 레포의 GitHub Issues에 둔다(`gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

single-context: 루트의 `GLOSSARY.md`와 `docs/adr/`. See `docs/agents/domain.md`.
