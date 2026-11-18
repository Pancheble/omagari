# Omagari

Omagari는 사람과 각자의 AI 에이전트가 함께 있는 웹 협업 공간이다. 팀원 옆에 그 사람의 에이전트(Claude Code, Codex)가 보이고, 누가 어느 브랜치에서 무엇을 하는지 보이고, 채널에서 사람과 에이전트가 함께 이야기한다. 멤버의 기기에서는 러너가 레포 폴더의 작업을 서버에 알리고 그 사람의 에이전트를 대신 돌리며, 훅이 에이전트에게 근처에서 일하는 팀원의 작업을 알린다. 무엇을 왜 만드는지는 [docs/omagari-v3.md](docs/omagari-v3.md)에 있다.

## 필요한 것

- Node.js 24.12 이상
- git
- Claude Code나 Codex(이 기기에서 로그인한 것)
- 워크스페이스 레포에 push 권한이 있는 GitHub 계정
- 팀이 띄운 Omagari 서버의 주소

## 설치

멤버는 `main`을 받아 쓴다. `dev`는 작업이 모이는 곳이라 쓰지 않는다([ADR-0019](docs/adr/0019-stage1-version-is-git-tag-members-run-main.md)).

Omagari로 Omagari를 만들며 써 보는 도그푸딩은 예외다. 도그푸딩 서버가 `dev`를 따르므로([ADR-0042](docs/adr/0042-dogfood-server-on-fly-follows-dev.md)), 그 서버를 쓰는 기기는 `--branch dev`로 설치 클론을 받는다. 서버가 새 계약이 되면 러너가 이 클론을 스스로 받는다(아래 업데이트).

```bash
git clone --branch main https://github.com/Pancheble/omagari.git ~/omagari
cd ~/omagari
npm ci
```

`omagari`를 PATH에 둔다. PATH에 있는 폴더에 CLI의 심볼릭 링크를 건다. Claude Code나 Codex를 네이티브 설치로 깔았으면 `~/.local/bin`이 이미 PATH에 있다.

```bash
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/cli/src/main.ts" ~/.local/bin/omagari
omagari --version
```

`command not found`가 나오면 `~/.local/bin`이 PATH에 없다. 셸 설정(`~/.zshrc` 등)에 `export PATH="$HOME/.local/bin:$PATH"`를 더하고 터미널을 새로 연다. 에이전트도 상태 한 줄 스킬에서 `omagari`를 부르므로 셸 설정에 두어야 한다.

서버 주소도 셸 설정에 둔다. 주지 않으면 `http://127.0.0.1:3000`에 붙는다.

```bash
export OMAGARI_SERVER=https://<팀의 서버>
```

이 기기의 에이전트에 훅과 상태 한 줄 스킬을 깐다. 기기마다 한 번이고, 다시 돌려도 하나만 깔린다. Codex는 Codex에서 `/hooks`를 열어 두 훅을 신뢰해야 돈다.

```bash
omagari install
```

워크스페이스 레포를 받은 폴더에서 러너를 켜 둔다. 처음이면 GitHub 기기 인증으로 로그인한다. 러너가 켜져 있어야 팀이 내 작업과 에이전트를 본다.

```bash
cd <워크스페이스 레포 폴더>
omagari runner
```

## 검사 명령

합쳐 돌려 보기는 두 작업을 합쳐 레포의 검사 명령을 이 기기의 샌드박스 안에서 돌린다. 바깥 네트워크, 임시 폴더 밖에 쓰기, 홈 폴더 읽기가 막힌다. 검사 명령은 팀이 레포 최상위에 `.omagari.json`을 커밋해 기본 브랜치에 머지하면 정해진다. `setup`(검사 명령 앞에 한 번 돌릴 준비 명령)은 없어도 된다.

```json
{ "check": "npm test", "setup": "npm ci" }
```

러너는 기본 브랜치(원격 추적)에 머지된 판만 읽는다. 이 기기에서 샌드박스와 검사 명령이 도는지는 지금 폴더의 내 작업에 한 번 돌려 본다.

