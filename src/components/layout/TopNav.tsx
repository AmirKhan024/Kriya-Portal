'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken, loadSessionUser, clearSessionUser } from '@/store/auth';

type NavLink = { label: string; href: string };

const ROLE_LABEL: Record<string, string> = {
  ops: 'Ops', clinic_admin: 'Clinic Admin', ortho: 'Ortho',
  physio: 'Physio', trainer: 'Trainer', front_desk: 'Front Desk',
};

/** Role-appropriate top-level destinations. */
function linksForRole(role: string): NavLink[] {
  if (role === 'ops') {
    return [{ label: 'Clinics', href: '/ops/clinics' }, { label: 'Videos', href: '/ops/videos' }];
  }
  const base: NavLink[] = [
    { label: 'Members', href: '/members' },
    { label: 'Activity log', href: '/activity' },
  ];
  if (role === 'clinic_admin') base.push({ label: 'Analytics', href: '/analytics' });
  return base;
}

/**
 * Shared top nav (logo + title + role-aware links + identity + logout). Replaces
 * the per-page inline navs so logout/identity exist everywhere and links never
 * point a user at a page their role can't load. `children` = page-specific actions.
 */
export function TopNav({ title, children }: { title: string; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    const access = tokenStore.get().access;
    const fromToken = access ? parseAccessToken(access) : null;
    const stored = loadSessionUser();
    setRole((fromToken?.role as string) ?? (stored?.role as string) ?? '');
    setName((stored?.name as string) ?? '');
  }, []);

  async function logout() {
    const { refresh } = tokenStore.get();
    try { await apiClient.post('/api/v1/auth/logout', { refresh_token: refresh }); } catch { /* best-effort */ }
    tokenStore.clear();
    clearSessionUser();
    window.location.href = role === 'ops' ? '/ops/login' : '/clinic/login';
  }

  const links = linksForRole(role);

  return (
    <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center shrink-0">
          <span className="text-slate-900 font-bold text-sm">K</span>
        </div>
        <span className="text-white font-semibold text-sm truncate">{title}</span>
      </div>

      <div className="flex items-center gap-4 text-sm">
        {links.filter((l) => l.href !== pathname).map((l) => (
          <button key={l.href} onClick={() => router.push(l.href)} className="text-slate-400 hover:text-white whitespace-nowrap">
            {l.label}
          </button>
        ))}
        {children}
        <span className="hidden sm:flex items-center gap-2 pl-3 border-l border-white/10">
          <span className="text-slate-300 text-xs whitespace-nowrap">
            {name || 'Signed in'}
            {role && <span className="text-slate-500"> · {ROLE_LABEL[role] ?? role}</span>}
          </span>
        </span>
        <button
          onClick={logout}
          className="text-slate-400 hover:text-red-300 text-xs border border-white/10 rounded-lg px-2.5 py-1 whitespace-nowrap transition-colors"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
