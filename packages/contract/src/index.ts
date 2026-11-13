// 계약: 러너와 서버가 주고받는 메시지, 웹이 쓰는 API. 모든 조각이 이 정의 하나를 쓴다.
// 객체는 모두 `z.strictObject`로 적는다. 계약에 없는 종류도, 계약에 없는 키도 받지 않는다.
import * as z from "zod";

/** 계약의 버전. 봉투마다 싣고, 다르면 받지 않는다. 계약을 깨는 변경마다 올린다. */
export const CONTRACT_VERSION = 24;

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
    "refused", // 받는 쪽이 남의 질문에 답하지 않게 해 두었다(ADR-0024)
    "turn_timeout", // 러너 세션의 한 턴이 시간 상한을 넘어 끊겼다
    "conflict", // 이미 있다(같은 이름의 채널)
    "github_failed", // GitHub이 요청을 받지 않았다(멤버의 토큰이 무효, 권한 없음, GitHub이 답하지 못함)
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
 * declared는 바뀐 파일의 경로를 모두 올리고 내용은 그 작업이 선점한 경로 안의 것만, intent는 작업(브랜치)과 상태 한 줄만 올린다.
 * 선점은 공유 수준과 상관없이 올라간다.
 */
export const ShareLevel = z.enum(["full", "declared", "intent"]);
export type ShareLevel = z.infer<typeof ShareLevel>;

/**
 * 관측한 파일 하나: 지금 내용, 지운 파일, 또는 경로만 보낸 파일과 그 까닭.
 * `binary`는 글이 아니거나(UTF-8이 아니거나 NUL이 있다) 파일이 아니거나 읽지 못한 것,
 * `too_large`는 파일 하나의 상한이나 합계의 상한을 넘은 것(ADR-0007),
 * `share`는 공유 수준이 내용을 내보내지 않는 것이다.
 */
/**
 * 정의 줄 하나: 이름 붙은 심볼을 선언하는 줄(GLOSSARY). 러너가 tree-sitter로 TypeScript, TSX, JavaScript 파일에서 뽑는다(ADR-0026).
 * 메서드의 이름은 `클래스.메서드`다. `line`은 그 작업의 사본에서의 줄(1부터)이고, `removed`면 기준 커밋의 판에서의 줄이다.
 * `change`는 기준 커밋의 판과 견준 것이다: 새로 생겼다(`added`), 정의 줄이 바뀌었다(`changed`), 없어졌다(`removed`).
 * 없으면 정의 줄이 그대로다(본문만 바뀐 것 포함).
 */
export const Definition = z.strictObject({
  name: z.string(),
  kind: z.enum(["function", "method", "class", "interface", "type", "enum"]),
  line: z.number().int().positive(),
  change: z.enum(["added", "changed", "removed"]).optional(),
});
export type Definition = z.infer<typeof Definition>;

/** 사람이 읽는 정의의 종류. */
export const DEFINITION_KINDS = {
  function: "함수",
  method: "메서드",
  class: "클래스",
  interface: "인터페이스",
  type: "타입",
  enum: "열거형",
} as const satisfies Record<Definition["kind"], string>;

export const ObservedFile = z.union([
  z.strictObject({
    path: z.string(),
    content: z.string(),
    /** 이 파일의 정의 줄. 내용을 올리는 파일 가운데 읽을 수 있는 언어이고 정의가 있을 때만 있다. */
    definitions: z.array(Definition).optional(),
  }),
  z.strictObject({
    path: z.string(),
    deleted: z.literal(true),
    /** 기준 커밋의 판에 있던 정의 줄(모두 `removed`). 내용을 올리는 경로(full, declared의 선점한 경로)일 때만 있다. */
    definitions: z.array(Definition).optional(),
  }),
  z.strictObject({ path: z.string(), omitted: z.enum(["binary", "too_large", "share"]) }),
]);
export type ObservedFile = z.infer<typeof ObservedFile>;

/**
 * 작업 하나(멤버 + 브랜치)의 관측. 기준 커밋 이후 그 브랜치가 바꾼 파일이다: 커밋한 것, 안 한 것, 추적하지 않는 새 파일.
 * 경로는 그 작업 폴더(등록한 폴더나 연결된 워크트리)의 최상위에서 본 것이다. 정의 줄은 내용과 같은 규칙으로 싣는다(ADR-0026).
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
 * 실행기가 고를 수 있게 알린 모델 하나. `id`는 실행기에 그대로 넘기는 값, `name`은 사람이 읽는 이름이다.
 * `efforts`는 이 모델에 고를 수 있는 effort 값이고, 비어 있으면 effort를 고르지 않는다.
 */
export const ModelChoice = z.strictObject({
  id: z.string(),
  name: z.string(),
  efforts: z.array(z.string()),
});
export type ModelChoice = z.infer<typeof ModelChoice>;

/**
 * 실행기 하나의 고를 거리(ADR-0020). 러너가 붙을 때 실행기에 물어 알린다. 실행기마다 다르고, 모델에 따라 effort 값도 다르다.
 * `efforts`는 모델을 "기본"(실행기 자기 설정)으로 둘 때 고를 수 있는 effort 값이다. 알리지 못했으면 둘 다 비어 있다.
 */
export const Choices = z.strictObject({
  models: z.array(ModelChoice),
  efforts: z.array(z.string()),
});
export type Choices = z.infer<typeof Choices>;

/**
 * 문답에 고른 모델과 effort. 없는 것은 "기본"이라 실행기 자기 설정을 따른다. 러너는 알린 고를 거리에 없는 값이면 실행기를 띄우지 않는다.
 */
export const ModelPick = z.strictObject({
  model: z.string().optional(),
  effort: z.string().optional(),
});
export type ModelPick = z.infer<typeof ModelPick>;

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
   * `choices`는 붙어 있는 러너가 그 실행기에 물어 알린 고를 거리다. 주인의 DM 입력 칸이 쓴다. 꺼져 있으면 비어 있다.
   */
  agents: z.array(
    z.strictObject({
      executor: ExecutorId,
      state: z.enum(["online", "answering", "offline"]),
      choices: Choices,
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
      /** 이 작업에 직접 충돌(줄이 부딪히는 것이 확인된 알림)이 걸려 있다. 풀리면 false로 돌아온다. */
      conflict: z.boolean(),
    }),
  ),
});
export type MemberView = z.infer<typeof MemberView>;

/** 멤버 목록 전부, 이름 순. `api.members`의 답이고, 실시간 연결의 `members`로도 온다. */
export const Members = z.strictObject({ members: z.array(MemberView) });

