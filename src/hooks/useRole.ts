'use client';
import { useEffect, useState } from 'react';
import { tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import type { UserRole } from '@/types/auth';

export function useRole(): UserRole | null {
  const [role, setRole] = useState<UserRole | null>(null);
  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens?.access) return;
    const payload = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    setRole((payload?.role as UserRole) ?? null);
  }, []);
  return role;
}

export function useClinicId(): string | null {
  const [clinicId, setClinicId] = useState<string | null>(null);
  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens?.access) return;
    const payload = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    setClinicId((payload?.clinic_id as string) ?? null);
  }, []);
  return clinicId;
}

// Role permission map — server also enforces all of these
const CAN_DO: Record<string, UserRole[]> = {
  override_pain_lock:      ['ortho', 'physio'],
  create_template:         ['clinic_admin'],
  invite_staff:            ['clinic_admin', 'ops'],
  manage_entitlements:     ['ops'],
  reassign_member:         ['clinic_admin', 'ortho', 'physio'],
  view_dashboards:         ['clinic_admin', 'ortho', 'physio'],
  manage_settings:         ['clinic_admin'],
  generate_prescription:   ['ortho', 'physio', 'clinic_admin'],
};

export function useCanDo(action: keyof typeof CAN_DO): boolean {
  const role = useRole();
  if (!role) return false;
  return (CAN_DO[action] ?? []).includes(role);
}
