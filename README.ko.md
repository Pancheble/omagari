# Omagari

[English](README.md) | 한국어

Omagari는 사람과 각자의 AI 에이전트가 함께 일하는 웹 협업 공간이에요. 팀원 옆에 그 사람의 에이전트(Claude Code, Codex)가 보이고, 누가 어느 브랜치에서 무엇을 하는지 보이고, 사람과 에이전트가 함께 이야기하는 채널이 있어요. 직접 서버를 띄워 써요.

멤버 기기의 러너가 레포 폴더에서 바뀌는 것을 서버에 알리고, 그 사람의 에이전트를 대신 돌려요. 훅은 에이전트에게 근처에서 일하는 팀원의 작업을 알려서, 머지하기 전에 부딪힘이 보이게 해요. 무엇을 왜 만드는지는 [docs/omagari-v3.md](docs/omagari-v3.md)에 있어요.

## 무엇이 되나

- **상황**: 누가 어느 브랜치에서 무엇을 하고, 어디를 고칠 계획인지(선점) 보여요.
- **부딪힘 알림**: 직접 충돌, 간접 충돌, 중복 구현을 포럼에 보이고 관련된 에이전트에게도 보내요.
- **합쳐 돌려 보기**: 두 작업을 멤버 기기의 샌드박스에서 합쳐 검사 명령을 돌려요. "서로 깨뜨릴지도 몰라요"가 통과나 실패로 바뀌어요.
- **채널과 문답**: 팀원, 그 사람의 에이전트와 이야기하고, 방해하지 않고 에이전트에게 물어볼 수 있어요.
- **GitHub에 남는 결정**: 사람이 봐야 하는 포스트는 GitHub 이슈가 되고, 결정은 PR이 돼요.

## 빠른 시작

필요한 것:

- Node.js 24.12 이상
- git
- Claude Code나 Codex(이 기기에서 로그인한 것)
- 워크스페이스 레포에 push 권한이 있는 GitHub 계정
- 팀이 띄운 Omagari 서버의 주소

멤버는 `main`을 받아 써요. `dev`는 작업이 모이는 곳이라 쓰지 않아요([ADR-0019](docs/adr/0019-stage1-version-is-git-tag-members-run-main.md)).

Omagari로 Omagari를 만들며 써 보는 도그푸딩은 예외예요. 도그푸딩 서버가 `dev`를 따르므로([ADR-0042](docs/adr/0042-dogfood-server-on-fly-follows-dev.md)), 그 서버를 쓰는 기기는 `--branch dev`로 설치 클론을 받아요. 서버가 새 계약이 되면 러너가 이 클론을 스스로 받아요(아래 업데이트).

```bash
git clone --branch main https://github.com/omagari-dev/omagari.git ~/omagari
cd ~/omagari
npm ci
```

`omagari`를 PATH에 둬요. PATH에 있는 폴더에 CLI의 심볼릭 링크를 걸어요. Claude Code나 Codex를 네이티브 설치로 깔았으면 `~/.local/bin`이 이미 PATH에 있어요.

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
omagari --version
```

`command not found`가 나오면 `~/.local/bin`이 PATH에 없어요. 셸 설정(`~/.zshrc` 등)에 `export PATH="$HOME/.local/bin:$PATH"`를 더하고 터미널을 새로 열어요. 에이전트도 상태 한 줄 스킬에서 `omagari`를 부르므로 셸 설정에 둬야 해요.

서버 주소도 셸 설정에 둬요. 주지 않으면 `http://127.0.0.1:3000`에 붙어요.

```bash
export OMAGARI_SERVER=https://<팀의 서버>
```

이 기기의 에이전트에 훅과 상태 한 줄 스킬을 깔아요. 기기마다 한 번이고, 다시 돌려도 하나만 깔려요. Codex는 Codex에서 `/hooks`를 열어 두 훅을 신뢰해야 돌아요.

```bash
omagari install
```

워크스페이스 레포를 받은 폴더에서 러너를 켜 둬요. 처음이면 GitHub 기기 인증으로 로그인해요. 러너가 켜져 있어야 팀이 내 작업과 에이전트를 봐요.

