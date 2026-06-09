/**
 * Appointment request schemas (feature 2d). Single source of truth for request
 * shape; reused by routes and tests.
 */
import { z } from 'zod';
import { APPOINTMENT_TYPES, DAY_NAMES } from './constants';

// Accept any Postgres-valid uuid (seed/imported ids aren't strict RFC-v4).
const PG_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const pgUuid = z.string().regex(PG_UUID, 'Invalid id');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createAppointmentSchema = z.object({
  member_id: pgUuid,
  clinician_id: pgUuid,
  slot: z.string().datetime(), // ISO 8601
  type: z.enum(APPOINTMENT_TYPES),
});
export type CreateAppointmentBody = z.infer<typeof createAppointmentSchema>;

export const patchAppointmentSchema = z.object({
  status: z.enum(['completed', 'no_show', 'cancelled']),
});

export const availabilitySchema = z.object({
  slots: z.array(z.object({
    day_of_week: z.enum(DAY_NAMES),
    start_time: z.string().regex(HHMM, 'Expected HH:MM'),
    end_time: z.string().regex(HHMM, 'Expected HH:MM'),
  })).max(50),
});
export type AvailabilityBody = z.infer<typeof availabilitySchema>;
