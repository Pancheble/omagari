import type { deletionEn } from "./deletion.en.ts";

export const deletionKo: typeof deletionEn = {
  deletedMember: "삭제된 멤버",
  account: {
    title: "계정 삭제",
    body: "세션, GitHub 토큰, 프로필, 작업, 설정이 지워져요. 쓴 메시지는 삭제된 멤버로 남아요.",
    button: "계정 삭제",
    confirm: "계정을 삭제할까요?",
    lines: [
      "세션, GitHub 토큰, 프로필, 상태, 작업, 설정이 지워져요.",
      "러너 연결이 끊겨요.",
      "쓴 메시지는 삭제된 멤버로 남아요.",
    ],
  },
  repo: {
    confirm: (repo: string) => `${repo} 레포를 빼고 데이터를 지울까요?`,
    lines: [
      "작업, 알림, 포스트, 라벨, 결정, 검사 명령, 레포 채널이 지워져요.",
      "다시 넣으면 빈 상태로 시작해요.",
    ],
  },
  workspace: {
    title: "워크스페이스 삭제",
    body: "모든 레포의 작업, 알림, 포스트, 라벨, 결정과 모든 채널이 지워져요.",
    note: "여기 있는 모든 레포의 GitHub Admin만 지울 수 있어요.",
    button: "워크스페이스 삭제",
    confirm: (name: string) => `${name} 워크스페이스를 삭제할까요?`,
    lines: (repos: number) => [
      `레포 ${repos}개의 작업, 알림, 포스트, 라벨, 결정, 검사 명령이 모두 지워져요.`,
      "여기 있는 채널과 포럼도 모두 지워져요.",
    ],
    forbidden: "여기 있는 모든 레포의 GitHub Admin이 아니라서 못 지워요.",
  },
  forever: "되돌릴 수 없어요. 백업에는 만료될 때까지 남아요.",
  typeName: "확인하려면 이름을 입력해 주세요:",
  cancel: "취소",
  delete: "삭제",
  failed: "못 지웠어요. 조금 있다 다시 해 볼래요?",
};
