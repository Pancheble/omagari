// 계약: 러너와 서버가 주고받는 메시지, 웹이 쓰는 API. 모든 조각이 이 정의 하나를 쓴다.
// 객체는 모두 `z.strictObject`로 적는다. 계약에 없는 종류도, 계약에 없는 키도 받지 않는다.
import * as z from "zod";

/** 계약의 버전. 봉투마다 싣고, 다르면 받지 않는다. 계약을 깨는 변경마다 올린다. */
export const CONTRACT_VERSION = 10;

/** 오류 형식. 러너와 서버 사이의 `error` 메시지와 HTTP 오류 본문(`{ error }`)이 같이 쓴다. */
export const ContractError = z.strictObject({
  code: z.enum([
    "invalid_message", // 봉투나 내용이 계약과 다르다
    "unknown_kind", // 계약에 없는 종류다
    "version_mismatch", // 계약의 버전이 다르다
    "invalid_request", // HTTP 요청의 본문이 계약과 다르다
    "unauthorized", // 로그인하지 않았거나 세션이 끝났다
    "forbidden", // 멤버가 아니거나, 워크스페이스의 레포가 아닌 폴더다
    "not_found",
    "internal",
    "executor_failed", // 에이전트 실행기가 실패했거나 답 없이 끝났다
    "runner_offline", // 그 에이전트의 러너가 서버에 붙어 있지 않다. 문답은 쌓아 두지 않는다
    "turn_timeout", // 러너 세션의 한 턴이 시간 상한을 넘어 끊겼다
    "conflict", // 이미 있다(같은 이름의 채널)
  ]),
  message: z.string(),
});
export type ContractError = z.infer<typeof ContractError>;

export class ContractFailure extends Error {
  code: ContractError["code"];
  constructor(error: ContractError) {
    super(error.message);
    this.code = error.code;
  }
}

// --- 러너와 서버 사이의 메시지 ---

/** 모든 메시지의 봉투. `re`는 이 메시지가 답하는 메시지의 `id`다. */
const Envelope = z.strictObject({
  v: z.number(),
  id: z.string(),
  re: z.string().optional(),
  kind: z.string(),
  payload: z.unknown(),
});

type Payloads = Record<string, z.ZodType>;

/**
 * 공유 수준: 관측이 서버에 올리는 범위. 주인이 러너마다 고르고, 기본은 full이다(ADR-0007).
 * 1단계에는 선점이 없어 declared는 바뀐 파일의 경로만, intent는 작업(브랜치)과 상태 한 줄만 올린다.
 */
export const ShareLevel = z.enum(["full", "declared", "intent"]);
export type ShareLevel = z.infer<typeof ShareLevel>;

/**
 * 관측한 파일 하나: 지금 내용, 지운 파일, 또는 경로만 보낸 파일과 그 까닭.
 * `binary`는 글이 아니거나(UTF-8이 아니거나 NUL이 있다) 파일이 아니거나 읽지 못한 것,
 * `too_large`는 파일 하나의 상한이나 합계의 상한을 넘은 것(ADR-0007),
 * `share`는 공유 수준이 내용을 내보내지 않는 것이다.
 */
export const ObservedFile = z.union([
  z.strictObject({ path: z.string(), content: z.string() }),
  z.strictObject({ path: z.string(), deleted: z.literal(true) }),
  z.strictObject({ path: z.string(), omitted: z.enum(["binary", "too_large", "share"]) }),
]);
export type ObservedFile = z.infer<typeof ObservedFile>;

/**
 * 작업 하나(멤버 + 브랜치)의 관측. 기준 커밋 이후 그 브랜치가 바꾼 파일이다: 커밋한 것, 안 한 것, 추적하지 않는 새 파일.
 * 경로는 그 작업 폴더(등록한 폴더나 연결된 워크트리)의 최상위에서 본 것이다. 정의 줄은 싣지 않는다(ADR-0009).
 */
export const Work = z.strictObject({
  branch: z.string(),
  /** 기준 커밋. 이 브랜치와 기본 브랜치(원격 추적)가 갈라진 지점이다(ADR-0002). */
  base: z.string(),
  /** 이 관측의 공유 수준. intent의 빈 `files`는 바뀐 것이 없다는 뜻이 아니라 보내지 않았다는 뜻이다. */
  share: ShareLevel,
  files: z.array(ObservedFile),
});
export type Work = z.infer<typeof Work>;

/**
 * 작업마다 이름 옆에 보이는 "~하는 중" 한 줄(ADR-0010). 서버가 이 순서로 고른다:
 * 에이전트가 쓴 줄(`at`은 쓴 시각) → 초안 PR 제목 → 고치는 파일("payment.ts 외 3개 수정 중") → 바뀐 것이 없으면 없음(null).
 * 순서의 맨 앞인 오프라인은 작업의 `offlineSince`로 따로 온다. 그때 이 줄은 그 시각 기준으로 남은 것이다.
 */
export const StatusLine = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("agent"), text: z.string(), at: z.string() }),
  z.strictObject({ source: z.literal("pull"), text: z.string() }),
  z.strictObject({ source: z.literal("files"), text: z.string() }),
]);
export type StatusLine = z.infer<typeof StatusLine>;

