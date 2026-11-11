import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 개발할 때는 Vite가 화면을 내고, /api는 따로 띄운 서버(`npm run server`)로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.OMAGARI_SERVER ?? "http://127.0.0.1:3000", ws: true },
    },
  },
});
