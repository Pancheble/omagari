---
status: accepted
---

# GIF는 서버를 거쳐 GIPHY에서 찾고, 반응은 계약에 둔다

@Pancheble이 채팅에서 GIF와 이모지를 쓰자고 했다(#291). 시안 전에 정한 것(2026-11-19 @Pancheble, #291 댓글):

- **GIF는 GIPHY 하나로 찾는다.** Tenor API는 2026-01-13에 새 키를 받지 않았고 2026-06-30에 꺼졌다. KLIPY도 있지만 둘을 맞추는 일은 쓸지 모를 일이라 미룬다. Slack, Mattermost, 인스타그램이 GIPHY를 쓴다.
- **키는 운영자가 서버 설정에 넣는다.** 공개 레포라 코드에 둘 수 없다. 키가 없으면 GIF 버튼이 없다(Zulip과 같다). 무료 베타 키는 시간당 100번이고, 더 쓰려면 GIPHY에 프로덕션 키를 신청한다.
- **찾기는 Omagari 서버가 대신 묻는다.** 브라우저는 우리 서버에만 묻고 서버가 키를 붙인다. GIPHY는 서버의 IP만 보고, 찾는 말이 멤버 한 사람에 묶여 나가지 않으며, 키는 서버 밖으로 나가지 않는다. 한도도 서버에서 지킨다. 그림은 브라우저가 `media.giphy.com`에서 바로 받는다(그림까지 서버를 거치게 하는 프록시는 따로 큰 일이다).
- **알린다.** GIF 칸 아래에 "Powered by GIPHY · 찾는 말은 GIPHY로 가요". GIPHY 약관의 표기 의무다.
- **등급은 R까지, 설정 없이.** @Pancheble: "그냥 R까지 해 뭐 어떄".
- **GIF 메시지는 GIPHY 주소 한 줄이다.** 새 메시지 종류를 두지 않는다. 웹은 GIPHY 주소 하나뿐인 메시지를 그림으로 보인다. 붙여 넣은 GIPHY 주소도 같다. 다른 이미지 주소는 그리지 않는다. 글을 쓴 사람이 보는 사람의 IP를 알아낼 수 있어서다.
- **파일 올리기는 하지 않는다.** 저장소, 용량 한도, 지우기 규칙이 따로 드는 큰 기능이다.
- **반응은 서버에 저장하고 실시간으로 나눈다.** 메시지 하나에 (이모지, 멤버)마다 하나다. 팔레트 전체에서 고른다. 계약에 반응 달기·떼기와 그 알림이 더해지고 `CONTRACT_VERSION`이 오른다. 포스트 메시지의 반응은 GitHub 이슈 댓글로 옮기지 않는다.
- 입력 칸의 이모지 버튼과 `:` 자동 완성은 글자만 넣어 계약이 그대로다.

## Considered Options

- **브라우저가 GIPHY에 바로 묻는다**(Zulip): 만들기는 가장 쉽다. GIPHY가 누가 무엇을 찾았는지 IP와 함께 본다. 키가 브라우저에 보인다(GIPHY는 괜찮다고 한다).
- **KLIPY도, 또는 KLIPY만**: Tenor 모양의 API라 옮기기는 쉽다. 프로덕션 요금이 공개되어 있지 않고, 둘을 맞추는 일은 지금 필요 없다. GIPHY가 막히면 더한다.
- **아무 이미지 주소나 그림으로**: 키 없이도 GIF를 쓰지만, 보는 사람의 IP가 링크 주인에게 간다.
- **GitHub처럼 반응 여덟 개**: 정해진 것만이라 계약은 작다. Slack, Discord처럼 팔레트 전체를 쓰기로 했다.

## Consequences

- 서버 설정에 GIPHY 키가 더해진다. 없으면 웹이 GIF 버튼을 숨기도록 서버가 알린다.
- 서버에 GIF 찾기 길이 더해진다. GIPHY 응답 가운데 웹이 쓰는 것(주소, 크기, 제목)만 넘긴다. GIPHY 약관의 "콘텐츠로 DB를 만들지 않는다"에 맞게 찾은 결과를 쌓아 두지 않는다.
- 포스트의 글은 GitHub 이슈 댓글이 되므로, GIF 메시지는 GitHub에서 GIPHY 주소로 보인다.
- 테스트에서 GIPHY는 가짜로 둔다(ADR-0033의 가짜 세 곳에 GIPHY가 더해진다). 진짜 GIPHY는 손 점검으로 본다.

## Sources

- [Tenor API 종료](https://support.google.com/tenor/answer/10455265), [Tenor 새 키 중단](https://developers.google.com/tenor/guides/quickstart) (2026-11-19 확인)
- [GIPHY API 문서: 키, 베타 한도, 표기](https://developers.giphy.com/docs/api/), [GIPHY FAQ](https://developers.giphy.com/faq/)
- [KLIPY 개발자](https://klipy.com/developers), [KLIPY API 약관](https://klipy.com/support/api-terms)
- [Zulip GIF 연동: 운영자 키, 기본 꺼짐](https://zulip.readthedocs.io/en/latest/production/gif-picker-integrations.html)
- [Mattermost GIF 설정](https://docs.mattermost.com/administration-guide/configure/integrations-configuration-settings)
- [Slack GIF](https://slack.com/help/articles/26860009071251-Add-GIFs-to-a-message-in-Slack)
