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

/** What gets attached to every request. `login` is the member who came with a valid session. */
export type Env = { Variables: { login?: string } };

const STATUS = {
  invalid_message: 400,
  unknown_kind: 400,
  version_mismatch: 400,
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  refused: 403,
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
 * An empty app that returns errors in the contract's error shape. Handlers reject by throwing `ContractFailure`.
 * `member` turns the Authorization header into the member's login.
 */
export function createApp(member: (authorization?: string) => string | undefined): Hono<Env> {
  const app = new Hono<Env>();
  app.use(
    bodyLimit({
      maxSize: MAX_MESSAGE_BYTES,
      onError: (c) =>
        fail(c, 413, {
          code: "invalid_request",
          message: `The body is over ${MAX_MESSAGE_BYTES} bytes`,
        }),
    }),
  );
  app.use(async (c, next) => {
    c.set("login", member(c.req.header("authorization")));
    await next();
  });
  app.notFound((c) =>
    fail(c, 404, { code: "not_found", message: `No such route: ${c.req.method} ${c.req.path}` }),
  );
  app.onError((error, c) => {
    if (error instanceof ContractFailure) {
      return fail(c, STATUS[error.code], { code: error.code, message: error.message });
    }
    console.error(error);
    return fail(c, 500, { code: "internal", message: "Something failed inside the server" });
  });
  return app;
}

/** Mounts one route of the contract. Bodies and replies go in and out only as the contract says, and unless it's `public`, only members can call it. */
export function mount<R extends Route>(
  app: Hono<Env>,
  route: R,
  handler: (body: BodyOf<R>, c: Context<Env>) => ReplyOf<R> | Promise<ReplyOf<R>>,
): void {
  app.on(route.method, route.path, async (c) => {
    if (!route.public && !c.get("login")) {
      throw new ContractFailure({
        code: "unauthorized",
        message: "You're not signed in, or your session ended",
      });
    }
    const body = route.body?.safeParse(await c.req.json().catch(() => undefined));
    if (body && !body.success) {
      throw new ContractFailure({
        code: "invalid_request",
        message: `The request doesn't match the contract: ${body.error.message}`,
      });
    }
    const reply = await handler(body?.data as BodyOf<R>, c);
    return c.json(route.response.parse(reply) as object);
  });
}
