/**
 * Event Chain Extractor — extracts structured event nodes from Foundation Sources.
 *
 * Reads source materials (scene descriptions, character profiles, event templates)
 * and outputs structured EventNode[] that the InferenceEngine can then link.
 *
 * Two modes:
 *   1. Frontmatter-based (zero LLM cost): extracts events from YAML frontmatter
 *      fields like linkedCharacters, linkedScenes, linkedEvents.
 *   2. LLM-assisted (opt-in): uses a cheap model to semantically parse body
 *      content into event participants, actions, and decisions.
 *
 * @module
 */

import { BaseAgent, type AgentContext } from "./base.js";
import { EventNodeSchema, type EventNode } from "../models/event-chain.js";

// ─── Input / Output ─────────────────────────────────────────────────

export interface ExtractorSource {
  /** Relative path within the sources directory. */
  readonly path: string;
  /** Full text content (Markdown body after frontmatter). */
  readonly content: string;
  /** Parsed YAML frontmatter fields. */
  readonly frontmatter: Record<string, unknown>;
}

export interface ExtractorInput {
  /** Source files to extract events from. */
  readonly sources: ReadonlyArray<ExtractorSource>;
  /** Target chapter number. */
  readonly chapterNumber: number;
  /** Known characters from the book. */
  readonly characters: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly traits?: ReadonlyArray<string>;
  }>;
  /** Whether to use LLM for semantic extraction (default: false). */
  readonly useLlm?: boolean;
}

export interface ExtractorOutput {
  /** Extracted and validated event nodes. */
  readonly events: ReadonlyArray<EventNode>;
  /** Non-critical warnings (e.g., unparseable sections). */
  readonly warnings: ReadonlyArray<string>;
  /** Overall confidence in the extraction (0–1). */
  readonly confidence: number;
}

// ─── Agent ──────────────────────────────────────────────────────────

export class EventChainExtractor extends BaseAgent {
  constructor(ctx: AgentContext) {
    super(ctx);
  }

  get name(): string {
    return "event-chain-extractor";
  }

  async execute(input: ExtractorInput): Promise<ExtractorOutput> {
    const warnings: string[] = [];
    const allNodes: EventNode[] = [];

    // Phase 1: Frontmatter-based extraction (zero LLM cost)
    for (const source of input.sources) {
      const fNodes = this.extractFromFrontmatter(source, input);
      for (const node of fNodes) {
        const result = EventNodeSchema.safeParse(node);
        if (result.success) {
          allNodes.push(result.data);
        } else {
          warnings.push(
            `[${source.path}] Frontmatter event validation failed: ${result.error.message.slice(0, 100)}`,
          );
        }
      }
    }

    // Phase 2: LLM-assisted semantic extraction (opt-in)
    if (input.useLlm && input.sources.length > 0) {
      try {
        const llmNodes = await this.extractViaLLM(input);
        for (const node of llmNodes) {
          const result = EventNodeSchema.safeParse(node);
          if (result.success) {
            // Avoid duplicates: skip if an event with the same eventId already exists
            if (!allNodes.some(n => n.eventId === result.data.eventId)) {
              allNodes.push(result.data);
            }
          } else {
            warnings.push(
              `[LLM] Event validation failed for node "${(node as Record<string, unknown>).eventId ?? "unknown"}": ${result.error.message.slice(0, 100)}`,
            );
          }
        }
      } catch (e) {
        warnings.push(`LLM extraction failed: ${String(e)}`);
      }
    }

    // Sort by sceneIndex
    allNodes.sort((a, b) => a.sceneIndex - b.sceneIndex);

    return {
      events: allNodes,
      warnings,
      confidence: allNodes.length > 0
        ? (input.useLlm ? 0.75 : 0.5)
        : 0.1,
    };
  }

  // ── Frontmatter extraction ─────────────────────────────────────

