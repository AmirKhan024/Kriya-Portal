import { describe, it, expect } from 'vitest';
import { resolveEventScope, encodeCursor, decodeCursor, dateBounds } from './query';
import type { AuthedUser } from '@/types/auth';

const u = (role: AuthedUser['role'], clinic: string | null = 'C1', id = 'U1'): AuthedUser =>
  ({ id, clinic_id: clinic, branch_id: null, role });

describe('resolveEventScope (RLS lens — filters never widen scope)', () => {
  it('ops sees all clinics and may filter by actor', () => {
    expect(resolveEventScope(u('ops', null), {})).toEqual({ clinicId: null, actorId: null });
    expect(resolveEventScope(u('ops', null), { actor: 'X' })).toEqual({ clinicId: null, actorId: 'X' });
  });

  it('clinic_admin is scoped to own clinic, may filter by actor', () => {
    expect(resolveEventScope(u('clinic_admin'), {})).toEqual({ clinicId: 'C1', actorId: null });
    expect(resolveEventScope(u('clinic_admin'), { actor: 'X' })).toEqual({ clinicId: 'C1', actorId: 'X' });
  });

  it('clinicians/front_desk are forced to their own actor (cannot widen)', () => {
    for (const role of ['ortho', 'physio', 'trainer', 'front_desk'] as const) {
      expect(resolveEventScope(u(role, 'C1', 'ME'), { actor: 'SOMEONE_ELSE' }))
        .toEqual({ clinicId: 'C1', actorId: 'ME' });
    }
  });
});

describe('cursor encode/decode', () => {
  it('round-trips', () => {
    const c = { ts: '2026-06-07T08:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects garbage', () => {
    expect(decodeCursor('not-base64-!!')).toBeNull();
    expect(decodeCursor(Buffer.from('noseparator', 'utf8').toString('base64'))).toBeNull();
  });
});

describe('dateBounds (date-only `to` is end-of-day inclusive)', () => {
  it('keeps a date-only `from` at midnight and pushes `to` to end-of-day', () => {
    const { fromDate, toDate } = dateBounds('2026-06-07', '2026-06-07');
    expect(fromDate?.toISOString()).toBe('2026-06-07T00:00:00.000Z');
    expect(toDate?.toISOString()).toBe('2026-06-07T23:59:59.999Z'); // single day now spans the whole day
  });

  it('passes a full ISO `to` through unchanged', () => {
    const { toDate } = dateBounds(undefined, '2026-06-07T10:30:00.000Z');
    expect(toDate?.toISOString()).toBe('2026-06-07T10:30:00.000Z');
  });

  it('returns null for empty or invalid inputs', () => {
    expect(dateBounds(undefined, undefined)).toEqual({ fromDate: null, toDate: null });
    expect(dateBounds('nope', 'also-bad')).toEqual({ fromDate: null, toDate: null });
  });
});
