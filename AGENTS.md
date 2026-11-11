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

## 코드와 명령

- 스택은 ADR-0014에 있다: Node.js 24 이상(빌드 없이 `.ts`를 그대로 실행), Hono, SQLite, WebSocket.
- 조각은 `packages/` 아래에 하나씩 있다: `contract`, `server`, `runner`, `cli`, `hooks`, `web`. 러너와 서버 사이의 메시지와 웹이 쓰는 API는 `packages/contract`에만 정의하고, 나머지 조각은 그것을 가져다 쓴다.
- 동작 테스트는 `test/harness.ts`의 틀로 쓴다. 실제 서버와 실제 러너를 임시 Git 레포 위에 띄우고, 서버 API와 CLI·훅 실행 파일의 입출력으로만 조작하고 확인한다. 가짜는 GitHub와 에이전트 실행기 두 곳에만 둔다.
  - 계약을 어기는 상대(뚫린 서버, 러너인 척하는 연결)를 흉내 낼 때만 `test/contract.test.ts`처럼 날 WebSocket을 쓴다.
  - 예외는 `packages/server/src/http.test.ts` 하나다. 본문을 받는 경로가 아직 없어 틀의 본문 검사만 안쪽에서 확인한다. 본문을 받는 첫 경로가 생기면 경계로 옮기고 지운다. 본보기로 삼지 않는다.
- 올리기 전에 셋을 돌린다: `npm run format`(포맷과 린트 고치기), `npm run typecheck`, `npm test`. CI도 같은 것을 돌린다.

## Git과 GitHub 규칙

- 브랜치는 `dev`(기본, 작업이 모이는 곳)와 `main`(릴리즈와 데모) 두 갈래다.
- 작업 브랜치는 `dev`에서 따고, PR은 `dev`로 연다. 머지는 스쿼시만 한다.
- 커밋과 PR 제목은 `접두사(범위): 요약` 형식이다. 접두사는 feat, fix, docs, refactor, test, chore, ci, perf. 커밋은 `.githooks/commit-msg`가, PR 제목은 "PR 제목 검사" 워크플로가 검사한다.
- `main`에는 PR을 열지 않는다. 릴리즈나 데모 때만 빨리 감기로 올린다: `git push origin dev:main`. 빨리 감기가 안 되면 멈추고 사람에게 알린다.
- `main`에 올린 커밋에 `vX.Y.Z` 태그를 찍는다. feat는 Y, fix는 Z, 깨지는 변경(`!`)은 X를 올린다. 1.0 전에는 깨지는 변경도 Y를 올린다.
- 릴리즈는 `gh release create vX.Y.Z --generate-notes`로 만든다. 노트는 PR의 `type:*` 라벨로 묶인다(`.github/release.yml`).
- 이슈에는 `type:*`, `area:*`, `stage:*` 라벨과 마일스톤을 붙인다. 사람 없이 에이전트가 바로 할 수 있는 이슈에만 `ready-for-agent`를 함께 붙인다.
- 이슈 하나에 세션 하나. 이슈가 끝나면 `/clear`, 중간에 길어지면 `/handoff`.

## Agent skills

### Issue tracker

이슈는 이 레포의 GitHub Issues에 둔다(`gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

single-context: 루트의 `GLOSSARY.md`와 `docs/adr/`. See `docs/agents/domain.md`.

## gstack

웹 브라우징은 모두 gstack의 `/browse` 스킬로 한다. `mcp__claude-in-chrome__*` 도구는 쓰지 않는다.