/**
 * 채널의 종류(ADR-0027). 채팅 채널은 멤버 모두가 읽고 쓴다. 포럼 채널에는 Omagari가 알림 하나를 포스트 하나로 올리고,
 * 사람은 포럼에 쓰지 못하고 포스트 안에서만 쓴다. 사람이 만드는 채널은 채팅이고, 지금 포럼은 "부딪힘" 하나다.
 */
export const ChannelKind = z.enum(["chat", "forum"]);
export type ChannelKind = z.infer<typeof ChannelKind>;
/** 채널. 워크스페이스의 멤버 모두가 읽는다. */
export const Channel = z.strictObject({ id: z.string(), name: z.string(), kind: ChannelKind });
export type Channel = z.infer<typeof Channel>;

/** 채널 이름의 길이 상한. 앞뒤 공백은 떼고, 줄바꿈과 겹친 공백은 공백 하나로 접는다. */
export const MAX_CHANNEL_NAME_CHARS = 80;
/** 메시지 하나의 길이 상한. 앞뒤 공백은 뗀다. */
export const MAX_MESSAGE_CHARS = 4000;
/** 문답을 채널에 올리며 함께 쓰는 글. 글 메시지처럼 앞뒤 공백을 떼고 길이를 막되, 비면 없는 것이다. */
const Note = z
  .string()
  .trim()
  .max(MAX_MESSAGE_CHARS)
  .optional()
  .transform((text) => text || undefined);
/** 피드에서 한 번에 읽는 최근 소식의 수. */
export const FEED_PAGE = 20;
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

/**
 * 러너 세션의 답. `model`은 답한 모델의 사람이 읽는 이름, `effort`는 그 턴에 고른 effort다.
 * "기본"으로 물어 실행기가 실제 모델을 알려 주지 않았거나 effort를 고르지 않았으면 없다(모르면 배지를 달지 않는다).
 */
const Reply = z.strictObject({
  text: z.string(),
  source: Source,
  model: z.string().optional(),
  effort: z.string().optional(),
});

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
    z.strictObject({ state: z.literal("answered"), ...Reply.shape }),
    z.strictObject({ state: z.literal("failed"), error: ContractError }),
  ]),
});
export type Qa = z.infer<typeof Qa>;

/** 줄 범위 하나. 1부터 세고 끝을 포함한다. 지운 줄만 있는 곳은 그 앞 줄로 적는다. */
export const LineRange = z.strictObject({ from: z.number(), to: z.number() });
export type LineRange = z.infer<typeof LineRange>;

/**
 * 남의 파일 내용을 읽을 수 없는 까닭: 공유 수준과 빠진 파일(`ObservedFile.omitted`), 또는 그 사람의 기준 커밋이 이 기기에 없다(`base`).
 */
export const Unreadable = z.enum(["share", "binary", "too_large", "base"]);
export type Unreadable = z.infer<typeof Unreadable>;

/** 알림이 가리키는 작업 하나. `name`은 그 멤버의 GitHub 프로필 이름이다(비워 두었으면 `login`). */
export const WorkRef = z.strictObject({ login: z.string(), name: z.string(), branch: z.string() });
export type WorkRef = z.infer<typeof WorkRef>;

/**
 * 알림에 묶인 파일 하나. `lines`는 합치면 부딪히는 줄이고 `works`와 같은 순서로 두 작업 각자의 사본 기준이다.
 * 한쪽이 지우고 다른 쪽이 고쳤으면 줄 없이 부딪힌다. 상대의 내용을 읽을 수 없으면 `unknown`과 까닭이고, "부딪힐 수 있음"이다.
 */
export const AlertFile = z.union([
  z.strictObject({ path: z.string(), lines: z.tuple([z.array(LineRange), z.array(LineRange)]) }),
  z.strictObject({ path: z.string(), unknown: Unreadable }),
]);
export type AlertFile = z.infer<typeof AlertFile>;

/** 알림 하나에 이름을 적는 파일(심볼 알림이면 심볼)의 수. 넘는 것은 `more`로 센다(Room과 같다). */
export const ALERT_FILES = 8;

/**
 * 심볼이 한 작업에 있는 곳 하나. `line`은 그 작업의 사본 기준이다(`removed`면 기준 커밋의 판).
 * `uses`는 그 심볼을 쓰는 곳이고, 나머지는 그 작업의 정의 줄의 변경(`Definition.change`)이다.
 */
export const SymbolPlace = z.strictObject({
  path: z.string(),
  line: z.number().int().positive(),
  role: z.enum(["added", "changed", "removed", "uses", "declared"]),
});
export type SymbolPlace = z.infer<typeof SymbolPlace>;

/** 사람이 읽는 심볼의 곳. */
export const PLACE_ROLES = {
  added: "새로 만듦",
  changed: "정의 줄 바꿈",
  removed: "없앰",
  uses: "씀",
  declared: "바꾸겠다고 선언함",
} as const satisfies Record<SymbolPlace["role"], string>;

/**
 * 바꿀 계약(구현 4장, Room의 선점 계획): 선점에 붙여 코드를 바꾸기 전에 알린다. 종류는 이름 바꾸기, 시그니처 변경, 삭제, 추가다.
 * `symbol`은 바꿀 심볼의 이름(메서드는 `클래스.메서드`), `detail`은 무엇으로 바꾸는지 사람이 쓴 한 줄이다.
 */
export const Plan = z.strictObject({
  kind: z.enum(["rename", "signature", "delete", "add"]),
  symbol: z.string().min(1),
  detail: z.string().max(MAX_STATUS_CHARS).optional(),
});
export type Plan = z.infer<typeof Plan>;

/** 사람이 읽는 계획의 종류. */
export const PLAN_KINDS = {
  rename: "이름 바꾸기",
  signature: "시그니처 변경",
  delete: "삭제",
  add: "추가",
} as const satisfies Record<Plan["kind"], string>;

/**
 * 알림에 묶인 심볼 하나. `places`는 `works`와 같은 순서로 두 작업 각자의 곳이다.
 * 간접 충돌(추정)은 한 작업이 정의 줄을 바꾸거나 없앴고(`changed`, `removed`) 다른 작업이 그 이름을 쓴다(`uses`).
 * 서로 상대가 바꾼 것을 쓰면 같은 이름이 방향마다 하나씩 있다. 중복 구현은 두 작업 모두 새로 만들었다(`added`).
 * 선언된 계약 변경은 한 작업이 선점에 계획(`plan`)을 붙였고(`declared`, 선점한 곳) 다른 작업이 그 이름을 쓴다(`uses`). 코드가 아직 바뀌지 않았어도 온다.
 */
export const AlertSymbol = z.strictObject({
  name: z.string(),
  places: z.tuple([z.array(SymbolPlace), z.array(SymbolPlace)]),
  /** 선언된 계약 변경에만 있다: 선언한 계획. */
  plan: Plan.optional(),
});
export type AlertSymbol = z.infer<typeof AlertSymbol>;

