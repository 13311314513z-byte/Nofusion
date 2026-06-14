/**
 * Scene Template — reusable scene configuration for consistent scene rendering.
 *
 * Scene templates allow authors to save, load, and reuse scene configurations
 * across chapters. They capture the static elements of a location (props, routines,
 * atmosphere) so the Writer can maintain scene consistency.
 *
 * Persisted at: books/<bookId>/story/sources/scenes/<templateId>.json
 *
 * @module
 */

import { z } from "zod";

export const SceneTemplateSchema = z.object({
  /** Unique identifier for this template. */
  id: z.string().min(1),

  /** Human-readable name. */
  name: z.string().min(1, "Template name is required"),

  /** Scene type tag (e.g. "药房取药", "军营审讯", "街头接头"). */
  type: z.string().min(1),

  /** The physical location. */
  location: z.string().min(1, "Location is required"),

  /** Atmospheric / emotional tone. */
  atmosphere: z.string().min(1, "Atmosphere is required"),

  /** Notable props in this scene. */
  props: z.array(z.string()).default([]),

  /** Recurring routines or rituals. */
  routines: z.array(z.string()).default([]),

  /** Default characters who appear in this scene type. */
  defaultCharacters: z.array(z.string()).default([]),

  /** Other scene template IDs this scene links to. */
  linkedScenes: z.array(z.string()).default([]),

  /** Event template IDs this scene links to. */
  linkedEvents: z.array(z.string()).default([]),

  /** Free-form notes. */
  notes: z.string().default(""),

  /** How many times this template has been used. */
  usageCount: z.number().int().default(0),

  /** ISO timestamp of creation. */
  createdAt: z.string().datetime().default(() => new Date().toISOString()),

  /** ISO timestamp of last modification. */
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type SceneTemplate = z.infer<typeof SceneTemplateSchema>;

/** Index of all scene templates for a book. */
export const SceneTemplateIndexSchema = z.object({
  templates: z.array(SceneTemplateSchema).default([]),
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
});

export type SceneTemplateIndex = z.infer<typeof SceneTemplateIndexSchema>;
