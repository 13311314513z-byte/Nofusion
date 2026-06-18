/**
 * Pipeline Stages Index
 *
 * Each stage is a self-contained module extracted from PipelineRunner.
 * Stages follow a functional pattern: (context, input) => output.
 *
 * Extraction status:
 *   ✅ notifications   — notification dispatch
 *   ✅ persistence     — chapter save + index update
 *   ✅ length-normalize — word count evaluation
 *   ⬜ plan            — chapter planning (generatePlan)
 *   ⬜ compose         — context assembly (composeChapter)
 *   ⬜ audit           — continuity audit (auditDraft)
 *   ⬜ revise          — chapter revision (reviseDraft)
 *   ⬜ post-validate   — post-write validation
 *   ⬜ book-create     — book creation + bootstrap
 *   ⬜ import-foundation — foundation source import
 */

export { runNotificationStage } from "./notifications.js";
export type { NotificationInput } from "./notifications.js";

export { runPersistenceStage } from "./persistence.js";
export type { PersistenceInput, PersistenceOutput } from "./persistence.js";

export { evaluateNormalizationNeed } from "./length-normalize.js";
export type { LengthNormalizeInput, LengthNormalizeOutput } from "./length-normalize.js";
