import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { prescriptions, nudges } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';

const sendSchema = z.object({
  channel: z.enum(['whatsapp', 'sms', 'email', 'print']),
});

export const POST = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ortho', 'physio', 'clinic_admin']);

  const prescriptionId = context?.params?.id ?? '';
  const [prescription] = await db
    .select()
    .from(prescriptions)
    .where(eq(prescriptions.id, prescriptionId))
    .limit(1);
  if (!prescription) throw new ApiError('NOT_FOUND', 'Prescription not found', 404);

  requireSameTenant(user, prescription.clinic_id);

  const raw = await request.json();
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input', 400);
  }
  const { channel } = parsed.data;

  const now = new Date();

  // MVP stub: log the send without calling external messaging APIs
  await db.insert(nudges).values({
    member_id: prescription.member_id,
    clinic_id: prescription.clinic_id,
    sent_by: user.id,
    channel,
    message: 'Prescription letter',
    status: 'sent',
    sent_at: now,
  });

  await db.update(prescriptions)
    .set({ status: 'sent', sent_at: now })
    .where(eq(prescriptions.id, prescriptionId));

  await emit('prescription.sent', user.id, prescription.clinic_id, `member:${prescription.member_id}`, {
    channel,
    prescription_id: prescription.id,
  });
  await emit('app.invited', user.id, prescription.clinic_id, `member:${prescription.member_id}`, {
    qr_code: prescription.qr_code,
  });

  return NextResponse.json({
    data: { status: 'sent', channel, message: 'Prescription sent (dev stub)' },
    error: null,
  });
});
