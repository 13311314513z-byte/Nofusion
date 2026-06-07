import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(studioRoot, "..", "..");
const isWindows = process.platform === "win32";
const pnpmCmd = isWindows ? "pnpm.cmd" : "pnpm";

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

const args = ["exec", "tsx", "watch", "src/api/index.ts"];
const child = isWindows ? spawn([pnpmCmd, ...args.map(shellQuote)].join(" "), {
  cwd: studioRoot,
  env: {
    ...process.env,
    INKOS_STUDIO_PORT: "4579",
    INKOS_PROJECT_ROOT: projectRoot,
  },
  shell: true,
  stdio: "inherit",
}) : spawn(pnpmCmd, args, {
  cwd: studioRoot,
  env: {
    ...process.env,
    INKOS_STUDIO_PORT: "4579",
    INKOS_PROJECT_ROOT: projectRoot,
  },
  shell: false,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
