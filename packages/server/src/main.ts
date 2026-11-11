import { startServer } from "./index.ts";

// HOST를 주지 않으면 이 기기 안에서만 듣는다. 배포할 때는 HOST=0.0.0.0처럼 준다.
const server = await startServer({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
});
console.log(`Omagari 서버: ${server.url}`);
