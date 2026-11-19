import type { Words } from "../i18n.ts";

/** 이름 뒤에 이/가를 붙인다. 한글로 끝나지 않으면 이름만 둔다. */
const subject = (name: string) => {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return name;
  return `${name}${code % 28 ? "이" : "가"}`;
};

export const dmKo: Words["dm"] = {
  myAgents: "내 에이전트",
  onlyYou: "나만 보여요",
  thisPost: "이 포스트",
  askAgent: "물을 에이전트",
  answering: "답하는 중…",
  idle: "쉬는 중",
  askOffline: (agent) => `${agent} 러너가 꺼져 있어 지금은 물을 수 없어요`,
  askFailed: "질문을 못 보냈어요. 조금 있다 다시 해 볼래요?",
  loading: "문답을 불러오는 중",
  loadFailed: "문답을 못 불러왔어요",
  loadFailedBody: "연결이 끊긴 것 같아요. 인터넷을 확인해 볼래요?",
  retry: "다시 시도",
  log: (channel) => `# ${channel}의 내 문답`,
  notAskedYet: (agent) => `${agent}에게 아직 묻지 않았어요`,
  notAskedBody: "이 채널의 대화와 내 폴더의 레포를 보고 답해요. 문답은 나만 봐요.",
  askLabel: (agent) => `${agent}에게 묻기`,
  noAgent: "연결된 에이전트가 없어요",
  noAgentBody: "이 기기에서 러너를 켜면 여기서 물을 수 있어요.",
  chips: {
    model: "모델",
    defaultModel: "기본 모델",
    effort: (effort) => `effort ${effort ?? "기본"}`,
    default: "기본",
    fromSettings: "설정값",
    older: (n) => `이전 모델 ${n}개`,
  },
  failed: {
    turn_timeout: "10분이 넘어 답을 끊었어요",
    runner_offline: "답하기 전에 러너가 꺼졌어요",
  },
  couldntAnswer: (agent) => `${agent}가 답하지 못했어요`,
  pending: (agent) => `${agent}가 답하는 중…`,
  aiBadge: "AI가 쓴 답",
  agentOf: (name, agent) => `${name}의 ${agent}`,
  postedName: subject,
  postedBy: "올림",
  public: "공개",
  expand: "펼치기",
  collapse: "접기",
  codeRead: "본 코드",
  noBranch: "브랜치 아님",
  dirty: "작업 중 변경 포함",
  modelAnswered: "답한 모델",
  calledIn: (where) => `${where}에서 @호출로 물었어요`,
  postedIn: (where) => `${where}에 올렸어요`,
  show: "보기",
  attachedPost: "포스트 입력 칸에 넣었어요",
  attachedChannel: "채널 입력 칸에 넣었어요",
  toPost: "포스트에 올리기",
  toChannel: "채널에 올리기",
  askAgain: "다시 묻기",
};
