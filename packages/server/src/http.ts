import {
  type BodyOf,
  type ContractError,
  ContractFailure,
  MAX_MESSAGE_BYTES,
  type ReplyOf,
  type Route,
} from "@omagari/contract";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

/** 요청마다 붙는 것. `login`은 유효한 세션을 들고 온 멤버다. */
export type Env = { Variables: { login?: string } };

const STATUS = {
  invalid_message: 400,
  unknown_kind: 400,
  version_mismatch: 400,
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  internal: 500,
  executor_failed: 500,
  runner_offline: 503,
  turn_timeout: 504,
  conflict: 409,
  github_failed: 502,
} as const satisfies Record<ContractError["code"], number>;

const fail = (
  c: Context,
  status: 413 | (typeof STATUS)[keyof typeof STATUS],
  error: ContractError,
) => c.json({ error }, status);

/**
 * 오류를 계약의 오류 형식으로 내는 빈 앱. 처리기는 `ContractFailure`를 던져 거절한다.
 * `member`는 Authorization 머리말을 멤버의 로그인으로 바꾼다.
 */
export function createApp(member: (authorization?: string) => string | undefined): Hono<Env> {
  const app = new Hono<Env>();
  app.use(
    bodyLimit({
      maxSize: MAX_MESSAGE_BYTES,
      onError: (c) =>
        fail(c, 413, {
          code: "invalid_request",
          message: `본문이 ${MAX_MESSAGE_BYTES}바이트를 넘는다`,
        }),
    }),
  );
  app.use(async (c, next) => {
    c.set("login", member(c.req.header("authorization")));
    await next();
  });
  app.notFound((c) =>
    fail(c, 404, { code: "not_found", message: `없는 경로다: ${c.req.method} ${c.req.path}` }),
  );
  app.onError((error, c) => {
    if (error instanceof ContractFailure) {
      return fail(c, STATUS[error.code], { code: error.code, message: error.message });
    }
    console.error(error);
    return fail(c, 500, { code: "internal", message: "서버 안에서 실패했다" });
  });
  return app;
}

/** 계약의 경로 하나를 붙인다. 본문도 답도 계약대로만 드나들고, `public`이 아니면 멤버만 부른다. */
export function mount<R extends Route>(
  app: Hono<Env>,
  route: R,
  handler: (body: BodyOf<R>, c: Context<Env>) => ReplyOf<R> | Promise<ReplyOf<R>>,
): void {
  app.on(route.method, route.path, async (c) => {
    if (!route.public && !c.get("login")) {
      throw new ContractFailure({
        code: "unauthorized",
        message: "로그인하지 않았거나 세션이 끝났다",
      });
    }
    const body = route.body?.safeParse(await c.req.json().catch(() => undefined));
    if (body && !body.success) {
      throw new ContractFailure({
        code: "invalid_request",
        message: `요청이 계약과 다르다: ${body.error.message}`,
      });
    }
    const reply = await handler(body?.data as BodyOf<R>, c);
    return c.json(route.response.parse(reply) as object);
  });
}
