import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { appointments, members } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { patchAppointmentSchema } from '@/modules/appointments/schemas';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['clinic_admin', 'ortho', 'physio', 'front_desk'] as const;

/**
 * PATCH /api/v1/appointments/:id — feature 2d · status transition
 * (completed | no_show | cancelled). Completed emits appointment.completed.
 * No-show flips the member to `at_risk` (mirrors the assessment-complete member
 * update); no dedicated event for no_show/cancelled per brief §8 2d.
 */
export const PATCH = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...MANAGE_ROLES]);

  const id = context?.params?.id ?? '';
  const [appt] = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  if (!appt) throw new ApiError('NOT_FOUND', 'Appointment not found', 404);
  requireSameTenant(user, appt.clinic_id);

  const raw = await request.json();
  const parsed = patchAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { status } = parsed.data;

  const now = new Date();
  await db.update(appointments).set({ status, updated_at: now }).where(eq(appointments.id, id));

  if (status === 'completed') {
    await emit('appointment.completed', user.id, appt.clinic_id, `member:${appt.member_id}`, {
      appointment_id: id, clinician_id: appt.clinician_id,
    });
  } else if (status === 'no_show') {
    // A no-show is a risk signal → flag the member at_risk (no dedicated event yet).
    await db.update(members).set({ status: 'at_risk', updated_at: now }).where(eq(members.id, appt.member_id));
  }

  return NextResponse.json({ data: { id, status }, error: null });
});
