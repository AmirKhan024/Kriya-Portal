import 'server-only';
import { z } from 'zod';

/**
 * Validates a test ID format
 */
export function isValidTestId(testId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(testId) && testId.length > 0 && testId.length <= 100;
}

/**
 * Validates user age
 */
export function validateAge(age: number): boolean {
  return Number.isInteger(age) && age >= 1 && age <= 120;
}

/**
 * Schema for raw test input validation
 */
export const rawTestInputSchema = z.object({
  testId: z.string().min(1).max(100),
  hits: z.number().int().min(0).optional(),
  misses: z.number().int().min(0).optional(),
  breachCount: z.number().int().min(0).optional(),
  maxSwayDegrees: z.number().min(0).optional(),
  duration: z.number().int().min(0).optional(),
  customMetrics: z.record(z.string(), z.unknown()).optional(),
});

export type RawTestInput = z.infer<typeof rawTestInputSchema>;

export type ValidationResult = { valid: boolean; errors?: string[] };

/**
 * Validates raw test input
 */
export function validateRawInput(input: unknown): ValidationResult {
  const result = rawTestInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { valid: false, errors };
  }
  return { valid: true };
}

// --- Plausibility Validators ---
// These prevent impossible values from being submitted.
// Max values are generous - they reject clearly fabricated data, not outliers.

/** Max plausible hits per test in a 30-second window */
const MAX_HITS: Record<string, number> = {
  NN1: 60, // Ball Catch: max ~2/sec
  NN2: 50, // Color Choose: slower due to color matching
  NN3: 40, // Cross Tap: cross-body is slower
  NN4: 60, // Flash Tap: fast reactions
  NN5: 40, // Cross Body Strike: complex movement
  BB1: 10, // Two-Leg Stand: not a hit-based test
  BB2: 10,
  BB3: 10,
  BB4: 10,
  FA1: 60, // Hand Swings
  FA2: 40, // Head Rotation
  FA3: 40, // Circle of Reach
  FA4: 40, // Hip Hinge
  FA5: 40, // Knee Arc Glide
  FA6: 40, // Hand Swings (max 40 green button hits)
  KS1: 50, // Static Target
  KS2: 20, // Finger to Foot
  KS3: 30, // Nose & Wrist
};

/** Max plausible sway in degrees for balance tests */
const MAX_SWAY_DEGREES = 90;

/** Max plausible duration override (5 minutes for a 30-sec test) */
const MAX_DURATION_SEC = 300;

export type PlausibilityResult = { plausible: boolean; violations: string[] };

/**
 * Checks whether submitted test metrics are within plausible ranges.
 * Returns violations list for logging/flagging.
 */
export function checkPlausibility(
  testId: string,
  data: { hits?: number; misses?: number; breachCount?: number; maxSwayDegrees?: number; duration?: number }
): PlausibilityResult {
  const violations: string[] = [];

  // Hit count plausibility
  if (data.hits !== undefined) {
    const maxHits = MAX_HITS[testId] ?? 100;
    if (data.hits > maxHits) {
      violations.push(`hits (${data.hits}) exceeds max plausible (${maxHits}) for ${testId}`);
    }
  }

  // Miss count shouldn't exceed total possible events
  if (data.misses !== undefined && data.hits !== undefined) {
    const total = data.hits + data.misses;
    const maxTotal = (MAX_HITS[testId] ?? 100) * 2;
    if (total > maxTotal) {
      violations.push(`total events (${total}) exceeds max plausible (${maxTotal})`);
    }
  }

  // Sway plausibility (balance tests)
  if (data.maxSwayDegrees !== undefined && data.maxSwayDegrees > MAX_SWAY_DEGREES) {
    violations.push(`maxSwayDegrees (${data.maxSwayDegrees}) exceeds ${MAX_SWAY_DEGREES}°`);
  }

  // Duration plausibility
  if (data.duration !== undefined && data.duration > MAX_DURATION_SEC) {
    violations.push(`duration (${data.duration}s) exceeds max plausible (${MAX_DURATION_SEC}s)`);
  }

  // Breach count for balance tests
  if (data.breachCount !== undefined && data.breachCount > 100) {
    violations.push(`breachCount (${data.breachCount}) exceeds max plausible (100)`);
  }

  return {
    plausible: violations.length === 0,
    violations,
  };
}
