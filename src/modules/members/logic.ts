import type { Segment } from './constants';
import type { CreateMemberInput, PainFlagInput } from './schemas';

/**
 * Pure domain helpers for feature 1b. No DB / Next imports — fully unit-testable.
 */

/** Strip spaces, dashes and parentheses from a mobile number, preserving a leading +. */
export function normalizeMobile(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^\d]/g, '');
}

/**
 * Segment auto-derives from complaint presence when not explicitly provided:
 * a complaint → `care` (symptomatic); none → `wellness` (screening). Explicit wins.
 */
export function deriveSegment(input: Pick<CreateMemberInput, 'segment' | 'complaint'>): Segment {
  if (input.segment) return input.segment;
  const hasComplaint = !!input.complaint && input.complaint.trim().length > 0;
  return hasComplaint ? 'care' : 'wellness';
}

export type PainFlagRow = {
  member_id: string;
  clinic_id: string;
  region: string;
  severity: number;
  type: string;
  active: string;
  set_by: string | null;
};

/** Map the quick pain-map UI input to `pain_flags` insert rows. */
export function painMapToRows(
  memberId: string,
  clinicId: string,
  setBy: string | null,
  painMap: PainFlagInput[] | undefined,
): PainFlagRow[] {
  if (!painMap || painMap.length === 0) return [];
  return painMap.map((p) => ({
    member_id: memberId,
    clinic_id: clinicId,
    region: p.region,
    severity: p.severity,
    type: p.type,
    active: 'true',
    set_by: setBy,
  }));
}
