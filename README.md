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

샌드박스 도구는 macOS에는 따로 깔 것이 없고, Linux는 bubblewrap, socat, ripgrep이 있어야 한다. 이 기기에서 끄려면 `omagari runner --merge-check off`로 켜고, 고른 것은 그 레포에 남는다.

## 업데이트

```bash
cd ~/omagari
git pull
npm ci
```

그리고 러너를 다시 켠다(`Ctrl-C`로 끄고 `omagari runner`). Node를 올렸거나 체크아웃을 옮겼으면 `omagari install`도 다시 돌린다. 훅 명령에 Node와 체크아웃의 경로가 들어 있다.

릴리즈마다 무엇이 바뀌었는지는 [GitHub 릴리즈](https://github.com/Pancheble/omagari/releases)에 있다. 맨 위에 "러너도 업데이트해야 해요"가 있으면 서버와 러너 사이의 계약이 바뀐 릴리즈다.

## 버전 확인

```bash
omagari --version
```

`omagari v0.1.0 (contract 9)`처럼 이 체크아웃의 git 태그와 계약 버전을 보인다. 릴리즈 뒤의 커밋이면 `v0.1.0-3-gabc1234`, 태그를 받지 못한 클론이면 `버전 모름(커밋 abc1234)`이다.

서버와 이 기기의 계약 버전이 다르면 서버가 러너를 받지 않고, 러너가 할 일을 알린다.

- 서버가 더 새로우면: "서버는 v0.3.0, 이 기기는 v0.2.1이에요." 위의 업데이트를 하고 러너를 다시 켠다.
- 서버가 더 오래됐으면: 서버를 올려야 한다. 서버를 띄운 사람에게 알린다.

## 서버

서버도 `main`으로 띄우고, 업데이트도 멤버와 같다(`git pull`, `npm ci`, 다시 띄우기). 켜질 때 `Omagari 서버 v0.1.0 (contract 9): ...`처럼 버전을 로그에 남긴다.

```bash
OMAGARI_REPO=<owner/name> GITHUB_CLIENT_ID=<기기 인증을 켠 GitHub 앱> HOST=0.0.0.0 npm run server
```

`OMAGARI_DB`(기본 `omagari.db`)와 `PORT`(기본 3000)로 DB 파일과 포트를 바꾼다. 멤버가 웹을 여는 주소가 서버가 듣는 주소와 다르면 `OMAGARI_URL`에 준다. 결정 PR의 출처(포스트 링크)가 이 주소로 적힌다.
