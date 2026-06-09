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
 * Default per-member channel opt-in. Telegram is the only live channel; a member
 * is reachable once they connect (telegram_chat_id set). The dispatcher handles
 * the not-connected case gracefully.
 */
export function defaultOptIn(): ChannelOptIn {
  return { telegram: true };
}
