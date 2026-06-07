/**
 * Care Video request schemas (feature 3a).
 */
import { z } from 'zod';

const PG_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const pgUuid = z.string().regex(PG_UUID, 'Invalid id');

export const createVideoSchema = z.object({
  title: z.string().trim().min(1).max(200),
  regions: z.string().trim().max(500).optional(),
  conditions: z.string().trim().max(500).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  visibility: z.enum(['all', 'logged_in', 'assigned']).optional(),
});
export type CreateVideoBody = z.infer<typeof createVideoSchema>;

export const assignVideoSchema = z.object({
  video_id: pgUuid,
});
