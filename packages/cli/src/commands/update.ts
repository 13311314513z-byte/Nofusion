import { Command } from "commander";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { log, logError } from "../utils.js";

const execAsync = promisify(exec);

export const updateCommand = new Command("update")
  .description("Update InkOS to the latest version")
  .action(async () => {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const { version: currentVersion } = require("../../package.json") as { version: string };

      log(`Current version: ${currentVersion}`);
      log("Checking npm registry...");

      const { stdout } = await execAsync("npm view @actalk/inkos version", { encoding: "utf-8" }) as { stdout: string; stderr: string };
      const remoteVersion = stdout.trim();

      if (currentVersion === remoteVersion) {
        log(`Already up to date (${currentVersion}).`);
        return;
      }

      // Don't downgrade development versions
      const current = currentVersion.split(".").map(Number);
      const remote = remoteVersion.split(".").map(Number);
      const isNewer = current[0]! > remote[0]! ||
        (current[0] === remote[0] && current[1]! > remote[1]!) ||
        (current[0] === remote[0] && current[1] === remote[1] && current[2]! > remote[2]!);

      if (isNewer) {
        log(`You're running a newer development version (${currentVersion} > ${remoteVersion}). Skipping.`);
        return;
      }

      log(`Updating: ${currentVersion} → ${remoteVersion}`);
      await execAsync("npm install -g @actalk/inkos@latest");
      log(`Updated to ${remoteVersion}.`);
    } catch (e) {
      logError(`Update failed: ${e}`);
      log("You can also update manually: npm install -g @actalk/inkos@latest");
      process.exit(1);
    }
  });
