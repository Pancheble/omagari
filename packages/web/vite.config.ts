import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development, Vite serves the screen and forwards /api to the separately started server (`npm run server`).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.OMAGARI_SERVER ?? "http://127.0.0.1:3000", ws: true },
    },
  },
});
