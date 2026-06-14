/**
 * Event Chain Inference Engine — links extracted event nodes into a causal chain.
 *
 * Takes raw EventNode[] from the Extractor and applies rule-based causal linking,
 * hook annotation, and (optionally) LLM-enhanced reasoning to produce a fully
 * linked EventChain ready for Writer injection.
 *
 * Rules (zero LLM cost):
 *   Rule A: Consecutive events sharing the same primary actor → causal link.
 *   Rule B: A relationshipDelta.trigger in event N matches an action in event N+1 → link.
 *   Rule C: Events at the same location with temporal adjacency → link.
 *   Rule D: A decision in event N has consequence matching event N+1's scenario → link.
 *
 * @module
 */

import { BaseAgent, type AgentContext } from "./base.js";
import {
  EventChainSchema,
  type EventNode,
  type EventChain,
  type InferenceReasoningEntry,
} from "../models/event-chain.js";

// ─── Input / Output ─────────────────────────────────────────────────

export interface InferenceInput {
  /** Events extracted from source materials. */
  readonly extractedEvents: ReadonlyArray<EventNode>;
  /** Active hooks from the book's hook ledger (for annotation, not extraction). */
  readonly activeHookIds?: ReadonlyArray<string>;
  /** Character-to-character relationship statuses. */
  readonly relationshipMap?: Record<string, Record<string, string>>;
  /** The previous chapter's event chain (for inter-chapter causal linking). */
  readonly previousChain?: EventChain;
  /** Whether to use LLM to resolve ambiguous causal links. */
  readonly useLlm?: boolean;
}

export interface InferenceOutput {
  /** The fully linked event chain. */
  readonly chain: EventChain;
  /** Reasoning log for each causal link. */
  readonly reasoningLog: ReadonlyArray<InferenceReasoningEntry>;
  /** Overall confidence (0–1). */
  readonly confidence: number;
}

// ─── Agent ──────────────────────────────────────────────────────────

