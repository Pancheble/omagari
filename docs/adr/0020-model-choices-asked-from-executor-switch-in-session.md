---
status: accepted
---

# 고를 모델과 effort는 러너가 붙을 때 실행기에 묻고, 이어 가는 채널 세션에서도 바꿔 넘긴다

DM에서 내 에이전트에게 물을 때 모델과 effort를 고른다(#55, DESIGN.md "모델과 effort"). 실행기마다 고를 수 있는 모델이 다르고, 같은 실행기여도 계정과 판에 따라 다르며, 모델에 따라 effort 값도 다르다. 그 목록을 어디서 얻는지와, 채널과 에이전트마다 이어 가는 채널 세션(ADR-0015)에서 모델을 바꿔도 되는지를 정한다.

- **고를 거리는 실행기에 묻는다.** 러너는 켤 때 실행기마다 한 번 묻고 hello의 `choices`로 서버에 알린다. 둘 다 모델을 부르지 않고 사용량도 쓰지 않는다.
  - Claude Code: Agent SDK가 `supportedModels()`에 쓰는 길을 그대로 쓴다. `claude -p --input-format=stream-json --output-format=stream-json`으로 띄워 제어 요청 `initialize`를 보내면 답에 `models`(`value`, `resolvedModel`, `displayName`, `supportedEffortLevels`)가 온다. 주인의 훅은 `--settings={"disableAllHooks":true}`로 돌리지 않는다. 손 점검(2.1.319)에서 1.7초 걸렸고 세션 기록을 남기지 않았다.
  - Codex: IDE 확장이 쓰는 `codex app-server`의 `model/list`를 부른다. `model`, `displayName`, `supportedReasoningEfforts`, `isDefault`, `hidden`이 온다. 숨긴 모델은 뺀다.
  - 모델의 `id`는 실행기에 넘기는 값이다. Claude Code는 별칭이 가리키는 전체 이름(`resolvedModel`)을 쓴다. 그래야 답한 모델(`system`/`init`의 `model`)과 맞춰 이름을 찾는다. `default`는 우리의 "기본"이라 빼고, 그 effort 값을 "기본"의 것으로 둔다. Codex의 "기본" effort는 `isDefault` 모델의 것이다.
  - 묻지 못하면(깔려 있지 않음, 15초 상한) 그 실행기는 고를 거리 없이 붙는다. 웹에는 칩이 없고 "기본"으로만 묻는다.
- **러너가 마지막 문지기다.** 서버는 고른 값을 그대로 넘기고, 러너는 자기가 알린 목록에 없는 모델이나 그 모델(없으면 "기본")에 없는 effort면 실행기를 띄우지 않고 `invalid_message`로 답한다. 실행기에 넘기는 값은 늘 실행기가 알려 준 것이다.
- **"기본"이면 플래그를 넘기지 않는다.** Claude Code는 `--model`, `--effort`, Codex는 `-m`, `-c model_reasoning_effort=`를 고른 것만 넘긴다. Codex의 둘은 `resume` 앞에 둔다.
- **이어 가는 채널 세션에서 모델을 바꿔도 된다.** 고른 값은 매 턴에 넘기고, 바꿨다고 새 세션을 띄우지 않는다. 손 점검(2026-11-12)에서 두 실행기 모두 바꾼 모델로 답하면서 앞 턴의 대화를 기억했다.
  - Claude Code(2.1.319): `--resume`에 `--model`을 바꿔 주면 그 턴부터 새 모델로 답한다. `--model` 없이 이으면 설정의 기본 모델이 아니라 **그 세션의 마지막 모델**로 돈다. effort는 이어지지 않는다(넘기지 않으면 기본으로 돌아간다).
  - Codex(0.167.1): `exec -m … resume`으로 바꾸면 "This session was recorded with model X but is resuming with Y" 경고 한 줄(`item.completed`의 `error`)을 내고 턴은 그대로 돈다. `-m` 없이 이으면 그 세션의 모델이 아니라 **설정의 모델**로 돈다. effort도 이어지지 않는다.
- **답한 모델은 실행기가 알린 것을 쓴다.** Claude Code는 stream-json의 `system`/`init` 줄에서 읽는다(결과의 `modelUsage`는 세션 전체를 더한 것이라 이 턴의 것을 가릴 수 없다). 그래서 "기본"으로 물었는데 세션의 마지막 모델로 답했으면 배지가 그 모델을 보인다. Codex는 이벤트에 모델이 없어, 고른 모델이면 그 이름을 쓰고 "기본"이면 모른다(배지를 달지 않는다). effort는 고른 것만 적는다.
- **고른 값은 브라우저에 에이전트마다 둔다.** `localStorage`의 `omagari.picks.<멤버>`에 실행기마다 하나다. DM과 `@호출`이 같은 값을 쓰고, 보낼 때 지금 고를 거리에 없는 값은 "기본"으로 본다.

## Considered Options

- **고정 목록을 계약이나 러너에 적기**: 묻는 코드가 없고 러너를 켜는 데 시간이 들지 않는다. 하지만 Claude 5 모델처럼 판이 자주 바뀌고, Codex는 계정마다 보이는 모델이 달라(무료 요금제는 셋) 목록이 늘 낡는다. DESIGN.md도 "실행기가 러너를 거쳐 알려 준 것만" 보이라고 한다.
- **Codex의 `codex debug models`**: 한 번 실행해 JSON을 받으니 더 짧다. 하지만 디버그 도구이고 날것의 카탈로그(숨긴 모델, 프롬프트 템플릿 포함)라, 클라이언트용으로 문서화된 app-server를 골랐다.
- **Agent SDK(`@anthropic-ai/claude-agent-sdk`)의 `supportedModels()`**: 같은 제어 요청을 SDK가 대신 보낸다. 의존성 하나를 이것만 위해 더하지 않았다.
- **"기본"이면 설정의 모델을 직접 넘기기**(Claude Code의 `--model=default`): 이어 가는 세션에서도 "기본"이 늘 설정을 따르게 된다. 하지만 "기본이면 플래그를 넘기지 않는다"(#55)와 어긋나고, 실행기 자기 동작을 그대로 두는 편이 덜 놀랍다. 대신 배지가 실제로 답한 모델을 보인다.
- **모델을 바꾸면 새 세션 띄우기**: Codex 경고를 피하지만 채널 세션이 쌓은 대화와 넘긴 채널 메시지의 자리(ADR-0017)를 잃는다. 두 실행기 모두 바꿔도 대화를 기억해서 고르지 않았다.
- **고른 값을 서버에 두기**: 다른 기기의 브라우저에서도 같은 값이 보이고 `@호출`이 서버만으로 그 값을 쓴다. 하지만 표와 API가 하나씩 늘고, 1단계의 멤버는 한 브라우저에서 쓴다. 새로 고쳐도 남는 것으로 충분하다.

## Consequences

- 러너를 켤 때 실행기마다 프로세스 하나를 더 띄운다(Claude Code 약 2초, 병렬). 계정이나 실행기 판이 바뀌어 목록이 달라지면 러너를 다시 켜야 반영된다.
- Claude Code 실행기의 출력을 `--output-format=json`에서 `stream-json`으로 바꿨다. 답과 세션은 같은 `result` 줄에서 읽는다.
- 고를 거리는 멤버 목록(`MemberView.agents[].choices`)에 실려 모두에게 간다. 주인만 쓰지만 따로 길을 내지 않았다. 멤버가 많아져 멤버 목록이 무거워지면 주인에게만 보내는 길로 옮긴다.
- 고른 값은 기기마다 다르다. 다른 브라우저에서는 "기본"부터 다시 고른다.
- 제어 요청 `initialize`의 `resolvedModel`과 app-server의 `model/list`는 실행기 판에 따라 바뀔 수 있다. 바뀌면 고를 거리가 비어 "기본"으로만 묻게 되고, 러너는 켤 때 이유를 한 줄 알린다.