/**
 * 멤버들이 보는 작업 하나: 그 관측과 상태 한 줄. 웹(`api.works`)과 러너(`situation`)가 같이 쓴다.
 * 러너가 떨어진 멤버의 작업은 `offlineSince`(떨어진 시각) 기준으로 남고, 7일이 지나면 지워진다.
 */
export const WorkView = z.strictObject({
  login: z.string(),
  ...Work.shape,
  line: StatusLine.nullable(),
  offlineSince: z.string().nullable(),
});
export type WorkView = z.infer<typeof WorkView>;

/** 에이전트가 쓰는 상태 한 줄의 길이 상한. 줄바꿈과 겹친 공백은 공백 하나로 접는다. */
export const MAX_STATUS_CHARS = 200;

/** 에이전트 세션을 돌리는 실행기. 에이전트는 주인과 실행기 한 쌍이라 실행기마다 하나다(ADR-0015). */
export const ExecutorId = z.enum(["claude-code", "codex"]);
export type ExecutorId = z.infer<typeof ExecutorId>;

/** 사람이 읽는 실행기 이름. 에이전트는 "지은의 Claude Code"처럼 사람과 함께 부른다(ADR-0015). */
export const EXECUTOR_NAMES = {
  "claude-code": "Claude Code",
  codex: "Codex",
} as const satisfies Record<ExecutorId, string>;

/**
 * 다른 멤버에게 보이는 사람의 접속 상태. 웹 창이 하나도 열려 있지 않거나 "오프라인으로 보이기"를 골랐으면 offline이다.
 * 사람의 것이다. 에이전트의 러너가 붙어 있는지(`MemberView.agents`)와 따로 간다.
 */
export const Presence = z.enum(["online", "away", "dnd", "offline"]);
export type Presence = z.infer<typeof Presence>;

/** 사람이 스스로 고르는 접속 상태. invisible은 "오프라인으로 보이기"다. 고른 사람 자신의 웹도 offline으로 받는다. */
export const ChosenPresence = z.enum(["online", "away", "dnd", "invisible"]);
export type ChosenPresence = z.infer<typeof ChosenPresence>;

/** 고른 접속 상태가 온라인으로 돌아오기까지의 시간. 고르지 않으면 직접 바꿀 때까지다. */
export const PresenceDuration = z.enum(["15m", "1h", "8h", "24h", "3d"]);
export type PresenceDuration = z.infer<typeof PresenceDuration>;
export const PRESENCE_DURATIONS = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
} as const satisfies Record<PresenceDuration, number>;

/**
 * 상태 메시지의 길이 상한. 코드 포인트로 센다(이모지 하나가 1~몇 자다). Slack의 상태 글 상한 100자를 따랐다.
 * 줄바꿈과 겹친 공백은 공백 하나로 접는다.
 */
export const MAX_STATUS_MESSAGE_CHARS = 100;

const graphemes = new Intl.Segmenter();
/**
 * 상태 메시지의 이모지 칸에 들어갈 수 있는지: 글자 묶음(grapheme) 하나이고 그림 문자다(국기와 키캡 포함).
 * `\p{RGI_Emoji}`는 런타임의 유니코드 판보다 새 이모지를 모르지만, 그림 문자 자리는 미리 잡혀 있어 새 이모지도 받는다.
 */
export const isEmoji = (text: string) =>
  [...graphemes.segment(text)].length === 1 &&
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(text);

/**
 * 멤버 목록의 한 사람: 이름, 접속 상태와 상태 메시지, 실행기마다의 에이전트, 작업마다의 상태 한 줄. 웹의 멤버 목록이 이것만으로 그린다.
 * 작업의 바뀐 파일과 내용은 싣지 않는다. 그것은 `api.works`에 있다.
 */
export const MemberView = z.strictObject({
  login: z.string(),
  /** GitHub 프로필의 이름. 비워 두었으면 `login`과 같다. */
  name: z.string(),
  presence: Presence,
  /** 사람이 쓴 상태 메시지. 쓴 그대로이고(HTML이 들어 있어도 바꾸지 않는다) 접속 상태와 상관없이 보인다. 없으면 null. */
  message: z.string().nullable(),
  /** 상태 메시지의 이모지 한 칸. 글과 따로 두고, 화면은 글 앞에 쓴다. 없으면 null. */
  emoji: z.string().nullable(),
  /**
   * 러너가 붙을 때 알린 실행기마다 에이전트 하나. 러너를 켠 적이 없으면 비어 있다.
   * 러너가 붙어 있으면 online, 그중 받은 문답에 아직 답하지 않았으면(줄을 선 것 포함) answering("답하는 중")이다.
   */
  agents: z.array(
    z.strictObject({
      executor: ExecutorId,
      state: z.enum(["online", "answering", "offline"]),
    }),
  ),
  /** 러너가 떨어진 시각. 작업과 상태 한 줄은 이 시각 기준으로 남은 것이다. 붙어 있거나 켠 적이 없으면 null. */
  offlineSince: z.string().nullable(),
  works: z.array(
    z.strictObject({
      branch: z.string(),
      /** 이 작업의 에이전트. 모르면 null이고, 작업은 에이전트 없이 사람 아래에 둔다(ADR-0015). */
      executor: ExecutorId.nullable(),
      line: StatusLine.nullable(),
    }),
  ),
});
export type MemberView = z.infer<typeof MemberView>;

