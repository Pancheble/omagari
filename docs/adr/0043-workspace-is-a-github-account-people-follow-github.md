---
status: accepted
---

# 워크스페이스는 GitHub 계정 하나와 짝짓고, 사람과 팀은 GitHub 권한을 따른다

ADR-0012는 서버 하나에 워크스페이스 하나, ADR-0011은 그 레포의 push 권한자만 멤버로 두었다. @Pancheble은 Notion처럼 워크스페이스 안에 레포 여럿과 팀별 권한을 두자고 했다(#211). 5단계 그릴링에서 Omagari가 사람과 팀을 따로 관리하지 않고 GitHub에 맡기기로 했다(2026-11-17 @Pancheble: "깃허브 권한이랑 똑같이", "그냥 조직을 지금 만들고 지금처럼 운영하는게 좋을수도", "개인 리포도 Omagari가 잘 작동하는지 확인은 해야해서 그냥 이대로 가자", `docs/stage5-questions.md` Q7, Q8).

- **워크스페이스**: 서버 하나에 여럿이다. GitHub 계정(조직이나 개인) 하나와 짝지어지고, 그 계정의 레포를 처음 넣으면 생긴다. 만드는 화면과 Omagari의 소유자는 없다. 서버 설정에 받을 GitHub 계정 목록을 두고, 도그푸딩 서버는 `Pancheble`만 받는다.
- **레포**: 그 레포의 GitHub Admin이 넣고 뺀다. 한 레포는 워크스페이스 하나에만 들어가므로 러너는 폴더의 GitHub 원격으로 워크스페이스를 찾는다.
- **멤버와 권한**: ADR-0011을 레포마다로 넓힌다. 레포마다 push 권한이 있으면 그 레포가 보이고 작업 중 코드를 서로 본다. 워크스페이스 레포 가운데 하나라도 push 권한이 있으면 멤버다. 초대 없이 로그인하면 들어오고, 10분마다 다시 확인한다.
- **팀**: GitHub 팀이다. GitHub이 돌려주는 레포 권한에 팀으로 받은 몫이 이미 들어 있어, Omagari는 팀을 만들거나 가져오지 않고 `read:org`도 받지 않는다.
- **레포마다 있는 것**: 작업, 알림, 포스트(그 레포의 GitHub 이슈), 라벨, 결정.
- **워크스페이스에 하나인 것**: 멤버, 프로필, 접속 상태, 상태 메시지.
- **두 층에 다 두는 것**: 채팅 채널은 레포 밑에도 워크스페이스 밑에도 만든다. 레포 채널의 `@호출`은 그 레포의 러너가 답하고, 워크스페이스 채널은 지금처럼 그 멤버가 마지막에 붙인 러너가 답하며 어느 레포와 브랜치를 보았는지 붙는다. 포럼은 거르기에 레포 조건이 더해져, 레포 하나면 그 레포 밑에, 둘 이상이거나 모든 레포면 워크스페이스 밑에 보인다.
- **워크스페이스 포스트는 방향만**: 레포를 넘는 부딪힘(계약 변경, 중복 구현, 간접 충돌)과 사람이 여는 여러 레포의 결정·운영 논의는 이슈와 결정 PR을 둘 레포가 없다. 워크스페이스가 집 레포를 하나 골라 거기에 두는 방향으로 하고(GitHub 조직 토론의 원천 레포, `rust-lang/rfcs`, `kubernetes/enhancements`), 레포 둘 이상으로 도그푸딩한 뒤 만든다.

## Considered Options

- **Omagari의 소유자, 초대, 팀(Notion식)**: GitHub과 사람 목록을 두 벌 관리한다. 팀이 GitHub에 이미 있다.
- **로그인한 누구나 워크스페이스를 만든다**: 우리 서버가 모르는 사람의 작업 중 코드를 들고 요금을 낸다.
- **이 레포를 지금 조직으로 옮긴다**: 개인 레포에서 잘 도는지를 도그푸딩으로 확인하지 못한다.
- **포럼도 레포마다**: 레포가 늘면 같은 이름의 포럼이 레포마다 생긴다. 포럼은 거른 보기라 레포를 넘어도 깨지는 것이 없다.

## Consequences

- ADR-0012의 "워크스페이스 하나"를 바꾼다. 서버는 여전히 우리가 띄우는 하나다.
- 서버 설정 `OMAGARI_REPO`는 받을 계정 목록으로 바뀐다. 이미 있는 DB의 행은 켤 때 옛 `OMAGARI_REPO`의 레포에 속한 것으로 옮긴다.
- push 권한이 없는 사람(보기)과 외부 기여자(기여)의 자격은 도그푸딩 뒤에 정한다. 공개 레포의 Read 권한은 세상 모두라 오픈소스 문제와 함께다(구현 13장).
- 조직 레포는 조직 Owner가 Omagari의 OAuth 앱을 승인해야 닿는다(새 조직은 접근 제한이 켜져 있다). 조직 팀이 쓰겠다고 할 때 손 점검으로 본다.
- 계약에 워크스페이스와 레포가 더해지고 `CONTRACT_VERSION`이 오른다.

## Sources

- [GitHub 레포 역할](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)
- [GitHub 조직 토론의 원천 레포](https://docs.github.com/en/organizations/managing-organization-settings/enabling-or-disabling-github-discussions-for-an-organization)
- [GitHub Enterprise Server: 조직 만들기 막기](https://docs.github.com/en/enterprise-server@3.15/admin/managing-accounts-and-repositories/managing-organizations-in-your-enterprise/preventing-users-from-creating-organizations)
- [OAuth 앱 접근 제한](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions)
