'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { useProgramBuilderStore, type ProgramItem, type ProgramPhase } from '@/store/program-builder';
import type { GameEligibility } from '@/server/clinical/eligibility-fixture';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusChip } from '@/components/ui/StatusChip';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type Member = {
  id: string;
  name: string;
  status: string;
  segment: string;
  pain_flags: { region: string; severity: number; type: string }[];
};

type Template = {
  id: string;
  name: string;
  segment: string;
  phase_count: number;
  item_count: number;
};

type PageState = 'loading' | 'no-program' | 'builder';

function verdictChip(verdict: string, isOverridden: boolean) {
  if (isOverridden) return <span className="px-2 py-0.5 text-xs rounded-full bg-teal-400/20 text-teal-300 font-medium">Overridden</span>;
  if (verdict === 'eligible') return <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400 font-medium">Cleared</span>;
  if (verdict === 'modified') return <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400 font-medium">Modified</span>;
  if (verdict === 'capped') return <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400 font-medium">Capped</span>;
  if (verdict === 'blocked') return <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400 font-medium flex items-center gap-1"><span>🔒</span>Locked</span>;
  return null;
}

function CategoryBars({ items }: { items: ProgramItem[] }) {
  const cats = ['stability', 'balance', 'rom', 'strength'];
  const counts = Object.fromEntries(cats.map(c => [c, items.filter(i => i.category === c).length]));
  const max = Math.max(...Object.values(counts), 1);
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Category Balance</p>
      {cats.map(cat => (
        <div key={cat} className="flex items-center gap-3">
          <span className="text-xs text-slate-400 w-16 capitalize">{cat}</span>
          <div className="flex-1 bg-white/5 rounded-full h-1.5">
            <div
              className="bg-teal-400 h-1.5 rounded-full transition-all"
              style={{ width: `${(counts[cat] / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 w-12 text-right">{counts[cat]} item{counts[cat] !== 1 ? 's' : ''}</span>
        </div>
      ))}
    </div>
  );
}

function ProgramBuilderInner() {
  const params = useParams<{ id: string }>();
  const memberId = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const store = useProgramBuilderStore();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [member, setMember] = useState<Member | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [overrideItem, setOverrideItemState] = useState<ProgramItem | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [phaseNameEdit, setPhaseNameEdit] = useState<string | null>(null);

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) { router.push('/clinic/login'); return; }
    const payload = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    setUserRole((payload?.role as string) ?? '');
    loadMemberAndProgram();
    return () => { store.reset(); };
  }, [memberId]);

  const loadMemberAndProgram = useCallback(async () => {
    setPageState('loading');
    const [memberRes, programRes] = await Promise.all([
      apiClient.get<Member>(`/api/v1/members/${memberId}`),
      apiClient.get<Record<string, unknown> | null>(`/api/v1/members/${memberId}/program`),
    ]);

    if (memberRes.error || !memberRes.data) {
      toast({ variant: 'error', title: 'Failed to load member', message: memberRes.error?.message });
      return;
    }
    setMember(memberRes.data);

    if (programRes.data) {
      const prog = programRes.data as {
        id: string; version: number; status: string; current_phase: number;
        source_template_id: string | null;
        phases: Array<{
          id: string; order: number; name: string; duration_weeks: number;
          items: Array<{
            id: string; game_id: string; game_name: string; category: string;
            regions: string[]; frequency_per_week: number; gating_verdict: string;
            is_overridden: boolean;
          }>;
        }>;
      };
      store.setProgram({
        instanceId: prog.id,
        memberId,
        templateId: prog.source_template_id,
        version: prog.version,
        status: prog.status,
        currentPhase: prog.current_phase,
        phases: prog.phases.map(p => ({
          id: p.id,
          order: p.order,
          name: p.name,
          duration_weeks: p.duration_weeks,
          items: p.items.map(i => ({
            id: i.id,
            game_id: i.game_id,
            game_name: i.game_name,
            category: i.category,
            regions: i.regions,
            frequency_per_week: i.frequency_per_week,
            gating_verdict: i.gating_verdict as ProgramItem['gating_verdict'],
            is_overridden: i.is_overridden,
            override_reason: null,
            reason: null,
            modifications: null,
          })),
        })),
      });
      setPageState('builder');
      loadEligibility();
    } else {
      setPageState('no-program');
    }
  }, [memberId]);

  const loadEligibility = useCallback(async () => {
    store.setProgram({ loadingEligibility: true });
    const res = await apiClient.get<GameEligibility[]>(`/api/v1/members/${memberId}/game-eligibility`);
    if (res.data) store.setEligibility(res.data);
    else store.setProgram({ loadingEligibility: false });
  }, [memberId]);

  async function handleStartFromScratch() {
    setActionLoading(true);
    const res = await apiClient.post<{ id: string; version: number; status: string; phases: ProgramPhase[] }>(
      `/api/v1/members/${memberId}/program`,
      { phases: [{ name: 'Phase 1', duration_weeks: 3, order: 1, items: [] }] },
    );
    setActionLoading(false);
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to create program', message: res.error?.message });
      return;
    }
    await loadMemberAndProgram();
  }

  async function handleUseTemplate(templateId: string) {
    setActionLoading(true);
    const res = await apiClient.post<{ id: string; version: number; status: string; phases: ProgramPhase[] }>(
      `/api/v1/members/${memberId}/program`,
      { source_template_id: templateId },
    );
    setActionLoading(false);
    setShowTemplatePicker(false);
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to clone template', message: res.error?.message });
      return;
    }
    await loadMemberAndProgram();
  }

  async function loadTemplates() {
    const res = await apiClient.get<Template[]>('/api/v1/program-templates');
    if (res.data) setTemplates(res.data.filter(t => t.segment === (member?.segment ?? 'care')));
  }

  async function handleAddPhase() {
    const nextOrder = store.phases.length + 1;
    const res = await apiClient.post<ProgramPhase>(
      `/api/v1/members/${memberId}/program/phases`,
      { name: `Phase ${nextOrder}`, duration_weeks: 3, order: nextOrder },
    );
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to add phase', message: res.error?.message });
      return;
    }
    store.addPhase(res.data);
    store.setActivePhase(store.phases.length); // index of new phase
  }

  async function handleAddItem(elig: GameEligibility) {
    const phase = store.phases[store.activePhaseIndex];
    if (!phase) return;

    const res = await apiClient.post<ProgramItem>(
      `/api/v1/members/${memberId}/program/items`,
      { phase_id: phase.id, game_id: elig.game_id, frequency_per_week: 3 },
    );
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to add exercise', message: res.error?.message });
      return;
    }
    store.addItem(phase.id, {
      id: res.data.id,
      game_id: res.data.game_id,
      game_name: res.data.game_name,
      category: res.data.category,
      regions: res.data.regions,
      frequency_per_week: res.data.frequency_per_week,
      gating_verdict: res.data.gating_verdict,
      is_overridden: res.data.is_overridden,
      override_reason: null,
      reason: elig.reason,
      modifications: elig.modifications,
    });
    toast({ variant: 'success', title: `${elig.game_name} added` });
  }

  async function handleRemoveItem(phase: ProgramPhase, itemId: string) {
    const res = await apiClient.delete(
      `/api/v1/members/${memberId}/program/items/${itemId}`,
    );
    if (res.error) {
      toast({ variant: 'error', title: 'Failed to remove exercise', message: res.error.message });
      return;
    }
    store.removeItem(phase.id, itemId);
  }

  async function handleFrequencyChange(phase: ProgramPhase, item: ProgramItem, delta: number) {
    const next = Math.min(7, Math.max(1, item.frequency_per_week + delta));
    if (next === item.frequency_per_week) return;
    store.updateItemFrequency(phase.id, item.id, next);
    const res = await apiClient.patch(
      `/api/v1/members/${memberId}/program/items`,
      { item_id: item.id, frequency_per_week: next },
    );
    if (res.error) {
      store.updateItemFrequency(phase.id, item.id, item.frequency_per_week); // rollback
      toast({ variant: 'error', title: 'Failed to update frequency', message: res.error.message });
    }
  }

  async function handleOverride() {
    if (!overrideItem || !store.phases[store.activePhaseIndex]) return;
    const phase = store.phases[store.activePhaseIndex];
    setOverrideLoading(true);
    const res = await apiClient.post(
      `/api/v1/members/${memberId}/program/items/${overrideItem.id}/override`,
      { reason: overrideReason },
    );
    setOverrideLoading(false);
    if (res.error) {
      toast({ variant: 'error', title: 'Override failed', message: res.error.message });
      return;
    }
    store.overrideItem(phase.id, overrideItem.id, overrideReason);
    toast({ variant: 'success', title: 'Safety lock overridden', message: 'Action logged.' });
    setOverrideItemState(null);
    setOverrideReason('');
  }

  async function handlePushUpdate() {
    setPushLoading(true);
    const res = await apiClient.post(`/api/v1/members/${memberId}/program/push`);
    setPushLoading(false);
    setShowPushConfirm(false);
    if (res.error) {
      toast({ variant: 'error', title: 'Push failed', message: res.error.message });
      return;
    }
    toast({ variant: 'success', title: `Program updated to v${store.version + 1}` });
    await loadMemberAndProgram();
  }

  const activePhase = store.phases[store.activePhaseIndex] ?? null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-white text-sm"
        >
          ← Back
        </button>
        {member && (
          <>
            <span className="text-slate-600">/</span>
            <span className="text-white font-medium text-sm">{member.name}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400 text-sm">Care Program</span>
          </>
        )}
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {pageState === 'loading' && (
          <div className="space-y-4">
            <div className="h-8 w-48 bg-white/5 rounded-xl animate-pulse" />
            <div className="flex gap-4">
              <div className="w-56 h-80 bg-white/5 rounded-xl animate-pulse" />
              <div className="flex-1 h-80 bg-white/5 rounded-xl animate-pulse" />
            </div>
          </div>
        )}

        {pageState === 'no-program' && (
          <div className="flex flex-col items-center justify-center py-24 gap-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white mb-2">No Program Yet</h1>
              <p className="text-slate-400 text-sm">Create a care program for {member?.name}.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="primary" loading={actionLoading} onClick={handleStartFromScratch}>
                Start from scratch
              </Button>
              <Button
                variant="secondary"
                onClick={() => { loadTemplates(); setShowTemplatePicker(true); }}
              >
                Use a template
              </Button>
            </div>
          </div>
        )}

        {pageState === 'builder' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-white">Care Program</h1>
                <p className="text-slate-400 text-sm mt-1">
                  {member?.name} · v{store.version}
                  {store.status && <span className="ml-2"><StatusChip status={store.status} /></span>}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => setShowPushConfirm(true)}
              >
                Push Update
              </Button>
            </div>

            <div className="flex gap-4">
              {/* Phase sidebar */}
              <div className="w-56 flex-shrink-0">
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  {store.phases.map((phase, idx) => (
                    <button
                      key={phase.id}
                      onClick={() => store.setActivePhase(idx)}
                      className={[
                        'w-full text-left px-4 py-3 border-b border-white/5 transition-colors',
                        idx === store.activePhaseIndex
                          ? 'border-l-2 border-l-teal-400 bg-white/5 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-white/3',
                      ].join(' ')}
                    >
                      <div className="font-medium text-sm truncate">{phase.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{phase.items.length} exercise{phase.items.length !== 1 ? 's' : ''}</div>
                    </button>
                  ))}
                  <button
                    onClick={handleAddPhase}
                    className="w-full text-left px-4 py-3 text-slate-500 hover:text-teal-400 text-sm transition-colors"
                  >
                    + Add Phase
                  </button>
                </div>
              </div>

              {/* Phase content */}
              {activePhase ? (
                <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      {phaseNameEdit === activePhase.id ? (
                        <input
                          autoFocus
                          defaultValue={activePhase.name}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val && val !== activePhase.name) store.updatePhase(activePhase.id, { name: val });
                            setPhaseNameEdit(null);
                          }}
                          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          className="bg-white/10 text-white px-3 py-1 rounded-lg text-lg font-semibold outline-none border border-teal-400/40"
                        />
                      ) : (
                        <h2
                          className="text-lg font-semibold text-white cursor-pointer hover:text-teal-400 transition-colors"
                          onClick={() => setPhaseNameEdit(activePhase.id)}
                        >
                          {activePhase.name}
                        </h2>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">{activePhase.duration_weeks} weeks</p>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => store.setShowItemPicker(true)}>
                      Add Exercise
                    </Button>
                  </div>

                  {activePhase.items.length === 0 ? (
                    <p className="text-slate-500 text-sm py-8 text-center">
                      No exercises yet. Add exercises to this phase.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-white/10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5">
                            <th className="text-left text-slate-400 font-medium px-4 py-2.5">Exercise</th>
                            <th className="text-left text-slate-400 font-medium px-4 py-2.5">Category</th>
                            <th className="text-left text-slate-400 font-medium px-4 py-2.5">Freq/Week</th>
                            <th className="text-left text-slate-400 font-medium px-4 py-2.5">Eligibility</th>
                            <th className="text-right text-slate-400 font-medium px-4 py-2.5">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {activePhase.items.map(item => (
                            <tr key={item.id} className="hover:bg-white/3 transition-colors">
                              <td className="px-4 py-3">
                                <div className="text-white font-medium">{item.game_name}</div>
                                <div className="text-slate-500 text-xs">{item.regions.join(', ')}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-0.5 text-xs rounded-full bg-white/10 text-slate-300 capitalize">
                                  {item.category}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleFrequencyChange(activePhase, item, -1)}
                                    className="w-6 h-6 rounded bg-white/10 text-white hover:bg-white/20 flex items-center justify-center text-xs"
                                  >−</button>
                                  <span className="w-4 text-center text-white text-sm">{item.frequency_per_week}</span>
                                  <button
                                    onClick={() => handleFrequencyChange(activePhase, item, +1)}
                                    className="w-6 h-6 rounded bg-white/10 text-white hover:bg-white/20 flex items-center justify-center text-xs"
                                  >+</button>
                                </div>
                              </td>
                              <td className="px-4 py-3">{verdictChip(item.gating_verdict, item.is_overridden)}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {/* Override button: only for ortho/physio on non-overridden blocked items */}
                                  {['ortho', 'physio'].includes(userRole) && item.gating_verdict === 'blocked' && !item.is_overridden && (
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => setOverrideItemState(item)}
                                    >
                                      Override
                                    </Button>
                                  )}
                                  <button
                                    onClick={() => handleRemoveItem(activePhase, item.id)}
                                    className="text-slate-500 hover:text-red-400 transition-colors px-1"
                                    title="Remove exercise"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <CategoryBars items={activePhase.items} />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500 bg-white/5 border border-white/10 rounded-xl">
                  Select a phase to view exercises
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Template picker modal */}
      <Modal
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        title="Use a Template"
        size="md"
      >
        {templates.length === 0 ? (
          <p className="text-slate-400 text-sm py-4">No published templates yet.</p>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                <div>
                  <div className="text-white font-medium text-sm">{t.name}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{t.phase_count} phases · {t.item_count} exercises</div>
                </div>
                <Button size="sm" variant="primary" loading={actionLoading} onClick={() => handleUseTemplate(t.id)}>
                  Use
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Item picker modal */}
      <Modal
        open={store.showItemPicker}
        onClose={() => store.setShowItemPicker(false)}
        title={`Add Exercise to ${activePhase?.name ?? 'Phase'}`}
        size="lg"
      >
        {store.loadingEligibility ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {(['eligible', 'modified', 'capped', 'blocked'] as const).map(verdict => {
              const group = store.eligibility.filter(e => e.verdict === verdict);
              if (group.length === 0) return null;
              return (
                <div key={verdict}>
                  <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1.5 mt-3 first:mt-0">
                    {verdict === 'eligible' ? 'Cleared' : verdict === 'modified' ? 'Modified' : verdict === 'capped' ? 'Capped' : 'Locked'}
                  </p>
                  {group.map(elig => {
                    const alreadyAdded = activePhase?.items.some(i => i.game_id === elig.game_id) ?? false;
                    return (
                      <div key={elig.game_id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/10 mb-1">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium">{elig.game_name}</span>
                            {verdictChip(elig.verdict, false)}
                          </div>
                          <div className="text-slate-500 text-xs mt-0.5">
                            {elig.regions.join(', ')}
                            {elig.reason && <span className="ml-2 text-amber-500">{elig.reason}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={alreadyAdded ? 'ghost' : 'secondary'}
                          disabled={alreadyAdded}
                          onClick={() => handleAddItem(elig)}
                        >
                          {alreadyAdded ? 'Added' : 'Add'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Override modal */}
      <Modal
        open={overrideItem !== null}
        onClose={() => { setOverrideItemState(null); setOverrideReason(''); }}
        title="Override Safety Lock"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setOverrideItemState(null); setOverrideReason(''); }}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={overrideLoading}
              disabled={overrideReason.length < 10}
              onClick={handleOverride}
            >
              Confirm Override
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-300">
            You are overriding a safety restriction. This action is logged.
          </div>
          {overrideItem && (
            <p className="text-slate-300 text-sm">
              <strong>{overrideItem.game_name}</strong> — {overrideItem.reason ?? 'Locked due to active pain flag'}
            </p>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Clinical reasoning (required)</label>
            <textarea
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              rows={3}
              placeholder="Provide clinical justification for overriding this safety lock…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-teal-400/40 resize-none"
            />
            <p className="text-xs text-slate-600 mt-1">{overrideReason.length}/500 · min 10 chars</p>
          </div>
        </div>
      </Modal>

      {/* Push confirm modal */}
      <Modal
        open={showPushConfirm}
        onClose={() => setShowPushConfirm(false)}
        title="Push Program Update?"
        size="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowPushConfirm(false)}>Cancel</Button>
            <Button variant="primary" loading={pushLoading} onClick={handlePushUpdate}>
              Push Update
            </Button>
          </div>
        }
      >
        <p className="text-slate-400 text-sm">
          This will archive the current version and create version {store.version + 1}.
          The member will receive the updated program.
        </p>
      </Modal>
    </div>
  );
}

export default function ProgramBuilderPage() {
  return (
    <ToastProvider>
      <ProgramBuilderInner />
    </ToastProvider>
  );
}
