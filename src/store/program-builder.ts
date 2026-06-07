import { create } from 'zustand';
import type { GameEligibility } from '@/server/clinical/eligibility-fixture';

export type ProgramItem = {
  id: string;
  game_id: string;
  game_name: string;
  category: string;
  regions: string[];
  frequency_per_week: number;
  gating_verdict: 'eligible' | 'modified' | 'capped' | 'blocked';
  is_overridden: boolean;
  override_reason: string | null;
  reason: string | null;
  modifications: string | null;
};

export type ProgramPhase = {
  id: string;
  order: number;
  name: string;
  duration_weeks: number;
  items: ProgramItem[];
};

type ProgramState = {
  instanceId: string | null;
  memberId: string | null;
  templateId: string | null;
  version: number;
  status: string;
  currentPhase: number;
  phases: ProgramPhase[];
  activePhaseIndex: number;
  showItemPicker: boolean;
  eligibility: GameEligibility[];
  loadingEligibility: boolean;
};

type ProgramActions = {
  setProgram: (program: Partial<ProgramState>) => void;
  setEligibility: (e: GameEligibility[]) => void;
  setActivePhase: (index: number) => void;
  setShowItemPicker: (show: boolean) => void;
  addPhase: (phase: ProgramPhase) => void;
  updatePhase: (phaseId: string, updates: Partial<Pick<ProgramPhase, 'name' | 'duration_weeks'>>) => void;
  addItem: (phaseId: string, item: ProgramItem) => void;
  removeItem: (phaseId: string, itemId: string) => void;
  updateItemFrequency: (phaseId: string, itemId: string, frequency: number) => void;
  overrideItem: (phaseId: string, itemId: string, reason: string) => void;
  reset: () => void;
};

export type ProgramBuilderStore = ProgramState & ProgramActions;

const INITIAL: ProgramState = {
  instanceId: null,
  memberId: null,
  templateId: null,
  version: 1,
  status: 'draft',
  currentPhase: 1,
  phases: [],
  activePhaseIndex: 0,
  showItemPicker: false,
  eligibility: [],
  loadingEligibility: false,
};

export const useProgramBuilderStore = create<ProgramBuilderStore>((set) => ({
  ...INITIAL,

  setProgram: (p) => set(p),

  setEligibility: (eligibility) => set({ eligibility, loadingEligibility: false }),

  setActivePhase: (activePhaseIndex) => set({ activePhaseIndex }),

  setShowItemPicker: (showItemPicker) => set({ showItemPicker }),

  addPhase: (phase) => set(s => ({ phases: [...s.phases, phase] })),

  updatePhase: (phaseId, updates) => set(s => ({
    phases: s.phases.map(p => p.id === phaseId ? { ...p, ...updates } : p),
  })),

  addItem: (phaseId, item) => set(s => ({
    phases: s.phases.map(p =>
      p.id === phaseId ? { ...p, items: [...p.items, item] } : p,
    ),
  })),

  removeItem: (phaseId, itemId) => set(s => ({
    phases: s.phases.map(p =>
      p.id === phaseId ? { ...p, items: p.items.filter(i => i.id !== itemId) } : p,
    ),
  })),

  updateItemFrequency: (phaseId, itemId, frequency) => set(s => ({
    phases: s.phases.map(p =>
      p.id === phaseId
        ? { ...p, items: p.items.map(i => i.id === itemId ? { ...i, frequency_per_week: frequency } : i) }
        : p,
    ),
  })),

  overrideItem: (phaseId, itemId, reason) => set(s => ({
    phases: s.phases.map(p =>
      p.id === phaseId
        ? {
            ...p,
            items: p.items.map(i =>
              i.id === itemId
                ? { ...i, is_overridden: true, override_reason: reason, gating_verdict: 'eligible' as const }
                : i,
            ),
          }
        : p,
    ),
  })),

  reset: () => set(INITIAL),
}));
