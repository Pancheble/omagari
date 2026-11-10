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

## Agent skills

### Issue tracker

이슈는 이 레포의 GitHub Issues에 둔다(`gh` CLI). See `docs/agents/issue-tracker.md`.

### Domain docs

single-context: 루트의 `GLOSSARY.md`와 `docs/adr/`. See `docs/agents/domain.md`.

## gstack

웹 브라우징은 모두 gstack의 `/browse` 스킬로 한다. `mcp__claude-in-chrome__*` 도구는 쓰지 않는다.
