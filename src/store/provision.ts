import { create } from 'zustand';

export type PlanPreset = 'move' | 'move_scan' | 'full_suite';

export type WizardBranch = {
  _clientId: string;
  name: string;
  address: string;
};

export type WizardEntitlements = {
  move: boolean;
  quick_scan: boolean;
  deep_scan: boolean;
  care_programs: boolean;
  pain_gating: boolean;
  custom_branding: boolean;
  iot: boolean;
};

export type ProvisionStore = {
  step: 1 | 2 | 3 | 4;
  profile: { name: string; city: string; type: string };
  branches: WizardBranch[];
  seats: { total: number; member_cap: number };
  plan: PlanPreset;
  entitlements: WizardEntitlements;
  adminInvite: { name: string; email: string };

  setStep: (step: 1 | 2 | 3 | 4) => void;
  setProfile: (p: ProvisionStore['profile']) => void;
  setBranches: (b: WizardBranch[]) => void;
  setSeats: (s: ProvisionStore['seats']) => void;
  setPlan: (plan: PlanPreset) => void;
  setEntitlements: (e: WizardEntitlements) => void;
  setAdminInvite: (a: ProvisionStore['adminInvite']) => void;
  reset: () => void;
};

export const PLAN_PRESETS: Record<PlanPreset, WizardEntitlements> = {
  move: {
    move: true, quick_scan: false, deep_scan: false,
    care_programs: false, pain_gating: false,
    custom_branding: false, iot: false,
  },
  move_scan: {
    move: true, quick_scan: true, deep_scan: true,
    care_programs: true, pain_gating: true,
    custom_branding: false, iot: false,
  },
  full_suite: {
    move: true, quick_scan: true, deep_scan: true,
    care_programs: true, pain_gating: true,
    custom_branding: true, iot: true,
  },
};

const INITIAL_STATE = {
  step: 1 as const,
  profile: { name: '', city: '', type: 'physio' },
  branches: [{ _clientId: 'b1', name: 'Main Branch', address: '' }],
  seats: { total: 5, member_cap: 200 },
  plan: 'move_scan' as PlanPreset,
  entitlements: PLAN_PRESETS.move_scan,
  adminInvite: { name: '', email: '' },
};

export const useProvisionStore = create<ProvisionStore>((set) => ({
  ...INITIAL_STATE,
  setStep: (step) => set({ step }),
  setProfile: (profile) => set({ profile }),
  setBranches: (branches) => set({ branches }),
  setSeats: (seats) => set({ seats }),
  setPlan: (plan) => set({ plan, entitlements: PLAN_PRESETS[plan] }),
  setEntitlements: (entitlements) => set({ entitlements }),
  setAdminInvite: (adminInvite) => set({ adminInvite }),
  reset: () => set(INITIAL_STATE),
}));