/** 멤버 목록 전부, 이름 순. `api.members`의 답이고, 실시간 연결의 `members`로도 온다. */
export const Members = z.strictObject({ members: z.array(MemberView) });

/** 채팅 채널. 1단계의 채널은 채팅 채널뿐이고(포럼 채널은 없다), 워크스페이스의 멤버 모두가 읽고 쓴다. */
export const Channel = z.strictObject({ id: z.string(), name: z.string() });
export type Channel = z.infer<typeof Channel>;

/** 채널 이름의 길이 상한. 앞뒤 공백은 떼고, 줄바꿈과 겹친 공백은 공백 하나로 접는다. */
export const MAX_CHANNEL_NAME_CHARS = 80;
/** 메시지 하나의 길이 상한. 앞뒤 공백은 뗀다. */
export const MAX_MESSAGE_CHARS = 4000;
/** 지난 대화를 한 번에 읽는 수. */
export const HISTORY_PAGE = 50;

/**
 * 문답의 답이 본 코드: 러너가 그 턴을 시작할 때 등록한 폴더에 체크아웃되어 있던 것(1단계 질문 A12).
 * `dirty`면 커밋하지 않은 변경(추적하지 않는 새 파일 포함)도 함께 본 답이라 "커밋 + 작업 중 변경"으로 보인다.
 */
export const Source = z.strictObject({
  /** 브랜치. 브랜치가 아니면(detached HEAD) null이다. */
  branch: z.string().nullable(),
  commit: z.string(),
  dirty: z.boolean(),
});
export type Source = z.infer<typeof Source>;

/** 채널 세션의 첫 턴에 넘기는 채널 대화의 최대 수. 그 뒤의 턴은 지난 턴 이후의 것만 넘긴다(구현 3장). */
export const CHANNEL_CONTEXT = 50;

/**
 * 문답의 공개 범위. 비공개(DM)는 묻는 사람만 보고, 공개는 채널의 모두가 본다.
 * DM으로 물은 문답은 비공개로 시작해 주인이 채널에 올리면 공개가 되고, `@호출`은 처음부터 공개다. 공개를 비공개로 되돌리지는 않는다.
 */
export const Visibility = z.enum(["private", "public"]);
export type Visibility = z.infer<typeof Visibility>;

/**
 * 문답 하나: 질문과 그 답, 공개 범위. DM과 `@호출`은 같은 채널 세션이 답하고 공개 범위만 다르다(ADR-0015).
 * `answer`는 답을 기다리는 중(`pending`, 줄을 선 것 포함), 답함, 또는 답하지 못함(`turn_timeout`은 끊긴 답)이다.
 */
export const Qa = z.strictObject({
  /** 워크스페이스 전체에서 늘어나기만 하는 번호. 채널 안의 순서다. */
  id: z.number(),
  channel: z.string(),
  /** 물은 에이전트. 묻는 사람의 에이전트 가운데 하나다. */
  executor: ExecutorId,
  question: z.string(),
  /** 물은 시각 */
  at: z.string(),
  visibility: Visibility,
  answer: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending") }),
    z.strictObject({ state: z.literal("answered"), text: z.string(), source: Source }),
    z.strictObject({ state: z.literal("failed"), error: ContractError }),
  ]),
});
export type Qa = z.infer<typeof Qa>;

/**
 * 채널에 쌓인 것 하나. `id`는 워크스페이스 전체에서 늘어나기만 하는 번호라 채널 안의 순서이자,
 * 실시간 연결이 다시 붙을 때 이어 받을 자리(`webToServer.hello`의 `after`)다.
 * 사람이 쓴 글(`text`)과 공개된 문답(`qa`)이 같은 번호 줄에 선다.
 */
export const ChannelMessage = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    id: z.number(),
    channel: z.string(),
    login: z.string(),
    /** 쓴 사람의 GitHub 프로필 이름. 비워 두었으면 `login`과 같다. */
    name: z.string(),
    /** 쓴 그대로의 글. HTML이 들어 있어도 서버는 바꾸지 않고, 웹은 글자로만 보인다. */
    text: z.string(),
    at: z.string(),
  }),
  /**
   * 공개된 문답: 채널에 올린 DM이나 `@호출`. 질문과 답이 늘 함께 있다. `login`과 `name`은 그 에이전트의 주인(올린 사람)이고,
   * `at`은 채널에 올라온 시각(`@호출`이면 물은 시각)이다. 답이 오면 같은 `id`의 것이 실시간 연결로 다시 온다.
   */
  z.strictObject({
    kind: z.literal("qa"),
    id: z.number(),
    channel: z.string(),
    login: z.string(),
    name: z.string(),
    at: z.string(),
    qa: Qa,
  }),
]);
export type ChannelMessage = z.infer<typeof ChannelMessage>;