```bash
omagari runner check
```

샌드박스 도구는 macOS에는 따로 깔 것이 없고, Linux는 bubblewrap, socat, ripgrep이 있어야 한다. Windows는 WSL2 안에서 러너를 켜고 레포도 WSL2 안에 두며, 도구는 Linux와 같다(PowerShell에서 켠 러너는 합쳐 돌려 보지 않는다). WSL2에서는 Windows 드라이브(`/mnt/c` 등)도 읽지 못한다. 이 기기에서 끄려면 `omagari runner --merge-check off`로 켜고, 고른 것은 그 레포에 남는다.

## 업데이트

```bash
cd ~/omagari
git pull
npm ci
```

그리고 러너를 다시 켠다(`Ctrl-C`로 끄고 `omagari runner`). 서버의 계약이 더 새로워 러너가 거절당하면 러너가 스스로 한다: 깔린 클론(러너 프로그램이 있는 체크아웃)에서 `git pull --ff-only`와 `npm ci`를 하고 같은 인자로 다시 켠다. 받은 것(앞뒤 커밋)은 `omagari runner log`에 남는다. 관측하는 레포 폴더는 건드리지 않는다. 깔린 클론에 고친 파일이 있거나 빨리 감기가 안 되면 아무것도 바꾸지 않고 할 일을 알린다. 서버가 더 낡았을 때도 받지 않는다. Node를 올렸거나 체크아웃을 옮겼으면 `omagari install`도 다시 돌린다. 훅 명령에 Node와 체크아웃의 경로가 들어 있다.