```bash
cd <워크스페이스 레포 폴더>
omagari runner
```

## 검사 명령

합쳐 돌려 보기는 두 작업을 합쳐 레포의 검사 명령을 이 기기의 샌드박스 안에서 돌려요. 바깥 네트워크, 임시 폴더 밖에 쓰기, 홈 폴더 읽기가 막혀요. 검사 명령은 팀이 레포 최상위에 `.omagari.json`을 커밋해 기본 브랜치에 머지하면 정해져요. `setup`(검사 명령 앞에 한 번 돌릴 준비 명령)은 없어도 돼요.

```json
{ "check": "npm test", "setup": "npm ci" }
```

러너는 기본 브랜치(원격 추적)에 머지된 판만 읽어요. 이 기기에서 샌드박스와 검사 명령이 도는지는 지금 폴더의 내 작업에 한 번 돌려 봐요.

```bash
omagari runner check
```

샌드박스 도구는 macOS에는 따로 깔 것이 없고, Linux는 bubblewrap, socat, ripgrep이 있어야 해요. Windows는 WSL2 안에서 러너를 켜고 레포도 WSL2 안에 두며, 도구는 Linux와 같아요(PowerShell에서 켠 러너는 합쳐 돌려 보지 않아요). WSL2에서는 Windows 드라이브(`/mnt/c` 등)도 읽지 못해요. 이 기기에서 끄려면 `omagari runner --merge-check off`로 켜고, 고른 것은 그 레포에 남아요.

## 업데이트

```bash
cd ~/omagari
git pull
npm ci
```

그리고 러너를 다시 켜요(`Ctrl-C`로 끄고 `omagari runner`). 서버의 계약이 더 새로워 러너가 거절당하면 러너가 스스로 해요: 깔린 클론(러너 프로그램이 있는 체크아웃)에서 `git pull --ff-only`와 `npm ci`를 하고 같은 인자로 다시 켜요. 받은 것(앞뒤 커밋)은 `omagari runner log`에 남아요. 관측하는 레포 폴더는 건드리지 않아요. 깔린 클론에 고친 파일이 있거나 빨리 감기가 안 되면 아무것도 바꾸지 않고 할 일을 알려요. 서버가 더 낡았을 때도 받지 않아요. Node를 올렸거나 체크아웃을 옮겼으면 `omagari install`도 다시 돌려요. 훅 명령에 Node와 체크아웃의 경로가 들어 있어요.

