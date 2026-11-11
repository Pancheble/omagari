// 계약: 러너와 서버가 주고받는 메시지, 웹이 쓰는 API. 모든 조각이 이 정의 하나를 쓴다.
// 객체는 모두 `z.strictObject`로 적는다. 계약에 없는 종류도, 계약에 없는 키도 받지 않는다.
import * as z from "zod";

/** 계약의 버전. 봉투마다 싣고, 다르면 받지 않는다. 계약을 깨는 변경마다 올린다. */
export const CONTRACT_VERSION = 1;

/** 오류 형식. 러너와 서버 사이의 `error` 메시지와 HTTP 오류 본문(`{ error }`)이 같이 쓴다. */
export const ContractError = z.strictObject({
  code: z.enum([
    "invalid_message", // 봉투나 내용이 계약과 다르다
    "unknown_kind", // 계약에 없는 종류다
    "version_mismatch", // 계약의 버전이 다르다
    "invalid_request", // HTTP 요청의 본문이 계약과 다르다
    "not_found",
    "internal",
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

/** 러너가 서버에 보내는 것. 이후의 이슈는 자기 메시지를 여기에 더한다. */
export const runnerToServer = {
  hello: z.strictObject({}),
  error: ContractError,
} satisfies Payloads;

/** 서버가 러너에 보내는 것. 러너는 여기 있는 종류만 받는다. */
export const serverToRunner = {
  welcome: z.strictObject({}),
  error: ContractError,
} satisfies Payloads;

/** 러너가 붙는 WebSocket 경로. */
export const RUNNER_SOCKET = "/api/runner";

/** 프레임 하나, HTTP 본문 하나의 상한. 서버는 넘는 것을 읽지 않는다. 더 큰 것이 필요한 이슈가 알고 올린다. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

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

// --- 웹이 쓰는 API ---

export type Route = {
  method: "GET" | "POST";
  path: string;
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
    response: z.strictObject({ contract: z.number(), runners: z.number() }),
  },
} satisfies Record<string, Route>;

/** API 하나를 부른다. 웹, CLI, 테스트가 같이 쓴다. 오류 답은 `ContractFailure`로 던진다. */
export async function call<R extends Route>(
  base: string,
  route: R,
  ...[body]: R["body"] extends z.ZodType ? [z.input<R["body"]>] : []
): Promise<z.output<R["response"]>> {
  const response = await fetch(new URL(route.path, base), {
    method: route.method,
    ...(route.body && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
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
