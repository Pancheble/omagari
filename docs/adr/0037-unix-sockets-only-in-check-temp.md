---
status: accepted
---

# 검사 명령은 임시 워크트리와 임시 폴더 안에서만 유닉스 소켓을 연다

ADR-0033의 샌드박스는 유닉스 소켓을 모두 막았다(sandbox-runtime의 기본값). 그래서 임시 폴더에 소켓을 여는 테스트는 샌드박스 안에서 돌지 못한다. 이 레포의 `npm test`도 148개 중 147개가 `listen EPERM`으로 떨어졌다(#138 손 점검, #145). 유닉스 소켓은 테스트가 서버를 띄워 붙을 때 흔히 쓴다. 막는 범위를 이렇게 바꾼다(2026-11-15 주인 결정, #145의 (가)).

- **연다**: 검사 명령은 임시 워크트리와 러너가 준 임시 폴더(`HOME`, `TMPDIR`) 아래에서 유닉스 소켓을 열고(`listen`) 붙는다(`connect`). 둘 다 돌림마다 새로 만들거나 되돌리는 자리라, 그 안의 소켓은 이번 검사 명령이 연 것뿐이다.
- **그대로 막는다**: 그 밖의 소켓. 샌드박스 밖에서 떠 있는 것(Docker의 `/var/run/docker.sock`, ssh-agent, 다른 세션이 함께 쓰는 `/tmp/claude`)에 붙지 못한다. 모든 소켓을 여는 `allowAllUnixSockets`는 쓰지 않는다.
- **짧은 경로**: macOS의 유닉스 소켓 경로는 104바이트 상한이 있는데, 사용자 임시 폴더(`/var/folders/…/T/`)에 둔 임시 폴더 안의 소켓 경로는 넘어 `EINVAL`이었다. 그래서 러너의 임시 폴더(`os.tmpdir()`)가 40바이트를 넘으면 이번 돌림의 임시 폴더를 `/tmp` 아래에 만든다. 그러면 임시 폴더는 40바이트쯤이라 소켓 이름에 60바이트 넘게 남는다. 40바이트 안이면(Linux의 `/tmp`, 샌드박스 안에서 도는 러너가 받은 임시 폴더) 그대로 쓴다. 샌드박스 안에서는 `/tmp`에 쓰지 못해서다. `mkdtemp`가 주인만 쓰는 폴더(0700)로 만든다.

sandbox-runtime 0.0.81에서 macOS는 `network.allowUnixSockets`의 경로마다 `network-bind`와 `network-outbound`를 `subpath`로 연다(`macos-sandbox-utils.js`의 `generateSandboxProfile`). 그래서 `listen`까지 되고, 경로 아래 전체가 열린다. 이 값은 명령마다 넘긴 설정이 아니라 `initialize`·`updateConfig`로 둔 설정에서만 읽으므로(`sandbox-manager.js`의 `getAllowUnixSockets`), 러너는 감쌀 때마다 이번 돌림의 설정으로 `updateConfig`를 부른다.

## Considered Options

- **이 레포의 검사 명령만 소켓을 쓰지 않게 고친다**(#145의 (나)): 테스트 틀이 TCP를 쓰게 바꾼다. 이 레포만 고쳐지고, 유닉스 소켓을 쓰는 다른 프로젝트의 판정은 계속 "돌리지 못함"이나 거짓 "깨짐"이다.
- **모든 유닉스 소켓을 연다**(`allowAllUnixSockets`): 가장 쉽지만 샌드박스 밖의 Docker 소켓에 붙으면 기기 전체를 다루는 것과 같다(sandbox-runtime README의 Security Limitations).
- **`/tmp/claude`도 연다**: sandbox-runtime이 `TMPDIR`을 그리로 덮어(#146) 지금은 테스트의 소켓이 거기 생긴다. 그러나 이 기기의 모든 샌드박스 명령이 함께 쓰는 자리라 다른 세션의 소켓에 붙을 수 있다. `TMPDIR`을 되돌리는 것은 #146에서 한다.

## Consequences

- Linux에서는 열리지 않는다. sandbox-runtime은 Linux에서 seccomp로 `socket(AF_UNIX, …)`을 통째로 막고 `allowUnixSockets`를 무시한다(README의 Unix Socket 표: "seccomp can't filter by path"). 경로로 좁혀 여는 길이 없어, Linux에서는 유닉스 소켓을 쓰는 검사 명령이 여전히 돌지 못한다. 그 레포는 혼자 돌린 것도 깨지므로 "깨짐"으로 굳지 않는다(ADR-0035). 넓히지 않는다.
- `TMPDIR`이 `/tmp/claude`로 덮이는 동안(#146)은 `os.tmpdir()`에 소켓을 여는 테스트가 여전히 막힌다. 이 레포의 `npm test`는 #146까지 고쳐야 샌드박스 안에서 돈다. `HOME`이나 임시 워크트리 안에 여는 것은 지금 된다.
- 검사 명령이 임시 워크트리 안에 링크를 걸어 밖의 소켓을 가리켜도 붙지 못했다(2026-11-15 손 점검, `test/real-sandbox.ts`).
- macOS에서는 이번 돌림의 임시 폴더가 사용자 임시 폴더가 아닌 `/tmp`에 생긴다. 끝나면 지운다.

## Sources

- [sandbox-runtime README](https://github.com/anthropics/sandbox-runtime) 0.0.81: Network Configuration의 Unix Socket 표, Security Limitations의 "Privilege Escalation via Unix Sockets"
- `@anthropic-ai/sandbox-runtime@0.0.81` 소스: `dist/sandbox/macos-sandbox-utils.js`(`generateSandboxProfile`), `dist/sandbox/sandbox-manager.js`(`getAllowUnixSockets`, `updateConfig`), `dist/sandbox/linux-sandbox-utils.js`(seccomp)
- [unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html)의 `sun_path`, macOS `<sys/un.h>`의 `sun_path[104]`
- #138 손 점검(PR #147)과 #145의 2026-11-15 댓글
