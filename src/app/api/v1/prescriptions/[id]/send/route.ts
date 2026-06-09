import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/server/db';
import { prescriptions, nudges, members } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import {
  getAuthedUser, requireRole, requireSameTenant, withApiHandler, ApiError,
} from '@/server/auth/middleware';
import { emit } from '@/server/db/emit';
import { dispatchNudge } from '@/modules/nudges/dispatch';

const sendSchema = z.object({
  channel: z.enum(['telegram', 'email', 'print']),
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
  const nudgeId = crypto.randomUUID();
  let nudgeStatus: 'sent' | 'failed' | 'scheduled' = 'sent';

  if (channel === 'telegram') {
    // Look up the member's telegram_chat_id for delivery.
    const [member] = await db
      .select({ telegram_chat_id: members.telegram_chat_id })
      .from(members)
      .where(eq(members.id, prescription.member_id))
      .limit(1);

    await db.insert(nudges).values({
      id: nudgeId,
      member_id: prescription.member_id,
      clinic_id: prescription.clinic_id,
      sent_by: user.id,
      channel: 'telegram',
      message: 'Your exercise prescription is ready. Contact your clinician for your personalised program details.',
      status: 'scheduled',
      scheduled_at: now,
    });

    const result = await dispatchNudge({
      to: member?.telegram_chat_id ?? null,
      message: 'Your exercise prescription is ready. Contact your clinician for your personalised program details.',
    });

    await db.update(nudges).set({
      status: result.status,
      sent_at: result.status === 'sent' ? now : null,
      provider: result.provider,
      provider_message_id: result.provider_message_id,
    }).where(eq(nudges.id, nudgeId));

    nudgeStatus = result.status;
  } else {
    // email / print — logged, not delivered externally.
    await db.insert(nudges).values({
      id: nudgeId,
      member_id: prescription.member_id,
      clinic_id: prescription.clinic_id,
      sent_by: user.id,
      channel,
      message: 'Prescription letter',
      status: 'sent',
      sent_at: now,
    });
  }

  await db.update(prescriptions)
    .set({ status: 'sent', sent_at: now })
    .where(eq(prescriptions.id, prescriptionId));

  try {
    await emit('prescription.sent', user.id, prescription.clinic_id, `member:${prescription.member_id}`, {
      channel,
      prescription_id: prescription.id,
    });
    await emit('app.invited', user.id, prescription.clinic_id, `member:${prescription.member_id}`, {
      qr_code: prescription.qr_code,
    });
  } catch (emitErr) {
    console.error('[PrescriptionSend] emit failed (non-fatal):', emitErr);
  }

  return NextResponse.json({
    data: { status: nudgeStatus, channel },
    error: null,
  });
});