/** 러너가 서버에 보내는 것. 이후의 이슈는 자기 메시지를 여기에 더한다. */
export const runnerToServer = {
  /**
   * 붙자마자 보낸다. `repos`는 러너 폴더의 GitHub 원격이 가리키는 레포(`owner/name`)들이다.
   * `executors`는 이 기기에서 러너가 돌릴 수 있는 실행기다. 실행기마다 에이전트가 하나씩 생긴다(ADR-0015).
   */
  hello: z.strictObject({
    session: z.string(),
    repos: z.array(z.string()),
    executors: z.array(ExecutorId),
  }),
  /**
   * 관측. 러너가 지금 보는 작업 전부다: 등록한 폴더와 그 연결된 워크트리마다 체크아웃된 브랜치 하나씩(ADR-0006).
   * 서버는 그 멤버의 작업을 이것으로 바꾼다. 그래서 공유 수준을 낮추면 전에 올린 내용이 서버에서 내려간다.
   * 붙을 때마다, 그리고 관측이 달라질 때마다 보낸다. 브랜치가 아니면(detached HEAD) 작업이 없다.
   */
  observation: z.strictObject({ works: z.array(Work) }),
  /** `ask`(`re`)에 러너 세션이 답했다. 답하지 못했으면 `error`를 `re`를 붙여 보낸다. */
  answer: z.strictObject({ text: z.string(), source: Source }),
  error: ContractError,
} satisfies Payloads;

/** 서버가 러너에 보내는 것. 러너는 여기 있는 종류만 받는다. */
export const serverToRunner = {
  /** hello를 받아들였다. 러너는 이 멤버의 에이전트로, 이 레포에 짝지어졌다. */
  welcome: z.strictObject({ login: z.string(), repo: z.string() }),
  /**
   * 문답. 러너가 받는 요청은 이것뿐이다. 물을 에이전트(`executor`), 채널, 질문, 채널 대화만 오고 도구·폴더·세션은 러너가 정한다.
   * 러너는 채널과 실행기마다 채널 세션 하나를 잇고(ADR-0015), 한 번에 한 턴만 돌리고 나머지는 온 순서대로 줄 세운다.
   * `recent`는 그 채널의 최근 대화(오래된 것부터 `CHANNEL_CONTEXT`개까지)다. 러너는 그 채널 세션의 지난 턴 뒤의 것만
   * 지시가 아닌 데이터로 감싸 넘긴다. 질문은 그 에이전트의 주인이 쓴 것이다.
   */
  ask: z.strictObject({
    executor: ExecutorId,
    channel: Channel,
    message: z.string().min(1),
    recent: z.array(ChannelMessage).max(CHANNEL_CONTEXT),
  }),
  /**
   * 지금 상황: 워크스페이스의 작업 전부(받는 러너의 멤버 것도 포함). `api.works`와 같은 것이다.
   * welcome 바로 뒤에 보내고, 그 뒤로는 달라질 때마다 다시 보낸다. 러너는 받아 두고 훅에 내준다(ADR-0005).
   */
  situation: z.strictObject({ works: z.array(WorkView) }),
  error: ContractError,
} satisfies Payloads;

/**
 * 러너가 붙는 WebSocket 경로. 서버는 hello를 거절하면 `error`를 보낸 뒤 1008로 닫는다.
 * 계약 버전이 달라 거절할 때의 `error`는 `VersionMismatch` 꼴이다.
 * 1008로 닫힌 러너는 다시 붙지 않는다. 그 밖의 이유로 끊기면 다시 붙는다.
 */
export const RUNNER_SOCKET = "/api/runner";

/**
 * 계약 버전이 달라 거절할 때 서버가 보내는 `error`(봉투의 `v`는 서버의 계약 버전이다). ADR-0019.
 * 계약 버전이 다른 러너가 읽으므로 `CONTRACT_VERSION`을 올려도 이 꼴은 바꾸지 않는다. 키는 더하기만 하고,
 * 더한 키를 앞의 러너가 읽을 수 있게 이것만은 모르는 키를 받는다.
 * `version`은 서버의 버전(`git describe --tags`), `contract`는 서버의 계약 버전이다.
 */
export const VersionMismatch = z.object({
  kind: z.literal("error"),
  payload: z.object({
    code: z.literal("version_mismatch"),
    message: z.string(),
    version: z.string(),
    contract: z.number(),
  }),
});

/** `VersionMismatch` 프레임을 만든다. `encode`는 이 계약의 `error`(모르는 키가 없다)만 만들어 따로 둔다. */
export function encodeVersionMismatch(message: string, version: string, re?: string) {
  const refusal: z.infer<typeof VersionMismatch> = {
    kind: "error",
    payload: { code: "version_mismatch", message, version, contract: CONTRACT_VERSION },
  };
  return JSON.stringify({ v: CONTRACT_VERSION, id: crypto.randomUUID(), re, ...refusal });
}

