import type { AuthedUser } from '@/types/auth';

/**
 * Activity-log scope + cursor helpers (feature 2e). Pure + unit-tested.
 */

/** Roles that may see their whole clinic's log (vs only their own actions). */
const CLINIC_LENS_ROLES = ['clinic_admin'];

export type EventScope = {
  /** null = all clinics (ops); otherwise restrict to this clinic_id. */
  clinicId: string | null;
  /** null = no actor restriction; otherwise restrict to this actor id. */
  actorId: string | null;
};

/**
 * Resolve the RLS lens (brief §8 2e) so a filter can NEVER widen scope:
 *   - ops          → all clinics; may filter by actor.
 *   - clinic_admin → own clinic;  may filter by actor (within clinic).
 *   - everyone else (ortho/physio/trainer/front_desk) → own clinic + FORCED to own actor.
 */
export function resolveEventScope(user: AuthedUser, params: { actor?: string | null }): EventScope {
  if (user.role === 'ops') {
    return { clinicId: null, actorId: params.actor ?? null };
  }
  if (CLINIC_LENS_ROLES.includes(user.role)) {
    return { clinicId: user.clinic_id, actorId: params.actor ?? null };
  }
  // Clinical/front-desk: locked to their own actions (ignore any actor param).
  return { clinicId: user.clinic_id, actorId: user.id };
}

export type Cursor = { ts: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.ts}|${c.id}`, 'utf8').toString('base64');
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    const idx = decoded.lastIndexOf('|');
    if (idx < 0) return null;
    const ts = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}
