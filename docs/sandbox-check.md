# 실제 샌드박스 손 점검

이슈 #138. 테스트는 합쳐 돌려 보기의 샌드박스를 가짜로 둔다(ADR-0033). 실제 샌드박스가 막을 것을 막고 열 것을 여는지는 `test/real-sandbox.ts` 하나로 주인 기기에서 손으로 돌린다. 이름이 `*.test.ts`가 아니라 `npm test`와 CI는 이것을 돌리지 않는다.

## 무엇을 보나

점검 명령 하나하나를 임시 레포의 기본 브랜치 `.omagari.json`에 넣고 러너의 `checkWork`로 돌린다. 막는 설정, 임시 워크트리, 의존성 잇기, 넘기는 환경 변수가 러너가 쓰는 그대로이고 샌드박스도 실제 `osSandbox`다. 임시 레포는 홈 폴더 아래(`~/.omagari-sandbox-check-…`)에 만든다. 홈 읽기 막기가 걸려야 하기 때문이다. 끝나면 지운다.

| 항목 | 통과 조건 |
| --- | --- |
| 도구 | `checkDependenciesAsync`가 통과한다(macOS는 ripgrep이 없어도 된다) |
| 바깥 네트워크 | 샌드박스 밖에서는 닿는 `https://example.com`과 `http://1.1.1.1`이 안에서는 닿지 않는다 |
| 쓰기 | 홈 폴더, 레포 폴더, 점검용 폴더 어디에도 쓰지 못하고, 임시 워크트리 안과 `HOME`에는 쓴다 |
| 홈 읽기 | 홈 아래의 파일과 목록(`~/.ssh`가 있으면 그것도)을 읽지 못한다 |
| 자기 기기의 포트 | 127.0.0.1에 서버를 열고 붙는다 |
| 환경 변수 | 이 셸에 가짜 `GITHUB_TOKEN` 등 셋을 두고 돌리면 명령 안에 없다. 이름에 TOKEN, SECRET, API_KEY가 든 변수도 없다 |
| Node | `node`가 돈다. Node가 홈 폴더 아래에 있으면(nvm) 그 경우를 본다 |
| 의존성 폴더 | 이은 의존성을 읽는다. `node_modules/.cache`와 이은 패키지 폴더 안에 쓰기, 그 밑에 새 폴더 만들기는 **관찰**한다 |
| git (#142) | 임시 워크트리 안의 `git add`, `write-tree`, `commit`, `status`가 된다. `objects`(홈 아래)를 읽고 레포의 `config`는 읽지 못한다. 샌드박스 안의 git이 쓰는 Git 폴더(돌림마다 새로 만드는 복사본, #144)의 `config`, `hooks`, `HEAD` 쓰기는 관찰한다. 열려 있는 것이 맞다 |
| 벗어남(관찰) | 러너가 샌드박스 밖에서 임시 워크트리에 부르는 `git`이 검사 명령이 써 둔 `.git/config`(`core.fsmonitor`)를 따라 밖에서 명령을 돌리는지. 러너의 현재 폴더가 레포일 때와 아닐 때 둘 다 본다. 표지 파일은 점검용 폴더 안에 만든다 |
| 유닉스 소켓, TMPDIR | `TMPDIR`이 러너가 준 임시 폴더인지, 유닉스 소켓을 열 수 있는지 관찰한다 |
| 이 레포의 `npm test` | `npm test`가 통과한다. 통과하지 못하면 실패한 테스트 이름과 수를 적는다. 이 레포에는 `.omagari.json`이 없을 수 있어 기본 브랜치에 있는 것처럼 가짜 원격 추적 ref(`refs/remotes/omagari-sandbox-check/*`)를 잠깐 만들고 끝나면 지운다. 실패하면 sandbox-runtime이 덮는 `TMPDIR`을 되돌려 한 번 더 돌려 본다(실험) |

`omagari runner check`는 러너가 받은 `check` 메시지를 `checkWork`로 부르는 것이라 같은 길이다. 점검은 러너를 띄우지 않고 `checkWork`를 바로 부른다.

## 돌리기 전에

- macOS(Linux는 bubblewrap, socat, ripgrep을 깔아야 한다. ADR-0033). 도구가 없으면 점검이 까닭과 까는 법을 적고 멈춘다.
- 레포 맨 위에서 `npm ci`를 해 둔다(Node 24 이상). `@anthropic-ai/sandbox-runtime`이 `node_modules`에 있어야 한다.
- 이 점검은 홈 폴더 아래에 점검용 폴더와 가짜 토큰이 든 환경 변수만 만든다. 어느 것도 이 셸 밖으로 나가지 않는다.
- 인터넷이 되는 기기여야 "바깥 네트워크가 막힌다"를 가릴 수 있다. 안 되면 그 항목은 가리지 못했다고 적는다.

## 돌리는 법

레포 맨 위에서:

```bash
node test/real-sandbox.ts > sandbox-check-result.md
```

- 진행은 터미널(stderr)에, 결과는 stdout에 나온다.
- 이 레포의 `npm test`를 빼고 빨리: `--quick`.
- Node를 홈 폴더 아래에 깐 기기를 보려면 그 Node로 돌린다: `~/.nvm/versions/node/v24.x/bin/node test/real-sandbox.ts`. 결과의 첫 줄에 `process.execPath`가 적히고, Node가 홈 아래이면 항목 이름이 "Node가 홈 폴더 아래에 있어도"로 바뀐다.

## 읽는 법

- `[x]`는 통과, `[ ] (실패)`는 실패, `(관찰)`은 통과·실패 없이 본 것이다. 실패가 하나라도 있으면 종료 코드가 1이다.
- 관찰 줄은 "막힌다"가 좋은 것도, "쓸 수 있다"가 좋은 것도 있다. `node_modules` 밑 새 폴더는 열려야 한다. 어긋나면 이슈로 만든다.
- "벗어남" 줄이 실패이면 샌드박스 밖에서 명령이 돈 것이다. 가장 급하다.
- 실패한 항목은 `docs/omagari-v3-implementation.md` 11장의 결과 블록과 같은 꼴로 날짜, 기기, 도구의 판과 함께 적고, 고쳐야 하는 것은 이슈로 만든다.

## 결과를 어디에 적나

결과 블록을 `docs/omagari-v3-implementation.md` 11장 "러너의 안전장치" 아래에 붙이고 ADR-0033의 "손 점검" 줄을 고친다. 못 본 것(Linux 등)은 못 봤다고 적는다.
