/**
 * Care Video (feature 3a) — shared constants.
 */
export const VIDEO_STATUSES = ['draft', 'ready', 'published'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** A view counts as a completed activity at or above this watch percentage (brief §8 3a). */
export const WATCH_COMPLETE_PCT = 90;
