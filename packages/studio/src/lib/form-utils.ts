/**
 * Lightweight form validation utilities — zero new dependencies.
 *
 * Provides two patterns:
 *   1. useZodForm — full-form validation with Zod schema (on submit)
 *   2. useFieldValidator — per-field inline validation (on blur)
 *
 * Inspired by React Hook Form + Zod but implemented as ~80 lines
 * to avoid adding dependencies.
 */

import { useState, useCallback } from "react";
import type { z } from "zod";

// ─── Full-form validation (on submit) ─────────────────────────────

interface ZodFormState<T> {
  readonly errors: Record<string, string>;
  readonly submitting: boolean;
  readonly handleSubmit: (formData: T) => Promise<boolean>;
  readonly clearErrors: () => void;
}

/**
 * Validate form data against a Zod schema on submit.
 * Returns { errors, submitting, handleSubmit, clearErrors }.
 *
 * Usage:
 *   const { errors, submitting, handleSubmit } = useZodForm(MySchema);
 *   await handleSubmit(formData); // returns true if valid
 */
export function useZodForm<T extends z.ZodType>(
  schema: T,
  onSubmit: (data: z.infer<T>) => Promise<void>,
): ZodFormState<z.infer<T>> {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (formData: z.infer<T>): Promise<boolean> => {
    const result = schema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.data);
      return true;
    } finally {
      setSubmitting(false);
    }
  }, [schema, onSubmit]);

  const clearErrors = useCallback(() => setErrors({}), []);

  return { errors, submitting, handleSubmit, clearErrors };
}

// ─── Per-field inline validation (on blur) ────────────────────────

interface FieldValidatorState {
  readonly error: string | null;
  readonly validate: () => boolean;
  readonly reset: () => void;
}

/**
 * Validate a single field value against a custom validator function.
 * Returns true if valid, sets error message if invalid.
 *
 * Usage:
 *   const { error, validate } = useFieldValidator(
 *     title,
 *     (v) => v.trim().length > 0 ? null : "Title is required"
 *   );
 *   <input onBlur={validate} />
 *   {error && <span className="text-red-500">{error}</span>}
 */
export function useFieldValidator<T>(
  value: T,
  validator: (v: T) => string | null,
): FieldValidatorState {
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback((): boolean => {
    const msg = validator(value);
    setError(msg);
    return msg === null;
  }, [value, validator]);

  const reset = useCallback(() => setError(null), []);

  return { error, validate, reset };
}

// ─── Common validators ─────────────────────────────────────────────

export const validators = {
  /** Non-empty trimmed string. */
  required: (label: string) => (v: string) =>
    v.trim().length > 0 ? null : `${label}不能为空`,

  /** Positive integer. */
  positiveInt: (label: string) => (v: number | undefined) =>
    v === undefined || v === null || (Number.isInteger(v) && v > 0)
      ? null
      : `${label}必须为正整数`,

  /** String length between min and max. */
  length: (label: string, min: number, max: number) => (v: string) => {
    const len = v.trim().length;
    if (len === 0) return null; // allow empty
    if (len < min) return `${label}至少${min}个字符`;
    if (len > max) return `${label}最多${max}个字符`;
    return null;
  },

  /** Value must be one of allowed options. */
  oneOf: <T extends string>(label: string, options: ReadonlyArray<T>) => (v: string) =>
    options.includes(v as T) ? null : `${label}必须是: ${options.join("、")}`,
};
