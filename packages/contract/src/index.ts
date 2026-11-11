// 계약: 러너와 서버가 주고받는 메시지, 웹이 쓰는 API. 모든 조각이 이 정의 하나를 쓴다.
// 객체는 모두 `z.strictObject`로 적는다. 계약에 없는 종류도, 계약에 없는 키도 받지 않는다.
import * as z from "zod";

/** 계약의 버전. 봉투마다 싣고, 다르면 받지 않는다. 계약을 깨는 변경마다 올린다. */
export const CONTRACT_VERSION = 4;

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

/** 러너가 서버에 보내는 것. 이후의 이슈는 자기 메시지를 여기에 더한다. */
export const runnerToServer = {
  /** 붙자마자 보낸다. `repos`는 러너 폴더의 GitHub 원격이 가리키는 레포(`owner/name`)들이다. */
  hello: z.strictObject({ session: z.string(), repos: z.array(z.string()) }),
  /**
   * 관측. 러너가 지금 보는 작업 전부다: 등록한 폴더와 그 연결된 워크트리마다 체크아웃된 브랜치 하나씩(ADR-0006).
   * 서버는 그 멤버의 작업을 이것으로 바꾼다. 그래서 공유 수준을 낮추면 전에 올린 내용이 서버에서 내려간다.
   * 붙을 때마다, 그리고 관측이 달라질 때마다 보낸다. 브랜치가 아니면(detached HEAD) 작업이 없다.
   */
  observation: z.strictObject({ works: z.array(Work) }),
  /** `ask`(`re`)에 러너 세션이 답했다. 답하지 못했으면 `error`를 `re`를 붙여 보낸다. */
  answer: z.strictObject({ text: z.string() }),
  error: ContractError,
} satisfies Payloads;

/** 서버가 러너에 보내는 것. 러너는 여기 있는 종류만 받는다. */
export const serverToRunner = {
  /** hello를 받아들였다. 러너는 이 멤버의 에이전트로, 이 레포에 짝지어졌다. */
  welcome: z.strictObject({ login: z.string(), repo: z.string() }),
  /**
   * 문답. 러너가 받는 요청은 이것뿐이다. 메시지만 오고, 도구·폴더·세션은 러너가 정한다.
   * 러너는 한 번에 한 턴만 돌리고 나머지는 온 순서대로 줄 세운다.
   */
  ask: z.strictObject({ message: z.string().min(1) }),
  error: ContractError,
} satisfies Payloads;

/**
 * 러너가 붙는 WebSocket 경로. 서버는 hello를 거절하면 `error`를 보낸 뒤 1008로 닫는다.
 * 1008로 닫힌 러너는 다시 붙지 않는다. 그 밖의 이유로 끊기면 다시 붙는다.
 */
export const RUNNER_SOCKET = "/api/runner";

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

/** CLI가 러너에 보내는 것. 러너는 문답만 받는다. */
export const cliToRunner = {
  ask: serverToRunner.ask,
} satisfies Payloads;

/** 러너가 CLI에 보내는 것. */
export const runnerToCli = {
  answer: runnerToServer.answer,
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
  /**
   * 워크스페이스의 멤버와 그 사람의 에이전트. 에이전트는 러너가 서버에 붙어 있으면 online이고,
   * 그중 받은 문답에 아직 답하지 않았으면(줄을 선 것 포함) answering("답하는 중")이다.
   */
  members: {
    method: "GET",
    path: "/api/members",
    response: z.strictObject({
      members: z.array(
        z.strictObject({
          login: z.string(),
          agent: z.enum(["online", "answering", "offline"]),
        }),
      ),
    }),
  },
  /** 멤버들의 작업과 그 관측. 바뀐 파일과 그 내용까지 온다. 멤버만 본다. */
  works: {
    method: "GET",
    path: "/api/works",
    response: z.strictObject({
      works: z.array(z.strictObject({ login: z.string(), ...Work.shape })),
    }),
  },
  /**
   * `agent`(멤버의 로그인)의 에이전트에게 묻고 러너 세션의 답을 기다린다. 에이전트는 주인만 부른다(`forbidden`).
   * 러너가 꺼져 있으면 쌓아 두지 않고 바로 `runner_offline`, 한 턴이 10분을 넘으면 `turn_timeout`이다.
   */
  ask: {
    method: "POST",
    path: "/api/ask",
    body: z.strictObject({ agent: z.string(), message: z.string().min(1) }),
    response: z.strictObject({ answer: z.string() }),
  },
} satisfies Record<string, Route>;

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
