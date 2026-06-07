import { NextResponse } from 'next/server';
import {
  getAuthedUser, requireRole, requireSameTenant, requireEntitlement, withApiHandler,
} from '@/server/auth/middleware';

export const GET = withApiHandler(async (request, context) => {
  const user = await getAuthedUser(request);
  requireRole(user, ['ops', 'clinic_admin']);

  const clinicId = context?.params?.id ?? '';
  requireSameTenant(user, clinicId);
  await requireEntitlement(clinicId, 'iot');

  return NextResponse.json({
    data: {
      enabled:       true,
      device_count:  0,
      devices:       [],
      message:       'IoT integration is enabled for this clinic. Device pairing coming soon.',
    },
    error: null,
  });
});
