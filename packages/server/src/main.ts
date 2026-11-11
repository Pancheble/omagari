import { startServer } from "./index.ts";

const server = await startServer({ port: Number(process.env.PORT ?? 3000) });
console.log(`Omagari 서버: ${server.url}`);
