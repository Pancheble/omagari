---
status: accepted
---

# 합쳐 돌려 보기는 러너가 샌드박스 안에서만 돌린다

구현 13장은 합쳐 돌려 보기를 어디서 돌릴지와, 서버에서 받은 푸시 전 코드를 돌릴 때의 안전장치를 미정으로 남겼다(ADR-0007). 러너가 돌린다. 그리고 운영체제의 샌드박스 안에서만 돌린다(2026-11-13 주인 확인, `docs/stage3-questions.md` Q5).

테스트를 돌리는 것은 그 코드를 실행하는 것이다. 상대의 푸시 전 코드는 서버를 거쳐 오므로, 서버가 뚫려 관측을 바꿔치기하면 모든 멤버의 기기에서 남의 코드가 저절로 실행된다. 샌드박스는 그 코드가 누구에게서 왔든 할 수 있는 일을 임시 워크트리 안으로 가둔다.

## 무엇을 막나

- **네트워크**: 바깥으로 나가지 못한다. 자기 기기의 포트(localhost)는 쓴다. 테스트가 서버를 띄워 붙는 레포가 많다.
- **쓰기**: 임시 워크트리와 임시 폴더 안에만 쓴다.
- **읽기**: 홈 폴더를 막고, 임시 워크트리와 실행에 필요한 도구 자리, 이어 둔 의존성 폴더, 레포의 개체 폴더(`objects`)만 연다. 레포의 Git 폴더는 열지 않는다(원격 URL에 토큰이 있을 수 있다). 임시 워크트리는 자기만의 Git 폴더를 두고 개체 폴더만 빌려 읽어, 샌드박스 안의 `git`이 돈다(#130).
- **환경 변수**: 정해 둔 것만 넘긴다. 토큰과 키는 넘기지 않는다. Room은 러너의 환경을 그대로 넘긴다(`ROOM_*`만 뺀다).

샌드박스는 `@anthropic-ai/sandbox-runtime`을 붙여 쓴다(Apache-2.0, "Beta Research Preview"). macOS에서는 `sandbox-exec`, Linux에서는 bubblewrap으로 가둔다. Claude Code와 Codex가 명령을 돌릴 때 쓰는 것과 같은 방식이다. 기본값이 네트워크 막음, 쓰기 막음, 읽기 허용이라 읽기는 따로 막는다.

샌드박스를 쓸 수 없는 기기(도구가 없다, Windows)에서는 합쳐 돌려 보기를 돌리지 않는다. 가두지 않고 돌리는 길은 두지 않는다.

## 샌드박스와 함께 지키는 것

- 검사 명령은 서버가 주지 않는다.
- 서버는 러너에게 "돌려라"를 시킬 수 없다. 러너가 받아 둔 상황을 보고 스스로 정한다. 구현 11장은 러너가 받는 요청에 합쳐 돌려 보기를 넣었는데, 요청으로 받지 않는다.
- 돌린 것은 실행 기록에 남긴다(구현 11장).
- 출력은 에이전트에게 지시가 아닌 데이터로만 넘긴다(ADR-0017).

## Considered Options

- **GitHub Actions에서 돌리기**: 푸시하지 않은 작업은 합칠 수 없다. 서버에는 레포가 없어(ADR-0023) 합친 브랜치를 만들어 올릴 수도 없다.
- **GitHub에서 받은 코드만 돌리기**: 서버는 멤버의 `repo` 토큰을 들고 있다(ADR-0025). 서버가 뚫리면 GitHub에 푸시도 할 수 있어, 막아 주는 것이 없다.
- **장치 없음**: Room이 이렇게 한다. 샌드박스도 서명도 없고 "방에 들인 사람은 모두 믿는다"(Room README). Room은 에이전트가 부를 때만 돌리지만 우리는 저절로 돌린다.
- **관측에 서명하기**: 러너가 관측에 서명하고 받는 러너가 GitHub에 등록된 SSH 서명 키로 확인한다. 서버가 내용을 바꿔치기하지 못한다. 그러나 팀원의 기기가 뚫린 경우는 막지 못하고, 멤버마다 서명 키를 등록하고 관리해야 한다. 서버를 믿을 수 없게 되면 샌드박스 위에 더한다.
- **사람이 누를 때만 돌리기**: 저절로 돌지 않을 뿐, 누른 사람의 기기에서는 똑같이 실행된다.
- **컨테이너에서 돌리기**: 더 단단히 가두지만 멤버가 Docker를 깔아야 하고, macOS에서는 Linux에서 도는 것이라 의존성을 다시 깔아야 한다.

## Consequences

- 바깥 네트워크나 Docker가 필요한 검사 명령은 돌지 못한다. 이때는 혼자 돌린 것도 깨지므로 "깨짐"이 아니라 "가릴 수 없음"이 된다.
- 멤버가 도구를 깔아야 한다. macOS는 ripgrep, Linux는 bubblewrap, socat, ripgrep이다. Ubuntu 24.04부터는 AppArmor 설정을 풀어야 할 수 있다.
- 읽기를 열어 둔 파일은 출력에 실려 서버로 나갈 수 있다. 샌드박스는 피해를 줄이지만 서버를 믿을 수 있게 만들지는 않는다.
- `sandbox-exec`는 macOS 매뉴얼에 폐기 예정으로 적혀 있다. 지금은 돌고, Apple이 내놓은 대체 명령은 찾지 못했다.
- `@anthropic-ai/sandbox-runtime`은 미리 보기 판이라 설정의 꼴이 바뀔 수 있다.
- 손 점검(2026-11-14, macOS, #138, 구현 문서 11장): 홈 아래에 둔 Node에서 읽기 막기와 돌리기는 됐다. 못 한 것은 Linux, 진짜 nvm, Jest 같은 감시 도구를 쓰는 테스트(`--no-watchman`)다. 점검에서 나온 것: 이 레포의 `npm test`는 유닉스 소켓이 막혀 돌지 못하고(#145), `TMPDIR`이 덮이고(#146), 러너의 현재 폴더가 레포가 아니면 임시 워크트리의 `.git/config`로 벗어날 수 있다(#144).

## Sources

- [sandbox-runtime README](https://github.com/anthropics/sandbox-runtime)
- [Room](https://github.com/rohanz/room) 커밋 `917b8d4`: `README.md`, `packages/room-mcp/src/tools/files.ts`의 `room_preview_merge`
- [GitHub Security Lab: Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/): 믿지 못하는 코드를 돌리는 쪽에는 비밀을 주지 않는다
- [SSH 서명과 GitHub의 서명 키](https://www.agwa.name/blog/post/ssh_signatures), [GitHub REST: SSH signing keys](https://docs.github.com/en/rest/users/ssh-signing-keys)