/** 사람이 읽는 알림의 종류. 간접 충돌은 이름으로만 이어 잘못 이을 수 있어 "추정"이다(ADR-0023). */
export const ALERT_KINDS = {
  direct: "직접 충돌",
  indirect: "간접 충돌(추정)",
  duplicate: "중복 구현",
  declared: "선언된 계약 변경",
} as const satisfies Record<Alert["kind"], string>;

const alertCommon = {
  works: z.tuple([WorkRef, WorkRef]),
  more: z.number(),
  resolved: z.string().nullable(),
};

/**
 * 알림: 두 작업 한 쌍과 부딪힘의 종류마다 하나(ADR-0023). 종류는 직접 충돌(`direct`), 간접 충돌(추정, `indirect`), 중복 구현(`duplicate`),
 * 선언된 계약 변경(`declared`)이다.
 * 러너들이 계산해 올린 것을 서버가 묶는다. 부딪힘이 바뀌면 같은 알림이 고쳐지고, 다 풀리면 `resolved`(풀린 시각)가 한 번 적히고 닫힌다.
 * 닫힌 뒤 다시 부딪히면 새 알림이다. 직접 충돌의 `files`는 부딪히는 것이 확인된 파일부터 경로 순으로, 나머지 둘의 `symbols`는 이름 순으로
 * `ALERT_FILES`개까지 적고, 나머지는 `more`다.
 */
export const Alert = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct"),
    ...alertCommon,
    files: z.array(AlertFile).max(ALERT_FILES),
  }),
  z.strictObject({
    kind: z.enum(["indirect", "duplicate", "declared"]),
    ...alertCommon,
    symbols: z.array(AlertSymbol).max(ALERT_FILES),
  }),
]);
export type Alert = z.infer<typeof Alert>;

/**
 * 선점 하나(ADR-0008): 작업(멤버 + 브랜치)이 고칠 곳. 아무것도 막지 않고 알리기만 한다.
 * 단위는 심볼(정의 이름으로 찾은 줄 범위), 줄 범위, 파일 전체(기준 커밋에 없던 새 파일), 폴더(`path`가 `/`로 끝난다)다.
 * `path`는 레포 최상위에서 본 경로, `lines`는 선점한 사람의 사본에서 건 때의 줄(1부터, 끝 포함)이고 심볼과 줄 범위에만 있다.
 * `id`는 서버 전체에서 늘어나기만 하는 번호다. `stale`은 주인이 오프라인으로 오래(7일) 있어 "오래됨"으로 보이는 것이고, 그 뒤 7일이면 지워진다.
 * 브랜치가 머지되거나 지워지면 저절로 풀린다. `plan`은 붙인 계획(바꿀 계약)이다. 한 작업에서 같은 심볼의 계획은 하나이고, 새로 걸면 옛 것을 대체한다.
 */
export const Claim = z.strictObject({
  id: z.number(),
  login: z.string(),
  branch: z.string(),
  path: z.string(),
  unit: z.enum(["symbol", "lines", "file", "folder"]),
  symbol: z.string().optional(),
  lines: LineRange.optional(),
  at: z.string(),
  stale: z.boolean(),
  plan: Plan.optional(),
});
export type Claim = z.infer<typeof Claim>;

/**
 * 내 사본에서 본 남의 선점. `lines`는 상대의 판과 내 판의 줄 차이로 옮긴 내 사본의 줄이다.
 * 상대의 판을 읽을 수 없으면(공유 수준, 빠진 파일, 내 기기에 없는 기준 커밋) 상대의 줄 그대로이고 `approx`("대략")다.
 */
export const SeenClaim = z.strictObject({ ...Claim.shape, approx: z.boolean() });
export type SeenClaim = z.infer<typeof SeenClaim>;

/** 선점을 걸 곳: 경로와, 심볼 이름이나 줄 범위 가운데 하나. 둘 다 없으면 새 파일의 전체나 폴더(`/`로 끝나거나 있는 폴더)다. */
const ClaimTarget = z.strictObject({
  branch: z.string().min(1),
  path: z.string().min(1),
  symbol: z.string().min(1).optional(),
  lines: LineRange.optional(),
});

/**
 * 편지함에 넣어 둔 소식을 넘겨준 것이 확인되지 않아도 남겨 두는 시간. 지나면 만료한다(Room의 14일, 2단계 질문 A7).
 * 묻기의 답(ADR-0024)도 같은 시간을 쓴다.
 */
export const INBOX_MS = 14 * 24 * 60 * 60_000;

/**
 * 편지함의 소식 하나(GLOSSARY): 작업(`branch`, 받는 러너의 멤버의 것)의 에이전트에게 직접 넘겨줄 것. 종류는 내 작업과의 부딪힘 알림(네 종류 모두), 내 선점과 겹친 선점, 내가 쓰는 계약의 선언된 변경의 취소다.
 * 알림이 생기고, 바뀌고, 풀릴 때마다 두 작업의 편지함에 들어간다. 아직 넘겨주지 않은 같은 알림의 소식은 새 것으로 바뀐다(`id`도 새로 받는다).
 * `id`는 서버 전체에서 늘어나기만 하는 번호이고 넘겨준 확인(`delivered`)이 가리킨다. `at`은 들어온 시각, `alert`는 들어온 때의 알림이다.
 */
const InboxHead = { id: z.number(), branch: z.string(), at: z.string() };

/** 묻기에서 남의 질문을 담는 길이 상한. 채널 메시지와 같다. */
export const MAX_QUESTION_CHARS = 4000;

/**
 * 묻기(ADR-0024)의 질문 하나. 묻는 작업의 에이전트가 다른 멤버(`to`)의 에이전트에게 보낸 것이다. `id`는 서버 전체에서 늘어나기만 하는 번호다.
 * `executor`는 답하는(답할) 받는 쪽 실행기다. 묻는 쪽이 고르지 않았고 아직 보내지 못했으면 null이다.
 */
