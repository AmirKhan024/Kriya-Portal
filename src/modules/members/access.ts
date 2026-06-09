import { db } from '@/server/db';
import { members, member_assignments } from '@/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '@/server/auth/middleware';
import type { AuthedUser } from '@/types/auth';

/**
 * Member visibility scoping (shared by member-record + game-eligibility reads):
 *   - every clinic role → any member in their own clinic (matches the clinic-wide
 *     members list). "Assigned to me" is a caseload filter, not a hard access gate.
 * Cross-tenant access throws NOT_FOUND (no existence leak).
 *
 * Returns the member row when visible.
 */
const VIEW_ALL_ROLES = ['ops', 'clinic_admin', 'front_desk', 'ortho', 'physio', 'trainer'];

export async function assertMemberVisible(user: AuthedUser, memberId: string) {
  const rows = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  const member = rows[0];
  const notFound = () => new ApiError('NOT_FOUND', 'Member not found', 404);
  if (!member) throw notFound();

  if (user.role !== 'ops' && member.clinic_id !== user.clinic_id) throw notFound();

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

  return member;
}
