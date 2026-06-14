import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BetaReaderOutput, ReaderObservation } from "../models/beta-reader-output.js";

const FAMILY_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:^|[/_-])(?:gpt|o1|o3|o4)(?:[/_.-]|$)/, "openai"],
  [/(?:^|[/_-])claude(?:[/_.-]|$)/, "anthropic"],
  [/(?:^|[/_-])gemini(?:[/_.-]|$)/, "google"],
  [/(?:^|[/_-])deepseek(?:[/_.-]|$)/, "deepseek"],
  [/(?:^|[/_-])qwen(?:[/_.-]|$)/, "qwen"],
  [/(?:^|[/_-])glm(?:[/_.-]|$)/, "zhipu"],
  [/(?:^|[/_-])(?:kimi|moonshot)(?:[/_.-]|$)/, "moonshot"],
  [/(?:^|[/_-])(?:mistral|mixtral|codestral)(?:[/_.-]|$)/, "mistral"],
  [/(?:^|[/_-])(?:llama|meta)(?:[/_.-]|$)/, "meta"],
];

export function inferModelFamily(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return "";

  for (const [pattern, family] of FAMILY_ALIASES) {
    if (pattern.test(normalized)) return family;
  }

  const providerPrefix = normalized.includes("/") ? normalized.split("/")[0] : undefined;
  return (providerPrefix ?? normalized.split(/[-_:]/)[0] ?? "").trim();
}

export interface BetaReaderModelConstraint {
  readonly allowed: boolean;
  readonly writerFamily: string;
  readonly readerFamily: string;
  readonly reason?: string;
}

export function evaluateBetaReaderModelConstraint(
  writerModel: string,
  readerModel: string,
  expectedReaderFamily?: string,
): BetaReaderModelConstraint {
  const writerFamily = inferModelFamily(writerModel);
  const readerFamily = inferModelFamily(readerModel);
  const expectedFamily = expectedReaderFamily
    ? inferModelFamily(expectedReaderFamily)
    : "";

  if (!writerFamily || !readerFamily) {
    return {
      allowed: false,
      writerFamily,
      readerFamily,
      reason: "unable to determine both writer and reader model families",
    };
  }

  if (expectedFamily && readerFamily !== expectedFamily) {
    return {
      allowed: false,
      writerFamily,
      readerFamily,
      reason: `reader family "${readerFamily}" does not match configured family "${expectedFamily}"`,
    };
  }

  if (writerFamily === readerFamily) {
    return {
      allowed: false,
      writerFamily,
      readerFamily,
      reason: `writer and reader both resolve to model family "${writerFamily}"`,
    };
  }

  return { allowed: true, writerFamily, readerFamily };
}

export interface PersistBetaReaderShadowInput {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly gitCommit: string;
  readonly writerModel: string;
  readonly writerPromptHash?: string;
  readonly readerModel: BetaReaderOutput["modelInfo"];
  readonly observations: ReadonlyArray<ReaderObservation>;
}

export interface PersistedBetaReaderShadow {
  readonly runId: string;
  readonly filePath: string;
}

export async function persistBetaReaderShadow(
  input: PersistBetaReaderShadowInput,
): Promise<PersistedBetaReaderShadow> {
  const shadowDir = join(input.bookDir, "story", "beta-reader-shadow");
  await mkdir(shadowDir, { recursive: true });

  const runId = randomUUID();
  const entry = {
    runId,
    chapterNumber: input.chapterNumber,
    title: input.title,
    timestamp: new Date().toISOString(),
    gitCommit: input.gitCommit,
    writerModel: input.writerModel,
    writerPromptHash: input.writerPromptHash,
    readerModel: input.readerModel,
    observations: input.observations,
  };
  const filePath = join(
    shadowDir,
    `${String(input.chapterNumber).padStart(4, "0")}-${runId}.json`,
  );

  await writeFile(filePath, JSON.stringify(entry, null, 2), {
    encoding: "utf-8",
    flag: "wx",
  });

  return { runId, filePath };
}
