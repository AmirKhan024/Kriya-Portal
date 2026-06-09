/**
 * Nudges (feature 2c) — shared constants.
 *
 * DOCUMENTED HEURISTIC — frequency caps, inactivity threshold and escalation
 * count need product / clinical sign-off (like the pain-gating and adherence
 * thresholds). They live here so the policy is in one place and easy to tune.
 */

/** Delivery channels in priority order (WhatsApp → push → SMS), per brief §8 2c. */
export const NUDGE_CHANNELS = ['whatsapp', 'push', 'sms'] as const;
export type NudgeChannel = (typeof NUDGE_CHANNELS)[number];

/** Lifecycle of a nudge row. */
export const NUDGE_STATUSES = ['scheduled', 'sent', 'responded', 'failed'] as const;
export type NudgeStatus = (typeof NUDGE_STATUSES)[number];

/** Frequency cap — don't spam a member. */
export const MAX_NUDGES_PER_DAY = 1; // sent nudges per rolling 24h
export const MAX_NUDGES_PER_WEEK = 3; // sent nudges per rolling 7d

/** N8N watcher: fire when no activity.completed within this window. */
export const INACTIVITY_THRESHOLD_HOURS = 48;

/** Escalate to the assigned clinician after this many consecutive non-responses. */
export const ESCALATION_NONRESPONSE_COUNT = 3;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