export const Question = z.strictObject({
  id: z.number(),
  to: z.string(),
  executor: ExecutorId.nullable(),
  text: z.string(),
  at: z.string(),
});
export type Question = z.infer<typeof Question>;
export const InboxItem = z.discriminatedUnion("kind", [
  z.strictObject({ ...InboxHead, kind: z.literal("alert"), alert: Alert }),
  /** 내 선점(`mine`)과 다른 작업의 선점(`theirs`)이 겹친다. 줄은 각자의 사본에서 건 때의 것이다. 나중에 건 쪽이 알아내 양쪽에 넣는다. */
  z.strictObject({ ...InboxHead, kind: z.literal("overlap"), mine: Claim, theirs: Claim }),
  /**
   * 이 작업이 물은 질문(`omagari ask`)의 답. 받는 쪽 러너 세션이 답했거나, 답하지 못했다(`error`: 실행기 실패, 받는 쪽이 그사이 스위치를 끔).
   * 14일 안에 답이 오지 않은 질문은 소식 없이 만료한다.
   */
  z.strictObject({
    ...InboxHead,
    kind: z.literal("answer"),
    question: Question,
    answer: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("answered"), ...Reply.shape }),
      z.strictObject({ state: z.literal("failed"), error: ContractError }),
    ]),
  }),
  /**
   * 다른 작업이 계획(`claim.plan`)을 이루지 못한 채 선점을 풀었다: 그 선언된 계약 변경은 취소됐다. 그 계획의 알림을 받은 작업에 넣는다.
   * 정의 줄이 계획대로 바뀐 뒤 풀었거나 브랜치가 머지되어 풀린 것은 취소가 아니다.
   */
  z.strictObject({ ...InboxHead, kind: z.literal("cancelled"), claim: Claim }),
]);
export type InboxItem = z.infer<typeof InboxItem>;

/**
 * 알림의 포스트(ADR-0027). 알림 하나에 포스트 하나이고, 알림이 포럼에 올라올 때 함께 생긴다. 포스트의 첫 글이 그 알림이다.
 * 포스트는 채널처럼 동작한다: `channel`을 채널 자리에 넣어 글 쓰기, 지난 대화, DM, `@호출`, 채널에 올리기를 그대로 쓴다.
 * 채널 목록(`api.channels`)에는 없다. `alert`는 알림이 선 채널 메시지의 번호, `count`는 포스트에 선 글(글과 공개된 문답)의 수다.
 * 포럼 목록이 그리는 요약도 여기 있다: `last`는 마지막 글(알림은 빼고, 글이 없으면 `null`)의 쓴 사람과 한 줄,
 * `activity`는 마지막 글이 선 시각(글이 없으면 알림이 올라온 시각)이다. 올라온 시각은 알림 메시지의 `at`이다.
 */
export const Post = z.strictObject({
  channel: z.string(),
  alert: z.number(),
  count: z.number(),
  last: z.strictObject({ login: z.string(), name: z.string(), line: z.string() }).nullable(),
  activity: z.string(),
});
export type Post = z.infer<typeof Post>;

/** 결정 PR의 이의 창(ADR-0025). "바로"면 PR을 열자마자 Omagari가 머지한다. "하루"는 기본이다. */
export const DecisionWindow = z.enum(["now", "day"]);
export type DecisionWindow = z.infer<typeof DecisionWindow>;

/**
 * 포스트에서 정리한 결정 하나와 그 결정 PR(ADR-0025). 정리한 멤버(`login`)의 이름으로 레포의 기본 브랜치에 PR이 열린다.
 * `state`는 PR에서 읽는다: 열려 있으면 제안됨(`proposed`), 머지되면 수락됨(`accepted`), 머지 없이 닫히면 `closed`다.
 * `post`는 포스트의 채널, `path`는 결정 파일(`docs/decisions/NNNN-제목.md`)이다.
 */
export const Decision = z.strictObject({
  id: z.number(),
  post: z.string(),
  login: z.string(),
  name: z.string(),
  title: z.string(),
  path: z.string(),
  pull: z.strictObject({ number: z.number(), url: z.string() }),
  window: DecisionWindow,
  state: z.enum(["proposed", "accepted", "closed"]),
  at: z.string(),
});
export type Decision = z.infer<typeof Decision>;

/**
 * 채널에 쌓인 것 하나. `id`는 워크스페이스 전체에서 늘어나기만 하는 번호라 채널 안의 순서이자,
 * 실시간 연결이 다시 붙을 때 이어 받을 자리(`webToServer.hello`의 `after`)다.
 * 사람이 쓴 글(`text`)과 공개된 문답(`qa`), Omagari가 올린 알림(`alert`)이 같은 번호 줄에 선다.
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
   * `text`는 올린 사람이 함께 쓴 글이다. 글 없이 올렸거나 `@호출`이면 없다. 글 메시지의 `text`처럼 웹은 글자로만 보인다.
   */
  z.strictObject({
    kind: z.literal("qa"),
    id: z.number(),
    channel: z.string(),
    login: z.string(),
    name: z.string(),
    at: z.string(),
    text: z.string().optional(),
    qa: Qa,
  }),
  /**
   * Omagari가 올린 알림. 쓴 사람이 없다. 알림이 고쳐지거나 풀리거나 포스트의 글 수가 바뀌면 같은 `id`의 것이 실시간 연결로 다시 온다.
   * `channel`은 올린 포럼이고, `at`은 처음 올린 시각이다. `post`는 이 알림의 포스트의 채널과 글 수다.
   */
  z.strictObject({
    kind: z.literal("alert"),
    id: z.number(),
    channel: z.string(),
    at: z.string(),
    alert: Alert,
    post: Post.omit({ alert: true }),
  }),
  /**
   * Omagari가 올린 결정 PR의 한 줄. 결정의 포스트와 알림 채널에 같은 것이 하나씩 선다. 쓴 사람이 없다.
   * `event`는 그때 일어난 일이다: PR이 열렸다, 머지됐다, 머지 없이 닫혔다, Omagari가 머지하려 했으나 GitHub이 막았다(`reason`이 그 까닭).
   * `decision`은 읽은 때의 결정이라, 지난 줄이어도 `state`는 지금의 것이다. 포스트의 글 수에 들지 않는다.
   */
  z.strictObject({
    kind: z.literal("decision"),
    id: z.number(),
    channel: z.string(),
    at: z.string(),
    event: z.enum(["opened", "merged", "closed", "blocked"]),
    reason: z.string().optional(),
    decision: Decision,
  }),
]);
export type ChannelMessage = z.infer<typeof ChannelMessage>;

/**
 * 결정 초안의 네 칸(ADR-0028). 결정 기록(Nygard의 ADR)의 꼴을 따른다. 무엇을 담는지는 러너가 실행기에 주는 지시문에 있다.
 */
export const DraftFields = z.strictObject({
  title: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
});
export type DraftFields = z.infer<typeof DraftFields>;

/**
 * 결정 초안 하나: 포스트(`post`, 포스트의 채널)의 글과 문답을 내 에이전트가 읽고 쓴 것(ADR-0028). 저장하지 않는 제안이라 서버가 꺼지면 잃는다.
 * `id`는 서버가 정한 것이고 멈출 때(`api.stopDraft`) 쓴다. `read`는 에이전트에 넘긴 포스트의 글(`texts`)과 공개된 문답(`qas`)의 수다.
 * `state`는 쓰는 중, 다 씀(`drafted`, 답한 모델과 effort가 붙는다, `Reply`와 같다), 멈춤, 쓰지 못함이다.
 */