/** HTTP 본문 하나의 상한. 서버는 넘는 것을 읽지 않는다. 더 큰 것이 필요한 이슈가 알고 올린다. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/** 러너 소켓의 프레임 하나의 상한. 서버는 넘는 것을 읽지 않는다. 관측 하나(내용 합계 8MiB와 경로)가 들어가게 잡았다. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type Message<P extends Payloads> = {
  [K in keyof P & string]: {
    v: number;
    id: string;
    re?: string;
    kind: K;
    payload: z.infer<P[K]>;
  };
}[keyof P & string];

/** 보낼 프레임을 만든다. 계약에 없는 종류나 내용은 타입 검사에서 걸리고, 여기서도 던진다. */
export function encode<P extends Payloads, K extends keyof P & string>(
  payloads: P,
  kind: K,
  payload: z.input<P[K]>,
  re?: string,
): string {
  return JSON.stringify({
    v: CONTRACT_VERSION,
    id: crypto.randomUUID(),
    re,
    kind,
    payload: payloads[kind].parse(payload),
  });
}

/** 받은 프레임을 계약으로 읽는다. 계약과 다르면 메시지 대신 돌려보낼 오류를 낸다. */
export function decode<P extends Payloads>(
  payloads: P,
  frame: unknown,
): { message: Message<P> } | { error: ContractError; re?: string } {
  let json: unknown;
  try {
    json = JSON.parse(String(frame));
  } catch {
    return { error: { code: "invalid_message", message: "JSON이 아니다" } };
  }
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) {
    return { error: { code: "invalid_message", message: "봉투가 계약과 다르다" } };
  }
  const { v, id, re, kind } = envelope.data;
  const refuse = (code: ContractError["code"], message: string) => ({
    re: id,
    error: { code, message },
  });
  if (v !== CONTRACT_VERSION) {
    return refuse(
      "version_mismatch",
      `계약 버전이 다르다: 받은 것 ${v}, 여기는 ${CONTRACT_VERSION}`,
    );
  }
  if (!Object.hasOwn(payloads, kind)) {
    return refuse("unknown_kind", `계약에 없는 종류다: ${kind}`);
  }
  const payload = payloads[kind].safeParse(envelope.data.payload);
  if (!payload.success) {
    return refuse("invalid_message", `${kind}의 내용이 계약과 다르다`);
  }
  return { message: { v, id, re, kind, payload: payload.data } as Message<P> };
}

// --- CLI와 러너 사이(같은 기기) ---
// 봉투, `encode`, `decode`는 러너와 서버 사이의 것을 그대로 쓴다.

/**
 * 근처 작업 하나: 고치려는 파일을 바꾸고 있는 다른 멤버의 작업과, 그 파일에서 바꾼 곳.
 * `lines`의 줄 번호는 그 사람의 사본 기준이고(1부터, 끝 포함), 지운 줄만 있는 곳은 그 앞 줄로 적는다.
 * 내용을 읽을 수 없으면 `unknown`과 까닭이다: 공유 수준과 빠진 파일(`ObservedFile.omitted`), 또는 그 사람의 기준 커밋이 이 기기에 없다(`base`).
 */
export const NearbyWork = z.strictObject({
  login: z.string(),
  branch: z.string(),
  offlineSince: z.string().nullable(),
  change: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("lines"),
      ranges: z.array(z.strictObject({ from: z.number(), to: z.number() })),
    }),
    z.strictObject({ kind: z.literal("deleted") }),
    z.strictObject({
      kind: z.literal("unknown"),
      reason: z.enum(["share", "binary", "too_large", "base"]),
    }),
  ]),
});
export type NearbyWork = z.infer<typeof NearbyWork>;

/** CLI와 훅이 러너에 보내는 것. 러너는 문답과 지금 상황 묻기만 받는다. */
export const cliToRunner = {
  /** 터미널에서 묻는다(`omagari runner ask`). 채널 세션과 따로 터미널 세션 하나를 잇는다. */
  ask: z.strictObject({ message: z.string().min(1) }),
  /** 지금 상황을 묻는다. 러너는 서버를 부르지 않고 받아 둔 것으로 바로 답한다. 문답의 줄에 서지 않는다. */
  situation: z.strictObject({ executor: ExecutorId }),
  /**
   * 파일 하나(`path`, 레포 최상위에서 본 경로)의 근처 작업을 묻는다. 편집 전 훅이 고칠 때마다 부른다.
   * `situation`처럼 받아 둔 것으로 바로 답하고, 그 파일을 바꾼 다른 멤버의 작업만 준다.
   */
  nearby: z.strictObject({ path: z.string().min(1), executor: ExecutorId }),
} satisfies Payloads;

