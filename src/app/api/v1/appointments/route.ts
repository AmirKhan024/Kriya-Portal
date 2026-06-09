import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { appointments, users } from '@/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireEntitlement, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { assertMemberVisible } from '@/modules/members/access';
import { createAppointmentSchema } from '@/modules/appointments/schemas';
import { hasConflict } from '@/modules/appointments/slots';
import { APPOINTMENT_STATUSES } from '@/modules/appointments/constants';

export const dynamic = 'force-dynamic';

const BOOK_ROLES = ['clinic_admin', 'ortho', 'physio', 'front_desk'] as const;
const VIEW_ALL_ROLES = ['ops', 'clinic_admin', 'front_desk'];

/**
 * POST /api/v1/appointments — feature 2d · book an appointment.
 * Entitlement-gated (care_programs), tenant + member scoped, with no-double-booking
 * (409) on the clinician's existing booked slots. Emits appointment.booked.
 */
export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...BOOK_ROLES]);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'No clinic context', 403);
  await requireEntitlement(user.clinic_id, 'care_programs');

  const raw = await request.json();
  const parsed = createAppointmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { member_id, clinician_id, slot, type } = parsed.data;

  const member = await assertMemberVisible(user, member_id);

  // Clinician must be in the same clinic.
  const [clinician] = await db.select().from(users).where(eq(users.id, clinician_id)).limit(1);
  if (!clinician || clinician.clinic_id !== member.clinic_id) {
    throw new ApiError('VALIDATION_ERROR', 'Clinician not in this clinic', 400);
  }

  const slotDate = new Date(slot);

  // No double-booking: the clinician's existing booked slots.
  const booked = await db.select({ slot: appointments.slot }).from(appointments)
    .where(and(eq(appointments.clinician_id, clinician_id), eq(appointments.status, 'booked')));
  if (hasConflict(booked.map((b) => b.slot as Date), slotDate)) {
    throw new ApiError('CONFLICT', 'That slot is already booked', 409);
  }

  const id = crypto.randomUUID();
  await db.insert(appointments).values({
    id, member_id, clinician_id, clinic_id: member.clinic_id, slot: slotDate, type, status: 'booked',
  });
  await emit('appointment.booked', user.id, member.clinic_id, `member:${member_id}`, {
    appointment_id: id, clinician_id, slot: slotDate.toISOString(), type,
  });

  return NextResponse.json({
    data: { id, member_id, clinician_id, clinic_id: member.clinic_id, slot: slotDate, type, status: 'booked' },
    error: null,
  }, { status: 201 });
});

/**
 * GET /api/v1/appointments — feature 2d · list (member tab / cockpit). Read-only.
 * `?member_id` → assertMemberVisible then that member; else VIEW_ALL roles list
 * clinic-wide. Optional `clinician_id`, `status` filters.
 */
export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  const url = new URL(request.url);
  const memberId = url.searchParams.get('member_id') || undefined;
  const clinicianFilter = url.searchParams.get('clinician_id') || undefined;
  const statusFilter = url.searchParams.get('status') || undefined;

  const conds = [];
  if (memberId) {
    await assertMemberVisible(user, memberId);
    conds.push(eq(appointments.member_id, memberId));
  } else {
    if (!VIEW_ALL_ROLES.includes(user.role)) {
      throw new ApiError('FORBIDDEN', 'A member_id is required for your role', 403);
    }
    if (user.role !== 'ops' && user.clinic_id) conds.push(eq(appointments.clinic_id, user.clinic_id));
  }
  if (clinicianFilter) conds.push(eq(appointments.clinician_id, clinicianFilter));
  if (statusFilter && (APPOINTMENT_STATUSES as readonly string[]).includes(statusFilter)) {
    conds.push(eq(appointments.status, statusFilter));
  }

  const rows = await db.select().from(appointments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(appointments.slot));

  return NextResponse.json({ data: rows, error: null, meta: { count: rows.length } });
});
