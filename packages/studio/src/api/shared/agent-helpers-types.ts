/**
 * Shared agent helper types — used by server.ts and extracted route modules.
 */

export interface CollectedToolExec {
  id: string;
  tool: string;
  agent?: string;
  label: string;
  status: "running" | "completed" | "error";
  args?: Record<string, unknown>;
  result?: string;
  details?: unknown;
  error?: string;
  stages?: Array<{ label: string; status: "pending" | "completed" }>;
  startedAt: number;
  completedAt?: number;
}
