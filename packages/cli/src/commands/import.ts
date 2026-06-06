import { Command } from "commander";
import {
  buildFoundationSourceBundle,
  extractDocument,
  PipelineRunner,
  StateManager,
  splitChapters,
  summariseBundle,
  type FoundationSourceInput,
} from "@actalk/inkos-core";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";
import {
  formatImportCanonComplete,
  formatImportCanonStart,
  formatImportChaptersComplete,
  formatImportChaptersDiscovery,
  formatImportChaptersResume,
  resolveCliLanguage,
} from "../localization.js";

export const importCommand = new Command("import")
  .description("Import external data into a book");

importCommand
  .command("canon")
  .description("Import parent book's canon for spinoff writing")
  .argument("[target-book-id]", "Target book ID (auto-detected if only one book)")
  .requiredOption("--from <parent-book-id>", "Parent book ID to import canon from")
  .option("--json", "Output JSON")
  .action(async (targetBookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const targetBookId = await resolveBookId(targetBookIdArg, root);
      const config = await loadConfig();
      const state = new StateManager(root);
      const targetBook = await state.loadBookConfig(targetBookId);
      const language = resolveCliLanguage(targetBook.language);

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) log(formatImportCanonStart(language, opts.from, targetBookId));

      await pipeline.importCanon(targetBookId, opts.from);

      if (opts.json) {
        log(JSON.stringify({
          targetBookId,
          parentBookId: opts.from,
          output: "story/parent_canon.md",
        }, null, 2));
      } else {
        for (const line of formatImportCanonComplete(language)) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Canon import failed: ${e}`);
      }
      process.exit(1);
    }
  });

importCommand
  .command("foundation")
  .description("Import world, character, era, plot, or rule material into an existing book")
  .argument("[book-id]", "Target book ID (auto-detected if only one book)")
  .requiredOption("--from <paths...>", "One or more .txt/.md/.jsonl/.json source files")
  .option("--mode <mode>", "supplement (safe merge) or rebuild", "supplement")
  .option("--instruction <text>", "Additional merge instruction")
  .option("--dry-run", "Generate preview without writing files")
  .option("--yes", "Commit the preview without another prompt")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const mode = opts.mode === "rebuild" ? "rebuild" : opts.mode === "supplement" ? "supplement" : null;
      if (!mode) throw new Error("--mode must be supplement or rebuild");

      const inputs: FoundationSourceInput[] = await Promise.all(
        (opts.from as string[]).map(async (sourcePath) => {
          const document = await extractDocument(resolve(sourcePath));
          return {
            sourceName: document.sourceName,
            fileType: document.fileType,
            text: document.text,
            purpose: "auto",
            normalized: true,
          };
        }),
      );
      const bundle = buildFoundationSourceBundle(inputs);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const plan = await pipeline.planFoundationImport(bookId, inputs, {
        mode,
        instruction: opts.instruction,
      });
      if (!plan.proposed || !plan.foundationRevision || !plan.roleChanges) {
        throw new Error(plan.warnings.join("; ") || "No foundation changes were generated");
      }

      const preview = {
        bookId,
        mode,
        bundle: {
          sourceCount: bundle.sources.length,
          totalChars: bundle.totalChars,
        },
        warnings: plan.warnings,
        roleChanges: plan.roleChanges,
      };
      if (opts.json) {
        log(JSON.stringify(preview, null, 2));
      } else {
        log(summariseBundle(bundle));
        log(`新增角色: ${plan.roleChanges.added.join(", ") || "(none)"}`);
        log(`更新角色: ${plan.roleChanges.updated.join(", ") || "(none)"}`);
        log(`移除角色: ${plan.roleChanges.removed.join(", ") || "(none)"}`);
        for (const warning of plan.warnings) log(`[warn] ${warning}`);
      }

      if (opts.dryRun) return;
      if (!opts.yes) {
        throw new Error("Preview generated. Re-run with --yes to commit, or use --dry-run.");
      }

      await pipeline.commitFoundationImport(bookId, plan.proposed, {
        mode,
        expectedRevision: plan.foundationRevision,
        sourceBundle: bundle,
      });
      if (!opts.json) log(`Foundation import completed for ${bookId}.`);
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Foundation import failed: ${e}`);
      }
      process.exit(1);
    }
  });

importCommand
  .command("chapters")
  .description("Import existing chapters for continuation writing. Reverse-engineers all truth files.")
  .argument("[book-id]", "Target book ID (auto-detected if only one book)")
  .requiredOption("--from <path>", "Path to a text file (auto-split) or directory of .md/.txt files")
  .option("--split <regex>", "Custom regex for chapter splitting (single-file mode)")
  .option("--resume-from <n>", "Resume from chapter N (for interrupted imports)", parseInt)
  .option("--series", "Treat as a new series (shared universe, independent story) instead of direct continuation")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const config = await loadConfig();

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const existingChapterCount = (await state.getNextChapterNumber(bookId)) - 1;
      if (existingChapterCount > 0 && !opts.resumeFrom) {
        throw new Error(
          `Book "${bookId}" already has ${existingChapterCount} chapter(s). ` +
          `Use --resume-from <n> to append, or delete existing chapters first.`
        );
      }

      const fromPath = resolve(opts.from);
      const fromStat = await stat(fromPath);

      let chapters: Array<{ title: string; content: string }>;

      if (fromStat.isDirectory()) {
        // Directory mode: read each .md/.txt file in sorted order
        const entries = await readdir(fromPath);
        const textFiles = entries
          .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
          .sort();

        if (textFiles.length === 0) {
          throw new Error(`No .md or .txt files found in ${fromPath}`);
        }

        chapters = await Promise.all(
          textFiles.map(async (f) => {
            const content = await readFile(join(fromPath, f), "utf-8");
            const title = f.replace(/\.(md|txt)$/, "").replace(/^\d+[_\-\s]*/, "");
            return { title, content };
          }),
        );
      } else {
        // Single file mode: split by chapter pattern
        const text = await readFile(fromPath, "utf-8");
        chapters = [...splitChapters(text, opts.split)];

        if (chapters.length === 0) {
          throw new Error(
            `No chapters found in ${fromPath}. ` +
            `Default pattern matches "第X章" and "Chapter X". Use --split to provide a custom regex.`,
          );
        }
      }

      if (!opts.json) {
        log(formatImportChaptersDiscovery(language, chapters.length, bookId));
        if (opts.resumeFrom) {
          log(formatImportChaptersResume(language, opts.resumeFrom));
        }
      }

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      const result = await pipeline.importChapters({
        bookId,
        chapters,
        resumeFrom: opts.resumeFrom,
        importMode: opts.series ? "series" : "continuation",
      });

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatImportChaptersComplete(language, {
          importedCount: result.importedCount,
          totalWords: result.totalWords,
          nextChapter: result.nextChapter,
          continueBookId: bookId,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Chapter import failed: ${e}`);
      }
      process.exit(1);
    }
  });
