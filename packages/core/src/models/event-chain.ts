/**
 * Event Chain — the causal sequence of scene events that drive a chapter.
 *
 * The event chain model captures the "scene → character → action → relationship →
 * decision" causal structure that powers the Narrative Control Block injected
 * into Writer prompts. It lives between Foundation Sources (raw material) and
 * the Composer/Writer pipeline.
 *
 * Persisted at: books/<bookId>/story/runtime/chapter-NNNN/event-chain.v{N}.json
 *
 * @module
 */

import { z } from "zod";

// ─── Event participant ────────────────────────────────────────────

export const EventParticipantSchema = z.object({
  /** Character identifier (matches role card id). */
  characterId: z.string().min(1, "Character ID is required"),
  /** Narrative role in this event. */
  role: z.enum(["protagonist", "antagonist", "ally", "observer", "catalyst"]),
  /** The character's dominant emotion at the start of this event. */
  initialEmotion: z.string().min(1, "Initial emotion is required"),
  /** What this character wants to achieve in this specific event. */
  goalInScene: z.string().min(1, "Goal in scene is required"),
});

export type EventParticipant = z.infer<typeof EventParticipantSchema>;

// ─── Event action ──────────────────────────────────────────────────

export const EventActionSchema = z.object({
  /** Who performs this action. */
  actorId: z.string().min(1),
  /** The kind of action. */
  type: z.enum(["verbal", "physical", "internal", "decision"]),
  /** Human-readable description of what happens. */
  description: z.string().min(1, "Action description is required"),
  /** Who this action is directed at (if anyone). */
  targetId: z.string().optional(),
  /** Why the actor does this. */
  intent: z.string().min(1, "Intent is required"),
  /** What happens as a result. */
  outcome: z.string().min(1, "Outcome is required"),
});

export type EventAction = z.infer<typeof EventActionSchema>;

// ─── Relationship delta ────────────────────────────────────────────

export const RelationshipDeltaSchema = z.object({
  /** The character whose relationship is changing. */
  fromId: z.string().min(1),
  /** The character being related to. */
  toId: z.string().min(1),
  /** Relationship status before this event. */
  before: z.string().min(1),
  /** Relationship status after this event. */
  after: z.string().min(1),
  /** What triggered this relationship change (action description or event id). */
  trigger: z.string().min(1),
});

export type RelationshipDelta = z.infer<typeof RelationshipDeltaSchema>;

// ─── Decision point ────────────────────────────────────────────────

export const DecisionPointSchema = z.object({
  /** Who is making the decision. */
  deciderId: z.string().min(1),
  /** The dilemma the character faces. */
  dilemma: z.string().min(1, "Dilemma is required"),
  /** At least two options. */
  options: z.array(z.string()).min(2, "At least two options required"),
  /** Which option was chosen. */
  chosen: z.string().min(1),
  /** Why this option was chosen. */
  reasoning: z.string().min(1),
  /** Immediate consequence of this decision. */
  consequence: z.string().min(1),
});

export type DecisionPoint = z.infer<typeof DecisionPointSchema>;

// ─── Event node ────────────────────────────────────────────────────

export const EventNodeSchema = z.object({
  /** Unique identifier for this event (e.g. "evt-001"). */
  eventId: z.string().min(1),

  /** Which chapter this event belongs to. */
  chapterNumber: z.number().int().positive(),

  /** Ordinal position within the chapter (0-based). */
  sceneIndex: z.number().int().min(0),

  /** Where this event takes place. */
  location: z.string().min(1, "Location is required"),

  /** Time of day (e.g. "午后", "黄昏", "深夜"). */
  timeOfDay: z.string().min(1, "Time of day is required"),

  /** Atmospheric / emotional tone of the scene (e.g. "紧张", "温馨", "诡异"). */
  atmosphere: z.string().min(1, "Atmosphere is required"),

  /** Who is involved in this event. */
  participants: z.array(EventParticipantSchema).min(1, "At least one participant required"),

  /** Ordered sequence of actions within this event. */
  actions: z.array(EventActionSchema).min(1, "At least one action required"),

  /** Relationship changes triggered by this event. */
  relationshipDeltas: z.array(RelationshipDeltaSchema).default([]),

  /** Key decision points within this event. */
  decisions: z.array(DecisionPointSchema).default([]),

  // ── Causal linking ───────────────────────────────────────

  /** The eventId of the next event this triggers (intra-chapter). */
  triggersNext: z.string().optional(),

  /** The eventId that triggered this event (intra-chapter). */
  triggeredBy: z.string().optional(),

  // ── Provenance ───────────────────────────────────────────

  /** Source files used to extract / infer this event. */
  sourceFiles: z.array(z.string()).default([]),

  /** How confident the extraction / inference engine is about this event (0–1). */
  confidence: z.number().min(0).max(1).default(0.5),
});

export type EventNode = z.infer<typeof EventNodeSchema>;

// ─── Event chain ───────────────────────────────────────────────────

export const EventChainSchema = z.object({
  /** The book this chain belongs to. */
  bookId: z.string().min(1),

  /** The chapter this chain describes. */
  chapterNumber: z.number().int().positive(),

  /** Ordered list of event nodes for this chapter. */
  events: z.array(EventNodeSchema).default([]),

  /** ISO timestamp when this chain was generated. */
  generatedAt: z.string().datetime(),

  /** Source files that contributed to this chain. */
  sourceFiles: z.array(z.string()).default([]),

  /** Overall confidence score for the chain (0–1). */
  confidence: z.number().min(0).max(1).default(0.5),
});

export type EventChain = z.infer<typeof EventChainSchema>;

// ─── Narrative Control Block ───────────────────────────────────────

/**
 * The Narrative Control Block is the serialized form of an EventChain
 * that gets injected into the Writer's system prompt. It uses Markdown
 * formatting so the LLM can read it naturally.
 */
export const NarrativeControlBlockSchema = z.object({
  /** Reference to the source chain. */
  chainId: z.string().min(1),
  /** The rendered Markdown text ready for prompt injection. */
  markdown: z.string().min(1),
  /** Number of included events. */
  eventCount: z.number().int().min(0),
});

export type NarrativeControlBlock = z.infer<typeof NarrativeControlBlockSchema>;

// ─── Extraction / inference metadata ───────────────────────────────

/** Log entry recording how a causal link was inferred. */
export const InferenceReasoningEntrySchema = z.object({
  rule: z.string(),             // e.g. "Rule A: same actor"
  fromEventId: z.string(),
  toEventId: z.string(),
  details: z.string(),
});

export type InferenceReasoningEntry = z.infer<typeof InferenceReasoningEntrySchema>;
