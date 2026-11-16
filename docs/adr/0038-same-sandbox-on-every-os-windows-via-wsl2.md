---
status: accepted
---

# 합쳐 돌려 보기는 모든 OS에서 같은 막기로 가두고, Windows는 WSL2 안에서 돌린다

합쳐 돌려 보기는 macOS에서만 제대로 돌았다. Windows에서는 "돌리지 못함"이었다. Linux에서는 유닉스 소켓을 쓰는 레포가 늘 "가릴 수 없음"이 되는데 까닭이 보이지 않았고, 손 점검도 한 번 못 했다. 이제 모든 OS를 지원한다(2026-11-15 주인 결정).

막는 것은 OS마다 같다(ADR-0033, ADR-0037).

- 쓰기는 임시 워크트리와 임시 폴더 안에만 한다.
- 바깥 네트워크를 막는다.
- 홈 폴더를 읽지 못한다.
- 토큰을 넘기지 않는다.
- 유닉스 소켓은 임시 워크트리와 임시 폴더 안에서만 쓴다.

이 가운데 하나라도 못 지키는 기기는 까닭을 적고 "돌리지 못함"이 된다. 가두지 않고 돌리는 길은 여전히 없다.

| OS | 어떻게 가두나 | 지금 못 지키는 것 |
| --- | --- | --- |
| macOS | `sandbox-exec` | 없다 |
| Linux | bubblewrap과 seccomp | 유닉스 소켓을 경로로 좁혀 열지 못해 모두 막는다(아래) |
| Windows의 WSL2 | Linux와 같다. Windows 드라이브도 읽지 못하게 가린다 | Linux와 같다 |
| Windows 그대로 | 돌리지 않는다. "WSL2 안에서 러너를 켜세요"를 까닭으로 보인다 | (돌리지 않는다) |

## Windows는 WSL2 안에서

멤버는 레포, 에이전트, 러너를 모두 WSL2 안에 두고 켠다. 그러면 Linux와 같은 길로 가둔다. Claude Code도 Windows 그대로에서는 명령을 가두지 않고 WSL2를 권한다. Codex도 WSL2에서는 Linux 샌드박스(bubblewrap)를 쓴다.

