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
