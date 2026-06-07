import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { members } from '@/server/db/schema';
import { eq, and, or, ilike, count } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin', 'trainer', 'front_desk']);

  const clinicId = context?.params?.id ?? '';
  requireSameTenant(user, clinicId);

  const url = new URL(request.url);
  const sp = url.searchParams;

  const status   = sp.get('status') ?? undefined;
  const search   = sp.get('search') ?? undefined;
  const branchId = sp.get('branch_id') ?? undefined;
  const page     = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit    = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '20')));
  const offset   = (page - 1) * limit;

  const whereClauses = [eq(members.clinic_id, clinicId)];
  if (status)   whereClauses.push(eq(members.status, status));
  if (branchId) whereClauses.push(eq(members.branch_id, branchId));
  if (search) {
    whereClauses.push(
      or(
        ilike(members.name,   `%${search}%`),
        ilike(members.mobile, `%${search}%`),
      )!
    );
  }

  const whereExpr = and(...whereClauses);

  const [{ total }] = await db
    .select({ total: count() })
    .from(members)
    .where(whereExpr);

  const rows = await db
    .select({
      id:         members.id,
      name:       members.name,
      mobile:     members.mobile,
      age:        members.age,
      sex:        members.sex,
      segment:    members.segment,
      status:     members.status,
      complaint:  members.complaint,
      branch_id:  members.branch_id,
      created_at: members.created_at,
      updated_at: members.updated_at,
    })
    .from(members)
    .where(whereExpr)
    .orderBy(members.created_at)
    .limit(limit)
    .offset(offset);

  return NextResponse.json({
    data: rows,
    error: null,
    meta: {
      total:  Number(total),
      page,
      limit,
      pages:  Math.ceil(Number(total) / limit),
    },
  });
});