export const Draft = z.strictObject({
  id: z.string(),
  post: z.string(),
  executor: ExecutorId,
  read: z.strictObject({ texts: z.number(), qas: z.number() }),
  state: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending") }),
    z.strictObject({
      state: z.literal("drafted"),
      ...DraftFields.shape,
      model: z.string().optional(),
      effort: z.string().optional(),
    }),
    z.strictObject({ state: z.literal("stopped") }),
    z.strictObject({ state: z.literal("failed"), error: ContractError }),
  ]),
});
export type Draft = z.infer<typeof Draft>;

const pairCommon = {
  branch: z.string(),
  theirs: z.strictObject({ login: z.string(), branch: z.string() }),
};
/**
 * 러너가 계산한 부딪힘의 한 쌍: 이 러너의 작업(`branch`)과 다른 멤버의 작업(`theirs`).
 * 직접 충돌은 부딪히거나 읽을 수 없는 파일들, 간접 충돌(추정)과 중복 구현은 심볼들이다.
 * 간접 충돌은 상대가 정의 줄을 바꾼 심볼을 이 러너의 사본에서 쓰는 방향만 싣는다(반대 방향은 상대 러너가 계산한다).
 * 선언된 계약 변경도 같다: 상대의 선점에 붙은 계획의 심볼을 이 러너의 사본에서 쓰는 방향만 싣고, `plan`을 단다.
 */
export const ConflictPair = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct"),
    ...pairCommon,
    /** `mine`은 이 러너의 사본, `theirs`는 상대의 사본 기준 줄이다. */
    files: z.array(
      z.union([
        z.strictObject({ path: z.string(), mine: z.array(LineRange), theirs: z.array(LineRange) }),
        z.strictObject({ path: z.string(), unknown: Unreadable }),
      ]),
    ),
  }),
  z.strictObject({
    kind: z.enum(["indirect", "duplicate", "declared"]),
    ...pairCommon,
    symbols: z.array(
      z.strictObject({
        name: z.string(),
        mine: z.array(SymbolPlace),
        theirs: z.array(SymbolPlace),
        plan: Plan.optional(),
      }),
    ),
  }),
]);
export type ConflictPair = z.infer<typeof ConflictPair>;

