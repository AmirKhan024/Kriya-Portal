/**
 * Appointments (feature 2d) — shared constants.
 *
 * DOCUMENTED HEURISTIC — slot duration + reminder windows need product/clinical
 * sign-off (like the nudges caps). Centralised here so the policy is one place.
 */

export const APPOINTMENT_TYPES = ['consultation', 'assessment', 'follow_up'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = ['booked', 'completed', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Fixed slot length — appointments occupy a single `slot` timestamp + this duration. */
export const SLOT_DURATION_MIN = 30;

/** Reminder windows before the appointment (T-24h and T-2h), per brief §8 2d. */
export const REMINDER_WINDOWS_H = [24, 2];

/** UTC weekday index → name, matching `clinician_availability.day_of_week`. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