export class EventChainInferenceEngine extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "event-chain-inference";
  }

  async execute(input: InferenceInput): Promise<InferenceOutput> {
    const log: InferenceReasoningEntry[] = [];
    const events = [...input.extractedEvents].sort((a, b) => a.sceneIndex - b.sceneIndex);

    if (events.length === 0) {
      return {
        chain: {
          bookId: "",
          chapterNumber: 0,
          events: [],
          generatedAt: new Date().toISOString(),
          sourceFiles: [],
          confidence: 0,
        },
        reasoningLog: [],
        confidence: 0,
      };
    }

    // ── Phase 1: Rule-based causal linking ─────────────────────
    this.linkCausally(events, log);

    // ── Phase 2: LLM enhancement for unlinked events ───────────
    if (input.useLlm) {
      await this.enhanceWithLLM(events, input, log);
    }

    // ── Phase 3: Cross-chapter linking ─────────────────────────
    if (input.previousChain && input.previousChain.events.length > 0) {
      this.linkInterChapter(events, input.previousChain, log);
    }

    // ── Phase 4: Calculate confidence ──────────────────────────
    const confidence = this.calculateConfidence(events);

    return {
      chain: {
        bookId: "",
        chapterNumber: events[0]?.chapterNumber ?? 0,
        events,
        generatedAt: new Date().toISOString(),
        sourceFiles: [...new Set(events.flatMap(e => e.sourceFiles ?? []))],
        confidence,
      },
      reasoningLog: log,
      confidence,
    };
  }

  // ── Rule-based causal linking ──────────────────────────────────

  private linkCausally(
    events: EventNode[],
    log: InferenceReasoningEntry[],
  ): void {
    for (let i = 0; i < events.length; i++) {
      const current = events[i];
      const next = events[i + 1];

      if (!next) break; // Last event — no next to link to

      // Rule A: Same primary actor across consecutive events
      const currentPrimary = current.participants.find(p => p.role === "protagonist");
      const nextPrimary = next.participants.find(p => p.role === "protagonist");
      if (
        currentPrimary && nextPrimary &&
        currentPrimary.characterId === nextPrimary.characterId
      ) {
        this.addLink(current, next, {
          rule: "Rule A: same protagonist",
          fromEventId: current.eventId,
          toEventId: next.eventId,
          details: `${currentPrimary.characterId} continues from event ${current.eventId} to ${next.eventId}`,
        }, log);
        continue;
      }

      // Rule B: Relationship delta trigger matches next event's participants
      for (const delta of current.relationshipDeltas ?? []) {
        const affectedChars = [delta.fromId, delta.toId];
        const nextHasAffected = next.participants.some(
          p => affectedChars.includes(p.characterId),
        );
        if (nextHasAffected) {
          this.addLink(current, next, {
            rule: "Rule B: relationship delta bridges events",
            fromEventId: current.eventId,
            toEventId: next.eventId,
            details: `Relationship change ${delta.fromId}↔${delta.toId}: ${delta.before} → ${delta.after} triggers next event`,
          }, log);
          break;
        }
      }

      // Rule C: Same location, temporal adjacency
      if (
        current.location === next.location ||
        current.location.includes(next.location) ||
        next.location.includes(current.location)
      ) {
        this.addLink(current, next, {
          rule: "Rule C: same location",
          fromEventId: current.eventId,
          toEventId: next.eventId,
          details: `Both events at "${current.location}"`,
        }, log);
        continue;
      }

      // Rule D: Decision consequence → next event scenario
      for (const decision of current.decisions ?? []) {
        const conTerms = this.extractCJKTerms(decision.consequence, 2);
        const nextDesc = [
          next.atmosphere,
          ...next.actions.map(a => a.description),
        ].join(" ");
        const matched = conTerms.filter(t => nextDesc.includes(t));
        if (matched.length >= Math.max(1, Math.floor(conTerms.length / 3))) {
          this.addLink(current, next, {
            rule: "Rule D: decision consequence → next event",
            fromEventId: current.eventId,
            toEventId: next.eventId,
            details: `Decision by ${decision.deciderId}: "${decision.chosen}" → "${decision.consequence}" manifests in next event`,
          }, log);
          break;
        }
      }
    }
  }

  // ── Inter-chapter linking ──────────────────────────────────────

  private linkInterChapter(
    current: EventNode[],
    previous: EventChain,
    log: InferenceReasoningEntry[],
  ): void {
    const prevLast = previous.events.at(-1);
    const currFirst = current[0];

    if (prevLast && currFirst && !currFirst.triggeredBy) {
      currFirst.triggeredBy = prevLast.eventId;
      log.push({
        rule: "Inter-chapter",
        fromEventId: prevLast.eventId,
        toEventId: currFirst.eventId,
        details: `Chapter ${prevLast.chapterNumber} last event → Chapter ${currFirst.chapterNumber} first event`,
      });
    }
  }

  // ── LLM enhancement ────────────────────────────────────────────

  private async enhanceWithLLM(
    events: EventNode[],
    input: InferenceInput,
    log: InferenceReasoningEntry[],
  ): Promise<void> {
    const unlinked = events.filter(
      e => !e.triggeredBy && !e.triggersNext,
    );

    if (unlinked.length <= 1) return; // Nothing to resolve

    // Build a concise prompt asking the LLM to suggest causal links
    const eventsDesc = unlinked
      .map(e => `${e.eventId}: ${e.location} - ${e.participants.map(p => p.characterId).join(", ")} - ${e.atmosphere}`)
      .join("\n");

    const prompt = `以下事件尚未建立因果链接。请分析它们之间是否存在因果关系：

${eventsDesc}

如果存在因果关系，请输出 JSON 数组，每项格式为：
{"fromEventId": "源事件ID", "toEventId": "目标事件ID", "reason": "因果推理（一句话）"}
如果没有明显的因果关系，输出空数组 []。只输出 JSON。`;

    try {
      const response = await this.chat(
        [
          { role: "system", content: "你是一个叙事因果分析器。只输出JSON。" },
          { role: "user", content: prompt },
        ],
        { temperature: 0.1, maxTokens: 1024 },
      );

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        fromEventId: string;
        toEventId: string;
        reason: string;
      }>;

      for (const sug of suggestions) {
        const from = events.find(e => e.eventId === sug.fromEventId);
        const to = events.find(e => e.eventId === sug.toEventId);
        if (from && to) {
          this.addLink(from, to, {
            rule: "LLM-inferred",
            fromEventId: sug.fromEventId,
            toEventId: sug.toEventId,
            details: sug.reason,
          }, log);
        }
      }
    } catch {
      // LLM enhancement failure is non-fatal
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private addLink(
    from: EventNode,
    to: EventNode,
    entry: InferenceReasoningEntry,
    log: InferenceReasoningEntry[],
  ): void {
    from.triggersNext = to.eventId;
    to.triggeredBy = from.eventId;
    log.push(entry);
  }

  private extractCJKTerms(text: string, minLen: number): string[] {
    const terms: string[] = [];
    const cjkOnly = text.replace(/[^\u4e00-\u9fff]/g, "");
    for (let i = 0; i <= cjkOnly.length - minLen; i++) {
      terms.push(cjkOnly.slice(i, i + minLen));
    }
    return [...new Set(terms)];
  }

  private calculateConfidence(events: EventNode[]): number {
    if (events.length <= 1) return 1.0;
    const linked = events.filter(e => e.triggeredBy || e.triggersNext).length;
    return Math.round((linked / (events.length - 1)) * 100) / 100;
  }
}
