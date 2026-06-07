import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(studioRoot, "..", "..");
const isWindows = process.platform === "win32";
const pnpmCmd = isWindows ? "pnpm.cmd" : "pnpm";

const children = new Set();

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function start(label, command, args, options = {}) {
  const child = isWindows
    ? spawn([command, ...args.map(shellQuote)].join(" "), {
      cwd: studioRoot,
      env: {
        ...process.env,
        ...options.env,
      },
      shell: true,
      stdio: ["inherit", "pipe", "pipe"],
    })
    : spawn(command, args, {
    cwd: studioRoot,
    env: {
      ...process.env,
      ...options.env,
    },
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.add(child);

  const prefix = `[${label}] `;
  child.stdout.on("data", (chunk) => {
    process.stdout.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`));
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(prefix + chunk.toString().replace(/\n/g, `\n${prefix}`));
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    if (code !== 0) {
      console.error(`${prefix}exited with ${signal ?? code}`);
      stopAll(code ?? 1);
    }
  });

  return child;
}

let shuttingDown = false;

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 250).unref();
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

start("api", pnpmCmd, ["exec", "tsx", "watch", "--clear-screen=false", "src/api/index.ts"], {
  env: {
    INKOS_STUDIO_PORT: "4579",
    INKOS_PROJECT_ROOT: projectRoot,
  },
});

start("vite", pnpmCmd, ["exec", "vite", "--host", "--port", "4577", "--strictPort"]);
