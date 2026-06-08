'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore, apiClient } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import type { UserRole } from '@/types/auth';

const ROLE_LABELS: Record<UserRole, string> = {
  ops:          'Kriya Ops',
  clinic_admin: 'Clinic Admin',
  ortho:        'Orthopaedic',
  physio:       'Physiotherapist',
  trainer:      'Trainer',
  front_desk:   'Front Desk',
};

export function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>('');

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens?.access) return;
    const p = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    setRole((p?.role as string) ?? '');
  }, []);

  async function handleLogout() {
    const tokens = tokenStore.get();
    if (tokens?.access) {
      try {
        await apiClient.post('/api/v1/auth/logout', { refresh_token: tokens.refresh ?? '' });
      } catch {}
    }
    tokenStore.clear();
    // Belt-and-suspenders: also clear cookie client-side in case API call failed
    document.cookie = 'kriya_access_token=; path=/; max-age=0; SameSite=Lax';
    router.push(role === 'ops' ? '/ops/login' : '/clinic/login');
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/10 transition-colors w-full"
      >
        <div className="w-7 h-7 rounded-full bg-teal-400/20 border border-teal-400/40 flex items-center justify-center shrink-0">
          <span className="text-teal-400 text-xs font-bold">
            {(role).charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="text-left flex-1 min-w-0">
          <p className="text-xs text-slate-400 truncate">{ROLE_LABELS[role as UserRole] ?? role}</p>
        </div>
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-2 w-48 bg-slate-900 border border-white/10 rounded-xl shadow-xl z-50 py-1">
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs text-slate-400">Signed in as</p>
              <p className="text-sm text-white font-medium">{ROLE_LABELS[role as UserRole] ?? role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
