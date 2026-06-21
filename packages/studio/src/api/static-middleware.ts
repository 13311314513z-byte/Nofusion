/**
 * Static file serving middleware for Studio.
 *
 * Extracted from server.ts to keep the server factory focused on
 * route registration and pipeline configuration.
 *
 * @module
 */

import type { Hono } from "hono";
import { resolve, relative, isAbsolute, join as joinPath } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface StaticMiddlewareOptions {
  readonly staticDir: string;
}

/**
 * Register static asset serving and SPA fallback on the given Hono app.
 * Serves JS/CSS/images from the staticDir, and falls back to index.html
 * for non-API routes (SPA client-side routing).
 */
export async function registerStaticMiddleware(
  app: Hono,
  options: StaticMiddlewareOptions,
): Promise<void> {
  // Serve static assets (js, css, etc.)
  app.get("/assets/*", async (c) => {
    const rawPath = c.req.path;
    // Prevent path traversal: resolve + relative check
    const resolved = resolve(options.staticDir, "." + rawPath);
    const rel = relative(options.staticDir, resolved);
    if (rel.startsWith("..") || rel.startsWith("/") || isAbsolute(rel)) {
      return c.notFound();
    }
    const filePath = joinPath(options.staticDir, rawPath);
    try {
      const content = await readFile(filePath);
      const ext = filePath.split(".").pop() ?? "";
      const contentTypes: Record<string, string> = {
        js: "application/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        png: "image/png",
        ico: "image/x-icon",
        json: "application/json",
      };
      return new Response(content, {
        headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
      });
    } catch {
      return c.notFound();
    }
  });

  // SPA fallback — serve index.html for all non-API routes
  const indexPath = joinPath(options.staticDir, "index.html");
  if (existsSync(indexPath)) {
    const indexHtml = await readFile(indexPath, "utf-8");
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/v1/")) return c.notFound();
      return c.html(indexHtml);
    });
  }
}