/** 러너가 서버에 보내는 것. 이후의 이슈는 자기 메시지를 여기에 더한다. */
export const runnerToServer = {
  /**
   * 붙자마자 보낸다. `repos`는 러너 폴더의 GitHub 원격이 가리키는 레포(`owner/name`)들이다.
   * `executors`는 이 기기에서 러너가 돌릴 수 있는 실행기다. 실행기마다 에이전트가 하나씩 생긴다(ADR-0015).
   * `choices`는 실행기마다 고를 거리다. 실행기에 묻지 못한 것은 빠진다(ADR-0020).
   */
  hello: z.strictObject({
    session: z.string(),
    repos: z.array(z.string()),
    executors: z.array(ExecutorId),
    choices: z.partialRecord(ExecutorId, Choices),
  }),
  /**
   * 관측. 러너가 지금 보는 작업 전부다: 등록한 폴더와 그 연결된 워크트리마다 체크아웃된 브랜치 하나씩(ADR-0006).
   * 서버는 그 멤버의 작업을 이것으로 바꾼다. 그래서 공유 수준을 낮추면 전에 올린 내용이 서버에서 내려간다.
   * 붙을 때마다, 그리고 관측이 달라질 때마다 보낸다. 브랜치가 아니면(detached HEAD) 작업이 없다.
   */
  observation: z.strictObject({ works: z.array(Work) }),
  /**
   * 부딪힘의 계산(ADR-0023). 직접 충돌은 이 러너의 작업과 다른 멤버의 작업이 함께 바꾼 파일을, 두 작업의 기준 커밋이 갈라진 지점의 판을 조상으로
   * `git merge-file`로 합쳐 본 결과다. 줄이 부딪히거나 상대 내용을 읽을 수 없는 파일이 있는 쌍만 싣는다. 실리지 않은 쌍은 깨끗하다.
   * 간접 충돌(추정)은 상대가 정의 줄을 바꾸거나 없앤 심볼을 내 작업의 사본에서 이름으로 찾은 것, 중복 구현은 두 작업에 같은 이름의 새 정의가 생긴 것이다.
   * 한 쌍과 종류마다 하나다.
   * 서버는 이 러너의 계산을 이것으로 바꾼다. 붙을 때마다 한 번(비어 있어도), 그 뒤로는 달라질 때마다 보낸다. 공유 수준이 intent인 작업은 싣지 않는다.
   */
  conflicts: z.strictObject({ pairs: z.array(ConflictPair) }),
  /**
   * 편지함의 소식을 작업 세션이나 CLI에 넘겼다(`inbox`의 `id`들). 서버는 그 멤버의 것만 지운다.
   * 서버와 끊긴 사이에 넘긴 것은 다시 붙자마자 보낸다. 서브에이전트에게 보여 준 것은 넘긴 것으로 치지 않아 싣지 않는다.
   */
  delivered: z.strictObject({ ids: z.array(z.number()) }),
  /**
   * 선점을 건다(ADR-0008). 서버는 늘 받고 `claimed`(`re`)로 건 선점을 돌려준다. 같은 작업에 같은 곳(경로, 심볼, 줄)의 선점이 있으면 바꾼다.
   * `overlaps`는 러너가 내 사본의 줄로 옮겨 보고 겹친다고 찾은 남의 선점(`Claim.id`)이다. 서버는 양쪽 작업의 편지함에 겹침을 넣는다.
   * `unit`과 `lines`는 러너가 정한다(심볼은 정의를 찾은 줄 범위, 새 파일은 파일 전체).
   * `plan`을 붙이면 같은 작업의 같은 심볼에 붙은 옛 계획을 대체한다.
   */
  claim: z.strictObject({
    branch: z.string(),
    path: z.string(),
    unit: Claim.shape.unit,
    symbol: z.string().optional(),
    lines: LineRange.optional(),
    overlaps: z.array(z.number()),
    plan: Plan.optional(),
  }),
  /**
   * 이 멤버의 작업(`branch`)의 선점을 푼다. `path`가 없으면 그 작업의 선점 모두, 있으면 그 경로의 것(심볼이나 줄을 주면 그것만)이다.
   * 서버는 `released`(`re`)로 푼 선점을 돌려준다. 러너는 브랜치가 지워지면 저절로 보낸다.
   * 푼 선점의 계획이 이루어지지 않았으면(그 작업의 정의 줄이 계획대로 바뀌지 않았으면) 그 계획의 알림을 받은 작업의 편지함에 취소(`cancelled`)를 넣는다.
   */
  release: z.strictObject({
    branch: z.string(),
    path: z.string().optional(),
    symbol: z.string().optional(),
    lines: LineRange.optional(),
  }),
  /**
   * 이 멤버의 작업(`branch`)의 에이전트가 다른 멤버(`to`)의 에이전트에게 묻는다(ADR-0024). `executor`는 고른 받는 쪽 실행기이고, 없으면 서버가 고른다.
   * 서버는 `questioned`(`re`)로 바로 답하고, 답은 나중에 그 작업의 편지함(`answer`)으로 넣는다. 자기 자신이나 멤버가 아니면 `error`다.
   */
  question: z.strictObject({
    branch: z.string().min(1),
    to: z.string().min(1),
    executor: ExecutorId.optional(),
    text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  }),
  /** `ask`나 `question`(`re`)에 러너 세션이 답했다. 답하지 못했으면 `error`를 `re`를 붙여 보낸다. */
  answer: Reply,
  /** `draft`(`re`)의 초안. 쓰지 못했으면 `error`를 `re`를 붙여 보낸다. 멈춘 초안의 답은 서버가 버린다. */
  drafted: z.strictObject({
    ...DraftFields.shape,
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
  error: ContractError,
} satisfies Payloads;

/** 서버가 러너에 보내는 것. 러너는 여기 있는 종류만 받는다. */
export const serverToRunner = {
  /** hello를 받아들였다. 러너는 이 멤버의 에이전트로, 이 레포에 짝지어졌다. */
  welcome: z.strictObject({ login: z.string(), repo: z.string() }),
  /**
   * 문답. 러너가 받는 요청은 이것과 결정 초안(`draft`)뿐이다. 물을 에이전트(`executor`), 채널, 질문, 채널 대화만 오고 도구·폴더·세션은 러너가 정한다.
   * 러너는 채널과 실행기마다 채널 세션 하나를 잇고(ADR-0015), 한 번에 한 턴만 돌리고 나머지는 온 순서대로 줄 세운다.
   * 포스트도 채널로 온다(`channel.id`가 포스트의 채널). 그래서 포스트의 채널 세션은 같은 채널의 것과 따로 이어 간다.
   * `recent`는 그 채널의 최근 대화(오래된 것부터 `CHANNEL_CONTEXT`개까지)다. 포스트면 맨 앞이 그 알림이고 뒤가 포스트의 대화다. 러너는 그 채널 세션의 지난 턴 뒤의 것만
   * 지시가 아닌 데이터로 감싸 넘긴다. 질문은 그 에이전트의 주인이 쓴 것이다.
   * `model`과 `effort`는 주인이 고른 것이다. 러너는 hello로 알린 고를 거리에 없으면 실행기를 띄우지 않고 오류로 답한다.
   */
  ask: z.strictObject({
    executor: ExecutorId,
    channel: Channel.omit({ kind: true }),
    message: z.string().min(1),
    recent: z.array(ChannelMessage).max(CHANNEL_CONTEXT),
    ...ModelPick.shape,
  }),
  /**
   * 결정 초안을 써 달라(ADR-0028). `messages`는 포스트의 대화(맨 앞이 그 알림, 오래된 것부터 `CHANNEL_CONTEXT`개까지)다.
   * 러너는 채널 세션을 잇지 않고 새 러너 세션 하나로, 문답과 같은 줄에 서서 읽기 전용으로 돌린다. 대화는 지시가 아닌 데이터로 감싼다(ADR-0017).
   * 답은 `drafted`(`re`)다. `model`과 `effort`는 `ask`와 같다.
   */
  draft: z.strictObject({
    executor: ExecutorId,
    post: Channel.omit({ kind: true }),
    messages: z.array(ChannelMessage).max(CHANNEL_CONTEXT),
    ...ModelPick.shape,
  }),
  /** `draft`(보낸 것의 `id`)를 멈춘다. 줄에 서 있으면 돌리지 않고, 돌고 있으면 실행기를 끈다. 답하지 않는다. */
  stopDraft: z.strictObject({ id: z.string() }),
  /**
   * 지금 상황: 워크스페이스의 작업 전부(받는 러너의 멤버 것도 포함, `api.works`와 같은 것)와 선점 전부. 선점은 작업이 관측되지 않아도(브랜치를 바꿔 체크아웃해도) 남는다.
   * welcome 바로 뒤에 보내고, 그 뒤로는 달라질 때마다 다시 보낸다. 러너는 받아 두고 훅에 내준다(ADR-0005).
   */
  situation: z.strictObject({ works: z.array(WorkView), claims: z.array(Claim) }),
  /** `claim`(`re`)을 받아 건 선점. */
  claimed: z.strictObject({ claim: Claim }),
  /**
   * `question`(`re`)의 답: 받는 쪽 러너에 보냈다(`sent`), 받는 쪽 러너가 오프라인이라 남겨 두었다가 붙으면 보낸다(`offline`, 14일 뒤 만료),
   * 받는 쪽이 스위치를 꺼 두어 받지 않는다(`refused`, 남기지 않는다).
   */
  questioned: z.discriminatedUnion("state", [
    z.strictObject({ state: z.enum(["sent", "offline"]), question: Question }),
    z.strictObject({ state: z.literal("refused") }),
  ]),
  /**
   * 다른 멤버(`from`의 작업)의 에이전트가 이 러너의 멤버의 `executor` 에이전트에게 보낸 질문. 러너는 읽기 전용 러너 세션을 새로 띄워
   * 질문을 지시가 아닌 데이터로 감싸 넘기고(ADR-0017과 같은 방식), `answer`나 `error`(`re`)로 답한다. 문답과 같은 줄에 선다.
   */
  question: z.strictObject({
    id: z.number(),
    from: WorkRef,
    executor: ExecutorId,
    text: z.string(),
  }),
  /** `release`(`re`)로 푼 선점. 없었으면 비어 있다. */
  released: z.strictObject({ claims: z.array(Claim) }),
  /**
   * 이 러너의 멤버의 편지함 전부(작업마다, 넘겨준 확인이 없고 만료되지 않은 것). welcome 바로 뒤에 보내고, 달라질 때마다 다시 보낸다.
   * 러너는 받아 두고 훅과 CLI에 내준다.
   */
  inbox: z.strictObject({ items: z.array(InboxItem) }),
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
    z.strictObject({ kind: z.literal("lines"), ranges: z.array(LineRange) }),
    z.strictObject({ kind: z.literal("deleted") }),
    z.strictObject({ kind: z.literal("unknown"), reason: Unreadable }),
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
  nearby: z.strictObject({
    path: z.string().min(1),
    executor: ExecutorId,
    /** 고치는 작업. 주면 남의 선점을 이 작업의 사본 줄로 옮기고, 이 작업이 그 파일을 선점했는지 본다. */
    branch: z.string().optional(),
  }),
  /**
   * 심볼 하나(`omagari impact <심볼>`)를 누가 쓰고 누가 고치는지 묻는다. 메서드는 `클래스.메서드`나 메서드 이름으로 묻는다.
   * 쓰는 곳은 러너의 사본에서 찾고, 고치는 작업은 받아 둔 상황에서 찾는다.
   */
  impact: z.strictObject({ symbol: z.string().min(1) }),
  /**
   * 작업(`branch`)의 편지함을 묻는다. 훅과 모든 `omagari` 명령이 부른다. 받아 둔 것으로 바로 답하고, 넘긴 것으로 치지 않는다.
   * 에이전트에게 넘긴 뒤에 `delivered`로 알린다.
   */
  inbox: z.strictObject({ branch: z.string().min(1) }),
  /** 편지함의 소식(`id`들)을 에이전트에게 넘겼다. 러너는 다시 내주지 않고 서버에 알린다. 서브에이전트에게 보여 준 것은 보내지 않는다. */
  delivered: z.strictObject({ ids: z.array(z.number()) }),
  /**
   * 작업(`branch`)의 선점을 건다(`omagari claim`). `path`는 그 작업 폴더의 최상위에서 본 경로다. 러너는 서버에 걸고 답한다.
   * `plan`은 붙일 계획(바꿀 계약)이다.
   */
  claim: ClaimTarget.extend({ plan: Plan.optional() }),
  /** 작업의 선점을 푼다(`omagari release`). `path`가 없으면 그 작업의 선점 모두다. */
  release: ClaimTarget.partial({ path: true }),
  /** 작업(`branch`)의 에이전트가 다른 멤버의 에이전트에게 묻는다(`omagari ask`). 러너는 서버에 보내고 서버의 답을 그대로 돌려준다. */
  question: runnerToServer.question,
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
    /** 서버에서 마지막으로 받은 선점 전부(줄은 각자의 사본 기준) */
    claims: z.array(Claim),
  }),
  /** `nearby`의 답. 근처 작업이 없으면 `works`가 비어 있다. 받아 둔 것이 아직 없으면 `error`(`runner_offline`)다. */
  nearby: z.strictObject({
    works: z.array(NearbyWork),
    /** 그 파일에 걸린 다른 작업의 선점(폴더 선점 포함). 줄은 고치는 작업의 사본으로 옮긴 것이다. */
    claims: z.array(SeenClaim),
    /** 고치는 작업(`branch`)이 그 파일에 선점을 걸었다. `branch`를 주지 않았으면 false다. */
    claimed: z.boolean(),
    /** `situation`의 것과 같다. */
    disconnectedAt: z.string().nullable(),
  }),
  /** `impact`의 답. 받아 둔 것이 아직 없으면 `error`(`runner_offline`)다. */
  impact: z.strictObject({
    /** 러너의 사본에서 그 이름을 쓰는 곳(정의하는 자리는 뺀다). 이름으로 이어 같은 이름의 다른 심볼도 잡힌다. */
    uses: z.array(z.strictObject({ path: z.string(), line: z.number() })),
    /** 그 이름의 정의 줄을 바꾸고 있는(새로 만들거나 바꾸거나 없앤) 다른 멤버의 작업. */
    works: z.array(
      z.strictObject({
        login: z.string(),
        branch: z.string(),
        offlineSince: z.string().nullable(),
        path: z.string(),
        definition: Definition,
      }),
    ),
    /** 그 이름에 계획(바꿀 계약)을 붙인 다른 멤버의 선점. 코드가 아직 바뀌지 않았어도 있다. */
    plans: z.array(Claim),
    /** `situation`의 것과 같다. */
    disconnectedAt: z.string().nullable(),
  }),
  /** `inbox`의 답: 그 작업의 소식, 들어온 순서. 받아 둔 것이 아직 없으면 `error`(`runner_offline`)다. */
  inbox: z.strictObject({
    /** 이 러너의 멤버 */
    login: z.string(),
    items: z.array(InboxItem),
    /** `situation`의 것과 같다. */
    disconnectedAt: z.string().nullable(),
  }),
  /** `delivered`를 받았다. */
  delivered: z.strictObject({}),
  /** `claim`의 답: 건 선점과, 내 사본의 줄로 옮겨 보아 겹친 남의 선점. 겹쳐도 걸린다. 서버와 끊겨 있으면 `error`(`runner_offline`)다. */
  claimed: z.strictObject({ claim: Claim, overlaps: z.array(SeenClaim) }),
  /** `release`의 답: 푼 선점. 없었으면 비어 있다. */
  released: z.strictObject({ claims: z.array(Claim) }),
  /** `question`의 답(서버의 `questioned`와 같다). 서버와 끊겨 있으면 `error`(`runner_offline`)다. */
  questioned: serverToRunner.questioned,
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
   * `model`과 `effort`는 고른 것이고 없으면 "기본"이다. 서버는 그대로 러너에 넘기고, 고를 거리에 없으면 러너가 문답을 실패로 돌려준다.
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
      ...ModelPick.shape,
    }),
    response: z.strictObject({ qa: Qa, message: ChannelMessage.optional() }),
  },
  /**
   * 포스트(`post`, 포스트의 채널)로 내 `executor` 에이전트에게 결정 초안을 쓰게 한다(ADR-0028). 에이전트는 주인만 부른다(`forbidden`).
   * 답을 기다리지 않고 쓰는 중인 초안(읽을 글과 문답의 수가 붙는다)을 돌려준다. 다 쓰거나, 멈추거나, 쓰지 못하면
   * 실시간 연결의 `draft`로 요청한 사람에게만 온다. 초안은 저장하지 않는다.
   * 러너가 꺼져 있으면 쌓아 두지 않고 바로 `runner_offline`이다. 포스트가 아니면 `not_found`. `model`과 `effort`는 `ask`와 같다.
   */
  draftDecision: {
    method: "POST",
    path: "/api/drafts",
    body: z.strictObject({
      agent: z.string(),
      executor: ExecutorId,
      post: z.string(),
      ...ModelPick.shape,
    }),
    response: z.strictObject({ draft: Draft }),
  },
  /**
   * 쓰는 중인 내 초안(`draft`, `Draft.id`)을 멈춘다("그만 쓰기"). 멈춘 초안을 돌려주고 실시간 연결의 `draft`로도 보낸다.
   * 내 것이 아니거나 이미 끝났으면 `not_found`다.
   */
  stopDraft: {
    method: "POST",
    path: "/api/drafts/stop",
    body: z.strictObject({ draft: z.string() }),
    response: z.strictObject({ draft: Draft }),
  },
  /**
   * 내 DM의 문답 하나를 채널에 올린다. 질문과 답이 함께 올라가고, 답만 올릴 수는 없다. 공개를 비공개로 되돌리지는 않는다.
   * `text`는 함께 쓰는 한마디다. 채널에는 올린 사람의 메시지 하나(글과 문답)로 선다. 비우거나 공백뿐이면 글 없이 올린다.
   * 답이 온 문답만 올린다(`invalid_request`). 이미 올렸으면 `conflict`. 내 문답이 아니면 있어도 `not_found`다.
   * 채널에 선 문답이 실시간 연결의 `message`로 모두에게, 공개가 된 문답이 `qa`로 나에게 간다.
   */
  postQa: {
    method: "POST",
    path: "/api/qas/post",
    body: z.strictObject({ qa: z.number().int(), text: Note }),
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
  /**
   * 피드: 최근 소식(`INBOX_MS` 안에 생기거나 바뀐 알림, 걸거나 푼 선점) 가운데 부른 멤버의 작업이 걸리지 않은 것. 걸린 것은 그 작업의 편지함으로 간다.
   * 새것부터 `FEED_PAGE`개다. `omagari status`의 최근 소식이 이것이다. `at`은 알림이 마지막으로 바뀐 시각이다.
   */
  feed: {
    method: "GET",
    path: "/api/feed",
    response: z.strictObject({
      news: z.array(
        z.union([
          z.strictObject({ at: z.string(), alert: Alert }),
          /** 다른 멤버가 건 선점. `at`은 건 시각이다. */
          z.strictObject({ at: z.string(), claim: Claim }),
          /** 다른 멤버가 푼 선점(브랜치가 머지되거나 지워져 저절로 풀린 것 포함). `at`은 푼 시각이다. */
          z.strictObject({ at: z.string(), released: Claim }),
        ]),
      ),
    }),
  },
  /**
   * 알림(`alert`, 포럼에 선 알림 메시지의 번호)의 포스트와, 그 첫 글인 알림 메시지(`message`)를 읽는다.
   * 포스트는 알림이 올라올 때 이미 생겼다. 알림이 아닌 메시지면 `not_found`다.
   */
  openPost: {
    method: "POST",
    path: "/api/posts",
    body: z.strictObject({ alert: z.number().int() }),
    response: z.strictObject({ post: Post, message: ChannelMessage }),
  },
  /**
   * 포스트 전부, 알림 순서. 포럼 목록이 한 번에 그리도록 포스트마다 첫 글인 알림 메시지(`message`)가 붙는다:
   * 알림의 종류, 두 사람과 브랜치, 파일이나 심볼, 풀렸는지(`alert.resolved`)와 올라온 시각(`at`)이 거기 있다. 풀린 포스트도 남는다.
   * 새 글이 서면 그 알림 줄이 실시간 연결로 다시 오고, 그 `post`가 바뀐 요약이다.
   */
  posts: {
    method: "GET",
    path: "/api/posts",
    response: z.strictObject({ posts: z.array(Post.extend({ message: ChannelMessage })) }),
  },
  /**
   * 포스트(`post`, 포스트의 채널)에서 결정을 정리해 부른 멤버의 이름으로 결정 PR을 연다(ADR-0025).
   * 사람이 쓰는 것은 제목, 맥락, 결정, 결과와 창의 길이다. 결정자(그 포스트에서 말한 멤버와 정리한 멤버)와 출처(포스트 링크)는 서버가 붙인다.
   * 결정 파일은 `docs/decisions/`에 다음 번호로 놓이고, 레포의 AGENTS.md가 그 폴더를 가리키지 않으면 같은 PR에 한 줄을 더한다.
   * 열리면 포스트와 알림 채널에 `decision` 줄(`opened`)이 선다. "바로"면 곧이어 머지하고, GitHub이 막으면 `blocked` 줄에 까닭을 적는다.
   * 포스트가 아니면 `not_found`, 부른 멤버의 토큰으로 GitHub이 받지 않으면 `github_failed`다.
   */
  proposeDecision: {
    method: "POST",
    path: "/api/decisions",
    body: z.strictObject({
      post: z.string(),
      title: z
        .string()
        .transform((title) => title.replace(/\s+/g, " ").trim())
        .pipe(z.string().min(1).max(MAX_CHANNEL_NAME_CHARS)),
      context: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      decision: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      consequences: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
      window: DecisionWindow.default("day"),
    }),
    response: z.strictObject({ decision: Decision }),
  },
  /** 정리한 결정 전부, 정리한 순서. 상태는 서버가 GitHub에서 주기마다 읽은 것이다. */
  decisions: {
    method: "GET",
    path: "/api/decisions",
    response: z.strictObject({ decisions: z.array(Decision) }),
  },
  /**
   * 내 에이전트가 다른 멤버의 질문(`omagari ask`)에 답할지 정하는 스위치(ADR-0024). 기본은 켜짐이다.
   * 끄면 그 뒤로 오는 질문에 바로 "받지 않는다"를 돌려주고, 남겨 둔 질문도 답하지 않는다(묻는 쪽 편지함에 실패로 간다).
   */
  setAskSwitch: {
    method: "POST",
    path: "/api/ask-switch",
    body: z.strictObject({ on: z.boolean() }),
    response: z.strictObject({ on: z.boolean() }),
  },
  /** 채널 전부(채팅과 포럼), 이름 순서. 포스트는 오지 않는다(`api.posts`). 멤버만 본다. */
  channels: {
    method: "GET",
    path: "/api/channels",
    response: z.strictObject({ channels: z.array(Channel) }),
  },
  /**
   * 알림을 올릴 포럼을 바꾼다. 그 뒤에 새로 생기는 알림이 이 포럼에 포스트로 간다. 지난 포스트는 제자리에 있다.
   * 정한 적이 없으면 처음 알림을 올릴 때 "부딪힘" 포럼(없으면 만든다)이 알림을 올릴 포럼이 된다.
   * 없는 채널이나 포스트면 `not_found`, 채팅 채널이면 `invalid_request`다.
   */
  setAlertChannel: {
    method: "POST",
    path: "/api/alert-channel",
    body: z.strictObject({ channel: z.string() }),
    response: z.strictObject({ channel: Channel }),
  },
  /**
   * 채팅 채널을 만든다. 같은 이름(대소문자를 가리지 않는다)이 있거나 "부딪힘"(포럼의 이름)이면 `conflict`다.
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
  /**
   * 채널이나 포스트에 글을 쓴다. 실시간 연결이 붙어 있는 웹 모두(쓴 사람 것 포함)에 `message`가 간다.
   * 포럼에는 쓰지 못한다(`invalid_request`). DM과 `@호출`(`api.ask`)도 같다.
   */
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
  /** 내 결정 초안이 끝났다(다 씀, 멈춤, 쓰지 못함). 요청한 사람의 연결에만 간다. 끊긴 사이의 것은 다시 보내지 않는다. */
  draft: Draft,
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
