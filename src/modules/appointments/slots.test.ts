import { describe, it, expect } from 'vitest';
import { generateSlots, hasConflict, dueReminders, type AvailabilityRow, type ReminderAppointment } from './slots';
import { DAY_NAMES } from './constants';

const FROM = new Date('2026-06-08T00:00:00.000Z');
const DAY = DAY_NAMES[FROM.getUTCDay()];
const avail = (over: Partial<AvailabilityRow> = {}): AvailabilityRow =>
  ({ day_of_week: DAY, start_time: '09:00', end_time: '10:00', is_available: 'true', ...over });

describe('generateSlots', () => {
  it('expands a weekly window into duration-stepped slots', () => {
    const slots = generateSlots({ availability: [avail()], fromDate: FROM, days: 1, durationMin: 30, now: FROM });
    expect(slots.map((s) => s.toISOString())).toEqual([
      '2026-06-08T09:00:00.000Z', '2026-06-08T09:30:00.000Z',
    ]);
  });

  it('excludes booked slots', () => {
    const booked = [new Date('2026-06-08T09:00:00.000Z')];
    const slots = generateSlots({ availability: [avail()], fromDate: FROM, days: 1, durationMin: 30, booked, now: FROM });
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-06-08T09:30:00.000Z']);
  });

  it('excludes past slots relative to now', () => {
    const now = new Date('2026-06-08T09:15:00.000Z');
    const slots = generateSlots({ availability: [avail()], fromDate: FROM, days: 1, durationMin: 30, now });
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-06-08T09:30:00.000Z']);
  });

  it('ignores days off and is_available=false rows', () => {
    const off = avail({ is_available: 'false' });
    expect(generateSlots({ availability: [off], fromDate: FROM, days: 1, now: FROM })).toEqual([]);
  });
});

describe('hasConflict', () => {
  const existing = [new Date('2026-06-08T10:00:00.000Z')];
  it('flags a slot within the duration window', () => {
    expect(hasConflict(existing, new Date('2026-06-08T10:00:00.000Z'), 30)).toBe(true);
    expect(hasConflict(existing, new Date('2026-06-08T10:15:00.000Z'), 30)).toBe(true);
  });
  it('allows an exactly-adjacent slot', () => {
    expect(hasConflict(existing, new Date('2026-06-08T10:30:00.000Z'), 30)).toBe(false);
  });
});

describe('dueReminders (T-24h / T-2h, tightest window wins)', () => {
  const now = new Date('2026-06-08T12:00:00.000Z');
  const appt = (id: string, hoursAhead: number, status = 'booked'): ReminderAppointment =>
    ({ id, slot: new Date(now.getTime() + hoursAhead * 3_600_000), status, member_id: 'm', clinician_id: 'c', clinic_id: 'cl' });

  it('tags each appointment with the tightest applicable window and skips others', () => {
    const out = dueReminders([
      appt('soon', 1),       // → 2h
      appt('tomorrow', 10),  // → 24h
      appt('far', 30),       // none
      appt('past', -1),      // none
      appt('cancelled', 1, 'cancelled'), // skipped
    ], now);
    expect(out.map((d) => [d.appointment.id, d.window])).toEqual([['soon', 2], ['tomorrow', 24]]);
  });
});
