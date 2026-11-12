---
status: accepted
---

# 정의 줄은 러너가 `@vscode/tree-sitter-wasm`으로 뽑고, 내용과 같은 규칙으로 올린다

2단계는 정의 줄과 심볼 색인 위에 간접 충돌(추정), 중복 구현, 선점의 심볼 단위, `omagari impact`를 세운다(PRD #78, 2단계 질문 A11). 러너가 tree-sitter로 TypeScript, TSX, JavaScript 파일을 읽는다. 파서는 `@vscode/tree-sitter-wasm`(MIT, VS Code 팀) 하나를 넣는다. 그 안에 tree-sitter 런타임(web-tree-sitter)과 그 런타임으로 빌드한 문법 wasm(typescript, tsx, javascript 포함)이 함께 있다.

Room은 `web-tree-sitter`와 `tree-sitter-wasms`(문법 wasm 모음)를 따로 넣는다(Room의 `package.json`). 정의와 쓰는 곳의 색인은 `docs/room-behavior.md`에 적었다. 동작만 보았고 코드는 옮기지 않았다: 정의 줄은 선언의 머리(본문 앞까지)이고, 타입처럼 몸 전체가 계약인 것은 선언 전체다. 본문만 바뀐 것은 정의 줄의 변경이 아니다.

## 무엇을 정의로 보나

- 파일의 맨 위(내보낸 것 포함)의 함수, 클래스, 인터페이스, 타입, 열거형과, 그 클래스의 메서드(`클래스.메서드`). 함수를 담은 변수(`const f = () => …`)는 함수다. 함수 안의 함수와 그 밖의 변수는 계약이 아니라 뺀다.
- 정의 줄은 선언의 머리를 공백만 접어 견준다. `export`를 붙이거나 떼는 것도 정의 줄의 변경이다.
- 기준 커밋의 판과 견주어 새로 생긴 것(`added`), 정의 줄이 바뀐 것(`changed`), 없어진 것(`removed`, 줄은 기준 판의 것)을 가린다. 표시가 없는 정의도 함께 싣는다. 선점이 정의 이름으로 줄을 찾는다(ADR-0008).

## 공유 수준

정의 줄은 내용과 같은 규칙으로 나간다(ADR-0007). 내용을 올리는 파일에만 싣는다: full이면 싣고, declared는 아직 선점이 없어 내용이 나가지 않으니 싣지 않고, intent는 싣지 않는다. 늘 빼는 파일(gitignore, `.env` 계열)은 관측에서 빠지므로 정의 줄도 나가지 않는다.

## 심볼 색인

`omagari impact`와 간접 충돌은 러너의 사본(등록한 폴더)에서 이름으로 정의와 쓰는 곳을 잇는다. 이름이 같으면 잘못 잇는다. 그래서 추정이다. 지금은 물을 때마다 사본을 읽는다(그 이름이 든 파일만 파싱한다). 자주 묻게 되면(간접 충돌) 색인을 남겨 두고 바뀐 파일만 다시 읽는다.

## Considered Options

- **`web-tree-sitter` + `tree-sitter-wasms`(Room과 같은 짝)**: 둘을 따로 맞춰야 한다. `tree-sitter-wasms`의 마지막 판(0.1.13)은 옛 tree-sitter로 빌드되어 새 `web-tree-sitter`와 ABI가 맞는지 판마다 확인해야 하고, 문법 36개(약 50MB)를 받는다.
- **`tree-sitter`(네이티브) + `tree-sitter-typescript`, `tree-sitter-javascript`**: 설치 때 `node-gyp-build`가 돌고, 미리 빌드된 판이 없는 기기에서는 컴파일러가 있어야 한다. 멤버의 기기마다 깔리는 러너에는 무겁다.
- **TypeScript 컴파일러 API**: TypeScript와 JavaScript는 정확하지만 그 언어뿐이다. 언어를 늘릴 때(PRD의 미정) 파서를 다시 고르게 된다.

## Consequences

- 런타임과 문법이 한 패키지라 판을 함께 올린다. 다른 언어(파이썬, Go, 자바 등)의 문법도 이미 들어 있어 언어를 늘릴 때 새 의존성이 없다.
- 설치 스크립트가 없고 네이티브 빌드가 없다(wasm). 패키지는 약 22MB다.
- 다른 언어의 파일은 정의 줄 없이 지금처럼 관측한다.
- 관측마다 바뀐 파일과 그 기준 판을 다시 파싱한다. 무거워지면 내용이 같은 파일의 결과를 남겨 둔다.
