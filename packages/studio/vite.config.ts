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
  // P2-6: Chunk splitting to reduce main bundle size
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-lucide": ["lucide-react"],
          "vendor-charts": ["recharts"],
        },
      },
    },
    chunkSizeWarningLimit: 500,
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
