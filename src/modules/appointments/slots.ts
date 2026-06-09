/**
 * Slot generation, conflict detection, reminder windows (feature 2d).
 * Pure + unit-tested; deterministic (`now`/`fromDate` passed in — never Date.now()).
 */
import { DAY_NAMES, SLOT_DURATION_MIN, REMINDER_WINDOWS_H } from './constants';

export type AvailabilityRow = {
  day_of_week: string;
  start_time: string; // 'HH:MM'
  end_time: string;   // 'HH:MM'
  is_available: string; // 'true' | 'false'
};

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Upcoming free slots from a clinician's weekly availability, minus booked slots.
 * Times are treated as UTC wall-clock (true timezone handling is a documented future
 * refinement). Returns ascending Date[].
 */
export function generateSlots({
  availability,
  fromDate,
  days,
  durationMin = SLOT_DURATION_MIN,
  booked = [],
  now,
}: {
  availability: AvailabilityRow[];
  fromDate: Date;
  days: number;
  durationMin?: number;
  booked?: Date[];
  now: Date;
}): Date[] {
  const out: Date[] = [];
  const base = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate());

  for (let d = 0; d < days; d += 1) {
    const dayMs = base + d * 86_400_000;
    const day = new Date(dayMs);
    const name = DAY_NAMES[day.getUTCDay()];
    for (const row of availability) {
      if (row.is_available !== 'true' || row.day_of_week !== name) continue;
      const start = parseHHMM(row.start_time);
      const end = parseHHMM(row.end_time);
      if (start === null || end === null || end <= start) continue;
      for (let t = start; t + durationMin <= end; t += durationMin) {
        const slot = new Date(dayMs + t * 60_000);
        if (slot.getTime() <= now.getTime()) continue; // past
        if (hasConflict(booked, slot, durationMin)) continue; // already booked
        out.push(slot);
      }
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/** No-double-booking: a slot conflicts if its start is within durationMin of an existing one. */
export function hasConflict(existing: Date[], slot: Date, durationMin = SLOT_DURATION_MIN): boolean {
  const windowMs = durationMin * 60_000;
  return existing.some((e) => Math.abs(e.getTime() - slot.getTime()) < windowMs);
}

export type ReminderAppointment = { id: string; slot: Date; status: string; member_id: string; clinician_id: string; clinic_id: string };

/**
 * Booked appointments currently inside a reminder window, tagged with the tightest
 * window (2h takes precedence over 24h) so each maps to one reminder per scan.
 */
export function dueReminders(
  appointments: ReminderAppointment[],
  now: Date,
  windowsH: number[] = REMINDER_WINDOWS_H,
): { appointment: ReminderAppointment; window: number }[] {
  const asc = [...windowsH].sort((a, b) => a - b);
  const out: { appointment: ReminderAppointment; window: number }[] = [];
  for (const a of appointments) {
    if (a.status !== 'booked') continue;
    const hoursUntil = (a.slot.getTime() - now.getTime()) / 3_600_000;
    if (hoursUntil <= 0) continue;
    const window = asc.find((w) => hoursUntil <= w);
    if (window !== undefined) out.push({ appointment: a, window });
  }
  return out;
}
