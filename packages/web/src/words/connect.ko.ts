import type { Words } from "../i18n.ts";

/** "컴퓨터 연결"과 레포 공유 안내의 한국어 글. */
export const connectKo: Words["connect"] = {
  title: "컴퓨터 연결하기",
  body: "터미널에서 아래 두 줄을 실행해요.",
  install: "Omagari 설치",
  setup: "이 서버에 연결",
  copy: "복사",
  copied: "복사했어요",
  codex: "Codex를 쓴다면 /hooks에서 Omagari 훅을 신뢰해 주세요.",
  notShared: "이 레포는 아직 공유하지 않았어요. 팀원이 내 작업을 볼 수 없어요.",
  share: "공유",
  shareFailed: "공유하지 못했어요. 조금 있다 다시 해 볼래요?",
  limit: {
    requests: (max) => `1분에 ${max}번 요청 제한에 걸렸어요. 1분 뒤에 다시 해 볼래요?`,
    repos: (max) =>
      `이 워크스페이스는 레포를 ${max}개까지 둘 수 있어요. 하나를 빼야 더 넣을 수 있어요.`,
    storage: (max) =>
      `이 워크스페이스가 저장 용량 ${max}MB를 넘었어요. 서버 운영자에게 물어봐 주세요.`,
  },
  closeLimit: "닫기",
};
