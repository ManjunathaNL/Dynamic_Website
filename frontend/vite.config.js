import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.VITE_DEV_PROXY_TARGET || "http://localhost:8787";

  return {
    root: ".",
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
      proxy: {
        "/api": backendTarget,
        "/uploads": backendTarget
      }
    },
    build: {
      outDir: "dist",
      emptyOutDir: true
    }
  };
});