/** 러너가 CLI와 훅에 보내는 것. */
export const runnerToCli = {
  answer: runnerToServer.answer,
  /** `situation`의 답. 서버에서 받아 둔 것이 아직 없으면 `error`(`runner_offline`)다. */
  situation: z.strictObject({
    /** 이 러너의 멤버 */
    login: z.string(),
    /** 서버에서 마지막으로 받은 작업 전부 */
    works: z.array(WorkView),
    /** 서버와 끊겼으면 끊긴 시각. `works`는 그 시각까지 받은 것이다. 붙어 있으면 null. */
    disconnectedAt: z.string().nullable(),
    /** 이 러너가 마지막으로 관측한 내 작업들. 공유 수준과 상관없이 바뀐 파일의 경로가 있다(서버로는 수준대로 나간다). */
    mine: z.array(Work),
  }),
  /** `nearby`의 답. 근처 작업이 없으면 `works`가 비어 있다. 받아 둔 것이 아직 없으면 `error`(`runner_offline`)다. */
  nearby: z.strictObject({
    works: z.array(NearbyWork),
    /** `situation`의 것과 같다. */
    disconnectedAt: z.string().nullable(),
  }),
  error: ContractError,
} satisfies Payloads;

// --- 웹이 쓰는 API ---

export type Route = {
  method: "GET" | "POST";
  path: string;
  /** 로그인 없이 부를 수 있다. 없으면 멤버의 세션(`Authorization: Bearer`)이 있어야 한다. */
  public?: true;
  body?: z.ZodType;
  response: z.ZodType;
};
export type BodyOf<R extends Route> = R["body"] extends z.ZodType ? z.output<R["body"]> : undefined;
export type ReplyOf<R extends Route> = z.input<R["response"]>;