릴리즈마다 무엇이 바뀌었는지는 [GitHub 릴리즈](https://github.com/omagari-dev/omagari/releases)에 있어요. 맨 위에 "러너도 업데이트해야 해요"가 있으면 서버와 러너 사이의 계약이 바뀐 릴리즈예요.

## 버전 확인

```bash
omagari --version
```

`omagari v0.1.0 (contract 9)`처럼 이 체크아웃의 git 태그와 계약 버전을 보여요. 릴리즈 뒤의 커밋이면 `v0.1.0-3-gabc1234`, 태그를 받지 못한 클론이면 `버전 모름(커밋 abc1234)`이에요.

서버와 이 기기의 계약 버전이 다르면 서버가 러너를 받지 않고, 러너가 할 일을 알려요.

- 서버가 더 새로우면: "서버는 v0.3.0, 이 기기는 v0.2.1이에요." 러너가 스스로 받고 다시 켜요. 받지 못하면 알려 주는 대로 위의 업데이트를 하고 러너를 다시 켜요.
- 서버가 더 오래됐으면: 서버를 올려야 해요. 서버를 띄운 사람에게 알려요.

## 서버

서버도 `main`으로 띄우고(도그푸딩 서버는 `dev`를 따라 Fly.io에 저절로 올라가요. 아래 "Fly.io에 올리기"), 업데이트도 멤버와 같아요(`git pull`, `npm ci`, 다시 띄우기). 켜질 때 `Omagari 서버 v0.1.0 (contract 9): ...`처럼 버전을 로그에 남겨요.

```bash
cp .env.example .env     # OMAGARI_REPO, GITHUB_CLIENT_ID를 채운다(.env는 커밋하지 않는다)
HOST=0.0.0.0 npm run server
```

`OMAGARI_REPO`는 받을 GitHub 계정 목록이에요(ADR-0043). 쉼표로 나눠 여럿 적고, 계정(`owner`)이나 레포(`owner/name`)로 적어요.

- 받을 계정마다 워크스페이스가 하나예요(`api.workspaces`). 다른 계정의 레포는 다른 워크스페이스에 들어가고, 멤버, 접속 상태, 채널, 포럼, 포스트, 결정, 지표가 워크스페이스끼리 섞이지 않아요. 한 사람이 둘에 다 들어가면 `Omagari-Workspace` 머리말(실시간 연결은 hello의 `workspace`)로 골라 오가요. 고르지 않으면 들어간 첫 워크스페이스예요. 레포가 하나이던 판과 워크스페이스가 하나이던 판의 DB는 켤 때 첫 워크스페이스의 것으로 옮겨져요. 화면은 워크스페이스가 하나일 때만 지금처럼 돌아요(#238).
- 워크스페이스에는 이 계정들의 레포만 들어가요. 레포는 그 레포의 GitHub Admin이 `POST /api/repos/add`(`{ "repo": "owner/name" }`)로 넣고 `POST /api/repos/remove`로 빼요. 뺀 레포의 것은 지우지 않아 다시 넣으면 돌아와요. 화면은 아직 없어요(#238).
- `owner/name`으로 적은 레포는 그 계정을 받고, 서버가 켜질 때마다 넣어요. 아무도 로그인할 수 없는 새 서버의 첫 레포는 이렇게 넣어요. API로 뺀 레포를 다시 넣지 않으려면 여기서도 지워요.
- 첫 `owner/name`은 레포가 하나이던 판의 레포예요. 그 판의 DB로 켜면 있던 작업, 알림, 포스트, 라벨, 결정, 검사 명령이 이 레포의 것으로 옮겨지고, 들어와 있던 세션도 다시 로그인하지 않고 이 레포의 멤버예요(10분 안에 GitHub 권한으로 다시 확인해요).
- 멤버는 워크스페이스 레포 가운데 하나라도 push 권한이 있는 사람이에요. 레포마다 push 권한이 있는 것만 보이고, 로그인할 때와 10분마다 다시 읽어요. 러너는 폴더의 GitHub 원격으로 그 레포에 이어져요. 레포마다 러너를 하나씩 켜요.
- 레포마다인 API(작업, 멤버, 포스트, 라벨, 결정, 피드)는 `Omagari-Repo: owner/name` 머리말로 레포를 골라요. 없으면 부른 사람에게 보이는 첫 레포예요. CLI는 폴더의 원격을 실어요.

`OMAGARI_DB`(기본 `omagari.db`)와 `PORT`(기본 3000)로 DB 파일과 포트를 바꿔요. 멤버가 웹을 여는 주소가 서버가 듣는 주소와 다르면 `OMAGARI_URL`에 줘요. 결정 PR의 출처(포스트 링크)가 이 주소로 적혀요.

채팅의 GIF(ADR-0044)는 `GIPHY_API_KEY`에 [GIPHY 개발자 키](https://developers.giphy.com/dashboard/)를 주면 켜져요. 없으면 입력 칸에 GIF 버튼이 없어요. 찾기는 서버가 키를 붙여 대신 묻고, 키는 웹에 내려가지 않아요. 베타 키의 시간당 100번을 넘지 않게 서버가 막아요. 프로덕션 키를 받았으면 `GIPHY_PER_HOUR`로 한도를 올려요. Fly에서는 `fly secrets set GIPHY_API_KEY=<키> -a "$FLY_APP"`로 넣어요.

서버가 `npm run build -w @omagari/web`로 빌드한 웹 화면(`packages/web/dist`)이 있으면 같은 주소에서 내요. 없는 경로는 화면의 첫 파일로 보내요. 개발할 때는 지금처럼 `npm run web`(Vite)를 써요. 건강 확인은 `GET /api/health`예요.

### Fly.io에 올리기

Fly.io(도쿄 `nrt`)의 작은 기계 하나에 서버를 올려요. 레포의 도그푸딩 서버가 이렇게 돌아요(ADR-0042). 설정은 `fly.toml`, 이미지는 `Dockerfile`에 있어요. 앱 이름과 받을 계정 목록은 레포에 없고 `.env`에 적어요(`cp .env.example .env`로 시작). 처음 한 번 사람이 해요.

```bash
set -a; . ./.env; set +a                    # FLY_APP, OMAGARI_REPO를 셸로 읽는다
fly apps create "$FLY_APP"
fly volumes create omagari_data --region nrt --size 1 -a "$FLY_APP"
fly secrets set GITHUB_CLIENT_ID=<기기 인증을 켠 GitHub 앱> -a "$FLY_APP"
fly deploy -a "$FLY_APP" -e OMAGARI_REPO="$OMAGARI_REPO"
```

- 비밀값은 `fly secrets`로만 넣어요. 레포에는 두지 않아요. `OMAGARI_REPO`(받을 계정 목록)는 비밀이 아니라 배포할 때 `-e`로 줘요. 앱 이름과 함께 `fly.toml`에 두지 않은 까닭은 누가 올려도 같은 값만 `fly.toml`에 두려는 것이에요(`app`은 toml이 환경변수를 못 읽어 `-a`로 줘요). `OMAGARI_URL`은 Fly에서는 `https://<앱 이름>.fly.dev`로 서버가 정해요.
- DB는 볼륨(`/data/omagari.db`)에 있어 새 판으로 바꿔도 남아요. 백업은 볼륨의 날마다 스냅샷이에요(`fly volumes snapshots list`로 봐요. 기본 5일 보관).
- 건강 확인(`/api/health`)을 통과한 판만 갈아 끼워요. 못 통과하면 옛 판이 남아요.
- 자동 배포: `.github/workflows/deploy.yml`이 `dev`의 CI가 통과하면 `fly deploy`를 돌려요. `dev`에서만 쓸 수 있는 GitHub Environment `dogfood`(Settings → Environments, 배포 브랜치를 `dev`로 제한)에 비밀값 `FLY_API_TOKEN`(`fly tokens create deploy`)과 변수 `FLY_APP`, `OMAGARI_REPO`를 넣어야 켜지고, 하나라도 없으면 배포 단계를 건너뛰어요. CI가 돈 커밋이 지금 `dev`의 끝이 아니면(옛 실행을 다시 돌린 경우) 올리지 않아요.
- 이 기기에서 이미지를 확인하려면: `docker build -t omagari .` 뒤 `docker run -p 8080:8080 -v omagari-data:/data -e OMAGARI_REPO=<owner/name> -e GITHUB_CLIENT_ID=<앱> omagari`.

## 개발

올리기 전에 CI와 같은 검사 셋을 돌려요.

```bash
npm run format      # 포맷과 린트를 고쳐요
npm run typecheck
npm test
```

팀 없이 화면을 둘러보려면 데모 서버를 띄워요. 가짜 GitHub로 멤버, 포럼, 부딪힘이 들어 있는 워크스페이스를 만들어요. `DEMO_AGENT=fake`이면 내 에이전트가 정해 둔 답을 내서 구독 사용량을 쓰지 않아요.

```bash
DEMO_AGENT=fake node test/demo.ts
```

## 문서

- [docs/omagari-v3.md](docs/omagari-v3.md): Omagari가 뭐고 왜 만드는지
- [docs/omagari-v3-implementation.md](docs/omagari-v3-implementation.md): 어떻게 만드는지
- [GLOSSARY.md](GLOSSARY.md): 쓰는 말
- [docs/adr/](docs/adr/): 설계 결정
- [DESIGN.md](DESIGN.md): 화면의 모양과 글

문서를 영어로 옮기는 중이라 일부는 아직 한국어예요([ADR-0045](docs/adr/0045-english-by-default-korean-as-a-choice.md)).

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md)를 먼저 읽어 주세요. 보안 문제는 [SECURITY.md](SECURITY.md)를 보세요. 함께하는 모두가 [행동 강령](CODE_OF_CONDUCT.md)을 따라요.

## 라이선스

[AGPL-3.0](LICENSE)
