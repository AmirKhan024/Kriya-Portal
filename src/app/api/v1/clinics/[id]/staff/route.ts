import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { users, user_roles } from '@/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  const clinicId = context?.params?.id ?? '';

  requireRole(user, ['ops', 'clinic_admin']);
  if (user.role === 'clinic_admin') requireSameTenant(user, clinicId);

  const staffUsers = await db
    .select()
    .from(users)
    .where(eq(users.clinic_id, clinicId))
    .orderBy(desc(users.created_at));

  const staffRoles = await db
    .select()
    .from(user_roles)
    .where(eq(user_roles.clinic_id, clinicId));

  // Map userId → most recently granted role
  const roleMap = new Map<string, string>();
  for (const r of staffRoles) {
    roleMap.set(r.user_id, r.role);
  }

  const data = staffUsers.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    branch_id: u.branch_id,
    created_at: u.created_at,
    activated_at: u.activated_at,
    role: roleMap.get(u.id) ?? null,
  }));

  return NextResponse.json({ data, error: null });
});
