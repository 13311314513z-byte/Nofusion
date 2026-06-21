/**
 * Pipeline Fanfic — extracted from runner.ts (C2-ext).
 *
 * Contains fanfic-related pipeline operations.
 */
import type { PipelineContext } from "./context.js";
import type { FanficMode } from "../models/book.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

/** Import external source material and generate fanfic_canon.md */
export async function importFanficCanon(
  ctx: PipelineContext,
  bookId: string,
  sourceText: string,
  sourceName: string,
  fanficMode: FanficMode,
): Promise<string> {
  const { FanficCanonImporter } = await import("../agents/fanfic-canon-importer.js");
  const importer = new FanficCanonImporter(ctx.agentCtxFor("fanfic-canon-importer", bookId));
  const result = await importer.importFromText(sourceText, sourceName, fanficMode);

  const bookDir = ctx.state.bookDir(bookId);
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(join(storyDir, "fanfic_canon.md"), result.fullDocument, "utf-8");

  return result.fullDocument;
}