/** 웹이 쓰는 API. 이후의 이슈는 자기 경로를 여기에 더한다. */
export const api = {
  health: {
    method: "GET",
    path: "/api/health",
    public: true,
    response: z.strictObject({ contract: z.number() }),
  },
  /** GitHub 기기 인증을 연다. 사람은 `verificationUri`에서 `userCode`를 넣고, 부른 쪽은 `loginPoll`로 기다린다. */
  login: {
    method: "POST",
    path: "/api/login",
    public: true,
    response: z.strictObject({
      device: z.string(),
      userCode: z.string(),
      verificationUri: z.string(),
      intervalMs: z.number(),
    }),
  },
  /**
   * 기기 인증이 끝났는지 본다. 끝났고 그 레포에 push 권한이 있으면 세션을 준다(ADR-0011).
   * GitHub 토큰은 서버에만 남는다. push 권한이 없으면 `forbidden`이다.
   */
  loginPoll: {
    method: "POST",
    path: "/api/login/poll",
    public: true,
    body: z.strictObject({ device: z.string() }),
    response: z.union([
      z.strictObject({ pending: z.literal(true) }),
      z.strictObject({ session: z.string(), login: z.string() }),
    ]),
  },
  /** 이 세션의 멤버와 워크스페이스. 웹은 새로 고친 뒤 남겨 둔 세션이 아직 쓸 수 있는지 이것으로 본다. */
  me: {
    method: "GET",
    path: "/api/me",
    response: z.strictObject({
      login: z.string(),
      /** GitHub 프로필의 이름. 비워 두었으면 `login`과 같다. 로그인할 때 읽는다. */
      name: z.string(),
      /** 워크스페이스의 레포 `owner/name`. 워크스페이스 하나에 레포 하나다(ADR-0012). */
      repo: z.string(),
    }),
  },
  /** 이 세션을 끝낸다. 같은 멤버의 다른 세션(다른 브라우저, CLI와 러너)은 그대로다. */
  logout: {
    method: "POST",
    path: "/api/logout",
    response: z.strictObject({}),
  },
  /**
   * 워크스페이스의 멤버와 그 사람의 접속 상태, 상태 메시지, 에이전트, 작업마다의 상태 한 줄. 이름 순이다.
   * 달라지면 실시간 연결로도 온다. 멤버가 아니면(세션이 없거나 끝났으면) `unauthorized`다.
   */
  members: {
    method: "GET",
    path: "/api/members",
    response: Members,
  },
  /** 멤버들의 작업과 그 관측, 상태 한 줄. 바뀐 파일과 그 내용까지 온다. 멤버만 본다. */
  works: {
    method: "GET",
    path: "/api/works",
    response: z.strictObject({ works: z.array(WorkView) }),
  },
  /**
   * 내 작업(`branch`)의 상태 한 줄을 쓴다. 같은 작업에 다시 쓰면 나중에 쓴 것이 남는다.
   * 그 브랜치가 머지되거나, 관측된 변경이 있다가 0이 되면 지워진다(ADR-0010).
   */
  setStatus: {
    method: "POST",
    path: "/api/status",
    body: z.strictObject({
      branch: z.string().min(1),
      text: z
        .string()
        .transform((text) => text.replace(/\s+/g, " ").trim())
        .pipe(z.string().min(1).max(MAX_STATUS_CHARS)),
    }),
    response: z.strictObject({ text: z.string(), at: z.string() }),
  },
  /**
   * 내 접속 상태를 고른다. `duration`이 지나면 온라인으로 돌아오고, 없으면 직접 바꿀 때까지다(online이면 무시한다).
   * 멤버 목록이 실시간 연결로 모두에게 간다. 답의 `until`은 온라인으로 돌아오는 시각이다.
   */
  setPresence: {
    method: "POST",
    path: "/api/presence",
    body: z.strictObject({ presence: ChosenPresence, duration: PresenceDuration.optional() }),
    response: z.strictObject({ until: z.string().nullable() }),
  },
  /**
   * 내 상태 메시지를 글과 이모지 한 칸으로 쓴다. 둘을 함께 보내고, 빈 글이면 글을, null이면 이모지를 지운다.
   * 이모지 칸에는 이모지 하나(글자 묶음 하나)만 받는다. 따로 만료는 없다. 멤버 목록이 실시간 연결로 모두에게 간다.
   */
  setStatusMessage: {
    method: "POST",
    path: "/api/status-message",
    body: z.strictObject({
      message: z
        .string()
        .transform((text) => text.replace(/\s+/g, " ").trim())
        .refine((text) => Array.from(text).length <= MAX_STATUS_MESSAGE_CHARS, {
          message: `상태 메시지는 ${MAX_STATUS_MESSAGE_CHARS}자까지다`,
        }),
      emoji: z.string().refine(isEmoji, { message: "이모지 칸에는 이모지 하나만 쓴다" }).nullable(),
    }),
    response: z.strictObject({ message: z.string().nullable(), emoji: z.string().nullable() }),
  },
  /**
   * 채널 안에서 `agent`(멤버의 로그인)의 `executor` 에이전트에게 묻는다. 에이전트는 주인만 부른다(`forbidden`).
   * `visibility`가 private(기본)이면 DM, public이면 `@호출`이다. 둘 다 그 채널과 에이전트의 채널 세션이 답한다.
   * 답을 기다리지 않고 답을 기다리는 문답을 돌려준다. 답은 실시간 연결의 `qa`로 묻는 사람에게 오고,
   * `@호출`이면 채널에 선 문답(`message`)도 돌려주고 실시간 연결의 `message`로 모두에게 간다(답이 오면 같은 번호로 다시).
   * 그 에이전트의 러너가 꺼져 있으면 쌓아 두지 않고 바로 `runner_offline`이다. 없는 채널이면 `not_found`.
   */
  ask: {
    method: "POST",
    path: "/api/ask",
    body: z.strictObject({
      agent: z.string(),
      executor: ExecutorId,
      channel: z.string(),
      message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      visibility: Visibility.default("private"),
    }),
    response: z.strictObject({ qa: Qa, message: ChannelMessage.optional() }),
  },
  /**
   * 내 DM의 문답 하나를 채널에 올린다. 질문과 답이 함께 올라가고, 답만 올릴 수는 없다. 공개를 비공개로 되돌리지는 않는다.
   * 답이 온 문답만 올린다(`invalid_request`). 이미 올렸으면 `conflict`. 내 문답이 아니면 있어도 `not_found`다.
   * 채널에 선 문답이 실시간 연결의 `message`로 모두에게, 공개가 된 문답이 `qa`로 나에게 간다.
   */
  postQa: {
    method: "POST",
    path: "/api/qas/post",
    body: z.strictObject({ qa: z.number().int() }),
    response: z.strictObject({ message: ChannelMessage }),
  },
  /**
   * 채널 안의 내 문답(그 채널의 내 채널 세션들이 답한 것). 비공개(DM)와 내가 공개한 것(올린 것, `@호출`)이 함께 온다. 최근 `HISTORY_PAGE`개를 오래된 것부터 준다. 다른 멤버의 DM은 오지 않는다.
   * 읽기지만 채널을 본문에 실으려고 POST다. 없는 채널이면 `not_found`.
   */
  dms: {
    method: "POST",
    path: "/api/dms",
    body: z.strictObject({ channel: z.string() }),
    response: z.strictObject({ qas: z.array(Qa) }),
  },
  /** 채팅 채널 전부, 이름 순서. 멤버만 본다. */
  channels: {
    method: "GET",
    path: "/api/channels",
    response: z.strictObject({ channels: z.array(Channel) }),
  },
  /**
   * 채팅 채널을 만든다. 같은 이름(대소문자를 가리지 않는다)이 있으면 `conflict`다.
   * 실시간 연결이 붙어 있는 웹 모두에 `channel`이 간다.
   */
  createChannel: {
    method: "POST",
    path: "/api/channels",
    body: z.strictObject({
      name: z
        .string()
        .transform((name) => name.replace(/\s+/g, " ").trim())
        .pipe(z.string().min(1).max(MAX_CHANNEL_NAME_CHARS)),
    }),
    response: z.strictObject({ channel: Channel }),
  },
  /**
   * 채널의 지난 대화. `before`(메시지 번호) 앞의 것 가운데 마지막 `HISTORY_PAGE`개를 오래된 것부터 준다.
   * `before`가 없으면 맨 끝에서부터다. 없는 채널이면 `not_found`. 읽기지만 채널을 본문에 실으려고 POST다.
   */
  history: {
    method: "POST",
    path: "/api/channels/history",
    body: z.strictObject({ channel: z.string(), before: z.number().optional() }),
    response: z.strictObject({ messages: z.array(ChannelMessage) }),
  },
  /** 채널에 글을 쓴다. 실시간 연결이 붙어 있는 웹 모두(쓴 사람 것 포함)에 `message`가 간다. */
  send: {
    method: "POST",
    path: "/api/channels/messages",
    body: z.strictObject({
      channel: z.string(),
      text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    }),
    response: z.strictObject({ message: ChannelMessage }),
  },
  /**
   * 지난 `days`일(오늘 포함) 날마다 들어온 멤버 수와 문답 수. 오래된 날부터 오고, 아무 일 없던 날은 0이다(ADR-0018).
   * 날은 `timeZone`(서울)의 자정으로 자른다. 들어온 멤버는 그날 웹을 열었거나 채널에서 읽고 쓴 멤버다.
   * 문답은 그날 서버가 받은 DM과 `@호출`이다. 수만 오고, 누가 무엇을 물었는지는 오지 않는다.
   * 읽기지만 날 수를 본문에 실으려고 POST다.
   */
  metrics: {
    method: "POST",
    path: "/api/metrics",
    body: z.strictObject({ days: z.number().int().min(1).max(366).default(14) }),
    response: z.strictObject({
      timeZone: z.string(),
      days: z.array(
        z.strictObject({
          /** 그 시간대의 날짜 YYYY-MM-DD */
          day: z.string(),
          members: z.number(),
          qas: z.number(),
        }),
      ),
    }),
  },
} satisfies Record<string, Route>;