릴리즈마다 무엇이 바뀌었는지는 [GitHub 릴리즈](https://github.com/Pancheble/omagari/releases)에 있다. 맨 위에 "러너도 업데이트해야 해요"가 있으면 서버와 러너 사이의 계약이 바뀐 릴리즈다.

## 버전 확인

```bash
omagari --version
```

`omagari v0.1.0 (contract 9)`처럼 이 체크아웃의 git 태그와 계약 버전을 보인다. 릴리즈 뒤의 커밋이면 `v0.1.0-3-gabc1234`, 태그를 받지 못한 클론이면 `버전 모름(커밋 abc1234)`이다.

서버와 이 기기의 계약 버전이 다르면 서버가 러너를 받지 않고, 러너가 할 일을 알린다.

- 서버가 더 새로우면: "서버는 v0.3.0, 이 기기는 v0.2.1이에요." 러너가 스스로 받고 다시 켠다. 받지 못하면 알려 주는 대로 위의 업데이트를 하고 러너를 다시 켠다.
- 서버가 더 오래됐으면: 서버를 올려야 한다. 서버를 띄운 사람에게 알린다.

## 서버

서버도 `main`으로 띄우고(도그푸딩 서버는 `dev`를 따라 Fly.io에 저절로 올라간다. 아래 "Fly.io에 올리기"), 업데이트도 멤버와 같다(`git pull`, `npm ci`, 다시 띄우기). 켜질 때 `Omagari 서버 v0.1.0 (contract 9): ...`처럼 버전을 로그에 남긴다.

```bash
OMAGARI_REPO=<owner/name> GITHUB_CLIENT_ID=<기기 인증을 켠 GitHub 앱> HOST=0.0.0.0 npm run server
```

`OMAGARI_REPO`는 받을 GitHub 계정 목록이다(ADR-0043). 쉼표로 나눠 여럿 적고, 계정(`owner`)이나 레포(`owner/name`)로 적는다.

- 워크스페이스에는 이 계정들의 레포만 들어간다. 레포는 그 레포의 GitHub Admin이 `POST /api/repos/add`(`{ "repo": "owner/name" }`)로 넣고 `POST /api/repos/remove`로 뺀다. 뺀 레포의 것은 지우지 않아 다시 넣으면 돌아온다. 화면은 아직 없다(#238).
- `owner/name`으로 적은 레포는 그 계정을 받고, 서버가 켜질 때마다 넣는다. 아무도 로그인할 수 없는 새 서버의 첫 레포는 이렇게 넣는다. API로 뺀 레포를 다시 넣지 않으려면 여기서도 지운다.
- 첫 `owner/name`은 레포가 하나이던 판의 레포다. 그 판의 DB로 켜면 있던 작업, 알림, 포스트, 라벨, 결정, 검사 명령이 이 레포의 것으로 옮겨지고, 들어와 있던 세션도 다시 로그인하지 않고 이 레포의 멤버다(10분 안에 GitHub 권한으로 다시 확인한다).
- 멤버는 워크스페이스 레포 가운데 하나라도 push 권한이 있는 사람이다. 레포마다 push 권한이 있는 것만 보이고, 로그인할 때와 10분마다 다시 읽는다. 러너는 폴더의 GitHub 원격으로 그 레포에 이어진다. 레포마다 러너를 하나씩 켠다.
- 레포마다인 API(작업, 멤버, 포스트, 라벨, 결정, 피드)는 `Omagari-Repo: owner/name` 머리말로 레포를 고른다. 없으면 부른 사람에게 보이는 첫 레포다. CLI는 폴더의 원격을 싣는다.

`OMAGARI_DB`(기본 `omagari.db`)와 `PORT`(기본 3000)로 DB 파일과 포트를 바꾼다. 멤버가 웹을 여는 주소가 서버가 듣는 주소와 다르면 `OMAGARI_URL`에 준다. 결정 PR의 출처(포스트 링크)가 이 주소로 적힌다.

서버가 `npm run build -w @omagari/web`로 빌드한 웹 화면(`packages/web/dist`)이 있으면 같은 주소에서 낸다. 없는 경로는 화면의 첫 파일로 보낸다. 개발할 때는 지금처럼 `npm run web`(Vite)를 쓴다. 건강 확인은 `GET /api/health`다.

### Fly.io에 올리기

도그푸딩 서버는 Fly.io(도쿄 `nrt`)의 작은 기계 하나다(ADR-0042). 설정은 `fly.toml`, 이미지는 `Dockerfile`에 있다. 처음 한 번 사람이 한다.

```bash
fly apps create omagari-dogfood            # fly.toml의 app 이름과 맞춘다(이미 쓰인 이름이면 둘 다 바꾼다)
fly volumes create omagari_data --region nrt --size 1
fly secrets set GITHUB_CLIENT_ID=<기기 인증을 켠 GitHub 앱>
fly deploy
```

- 비밀값은 `fly secrets`로만 넣는다. 레포에는 두지 않는다. `OMAGARI_REPO`(받을 계정 목록)와 `OMAGARI_URL`은 비밀이 아니라 `fly.toml`의 `[env]`에 있다.
- DB는 볼륨(`/data/omagari.db`)에 있어 새 판으로 바꿔도 남는다. 백업은 볼륨의 날마다 스냅샷이다(`fly volumes snapshots list`로 본다. 기본 5일 보관).
- 건강 확인(`/api/health`)을 통과한 판만 갈아 끼운다. 못 통과하면 옛 판이 남는다.
- 자동 배포: `.github/workflows/deploy.yml`이 `dev`의 CI가 통과하면 `fly deploy`를 돈다. `dev`에서만 쓸 수 있는 GitHub Environment `dogfood`(Settings → Environments, 배포 브랜치를 `dev`로 제한)의 비밀값에 `FLY_API_TOKEN`(`fly tokens create deploy`)을 넣어야 켜지고, 없으면 배포 단계를 건너뛴다. CI가 돈 커밋이 지금 `dev`의 끝이 아니면(옛 실행을 다시 돌린 경우) 올리지 않는다.
- 이 기기에서 이미지를 확인하려면: `docker build -t omagari .` 뒤 `docker run -p 8080:8080 -v omagari-data:/data -e OMAGARI_REPO=<owner/name> -e GITHUB_CLIENT_ID=<앱> omagari`.