  private extractFromFrontmatter(
    source: ExtractorSource,
    input: ExtractorInput,
  ): Partial<EventNode>[] {
    const fm = source.frontmatter;
    const nodes: Partial<EventNode>[] = [];

    // Only process sources with type metadata
    const sourceType = fm["type"] as string | undefined;
    if (!sourceType) return nodes;

    // Build a basic event node from frontmatter
    const linkedCharacters = this.asStringArray(fm["linkedCharacters"]);
    const linkedScenes = this.asStringArray(fm["linkedScenes"]);

    // If this source links to characters, create participants
    const participants = linkedCharacters
      .map((name, i) => {
        const char = input.characters.find(
          c => c.name === name || c.id === name,
        );
        if (!char) return null;
        return {
          characterId: char.id,
          role: i === 0 ? "protagonist" as const : "ally" as const,
          initialEmotion: sourceType === "event" ? "警觉" : "平静",
          goalInScene: `参与${source.path.replace(/\.md$/, "")}中的事件`,
        };
      })
      .filter(Boolean) as EventNode["participants"];

    // Only create a node if we have participants or a scene link
    if (participants.length > 0 || linkedScenes.length > 0) {
      const sourceId = source.path.replace(/\.md$/, "").replace(/\//g, "-");
      nodes.push({
        eventId: `evt-ext-${sourceId}-${input.chapterNumber}`,
        chapterNumber: input.chapterNumber,
        sceneIndex: nodes.length,
        location: sourceType === "scene"
          ? (fm["location"] as string) ?? sourceId
          : "待定",
        timeOfDay: (fm["timeOfDay"] as string) ?? "待定",
        atmosphere: sourceType === "scene"
          ? (fm["atmosphere"] as string) ?? "中性"
          : "叙事",
        participants: participants.length > 0 ? participants : [{
          characterId: "narrator",
          role: "observer" as const,
          initialEmotion: "客观",
          goalInScene: "展开叙述",
        }],
        actions: [{
          actorId: participants[0]?.characterId ?? "narrator",
          type: "physical",
          description: sourceType === "event"
            ? (fm["description"] as string) ?? `事件: ${sourceId}`
            : `场景展开: ${sourceId}`,
          intent: (fm["intent"] as string) ?? "推进叙事",
          outcome: "事件展开",
        }],
        sourceFiles: [source.path],
        confidence: 0.3, // Low confidence for frontmatter-only extraction
      });
    }

    return nodes;
  }

  // ── LLM extraction ─────────────────────────────────────────────

  private async extractViaLLM(input: ExtractorInput): Promise<Partial<EventNode>[]> {
    // Build the prompt using all source bodies
    const sourcesText = input.sources
      .map(s => `### ${s.path}\n类型: ${s.frontmatter["type"] ?? "未知"}\n${s.content.slice(0, 1500)}`)
      .join("\n\n---\n\n");

    const charactersText = input.characters
      .map(c => `- ${c.name} (ID: ${c.id})${c.traits ? ` | 特征: ${c.traits.join(", ")}` : ""}`)
      .join("\n");

    const systemPrompt = `你是一个叙事事件链提取器。你的任务是从给定的原始资料中提取结构化的叙事事件节点。

每个事件节点必须包含:
- eventId: 唯一标识 (如 "evt-001")
- chapterNumber: ${input.chapterNumber}
- sceneIndex: 序号 (0, 1, 2...)
- location: 地点
- timeOfDay: 时间
- atmosphere: 氛围
- participants: [{ characterId, role: "protagonist"|"antagonist"|"ally"|"observer"|"catalyst", initialEmotion, goalInScene }]
- actions: [{ actorId, type: "verbal"|"physical"|"internal"|"decision", description, intent, outcome }]
- relationshipDeltas: [{ fromId, toId, before, after, trigger }] (可选)
- decisions: [{ deciderId, dilemma, options, chosen, reasoning, consequence }] (可选)

只输出 JSON 数组，不要任何其他文字。`;

    const userPrompt = `## 原始资料
${sourcesText}

## 已知角色
${charactersText}

## 任务
从以上资料中提取第 ${input.chapterNumber} 章的事件节点。输出纯 JSON 数组。`;

    const response = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.2, maxTokens: 4096 },
    );

    try {
      // Extract JSON array from response
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("No JSON array found in LLM response");
      }
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error("LLM response is not a JSON array");
      }
      return parsed as Partial<EventNode>[];
    } catch (e) {
      throw new Error(`Failed to parse LLM event extraction response: ${String(e)}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
    if (typeof value === "string") return [value];
    return [];
  }
}
