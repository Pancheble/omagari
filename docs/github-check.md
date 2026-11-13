# 실제 GitHub 손 점검

이슈 #124. 결정 PR(#83)과 포스트 = GitHub 이슈(#118)는 가짜 GitHub(`test/harness.ts`의 `fakeGitHub()`)로만 테스트했다. 가짜는 우리가 생각한 GitHub이라, 실제 GitHub이 그렇게 답하는지는 `test/real-github.ts` 하나로 손으로 돌려 본다. 서버의 진짜 구현(`packages/server/src/github.ts`의 `realGitHub`)을 시험용 레포에 대고 부른다. 이름이 `*.test.ts`가 아니라 `npm test`와 CI는 이것을 돌리지 않는다.

## 무엇을 보나

| 단계 | 부르는 것 | 통과 조건 |
| --- | --- | --- |
| user, canPush, defaultBranch | `user`, `canPush`, `defaultBranch` | 로그인 이름이 오고, push 권한이 `true`이고, 기본 브랜치 이름과 40자 sha가 온다 |
| commit + openPull | `commit`(새 브랜치), `openPull` | PR 번호와 주소가 온다 |
| pulls + pull | `pulls`, `pull` | 브랜치로 찾으면 열린 PR 하나, 번호로 읽으면 제목이 같다 |
| read + list | `read`, `list` | 올린 파일의 내용이 같고, 폴더 목록에 있고, 없는 파일은 `null`이다 |
| addCommit | `addCommit` | 브랜치 끝에 커밋을 더하면 내용이 바뀐다 |
| changesRequested (리뷰 없음) | `changesRequested` | 빈 목록이다 |
| changesRequested (변경 요청 리뷰) | 두 번째 계정이 단 리뷰 | `changesRequested`가 그 계정의 로그인을 돌려준다. 두 번째 토큰이 없으면 건너뜀 |
| merge | `merge`, `pull` | 머지되고 `mergedAt`이 있다 |
| openPull (닫을 PR), closePull | `openPull`, `closePull`, `pull` | 머지 없이 닫힌다 |
| openIssue (레포에 없는 라벨) | `openIssue` | 레포에 없는 라벨 이름을 줘도 이슈가 열린다 |
| issue | `issue` | 제목이 같고 열려 있고, 없던 라벨이 붙었다 |
| comment + comments | `comment`, `comments` | 단 댓글이 id, 본문, 쓴 사람(토큰 주인)으로 읽힌다 |
| closeIssue + issue | `closeIssue`, `issue` | 닫힌 것으로 읽힌다 |

방금 쓴 것이 읽히기까지 GitHub이 걸릴 수 있어 읽는 단계는 최대 6초 다시 본다. 머지는 GitHub이 머지 가능 여부를 계산하는 동안 막힐 수 있어 최대 5번 다시 한다.

변경 요청 리뷰는 두 번째 계정이 있어야 한다. GitHub은 자기 PR에 변경 요청을 달 수 없게 한다.

## 돌리기 전에

- **시험용 레포**를 하나 정한다. 점검은 브랜치(`check/<id>-a`, `check/<id>-b`)를 만들고, PR을 열어 하나는 머지하고 하나는 닫고, 이슈를 열어 닫는다. 머지한 PR의 파일(`omagari-check/<id>.txt`)은 기본 브랜치에 남는다. 쓰던 레포나 이 레포(Pancheble/omagari)에는 돌리지 않는다. 기본 브랜치가 있어야 하니 커밋이 하나는 있는 레포여야 한다.
- 시험용 레포에서 머지에 리뷰나 검사를 요구하지 않게 둔다(브랜치 보호 없음). 요구하면 `merge` 단계가 그 까닭과 함께 실패한다. 그것도 `merge`가 까닭을 돌려주는지 보는 데는 쓸모가 있다.
- 토큰: 환경 변수 `GITHUB_TOKEN`, 없으면 `gh auth token`이 주는 것을 쓴다. 시험용 레포에 push할 수 있어야 하고, 범위는 `repo`(세밀한 토큰이면 그 레포의 Contents, Pull requests, Issues 쓰기)다. 값은 읽기만 하고 어디에도 찍지 않는다.
- 두 번째 계정(선택): 환경 변수 `GITHUB_REVIEWER_TOKEN`. 시험용 레포의 PR을 리뷰할 수 있는 다른 계정의 토큰이다. 비공개 레포면 그 계정을 협업자로 초대해 둔다.
- 레포 맨 위에서 `npm ci`를 해 둔다(Node 24 이상).

## 돌리는 법

레포 맨 위에서:

```bash
node test/real-github.ts --repo owner/name > github-check-result.md
```

- 진행은 터미널(stderr)에, 결과는 stdout에 나온다. 위처럼 받으면 결과만 파일에 남는다.
- `--repo`나 토큰이 없으면 무엇이 필요한지 알리고 종료 코드 2로 끝난다. 아무것도 만들지 않는다.

## 읽는 법

- `[x]`는 통과, `[ ] …(실패)`는 실패, `[-] …(건너뜀)`은 건너뛴 것이다. 실패가 하나라도 있으면 종료 코드가 1이다.
- 앞 단계가 실패하면 그것에 기대는 단계도 같이 실패한다. 맨 위의 실패부터 본다.
- 끝에서 열린 채로 남은 PR과 이슈를 닫고, 점검이 만든 브랜치를 지우고, GitHub이 없는 라벨로 이슈를 열 때 만들어 둔 점검 라벨(`omagari-check-<id>`)을 지운다. 지우지 못한 것은 결과 맨 끝에 적힌다. 손으로 지운다.
- 실제 GitHub이 가짜와 다르게 답한 것이 나오면 `packages/server/src/github.ts`를 고치고 `fakeGitHub()`도 같은 답을 하게 맞춘다. 고칠 일이 크면 이슈를 연다.

## 결과를 어디에 적나

결과 블록을 이슈 #83에 댓글로 붙인다. 모두 통과면 #83을 닫고, 실패가 있으면 고칠 이슈를 연다.
