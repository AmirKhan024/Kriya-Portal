import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, consents, assessments } from '@/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireEntitlement, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import type { UserRole } from '@/types/auth';
import { createAssessmentSchema, SCAN_ROLES } from '@/modules/scoring/schemas';

/**
 * POST /api/v1/assessments — feature 1c-b · start a scan.
 *
 * Clinical action: requires a scan role (clinic_admin/ortho/physio), the member's
 * active consent, and the matching entitlement (deep→deep_scan, quick→quick_scan).
 */
export const POST = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);
  requireRole(user, [...SCAN_ROLES] as UserRole[]);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'User is not attached to a clinic', 403);
  const clinicId = user.clinic_id;

  const raw = await request.json();
  const parsed = createAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues?.[0]?.message ?? 'Invalid input', 400);
  }
  const { member_id, type } = parsed.data;

  // Member must exist and belong to the caller's clinic.
  const memberRows = await db
    .select({ id: members.id, clinic_id: members.clinic_id })
    .from(members)
    .where(eq(members.id, member_id))
    .limit(1);
  const member = memberRows[0];
  if (!member || member.clinic_id !== clinicId) {
    throw new ApiError('NOT_FOUND', 'Member not found', 404);
  }

  // Consent gate — mandatory before any clinical action.
  const consent = await db
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.member_id, member_id), isNull(consents.withdrawn_at)))
    .limit(1);
  if (!consent[0]) {
    throw new ApiError('FORBIDDEN', 'Consent is required before a scan', 403);
  }

  // Entitlement gate (rejects API action, not just UI).
  await requireEntitlement(clinicId, type === 'deep' ? 'deep_scan' : 'quick_scan');

  const assessmentId = crypto.randomUUID();
  await db.insert(assessments).values({
    id: assessmentId,
    member_id,
    clinic_id: clinicId,
    clinician_id: user.id,
    type,
    status: 'in_progress',
  });

  await emit('assessment.started', user.id, clinicId, `assessment:${assessmentId}`, { member_id, type });

  return NextResponse.json(
    { data: { assessment: { id: assessmentId, member_id, type, status: 'in_progress' } }, error: null },
    { status: 201 },
  );
});
