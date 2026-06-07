import { z } from 'zod';

/** Zod schemas for the assessment endpoints (feature 1c-b). Pure — no DB/Next imports. */

export const createAssessmentSchema = z.object({
  member_id: z.string().uuid(),
  type: z.enum(['quick', 'deep']),
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

/** Raw per-game metrics posted from the scan client (test_id validated separately). */
export const resultSchema = z.object({
  test_id: z.string().min(1),
  hits: z.number().int().min(0).optional(),
  misses: z.number().int().min(0).optional(),
  breachCount: z.number().int().min(0).optional(),
  maxSwayDegrees: z.number().min(0).optional(),
  duration: z.number().min(0).optional(),
  customMetrics: z.record(z.string(), z.number()).optional(),
});
export type ResultInput = z.infer<typeof resultSchema>;

/** Roles permitted to run a scan (RBAC table: clinic_admin, ortho, physio). */
export const SCAN_ROLES = ['clinic_admin', 'ortho', 'physio'] as const;
