import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 127.0.0.1 rather than "localhost": Node resolves localhost to both ::1
  // and 127.0.0.1 and tries each, which only adds noise (AggregateError) when
  // the API isn't up yet.
  const backendTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8787";

  // While the API is still starting (or stopped), answer with the same
  // retryable 503 JSON the API itself sends during startup, so the app shows
  // "connecting…" and retries instead of hanging on a dropped connection.
  const proxyTo = (target) => ({
    target,
    configure: (proxy) => {
      proxy.on("error", (_error, _req, res) => {
        if (!res || res.headersSent || typeof res.writeHead !== "function") return;
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "3" });
        res.end(JSON.stringify({ error: `The API server at ${target} isn't reachable yet — make sure "npm run dev" is running in backend/.`, code: "starting" }));
      });
    }
  });

  return {
    root: ".",
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
      proxy: {
        "/api": proxyTo(backendTarget),
        "/uploads": proxyTo(backendTarget)
      }
    },
    build: {
      outDir: "dist",
      emptyOutDir: true
    }
  };
});
