import type { BodyOf, ContractError, ReplyOf, Route } from "@omagari/contract";
import { type Context, Hono } from "hono";

const fail = (c: Context, status: 400 | 404 | 500, code: ContractError["code"], message: string) =>
  c.json({ error: { code, message } }, status);

/** 오류를 계약의 오류 형식으로 내는 빈 앱. */
export function createApp(): Hono {
  const app = new Hono();
  app.notFound((c) => fail(c, 404, "not_found", `없는 경로다: ${c.req.method} ${c.req.path}`));
  app.onError((error, c) => {
    console.error(error);
    return fail(c, 500, "internal", "서버 안에서 실패했다");
  });
  return app;
}

/** 계약의 경로 하나를 붙인다. 본문도 답도 계약대로만 드나든다. */
export function mount<R extends Route>(
  app: Hono,
  route: R,
  handler: (body: BodyOf<R>, c: Context) => ReplyOf<R> | Promise<ReplyOf<R>>,
): void {
  app.on(route.method, route.path, async (c) => {
    const body = route.body?.safeParse(await c.req.json().catch(() => undefined));
    if (body && !body.success) {
      return fail(c, 400, "invalid_request", `요청이 계약과 다르다: ${body.error.message}`);
    }
    const reply = await handler(body?.data as BodyOf<R>, c);
    return c.json(route.response.parse(reply) as object);
  });
}
