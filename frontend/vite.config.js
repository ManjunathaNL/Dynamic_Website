import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.VITE_DEV_PROXY_TARGET;

  return {
    root: ".",
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT),
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
