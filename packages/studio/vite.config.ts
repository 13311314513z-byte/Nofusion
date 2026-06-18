import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  // P2-1: Aggressive chunk splitting to reduce main bundle size (<600KB per chunk)
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "vendor-react";
          }
          // Lucide icons
          if (id.includes("node_modules/lucide-react/")) {
            return "vendor-lucide";
          }
          // Streamdown + all plugins (cjk, code, math, mermaid) — heavy markdown renderer
          if (id.includes("node_modules/streamdown/") || id.includes("node_modules/@streamdown/")) {
            return "vendor-streamdown";
          }
          // Shiki — dynamically imported in code-block.tsx, Vite auto-splits to async chunk
          // AI SDK
          if (id.includes("node_modules/ai/") || id.includes("node_modules/@ai-sdk/")) {
            return "vendor-ai";
          }
          // Base UI + Radix (UI primitives)
          if (id.includes("node_modules/@base-ui/") || id.includes("node_modules/@radix-ui/")) {
            return "vendor-ui";
          }
          // Hono server-side only — exclude from client bundle via treeshaking
          if (id.includes("node_modules/@hono/") || id.includes("node_modules/hono/")) {
            return "vendor-hono";
          }
          // Everything else stays in main
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 4577,
    // 防止 Windows 文件监听抖动触发 Vite 全量 HMR 刷新
    watch: {
      ignored: [
        "**/dist/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/books/**",
        "**/reports/**",
        "**/*.tsbuildinfo",
      ],
    },
    proxy: {
      "/api/v1/events": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4579"}`,
        changeOrigin: true,
        // SSE needs unbuffered streaming — bypass http-proxy response handling
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          });
        },
      },
      "/api": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4579"}`,
        changeOrigin: true,
      },
    },
  },
});
