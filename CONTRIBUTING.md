# 기여 안내

Omagari에 관심 가져 주셔서 고맙습니다. 무엇을 만드는지와 왜 만드는지는 [docs/omagari-v3.md](docs/omagari-v3.md)에, 설치와 실행은 [README.md](README.md)에 있습니다. 기여하기 전에 이 문서와 [행동 강령](CODE_OF_CONDUCT.md)을 읽어 주세요.

## 시작하기

```bash
git clone https://github.com/Pancheble/omagari.git
cd omagari
git config core.hooksPath .githooks
npm ci
```

`git config core.hooksPath .githooks`는 커밋 메시지 형식을 검사하는 훅을 켭니다. 클론할 때마다 한 번 실행해 주세요.

## 브랜치와 PR

- 작업 브랜치는 `dev`에서 따고, PR도 `dev`로 엽니다. `main`에는 PR을 열지 않습니다. `main`은 릴리즈한 판입니다.
- 브랜치 이름은 `접두사/짧은-영문-설명`으로 짓습니다(예: `fix/runner-reconnect`).
- 머지는 스쿼시만 합니다. PR 제목이 머지 커밋 메시지가 됩니다.
- 이슈 하나에 PR 하나를 원칙으로 합니다. 이슈 번호는 PR 본문 첫 줄에 `Closes #<번호>`로 적어 주세요.

## 커밋과 PR 제목 형식

```text
접두사(범위): 요약
```

- 접두사: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf` 중 하나.
- 범위(선택): 소문자, 숫자, 하이픈(예: `runner`, `web`, `contract`).
- 요약: 한국어, 50자 안쪽, 끝에 마침표를 찍지 않습니다.
- 깨지는 변경은 접두사 뒤에 `!`를 붙입니다(예: `feat(contract)!: ...`).

커밋은 `.githooks/commit-msg`가, PR 제목은 "PR 제목 검사" 워크플로가 확인합니다.

## 올리기 전에

PR을 열기 전에 다음 셋을 돌려 주세요. CI도 같은 것을 돌립니다.

```bash
npm run format      # 포맷과 린트를 고칩니다
npm run typecheck   # 타입을 검사합니다
npm test            # 테스트를 돌립니다
```

테스트는 `test/harness.ts`의 틀을 씁니다. 실제 서버와 실제 러너를 임시 Git 레포 위에 띄우고, 서버 API와 CLI·훅 실행 파일의 입출력으로만 조작하고 확인합니다. 버그를 고쳤다면 그 버그를 잡는 테스트를 함께 넣어 주세요.

## 설계 문서

이 레포는 결정을 문서로 남깁니다.

- 용어는 [GLOSSARY.md](GLOSSARY.md)에 맞춥니다.
- 설계를 바꾸는 결정은 [docs/adr/](docs/adr/)에 ADR로 남깁니다.
- 화면을 만들거나 고칠 때는 루트의 [DESIGN.md](DESIGN.md)를 먼저 읽어 주세요. 어긋나게 가야 하면 PR에 이유를 적습니다.
- 스택은 [ADR-0014](docs/adr/0014-stack-node-hono-sqlite-websocket.md)에 있습니다. 새 의존성을 더하기 전에 기존 것으로 되는지 먼저 봐 주세요.

## 이슈

- 버그나 기능 요청은 이슈 양식을 써 주세요.
- 보안 취약점은 공개 이슈로 올리지 말고 [SECURITY.md](SECURITY.md)의 절차를 따라 주세요.
- 큰 변경은 PR 전에 이슈에서 먼저 이야기해 주시면 좋습니다.

## 라이선스

이 레포의 라이선스는 [LICENSE](LICENSE)에 있습니다. 기여하기 전에 조건을 확인해 주세요.
