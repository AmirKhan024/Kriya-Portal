import { z } from 'zod';
import { uuidish } from '@/server/validation';
import {
  PAIN_REGIONS, PAIN_TYPES, SEGMENTS, SEXES, CONSENT_TYPES, CONSENT_METHODS,
} from './constants';

/**
 * Zod schemas for feature 1b (Add Member + Consent). These are the single source of
 * truth for request validation and are imported by both the API routes and the unit
 * tests. Pure (no DB / Next imports) so they can run in plain Node tests.
 */

/**
 * Mobile = identity key. Accept human-entered formatting (spaces, dashes, parens,
 * optional leading +); the route normalizes to digits before storing. Validation is
 * on the digit count (10–15) so "98765 43210" and "+91-98765-43210" are both valid.
 */
const mobileSchema = z
  .string()
  .trim()
  .refine((v) => /^[+\d][\d\s().-]*$/.test(v), 'Enter a valid mobile number')
  .refine((v) => {
    const digits = v.replace(/[^\d]/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }, 'Enter a valid mobile number (10–15 digits)');

export const painFlagInputSchema = z.object({
  region: z.enum(PAIN_REGIONS),
  severity: z.number().int().min(0).max(10),
  type: z.enum(PAIN_TYPES),
});
export type PainFlagInput = z.infer<typeof painFlagInputSchema>;

export const consentInputSchema = z.object({
  type: z.enum(CONSENT_TYPES).default('clinical'),
  method: z.enum(CONSENT_METHODS),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

export const createMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  mobile: mobileSchema,
  age: z.number().int().min(0).max(120).optional(),
  sex: z.enum(SEXES).optional(),
  branch_id: uuidish.optional(),
  /** Optional — auto-derived from complaint presence when omitted (see deriveSegment). */
  segment: z.enum(SEGMENTS).optional(),
  complaint: z.string().trim().max(500).optional(),
  /** Clinician to assign to; defaults to the creating user when omitted. */
  clinician_id: uuidish.optional(),
  /** Quick pain map captured at creation (triage signal — gates scan safety later). */
  pain_map: z.array(painFlagInputSchema).max(20).optional(),
  /** Consent may be captured at creation or later via the consent endpoint. */
  consent: consentInputSchema.optional(),
  /** Set true to create a member despite a duplicate mobile (explicit "create new anyway"). */
  allow_duplicate: z.boolean().optional(),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const assignmentInputSchema = z.object({
  clinician_id: z.string().uuid('A valid clinician is required'),
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
