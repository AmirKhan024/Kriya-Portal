import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import {
  prescriptions, users, program_items, games, program_phases,
  program_instances, override_log, members,
} from '@/server/db/schema';
import { eq, and, gte, lte, isNotNull, count, sql } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, withApiHandler, ApiError,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request) => {
  const user = await getAuthedUser(request);

  requireRole(user, ['ortho', 'physio', 'clinic_admin']);
  if (!user.clinic_id) throw new ApiError('FORBIDDEN', 'No clinic context', 403);
  const clinicId = user.clinic_id;
  const url = new URL(request.url);
  const sp = url.searchParams;

  const now = new Date();
  const fromDate = sp.get('from')
    ? new Date(sp.get('from')!)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toDate = sp.get('to') ? new Date(sp.get('to')!) : now;
  const branchId    = sp.get('branch_id') ?? undefined;
  const clinicianId = sp.get('clinician_id') ?? undefined;

  // Build base WHERE conditions for prescriptions
  const baseWhere = [
    eq(prescriptions.clinic_id, clinicId),
    gte(prescriptions.created_at, fromDate),
    lte(prescriptions.created_at, toDate),
  ];
  // Branch filter: prescriptions joined through members
  const memberWhere = branchId ? [eq(members.branch_id, branchId)] : [];
  if (clinicianId) baseWhere.push(eq(prescriptions.clinician_id, clinicianId));

  // 1. Total prescriptions
  const rxQuery = branchId
    ? db.select({ totalRx: count() })
        .from(prescriptions)
        .leftJoin(members, eq(prescriptions.member_id, members.id))
        .where(and(...baseWhere, ...memberWhere))
    : db.select({ totalRx: count() })
        .from(prescriptions)
        .where(and(...baseWhere));

  const [{ totalRx }] = await rxQuery;

  // 2. Rx by clinician
  const rxByClinician = await db
    .select({
      clinician_id:   prescriptions.clinician_id,
      clinician_name: users.name,
      rx_count:       count(),
    })
    .from(prescriptions)
    .leftJoin(users, eq(prescriptions.clinician_id, users.id))
    .where(and(...baseWhere))
    .groupBy(prescriptions.clinician_id, users.name)
    .orderBy(sql`count(*) desc`);

  // 3. Program mix (category breakdown from program items created in period)
  const programMix = await db
    .select({ category: games.category, item_count: count() })
    .from(program_items)
    .leftJoin(games, eq(program_items.game_id, games.id))
    .leftJoin(program_phases, eq(program_items.phase_id, program_phases.id))
    .leftJoin(program_instances, eq(program_phases.instance_id, program_instances.id))
    .where(and(
      eq(program_instances.clinic_id, clinicId),
      isNotNull(games.category),
      gte(program_instances.created_at, fromDate),
      lte(program_instances.created_at, toDate),
    ))
    .groupBy(games.category);

  // 4. Total items and override count
  const [{ totalItems }] = await db
    .select({ totalItems: count() })
    .from(program_items)
    .leftJoin(program_phases, eq(program_items.phase_id, program_phases.id))
    .leftJoin(program_instances, eq(program_phases.instance_id, program_instances.id))
    .where(and(
      eq(program_instances.clinic_id, clinicId),
      gte(program_instances.created_at, fromDate),
    ));

  const [{ overrideCount }] = await db
    .select({ overrideCount: count() })
    .from(override_log)
    .where(and(
      eq(override_log.clinic_id, clinicId),
      gte(override_log.ts, fromDate),
      lte(override_log.ts, toDate),
    ));

  const totalItemsNum    = Number(totalItems);
  const overrideCountNum = Number(overrideCount);
  const overrideRate = totalItemsNum > 0
    ? Math.round((overrideCountNum / totalItemsNum) * 100)
    : 0;

  return NextResponse.json({
    data: {
      as_of:  now.toISOString(),
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      total_rx: Number(totalRx),
      rx_by_clinician: rxByClinician.map(r => ({
        clinician_id:   r.clinician_id,
        clinician_name: r.clinician_name ?? 'Unknown',
        rx_count:       Number(r.rx_count),
      })),
      program_mix: programMix.map(p => ({
        category: p.category,
        count:    Number(p.item_count),
      })),
      override_rate_percent: overrideRate,
      override_count:        overrideCountNum,
      total_items:           totalItemsNum,
    },
    error: null,
  });
});
