import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { users, clinician_availability, appointments } from '@/server/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { availabilitySchema } from '@/modules/appointments/schemas';
import { generateSlots, type AvailabilityRow } from '@/modules/appointments/slots';

export const dynamic = 'force-dynamic';

const SLOT_HORIZON_DAYS = 14;

/** Load a clinician and enforce tenant scope (cross-tenant → 404, no leak). */
async function loadClinician(user: { role: string; clinic_id: string | null }, clinicianId: string) {
  const [clinician] = await db.select().from(users).where(eq(users.id, clinicianId)).limit(1);
  if (!clinician) throw new ApiError('NOT_FOUND', 'Clinician not found', 404);
  if (user.role !== 'ops' && clinician.clinic_id !== user.clinic_id) {
    throw new ApiError('NOT_FOUND', 'Clinician not found', 404);
  }
  return clinician;
}

/**
 * GET /api/v1/clinicians/:id/availability — feature 2d.
 * Returns the clinician's weekly availability rows + computed upcoming free slots
 * (next 14 days, excluding already-booked appointments). Read-only.
 */
export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicianId = context?.params?.id ?? '';
  await loadClinician(user, clinicianId);

  const rows = await db.select().from(clinician_availability)
    .where(eq(clinician_availability.clinician_id, clinicianId));

  const now = new Date();
  const booked = await db.select({ slot: appointments.slot }).from(appointments)
    .where(and(
      eq(appointments.clinician_id, clinicianId),
      eq(appointments.status, 'booked'),
      gte(appointments.slot, now),
    ));

  const slots = generateSlots({
    availability: rows as AvailabilityRow[],
    fromDate: now,
    days: SLOT_HORIZON_DAYS,
    booked: booked.map((b) => b.slot as Date),
    now,
  });

  return NextResponse.json({
    data: {
      clinician_id: clinicianId,
      availability: rows,
      slots: slots.map((s) => s.toISOString()),
    },
    error: null,
  });
});

/**
 * POST /api/v1/clinicians/:id/availability — feature 2d · the availability editor.
 * Replaces the clinician's weekly availability. RBAC: the clinician themselves or
 * a clinic_admin. Config write — emits no event.
 */
export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicianId = context?.params?.id ?? '';

  // Only the clinician themselves or an admin/ops may edit.
  if (user.id !== clinicianId) requireRole(user, ['clinic_admin', 'ops']);
  const clinician = await loadClinician(user, clinicianId);
  if (!clinician.clinic_id) throw new ApiError('VALIDATION_ERROR', 'Clinician has no clinic', 400);

  const raw = await request.json();
  const parsed = availabilitySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }

  await db.delete(clinician_availability).where(eq(clinician_availability.clinician_id, clinicianId));
  for (const s of parsed.data.slots) {
    await db.insert(clinician_availability).values({
      clinician_id: clinicianId,
      clinic_id: clinician.clinic_id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      is_available: 'true',
    });
  }

  return NextResponse.json({ data: { clinician_id: clinicianId, count: parsed.data.slots.length }, error: null });
});
