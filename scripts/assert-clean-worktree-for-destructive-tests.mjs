#!/usr/bin/env node
import { execFileSync } from "node:child_process";

if (process.env.INKOS_ALLOW_DIRTY_DESTRUCTIVE_TESTS === "1") {
  process.exit(0);
}

let output = "";
try {
  output = execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf-8" });
} catch (error) {
  console.error("Unable to inspect git status before destructive tests.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const dirty = output
  .split(/\r?\n/u)
  .map((line) => line.trimEnd())
  .filter(Boolean)
  .filter((line) => !line.startsWith("?? reports/"));

if (dirty.length > 0) {
  console.error("Refusing to run destructive tests against a dirty worktree.");
  console.error("Commit/stash changes or set INKOS_ALLOW_DIRTY_DESTRUCTIVE_TESTS=1 to override explicitly.");
  console.error("");
  console.error(dirty.join("\n"));
  process.exit(1);
}
