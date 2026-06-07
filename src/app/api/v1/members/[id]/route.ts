import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members, consents, pain_flags, member_assignments, users } from '@/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { getAuthedUser, withApiHandler, ApiError } from '@/server/auth/middleware';

/**
 * GET /api/v1/members/:id — feature 1b · member record.
 *
 * Returns the member plus consent state, active pain flags and current assignment.
 * Visibility:
 *   - ops / clinic_admin / front_desk  → any member in their clinic
 *   - ortho / physio / trainer         → only members assigned to them
 * Cross-tenant or unassigned access returns NOT_FOUND (no existence leak).
 */
const VIEW_ALL_ROLES = ['ops', 'clinic_admin', 'front_desk'];

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const memberId = context?.params?.id ?? '';

  const rows = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  const member = rows[0];
  const notFound = () => new ApiError('NOT_FOUND', 'Member not found', 404);
  if (!member) throw notFound();

  // Tenant scope (ops is platform-wide).
  if (user.role !== 'ops' && member.clinic_id !== user.clinic_id) throw notFound();

  // Assignment scope for clinical (non-admin) roles.
  if (!VIEW_ALL_ROLES.includes(user.role)) {
    const assigned = await db
      .select({ id: member_assignments.id })
      .from(member_assignments)
      .where(and(
        eq(member_assignments.member_id, memberId),
        eq(member_assignments.clinician_id, user.id),
        isNull(member_assignments.ended_at),
      ))
      .limit(1);
    if (!assigned[0]) throw notFound();
  }

  const activeConsent = await db
    .select()
    .from(consents)
    .where(and(eq(consents.member_id, memberId), isNull(consents.withdrawn_at)))
    .limit(1);

  const activePainFlags = await db
    .select()
    .from(pain_flags)
    .where(and(eq(pain_flags.member_id, memberId), eq(pain_flags.active, 'true')));

  const currentAssignment = await db
    .select()
    .from(member_assignments)
    .where(and(eq(member_assignments.member_id, memberId), isNull(member_assignments.ended_at)))
    .limit(1);

  // Resolve the assigned clinician's name (avoid showing a raw UUID in the UI).
  let assignment = currentAssignment[0] ?? null;
  if (assignment) {
    const clinician = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, assignment.clinician_id))
      .limit(1);
    assignment = { ...assignment, clinician_name: clinician[0]?.name ?? null } as typeof assignment & { clinician_name: string | null };
  }

  return NextResponse.json({
    data: {
      member,
      consent: activeConsent[0] ?? null,
      has_consent: !!activeConsent[0],
      pain_flags: activePainFlags,
      assignment,
    },
    error: null,
  });
});
