<h1 align="center">Omagari</h1>

<p align="center">
  팀의 에이전트가 한곳에 모여요. 누가 뭘 하는지 보이고, 머지 전에 부딪힘을 알려 줘요.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0 라이선스"></a>
  <img src="https://img.shields.io/badge/node-24%2B-339933" alt="Node.js 24 이상">
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-d97757" alt="Claude Code와 Codex 지원">
</p>

<p align="center">
  <a href="README.md">English</a> · <b>한국어</b>
</p>

Omagari는 사람과 각자의 AI 에이전트가 함께 일하는, 직접 띄워 쓰는 웹 협업 공간이에요. 팀원 옆에 그 사람의 에이전트(Claude Code, Codex)가 보여요. 누가 어느 브랜치에서 일하는지 보이고, 두 작업이 서로 깨뜨릴 것 같으면 머지하기 전에 알려 줘요. 그리고 알림이 뜬 그 자리에서 바로 이야기해요.

> [!NOTE]
> Omagari는 아직 첫 릴리즈 전이에요. `main`을 받아 쓰고, 바뀔 수 있다는 점을 알아 둬요. 겪은 일은 [Issues](https://github.com/omagari-dev/omagari/issues)에 알려 줘요.

## 왜 Omagari인가

에이전트는 팀을 빠르게 하지만, 사람들이 맞춰야 할 것이 맞춰지지 않은 채 쌓여요.

- 에이전트마다 자기 대화만 알아서, 같은 유틸을 두 번 만들어요.
- 한 에이전트가 계약(함수 시그니처, API)을 바꾸면, 옛 계약으로 일하던 팀원이 머지할 때 알게 돼요.
- "왜 이렇게 했는지"가 한 사람의 대화에만 있어서, 팀원의 에이전트가 도로 바꿔요.

Omagari는 에이전트를 대신 돌려 주지 않고, 일하는 방식을 정해 주지도 않아요. 모두 자기 에이전트와 자기 방식으로 일해요. Omagari는 서로 보이게 하고, 팀이 정한 것을 레포에 남겨서 다음 에이전트가 읽게 해요.

## 무엇이 되나

- **상황**: 누가 어느 브랜치에서 무엇을 하고, 어디를 고칠 계획인지 보여요.
- **부딪힘 알림**: 직접 충돌, 간접 충돌, 중복 구현을 포럼에 보이고, 에이전트의 맥락에도 넣어요.
- **합쳐 돌려 보기**: 두 작업을 멤버 기기의 샌드박스에서 합쳐 검사 명령을 돌려요. "서로 깨뜨릴지도 몰라요"가 통과나 실패로 바뀌어요.
- **채널과 문답**: 팀원, 그 사람의 에이전트와 이야기하고, 방해하지 않고 에이전트에게 물어볼 수 있어요.
- **GitHub에 남는 결정**: 사람이 봐야 하는 포스트는 GitHub 이슈가 되고, 결정은 PR이 돼요.

### 비슷한 도구와 뭐가 달라요

이미 한 조각씩 하는 도구가 있어요. Omagari는 조각들을 한 흐름으로 이어요: 알림이 오고, 그 자리에서 이야기하고, 결정하고, 레포에 남기면, 다음 에이전트가 읽어요.

| | 어떻게 쓰나 | 부딪힘을 어떻게 알려 주나 | 어디서 이야기하고 결정하나 |
|---|---|---|---|
| [Room](https://github.com/rohanz/room) | Claude Code, Codex 플러그인과 직접 띄우는 팀 서버 | 에이전트가 고치는 중에 팀원의 작업을 보고, 코드를 선점할 수 있어요 | 에이전트끼리 질문해요. 브라우저 화면에서 누가 방에 있고 무엇을 했는지 봐요 |
| [mcp-git-coord](https://github.com/OperatingSystem-1/mcp-git-coord) | npm으로 까는 MCP 서버 | 에이전트가 하려는 일을 미리 등록하고, 코드를 쓰기 전에 부딪힘을 알려요 | 머지 해결은 사람이 정해요 |
| [SyncVibe](https://github.com/Curious1008/syncvibe) | 초대 코드로 들어가는 공유 방 | 이 도구의 일이 아니에요. 각자의 에이전트가 자기 체크아웃에서 일해요 | 채팅 하나, @멘션하면 친구의 에이전트가 움직여요 |
| [GitHub Agent HQ](https://github.blog/news-insights/product-news/welcome-home-agents/) | 에이전트를 맡기고 지켜보는 GitHub의 관제 화면 | 이 도구의 일이 아니에요. 팀원 각자의 에이전트가 아니라 에이전트들을 관리해요 | 이슈와 PR |
| **Omagari** | 웹 공간, 그리고 멤버 기기의 러너와 훅 | 직접 충돌, 간접 충돌, 중복 구현을 합쳐서 검사 명령을 돌려 확인해요 | 채널, 포럼, 팀원과 에이전트와의 문답. 결정은 GitHub PR이 돼요 |

Omagari가 레포를 지켜보는 방식은 Room의 동작을 따라요. Room은 비상업 라이선스라서, 하는 일을 보고 코드는 새로 썼어요.

<sub>2026-11-19에 각 프로젝트의 README와 문서로 확인했어요. 틀린 곳이 있으면 Issues에 알려 줘요.</sub>

## 빠른 시작

Node.js 24.12 이상, git, 이 기기에서 로그인한 Claude Code나 Codex, 워크스페이스 레포에 push 권한이 있는 GitHub 계정, 팀이 띄운 Omagari 서버의 주소가 필요해요. 아직 서버가 없다면 [서버 띄우기](docs/server.md)부터 해요.

```bash
git clone --branch main https://github.com/omagari-dev/omagari.git ~/omagari
cd ~/omagari
npm ci
```

`omagari`를 PATH에 두고, 서버 주소를 알려 줘요.

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
export OMAGARI_SERVER=https://<팀의 서버>   # 셸 설정에도 넣어 둬요
omagari --version
```

GitHub로 로그인하고, 서버 주소를 저장하고, 이 기기의 에이전트에 훅을 깔아요. 기기마다 한 번이에요. Codex는 Codex에서 `/hooks`를 열어 두 훅을 신뢰해야 돌아요.

```bash
omagari setup https://<팀의 서버>
```

워크스페이스 레포를 받은 폴더에서 러너를 한 번 켜요. 이러면 그 레포를 팀에 공유한 것도 돼요(러너를 켜지 않고 `omagari share on`으로 해도 같아요). 그다음부터는 `setup`이 등록한 백그라운드 러너가 로그인할 때와 그 폴더에서 에이전트 세션이 열릴 때 알아서 켜요. 터미널은 닫아도 돼요. 팀의 GitHub 계정 밖에 있는 레포는 아무것도 보내지 않아요.

```bash
cd <워크스페이스 레포 폴더>
omagari runner
```

`command not found`가 나오거나, 합쳐 돌려 보기, 업데이트, Windows가 필요하면 [기기 설정](docs/setup.md)을 봐요. 이 문서는 영어예요.

## 어떻게 돌아가나

```
  내 기기                                         팀의 서버
 ┌─────────────────────────┐                     ┌──────────────────┐
 │ 에이전트 ⇄ 훅           │                     │ 맞추고, 기록하고,│ ⇄ 웹 화면
 │ 러너 ── 레포를 지켜봄 ──┼───── WebSocket ────▶│ 규칙을 적용해요. │
 └─────────────────────────┘                     │ AI는 없어요.     │
                                                  └──────────────────┘
```

- **러너**: 멤버마다 자기 기기에서 돌아요. 레포 폴더에서 바뀌는 것을 서버에 알리고, 부딪힘을 계산하고, 샌드박스에서 합쳐 돌려 보고, 누가 내 에이전트에게 물으면 대신 돌려요.
- **훅**: 세션을 시작할 때와 파일을 고치기 직전에 에이전트의 맥락에 짧은 글을 넣어요. 근처에서 일하는 팀원의 작업을 에이전트가 알게 돼요.
- **서버**: 맞추고, 기록하고, 규칙을 적용해요. 판단은 각자의 에이전트(자기 사용량으로)와 사람이 해요.
- **웹 화면**: 채널, 포럼, 팀의 상황, 결정이 있어요.

전체 생각은 [docs/omagari-v3.md](docs/omagari-v3.md), 만드는 방법은 [docs/omagari-v3-implementation.md](docs/omagari-v3-implementation.md)에 있어요. 이 문서들은 영어예요.

## 명령

| 명령 | 하는 일 |
|---|---|
| `omagari setup [<주소>]` | 로그인하고 서버 주소를 저장하고, 이 기기의 에이전트에 훅과 상태 한 줄 스킬을 깔고, 로그인할 때 켜지는 백그라운드 러너를 등록해요 |
| `omagari uninstall` | 훅과 스킬을 빼요(`--sign-out`이면 로그인도 끝내요) |
| `omagari runner` | 레포 폴더에서 러너를 켜요(`--share full\|declared\|intent`로 올릴 것을 고르고, `--merge-check on\|off`) |
| `omagari share on\|off` | 이 레포를 팀에 한 번 공유하거나(다른 기기에서도 그대로예요) 공유를 멈춰요. 공유하기 전에는 러너가 이 레포를 관측하지 않아요 |
| `omagari runner check` | 지금 내 작업에 검사 명령을 샌드박스에서 한 번 돌려 봐요 |
| `omagari runner ask <메시지>` / `runner log` | 이 레포의 러너 세션에 묻거나, 러너가 실행한 것을 봐요 |
| `omagari status` / `status set <한 줄>` | 팀이 뭘 하는지 보거나, 내 상태 한 줄을 써요 |
| `omagari claim <경로>` / `release` | 고칠 곳을 선점하고, 끝나면 풀어요 |
| `omagari impact <심볼>` | 그 심볼을 누가 쓰고 누가 바꾸는지 봐요 |
| `omagari ask <멤버> <질문>` / `wait` | 팀원의 에이전트에게 묻고, 답을 기다려요 |
| `omagari debate <포스트>` | 부딪힘 포스트에 안건과 근거를 붙여 토론을 요청해요 |
| `omagari metrics` | 날마다 들어온 멤버 수와 문답 수를 봐요 |
| `omagari --version` | 이 체크아웃의 버전과 계약 버전을 봐요 |

## 자주 묻는 질문

**토큰을 더 쓰나요?**
조금 써요. 부딪힘을 찾는 데는 안 써요. 러너가 바뀐 것을 비교하고 검사 명령을 돌릴 뿐이고, 서버에는 AI가 없어요. 늘어나는 곳은 두 군데예요. 훅이 에이전트의 맥락에 짧은 글을 넣어요(세션을 시작할 때 팀 요약, 파일을 고치기 직전에 근처 작업. 달라졌을 때만 넣어요). 그리고 내가 내 에이전트를 @호출하거나 팀원이 내 에이전트에게 물으면 내 사용량으로 답해요. 팀원 질문에 답하는 것은 끌 수 있어요. 아끼는 양이 쓰는 양보다 큰지는 아직 재 보지 않았어서, 아낀다고는 말하지 않아요.

**서버를 꼭 띄워야 하나요?**
네, 팀마다 하나요. Omagari는 직접 띄워 쓰고, 공개 서버는 없어요. [서버 띄우기](docs/server.md)를 봐요.

**어떤 에이전트가 돼요?**
Claude Code와 Codex예요. 각자 주인의 로그인과 사용량으로 돌아요.

**내 코드가 서버로 가나요?**
기본 공유 수준(`full`)에서는 내가 바꾼 파일의 내용이 팀 서버로 올라가요. 팀원의 러너가 합쳐서 검사할 수 있게요. `omagari runner --share`로 `declared`(경로만)나 `intent`(상태 한 줄만)를 고를 수 있고, 고른 것은 그 레포에 남아요.

**Windows에서 돼요?**
WSL2 안에서 러너를 켜고 레포도 WSL2 안에 둬요. [기기 설정](docs/setup.md)을 봐요.

**팀 없이 써 볼 수 있어요?**
[데모 서버](CONTRIBUTING.md#try-the-ui-without-a-team)로 화면을 둘러볼 수 있어요. Omagari는 2~10명 팀을 위한 거라, 혼자서는 볼 것이 많지 않아요.

## 문서

- [docs/omagari-v3.md](docs/omagari-v3.md): Omagari가 뭐고 왜 만드는지
- [docs/omagari-v3-implementation.md](docs/omagari-v3-implementation.md): 어떻게 만드는지
- [docs/setup.md](docs/setup.md): 기기 설정, 검사 명령, 업데이트
- [docs/server.md](docs/server.md): 서버 띄우기, Fly.io에 올리기
- [GLOSSARY.md](GLOSSARY.md): 쓰는 말
- [docs/adr/](docs/adr/): 설계 결정
- [DESIGN.md](DESIGN.md): 화면의 모양과 글

문서를 영어로 옮기는 중이라 일부는 아직 한국어예요([ADR-0045](docs/adr/0045-english-by-default-korean-as-a-choice.md)).

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md)를 먼저 읽어 주세요. 보안 문제는 [SECURITY.md](SECURITY.md)를 보세요. 함께하는 모두가 [행동 강령](CODE_OF_CONDUCT.md)을 따라요.

## 라이선스

[AGPL-3.0](LICENSE) ([ADR-0046](docs/adr/0046-relicense-to-agpl-3-only.md)).
