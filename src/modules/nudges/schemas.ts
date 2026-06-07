/**
 * Nudge request schemas (feature 2c). Single source of truth for request shape;
 * reused by the routes and tests.
 */
import { z } from 'zod';
import { NUDGE_CHANNELS } from './constants';
import type { ChannelOptIn } from './channel';

// Accept any Postgres-valid uuid (8-4-4-4-12 hex). Zod's strict .uuid() rejects
// non-RFC-v4 variants (e.g. seed/imported ids) that Postgres stores fine.
const PG_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const pgUuid = z.string().regex(PG_UUID, 'Invalid id');

export const createNudgeSchema = z.object({
  member_id: pgUuid,
  message: z.string().trim().min(1).max(1000),
  channel: z.enum(NUDGE_CHANNELS).optional(),
  /** Free-form category for analytics (e.g. 'reminder', 'reengagement'). */
  type: z.string().trim().min(1).max(64).optional(),
});
export type CreateNudgeBody = z.infer<typeof createNudgeSchema>;

export const patchNudgeSchema = z.object({
  status: z.literal('responded'),
});

/**
 * Default per-member channel opt-in (DOCUMENTED DEFAULT — no preference column
 * yet; see channel.ts). Push is always available; WhatsApp/SMS default on so
 * manual sends work. Swap for real preferences when that table lands.
 */
export function defaultOptIn(): ChannelOptIn {
  return { whatsapp: true, push: true, sms: true };
}
