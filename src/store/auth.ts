import { create } from 'zustand';
import type { UserRole } from '@/types/auth';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  clinic_id: string | null;
  branch_id: string | null;
};

type AuthStore = {
  user: AuthUser | null;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}));

export function parseAccessToken(token: string): Partial<AuthUser> | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/**
 * Persist the logged-in user (name/role/clinic) across reloads. The JWT carries
 * role + ids but not the name, so we stash the login response's `user` object in
 * localStorage for the identity chip + role-aware nav.
 */
const SESSION_USER_KEY = 'kriya_user';

export function saveSessionUser(user: unknown): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user)); } catch { /* ignore */ }
}

export function loadSessionUser(): Partial<AuthUser> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    return raw ? (JSON.parse(raw) as Partial<AuthUser>) : null;
  } catch {
    return null;
  }
}

export function clearSessionUser(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(SESSION_USER_KEY); } catch { /* ignore */ }
}