// --- 웹의 실시간 연결 ---
// 웹은 조작을 HTTP API로 하고, 받는 것만 이 WebSocket으로 받는다(ADR-0014). 봉투, `encode`, `decode`는 러너의 것과 같다.

/** 웹이 실시간으로 받는 WebSocket 경로. */
export const LIVE_SOCKET = "/api/live";

/** 웹이 실시간 연결에 보내는 것. 붙자마자 hello 하나만 보낸다. */
export const webToServer = {
  /**
   * 브라우저의 WebSocket은 머리말을 싣지 못해 세션을 여기에 싣는다.
   * `after`는 지난 연결에서 마지막으로 받은 메시지 번호(또는 그 연결의 welcome `seq`)다.
   * 주면 그 뒤에 쌓인 메시지를 끊긴 사이의 것까지 다시 받는다. 처음 붙을 때는 주지 않는다.
   */
  hello: z.strictObject({ session: z.string(), after: z.number().int().nonnegative().optional() }),
} satisfies Payloads;

/** 서버가 웹의 실시간 연결에 보내는 것. 세션이 없거나 끝나면 `error`를 보낸 뒤 1008로 닫는다. */
export const serverToWeb = {
  /** hello를 받아들였다. `seq`는 지금 마지막 메시지 번호다. 다음에 다시 붙을 때 `after`로 쓴다. */
  welcome: z.strictObject({ seq: z.number() }),
  /**
   * 채널에 새로 쌓인 것. welcome 바로 뒤에 `after` 뒤의 것을 번호 순서대로 보내고, 그 뒤로는 쌓이는 대로 보낸다.
   * 공개된 문답에 답이 오면 같은 번호의 것을 다시 보낸다. 끊긴 사이에 답이 온 것도 welcome 뒤에 다시 보낸다.
   */
  message: ChannelMessage,
  /** 새 채널이 생겼다. 끊긴 사이에 생긴 채널은 다시 보내지 않으니, 다시 붙으면 `api.channels`를 읽는다. */
  channel: Channel,
  /** 멤버 목록 전부(`api.members`와 같다). 붙을 때마다 welcome 뒤에 한 번, 그 뒤로는 달라질 때마다 보낸다. */
  members: Members,
  /**
   * 내 문답이 생겼거나, 답이 왔거나, 채널에 올렸다(`api.ask`, `api.dms`의 것과 같다). 묻는 사람의 연결에만 간다.
   * 공개된 문답은 채널의 모두에게 `message`(kind `qa`)로도 간다. 끊긴 사이의 것은 다시 보내지 않으니, 다시 붙으면 `api.dms`를 읽는다.
   */
  qa: Qa,
  error: ContractError,
} satisfies Payloads;

/** API 하나를 부른다. 웹, CLI, 테스트가 같이 쓴다. 오류 답은 `ContractFailure`로 던진다. */
export async function call<R extends Route>(
  server: { url: string; session?: string },
  route: R,
  ...[body]: R["body"] extends z.ZodType ? [z.input<R["body"]>] : []
): Promise<z.output<R["response"]>> {
  const headers: Record<string, string> = {};
  if (server.session) headers.authorization = `Bearer ${server.session}`;
  if (route.body) headers["content-type"] = "application/json";
  const response = await fetch(new URL(route.path, server.url), {
    method: route.method,
    headers,
    ...(route.body && { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const failure = z.strictObject({ error: ContractError }).safeParse(json);
    throw new ContractFailure(
      failure.data?.error ?? { code: "internal", message: `HTTP ${response.status}` },
    );
  }
  return route.response.parse(json) as z.output<R["response"]>;
}

/** "3분 전"처럼 지금에서 거슬러 센 시간. 상태 한 줄의 쓴 시각과 오프라인의 기준 시각에 붙인다. */
export function ago(iso: string) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / (24 * 60))}일 전`;
}