WSL2에서는 Windows 드라이브가 `/mnt/c` 같은 자리로 보인다. Linux 홈만 가리면 Windows 홈(`C:\Users\<이름>`)은 샌드박스 안에서 읽힌다. 그래서 WSL2에서는 Windows 드라이브가 걸린 자리를 모두 읽지 못하게 가린다. 걸린 자리는 기기마다 바꿀 수 있으니 마운트 목록을 보고 정한다. 레포나 도구가 그 안에 있으면 Linux 홈처럼 그 자리만 다시 연다(#164).

WSL2에서 Windows 프로그램을 띄우는 길(interop)은 유닉스 소켓을 거친다. 그래서 seccomp가 막는다(Claude Code 문서).

러너를 Windows 그대로 켜는 일은 이번에 하지 않는다. CLI와 러너는 임시 폴더의 `.sock`으로 잇는데, Node는 Windows에서 이름 붙은 파이프만 받는다. 검사도 `/bin/sh`, 프로세스 그룹 끄기, 심볼릭 링크를 쓴다. WSL1에서 도는지는 보지 않았다. 도구 검사에서 걸리면 "돌리지 못함"이다.

## Linux의 유닉스 소켓

sandbox-runtime PR #797(`network.allowUnixSocketCreation`)이 판으로 나올 때까지는 지금처럼 모두 막는다.

PR #797은 seccomp 도우미를 그대로 두고 `socket(AF_UNIX)` 규칙만 뺀다. 판이 나오면 바꾸는 순서는 이렇다.

1. 판을 올리고 그 설정으로 소켓 만들기를 연다.
2. 샌드박스 밖의 소켓이 있는 자리는 읽기 막기로 가린다. `/run`, `/var/run`, `/tmp`, `/var/tmp`, `/dev/shm`, 그리고 `/proc/net/unix`에 나오는 그 밖의 경로다. bubblewrap은 `/`를 읽기 전용으로 걸 뿐이라, 가리지 않으면 소켓 파일에 그대로 붙는다.
3. 이번 돌림의 임시 폴더는 다시 연다.

이름만 있는 소켓(abstract)은 `--unshare-net`으로 네트워크 공간이 따로라 원래 닿지 않는다. 소켓 파일 하나를 가리려면 bubblewrap 0.5 이상이 필요하다. 못 미치는 기기는 지금처럼 모두 막는다. 이렇게 하면 ADR-0037이 Linux에서도 지켜진다(#167).

그 전까지 Linux와 WSL2에서는 유닉스 소켓을 쓰는 테스트를 못 돌린다. 이 레포의 `npm test`도 그렇다(#177에서 세 기계로 확인). 그런 레포는 `가릴 수 없음`이 되고, 손 점검의 소켓 두 항목은 "막힌다"를 기대한다.

그 전까지는 혼자 돌린 것이 소켓 막기로 깨지면 "가릴 수 없음"에 까닭을 붙인다. 까닭은 "이 기기(Linux)에서는 샌드박스가 유닉스 소켓을 막는다"다(#163).

seccomp 도우미가 없는 기기는 "돌리지 못함"이다. x64와 arm64가 아닌 Linux가 그렇다. 그런 기기에서 sandbox-runtime은 소켓을 막지 않고 경고(`seccomp not available - unix socket access not restricted`)만 낸다. 그런데 러너는 오류만 보고 경고는 보지 않아, 지금은 소켓이 다 열린 채로 돈다(#163).

## 손 점검은 GitHub Actions의 버튼으로

GitHub Actions에 버튼(`workflow_dispatch`)으로만 도는 워크플로를 둔다. 누르면 `test/real-sandbox.ts`를 세 곳에서 돌리고 결과 표를 실행 요약에 싣는다(#165, 첫 실행은 #166).

- **Ubuntu 24.04**: AppArmor가 비특권 사용자 네임스페이스를 막아, 풀어야 하는 경우다.
- **Ubuntu 22.04**: bubblewrap이 오래된(0.6.1) 경우다.
- **Windows 위의 WSL2**

읽기·쓰기 막기의 기대는 Linux에서 다르다. bubblewrap은 읽기를 막은 폴더(홈, WSL2의 드라이브)를 오류 대신 빈 `tmpfs`로 덮는다. 그래서 `ls`가 성공하고 쓰기도 샌드박스 안에서는 성공하지만, 카나리는 보이지 않고 쓴 파일은 밖에 생기지 않는다. 점검은 이것으로 본다(#176, 세 기계 통과).

PR마다 도는 CI에는 넣지 않는다. 테스트에서는 샌드박스를 가짜로 둔다는 결정(2026-11-14)은 그대로다. macOS는 지금처럼 주인 기기에서 본다. GitHub의 Windows 기계에서 WSL2는 켜졌다(2026-11-16 첫 실행, #166). 그러나 같은 실행에서 세 곳 모두 이 레포의 `npm test` 말고는 샌드박스 안의 명령이 `apply-seccomp`를 찾지 못해 막기는 아직 가리지 못했다(`npm test`는 돌았고 160개 중 154개가 `EPERM` 등으로 실패했다)(#174, 구현 문서 11장). #174를 고친 뒤에는 세 곳 모두에서 명령이 돈다. 남은 실패는 #176, #177이다.

## Considered Options

- **Windows 그대로, sandbox-runtime의 Windows 알파(`srt-win`)**: 0.0.81부터 들어 있고, 관리자 권한 설치가 한 번 필요하다. 그러나 ADR-0033의 막기를 못 지킨다.
  - **네트워크**: README의 Known limitations가 스스로 적어 두었다. 바로 붙는 명령은 막지만, 뚫으려고 짠 코드는 못 막는다. 익명 토큰이나 자기 토큰에서 만든 토큰으로 연 소켓, SMB, WSL 서비스가 그 길이다. 우리가 막으려는 것이 바로 서버를 거쳐 온 나쁜 코드다.
  - **이름 붙은 파이프**: 샌드박스 안에서 붙는다(#559).
  - **쓰기**: 허락한 폴더 밖에서도 샌드박스 계정의 프로필과 Everyone이 쓸 수 있는 자리에 쓴다.
  - **설정**: 자기 기기 포트는 설치할 때 기기 전체로 정한다. 명령마다 `allowRead`·`allowWrite`를 줄 수 없고, 환경 변수를 넘길 수 없다(#772).
  - **러너**: Windows용으로 고쳐야 한다.
- **Windows 그대로, MXC 백엔드**: Windows 11 24H2 이상에서만 돌고 아직 실험판이다(0.0.83).
  - `allowLocalBinding`을 거절한다. 그러면 테스트가 자기 기기 포트에 서버를 띄워 붙는 레포가 깨진다.
  - 호스트의 임시 폴더에 쓸 수 있다.
  - Git Bash의 `sh`가 돌지 않는다.
  - 러너를 고쳐야 한다.
  - 위 둘은 sandbox-runtime이 구멍을 막으면 다시 본다(#168).
- **Linux에서 모든 유닉스 소켓 열기(`allowAllUnixSockets`)**: ADR-0037에서 이미 버렸다. 켜면 seccomp 도우미를 통째로 빼므로 막던 것을 모두 잃는다. 가상 기계 밖으로 나가는 통로(AF_VSOCK) 막기, io_uring 막기, 안쪽 PID 네임스페이스가 그것이다(PR #797 본문).
- **Linux에서 경로를 보고 `connect`만 허락하기(PR #510)**: `bind`·`listen`을 거절한다. 테스트가 소켓을 여는 경우는 풀지 못한다.
- **Landlock으로 소켓 경로 막기**: 경로 유닉스 소켓을 막는 기능(`LANDLOCK_ACCESS_FS_RESOLVE_UNIX`)은 Linux 7.1에 들어왔다. sandbox-runtime은 Landlock을 쓰지 않아, 우리가 도우미를 따로 만들어야 하고 7.1 이상 기기에서만 된다.
- **테스트가 TCP만 쓰게 하기**: 프로젝트마다 고쳐야 한다.
- **컨테이너**: 버린 까닭(ADR-0033)이 그대로다. Docker를 깔아야 하고, 의존성을 다시 깔아야 한다. Linux에서는 sandbox-runtime도 이미 네임스페이스로 가둔다.
- **손 점검을 Mac 안의 Linux 가상 기계(Lima, OrbStack)에서 하기**: 깔 것이 생기고, WSL2는 볼 수 없다.
- **Linux를 못 본 채로 두기**: 막기가 도는지 모른 채로 Linux와 WSL2를 지원한다고 하게 된다.

## Consequences

- Windows 멤버는 WSL2를 깔고 레포를 WSL2 안에 두어야 한다. PowerShell에서 켠 러너는 합쳐 돌려 보지 않는다.
- PR #797이 판으로 나오기 전까지 Linux와 WSL2에서는 유닉스 소켓을 쓰는 레포가 "가릴 수 없음"이다. 이 레포의 `npm test`도 그렇다. 판이 나오면 sandbox-runtime을 0.0.81에서 올려야 하고, 설정의 꼴이 바뀔 수 있다.
- Linux와 WSL2의 자기 기기 포트는 명령마다 따로다. 검사 명령이 스스로 띄운 서버에는 붙지만, 샌드박스 밖에 떠 있는 서버에는 붙지 못한다. macOS와 다르다. ADR-0033이 자기 기기 포트를 연 것은 테스트가 스스로 띄우는 서버 때문이라, 이것으로 된다.
- 손 점검 워크플로는 GitHub의 기계에서 돈다. 점검이 만드는 가짜 토큰과 임시 레포만 쓰고, 저장소의 비밀은 쓰지 않는다.

## Sources

- [sandbox-runtime README](https://github.com/anthropics/sandbox-runtime) 0.0.81·0.0.83: Platform Support, Windows (alpha)의 Security model과 Known limitations, MXC backend, Local servers on Windows, Network Configuration의 Unix Socket 표
- `@anthropic-ai/sandbox-runtime@0.0.81` 소스: `dist/sandbox/linux-sandbox-utils.js`(`checkLinuxDependencies`의 seccomp 경고, `--unshare-net`, 0.5 미만 bubblewrap 경고), `dist/sandbox/linux-violation-monitor.js`(abstract 소켓은 네트워크 공간을 따른다)
- sandbox-runtime 이슈 [#559](https://github.com/anthropics/sandbox-runtime/issues/559), [#772](https://github.com/anthropics/sandbox-runtime/issues/772), PR [#797](https://github.com/anthropics/sandbox-runtime/pull/797), [#510](https://github.com/anthropics/sandbox-runtime/pull/510)
- [Claude Code: Sandboxing](https://code.claude.com/docs/en/sandboxing): 가두는 OS(macOS, Linux, WSL2), WSL2의 interop, Linux의 localhost
- [Codex: Windows](https://developers.openai.com/codex/windows): Windows 샌드박스 셋(mxc, elevated, unelevated)과 WSL2
- [Landlock](https://docs.kernel.org/userspace-api/landlock.html), [Linux 7.1](https://kernelnewbies.org/Linux_7.1)
- [Node.js net: Identifying paths for IPC connections](https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections)
- [Vampire/setup-wsl](https://github.com/Vampire/setup-wsl): GitHub Actions의 Windows 기계에서 WSL을 켠다
