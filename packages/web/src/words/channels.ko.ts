import type { Presence } from "@omagari/contract";
import type { Words } from "../i18n.ts";

export const channelsKo: Words["channels"] = {
  panel: {
    unread: "새 글",
    chatTitle: "채팅 채널",
    createChat: "채팅 채널 만들기",
    forumTitle: "포럼 채널",
    createForum: "포럼 만들기",
    foldMyPosts: (forum, shut) => `${forum}의 내 포스트 ${shut ? "펼치기" : "접기"}`,
    myPosts: (forum) => `${forum}의 내 포스트`,
  },

  place: {
    all: "전체",
    allOf: (account) => `${account} 전체`,
    elsewhere: "다른 곳에 새 글",
    menu: "레포 고르기",
    find: "레포 찾기",
    repoCount: (n) => `레포 ${n}`,
    add: "레포 넣기",
    note: "넣은 레포 가운데 push 권한이 있는 것만 보여요.",
  },

  repoMenu: {
    label: "레포 메뉴",
    openGithub: "GitHub에서 열기",
    remove: "워크스페이스에서 빼기",
  },

  addRepo: {
    title: "레포 넣기",
    lead: "내가 Admin인 레포만 보여요. 개인 레포도 넣어야 Omagari가 봐요. 넣으면 그 레포에 push 권한이 있는 사람이 멤버로 들어와요.",
    loading: "레포를 읽는 중…",
    loadFailed: "GitHub에서 레포를 못 읽었어요. 조금 있다 다시 열어 볼래요?",
    visibility: (isPrivate, pushers) => `${isPrivate ? "비공개" : "공개"} · push 권한 ${pushers}명`,
    added: "넣음",
    add: "넣기",
    addFailed: "레포를 못 넣었어요. 조금 있다 다시 해 볼래요?",
    missing: "레포가 안 보여요? 그 레포에 Omagari GitHub App이 설치돼 있어야 해요.",
    install: "App 설치",
    other: `다른 계정의 레포는 메뉴에서 그 계정 아래 "레포 넣기"로 넣어요.`,
    close: "닫기",
  },

  frame: {
    channelPanel: "채널 패널",
    keepPanelOpen: "채널 패널 펼쳐 두기",
    closePanel: "채널 패널 닫기",
    openPanel: "채널 패널 열기",
    notFound: "찾을 수 없음",
    backToForum: "포럼으로 돌아가기",
    editForum: "포럼 고치기",
    toSidePanel: "옆 칸으로",
    myAgent: "내 에이전트",
    members: "멤버 목록",
    profile: "프로필",
    expand: "크게 보기",
    back: "돌아가기",
    closePanelNamed: (title) => `${title} 닫기`,
    reconnecting: "서버에 다시 붙는 중…",
    messageTo: (name) => `${name}에 메시지 보내기`,
    messagePost: "이 포스트에 메시지 보내기",
    hiddenTitle: "이 레포는 볼 수 없어요",
    hiddenBody:
      "push 권한이 있는 사람만 이 레포의 채널과 포스트를 봐요. GitHub에서 권한을 받으면 10분 안에 패널에 생겨요.",
    goToAll: (account) => `${account} 전체로 가기`,
    goToRepo: (repo) => `${repo}로 가기`,
    emptyTitle: "아직 채널이 없어요",
    emptyBody: "채널을 만들어 멤버들과 이야기를 시작해 보세요.",
    createChannel: "채널 만들기",
  },

  presence: {
    online: "온라인",
    away: "자리 비움",
    dnd: "방해 금지",
    offline: "오프라인",
  } satisfies Record<Presence, string>,
};
