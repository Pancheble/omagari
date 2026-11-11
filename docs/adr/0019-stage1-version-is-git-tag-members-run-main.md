---
status: accepted
---

# 1단계의 버전은 git 태그에서 읽고, 멤버와 서버는 `main`을 받아 쓴다

v0.1.0을 릴리즈했지만 package.json은 모두 `0.0.0`이라 `omagari --version`이 `omagari 0.0.0 (contract 9)`를 보였다. 러너, CLI, 훅을 기기에 까는 방식은 정하지 않았고(ADR-0016), 계약 버전이 하나라도 다르면 서버가 러너를 받지 않는데 무엇을 하라는 안내도 없었다. 1단계는 두세 명이 매일 들어오는지를 재는 단계라(구현 문서 1장), 릴리즈도 그 답을 앞당기는 만큼만 갖춘다. ADR-0012가 설치 묶음을 미룬 것과 같은 기준이다.

- **버전은 git 태그다.** package.json에는 버전을 적지 않는다(`0.0.0` 그대로). `omagari --version`과 서버는 자기 체크아웃의 `git describe --tags`를 보인다. 릴리즈한 커밋이면 `v0.1.0`, 그 뒤 커밋이면 `v0.1.0-3-gabc1234`다. 그래서 버전을 올리는 커밋도, 릴리즈 PR도 없다.
- **`main`은 멤버와 서버가 쓰는 판이다.** 멤버는 레포를 클론해 `main`에서 러너, CLI, 훅을 돌린다. 업데이트는 `git pull`, `npm ci`, 러너 다시 켜기다. 우리가 띄우는 서버(ADR-0012)도 `main`으로 띄운다. `dev`는 작업이 모이는 곳이라 멤버가 쓰지 않는다.
- **릴리즈는 손으로 한다.** `dev`를 `main`으로 빨리 감고, 그 커밋에 태그를 찍고, `gh release create --generate-notes`로 노트를 만든다. 변경 기록은 GitHub 릴리즈 노트이고 CHANGELOG 파일은 두지 않는다.
- **멤버나 서버가 받아야 할 feat나 fix가 `dev`에 쌓였을 때 릴리즈한다.** 문서, 테스트, CI만 바뀌었으면 하지 않는다. 정해진 주기는 없다.
- **번호는 SemVer다.** feat는 Y, fix는 Z, 깨지는 변경은 X를 올린다. 1.0 전에는 깨지는 변경도 Y를 올린다. 계약 버전(`CONTRACT_VERSION`)은 릴리즈 번호와 따로 센다. 계약이 바뀐 릴리즈는 노트 맨 위에 "러너도 업데이트해야 해요"를 적는다.
- **계약이 맞지 않으면 할 일을 알린다.** 서버는 거절할 때 자기 버전을 함께 보내고, 러너와 CLI는 "서버는 v0.3.0, 이 기기는 v0.2.1이에요. `main`을 받고 러너를 다시 켜세요"처럼 보인다. 서버가 더 낮으면 서버를 올리라고 알린다.

## Considered Options

- **package.json에 버전을 적고 손으로 올리기**: `dev`가 보호되어 있어 버전을 올리는 커밋도 PR을 거쳐야 하고, 태그와 어긋나기 쉽다.
- **release-please로 자동화**([release-please-action](https://github.com/googleapis/release-please-action)): PR 제목(conventional commits)으로 다음 버전과 CHANGELOG를 담은 릴리즈 PR을 늘 열어 두고, 머지하면 태그와 릴리즈를 만든다. 다음 릴리즈가 늘 보이고 번호를 사람이 정하지 않는다. 하지만 워크플로의 `GITHUB_TOKEN`으로 연 PR은 CI가 승인을 기다리는 상태로 떠서, 갱신될 때마다 누가 눌러 주거나 PAT·GitHub App 토큰을 따로 둬야 한다([Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). 지금 릴리즈는 태그와 노트뿐이라 아끼는 일이 작고, 릴리즈 뒤에 이어 붙일 배포가 아직 없다.
- **npm 패키지나 Claude Code·Codex 플러그인으로 배포**: Room은 클라이언트를 플러그인으로, 서버를 `v*` 태그마다 만드는 Docker 이미지로 배포한다. git 없이 깔 수 있지만, Node는 `node_modules` 아래의 `.ts`를 실행하지 않아 JS 빌드가 필요하다(ADR-0014). 두세 명이 쓰는 동안에는 클론으로 충분하다.
- **계약의 호환 범위를 맞추기**: Room은 서버와 클라이언트가 지원 범위(지금 판과 앞 마이너 세 개)를 서로 맞춘다. 서버가 하나이고 멤버가 몇뿐이라 다 같이 올리는 편이 싸다.

## Consequences

- git 없이 까는 방식(npm, 플러그인)으로 바꾸면 패키지 안에 `.git`이 없어 `git describe`를 쓸 수 없다. 그때 버전을 package.json에 적고 release-please로 자동화하며, 이 ADR을 대체한다. 다른 팀이 쓰겠다고 할 때가 그 시점이다.
- 멤버의 기기에는 git과 이 레포의 클론이 있어야 한다. 훅이 체크아웃의 절대 경로를 쓰는 ADR-0016과 맞는다.
- 서버가 계약을 올린 릴리즈를 먼저 받으면, 멤버의 러너는 각자 업데이트할 때까지 붙지 못한다. 계약을 올린 릴리즈는 멤버에게 미리 알린다.
- 태그를 받지 못한 클론(얕은 클론 등)은 `git describe`가 커밋만 보인다. 그때는 버전을 모른다고 보인다.
