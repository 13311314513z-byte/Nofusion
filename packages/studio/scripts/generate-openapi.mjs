/**
 * OpenAPI 3.0 spec generator for InkOS Studio API.
 * Scans route modules and generates openapi.json.
 *
 * Usage: node scripts/generate-openapi.mjs
 * Output: openapi.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

const ROUTES_DIR = join(import.meta.dirname, "..", "src", "api", "routes");
const OUTPUT = join(import.meta.dirname, "..", "openapi.json");

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

function extractEndpoints(content, fileName) {
  const endpoints = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const method of HTTP_METHODS) {
      const pattern = new RegExp(
        `app\\.${method}\\s*\\(\\s*["\`]([^"\`]+)["\`]`,
      );
      const match = line.match(pattern);
      if (match) {
        endpoints.push({
          method: method.toUpperCase(),
          path: match[1],
          file: fileName,
          line: i + 1,
        });
      }
    }
  }
  return endpoints;
}

async function main() {
  const files = (await readdir(ROUTES_DIR)).filter((f) => f.endsWith(".ts"));
  const allEndpoints = [];

  for (const file of files) {
    const content = readFileSync(join(ROUTES_DIR, file), "utf-8");
    allEndpoints.push(...extractEndpoints(content, file));
  }

  const paths = {};
  const tagSet = new Set();

  for (const ep of allEndpoints) {
    const openApiPath = ep.path.replace(/:([^/]+)/g, "{$1}");

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    const tag = ep.file.replace(/\.ts$/, "");
    tagSet.add(tag);

    paths[openApiPath][ep.method.toLowerCase()] = {
      tags: [tag],
      summary: `${ep.method} ${ep.path}`,
      operationId: `${ep.method.toLowerCase()}_${openApiPath.replace(/[{}]/g, "").replace(/[/-]/g, "_")}`.slice(0, 100),
      responses: {
        "200": { description: "Successful response" },
        "400": { description: "Bad request" },
        "500": { description: "Internal server error" },
      },
    };
  }

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "InkOS Studio API",
      version: "1.5.0",
      description: `Auto-generated OpenAPI spec from ${allEndpoints.length} endpoints across ${files.length} route modules.`,
    },
    servers: [
      { url: "http://localhost:4579", description: "InkOS Studio API server" },
    ],
    paths,
    tags: Array.from(tagSet).sort().map((name) => ({ name, description: `${name} routes` })),
  };

  writeFileSync(OUTPUT, JSON.stringify(spec, null, 2), "utf-8");
  console.log(`Generated ${OUTPUT}`);
  console.log(`  ${allEndpoints.length} endpoints from ${files.length} modules`);
  console.log(`  ${Object.keys(paths).length} unique paths`);
}

main().catch((e) => { console.error(e); process.exit(1); });
