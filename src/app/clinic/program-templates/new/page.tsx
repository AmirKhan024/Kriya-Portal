'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type GameOption = {
  id: string;
  name: string;
  category: string;
  regions: string[];
};

type DraftItem = {
  tempId: string;
  game_id: string;
  game_name: string;
  category: string;
  regions: string[];
  frequency_per_week: number;
};

type DraftPhase = {
  tempId: string;
  name: string;
  duration_weeks: number;
  order: number;
  items: DraftItem[];
};

function TemplateBuilderInner() {
  const router = useRouter();
  const { toast } = useToast();

  const [templateName, setTemplateName] = useState('');
  const [segment, setSegment] = useState<'care' | 'wellness'>('care');
  const [phases, setPhases] = useState<DraftPhase[]>([
    { tempId: 'p1', name: 'Phase 1', duration_weeks: 3, order: 1, items: [] },
  ]);
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);
  const [games, setGames] = useState<GameOption[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) { router.push('/clinic/login'); return; }
    const payload = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    if ((payload?.role as string) !== 'clinic_admin') { router.push('/clinic/members'); return; }
    loadGames();
  }, []);

  async function loadGames() {
    const res = await apiClient.get<GameOption[]>('/api/v1/games');
    if (res.data) setGames(res.data);
  }

  function addPhase() {
    const order = phases.length + 1;
    setPhases(prev => [...prev, {
      tempId: `p${Date.now()}`,
      name: `Phase ${order}`,
      duration_weeks: 3,
      order,
      items: [],
    }]);
    setActivePhaseIdx(phases.length);
  }

  function updatePhaseName(tempId: string, name: string) {
    setPhases(prev => prev.map(p => p.tempId === tempId ? { ...p, name } : p));
  }

  function addItemToPhase(game: GameOption) {
    const phase = phases[activePhaseIdx];
    if (!phase) return;
    if (phase.items.some(i => i.game_id === game.id)) {
      toast({ variant: 'error', title: 'Already added', message: `${game.name} is already in this phase` });
      return;
    }
    setPhases(prev => prev.map(p =>
      p.tempId === phase.tempId
        ? { ...p, items: [...p.items, { tempId: `i${Date.now()}`, game_id: game.id, game_name: game.name, category: game.category, regions: game.regions, frequency_per_week: 3 }] }
        : p,
    ));
  }

  function removeItem(phaseTempId: string, itemTempId: string) {
    setPhases(prev => prev.map(p =>
      p.tempId === phaseTempId ? { ...p, items: p.items.filter(i => i.tempId !== itemTempId) } : p,
    ));
  }

  function updateFrequency(phaseTempId: string, itemTempId: string, delta: number) {
    setPhases(prev => prev.map(p =>
      p.tempId === phaseTempId
        ? {
            ...p,
            items: p.items.map(i =>
              i.tempId === itemTempId
                ? { ...i, frequency_per_week: Math.min(7, Math.max(1, i.frequency_per_week + delta)) }
                : i,
            ),
          }
        : p,
    ));
  }

  async function handleSave(andPublish = false) {
    if (!templateName.trim()) {
      toast({ variant: 'error', title: 'Name required', message: 'Enter a template name.' });
      return;
    }

    setSaving(true);
    const res = await apiClient.post<{ id: string }>('/api/v1/program-templates', {
      name: templateName.trim(),
      segment,
      phases: phases.map((p, idx) => ({
        name: p.name,
        duration_weeks: p.duration_weeks,
        order: idx + 1,
        items: p.items.map(i => ({ game_id: i.game_id, frequency_per_week: i.frequency_per_week })),
      })),
    });
    setSaving(false);

    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Save failed', message: res.error?.message });
      return;
    }

    const templateId = res.data.id;

    if (andPublish) {
      setPublishing(true);
      const pubRes = await apiClient.post(`/api/v1/program-templates/${templateId}/publish`);
      setPublishing(false);
      if (pubRes.error) {
        toast({ variant: 'error', title: 'Publish failed', message: pubRes.error.message });
        router.push(`/clinic/program-templates/new/${templateId}`);
        return;
      }
      toast({ variant: 'success', title: 'Template published' });
    } else {
      toast({ variant: 'success', title: 'Template saved as draft' });
    }

    router.push('/clinic/program-templates');
  }

  const activePhase = phases[activePhaseIdx] ?? null;

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-sm">← Back</button>
        <span className="text-slate-600">/</span>
        <a href="/clinic/program-templates" className="text-slate-400 hover:text-white text-sm">Program Templates</a>
        <span className="text-slate-600">/</span>
        <span className="text-white font-medium text-sm">New Template</span>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">New Template</h1>
          <div className="flex gap-2">
            <Button variant="secondary" loading={saving} onClick={() => handleSave(false)}>
              Save Draft
            </Button>
            <Button variant="primary" loading={publishing} onClick={() => handleSave(true)}>
              Save & Publish
            </Button>
          </div>
        </div>

        {/* Header fields */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Template Name</label>
            <input
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="e.g. Lower Back Recovery — 6 Week Plan"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-teal-400/40"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Segment</label>
            <select
              value={segment}
              onChange={e => setSegment(e.target.value as 'care' | 'wellness')}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-teal-400/40"
            >
              <option value="care">Care</option>
              <option value="wellness">Wellness</option>
            </select>
          </div>
        </div>

        {/* Builder layout */}
        <div className="flex gap-4">
          {/* Phase sidebar */}
          <div className="w-52 flex-shrink-0">
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              {phases.map((phase, idx) => (
                <button
                  key={phase.tempId}
                  onClick={() => setActivePhaseIdx(idx)}
                  className={[
                    'w-full text-left px-4 py-3 border-b border-white/5 transition-colors',
                    idx === activePhaseIdx
                      ? 'border-l-2 border-l-teal-400 bg-white/5 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/3',
                  ].join(' ')}
                >
                  <div className="font-medium text-sm truncate">{phase.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{phase.items.length} exercise{phase.items.length !== 1 ? 's' : ''}</div>
                </button>
              ))}
              <button
                onClick={addPhase}
                className="w-full text-left px-4 py-3 text-slate-500 hover:text-teal-400 text-sm transition-colors"
              >
                + Add Phase
              </button>
            </div>
          </div>

          {/* Phase content */}
          {activePhase && (
            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <input
                    defaultValue={activePhase.name}
                    onBlur={e => updatePhaseName(activePhase.tempId, e.target.value.trim() || activePhase.name)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="bg-transparent text-lg font-semibold text-white outline-none hover:bg-white/5 rounded-lg px-2 -ml-2 py-0.5 border border-transparent hover:border-white/10 focus:border-teal-400/40 transition-colors"
                  />
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-500">Duration:</span>
                    <input
                      type="number"
                      min={1}
                      max={52}
                      value={activePhase.duration_weeks}
                      onChange={e => setPhases(prev => prev.map(p =>
                        p.tempId === activePhase.tempId ? { ...p, duration_weeks: Number(e.target.value) || 1 } : p,
                      ))}
                      className="w-12 bg-white/10 text-white text-xs rounded px-1.5 py-0.5 outline-none"
                    />
                    <span className="text-xs text-slate-500">weeks</span>
                  </div>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowPicker(true)}>
                  Add Exercise
                </Button>
              </div>

              {activePhase.items.length === 0 ? (
                <p className="text-slate-500 text-sm py-8 text-center">
                  No exercises yet. All games are eligible on templates — gating is applied when assigning to a member.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="text-left text-slate-400 font-medium px-4 py-2.5">Exercise</th>
                        <th className="text-left text-slate-400 font-medium px-4 py-2.5">Category</th>
                        <th className="text-left text-slate-400 font-medium px-4 py-2.5">Freq/Week</th>
                        <th className="text-right text-slate-400 font-medium px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {activePhase.items.map(item => (
                        <tr key={item.tempId} className="hover:bg-white/3 transition-colors">
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
                              <button onClick={() => updateFrequency(activePhase.tempId, item.tempId, -1)} className="w-6 h-6 rounded bg-white/10 text-white hover:bg-white/20 flex items-center justify-center text-xs">−</button>
                              <span className="w-4 text-center text-white text-sm">{item.frequency_per_week}</span>
                              <button onClick={() => updateFrequency(activePhase.tempId, item.tempId, +1)} className="w-6 h-6 rounded bg-white/10 text-white hover:bg-white/20 flex items-center justify-center text-xs">+</button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => removeItem(activePhase.tempId, item.tempId)}
                              className="text-slate-500 hover:text-red-400 transition-colors px-1"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Game picker */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0d1117] border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="text-white font-semibold">Add Exercise</h2>
              <button onClick={() => setShowPicker(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {games.map(game => {
                const alreadyAdded = activePhase?.items.some(i => i.game_id === game.id) ?? false;
                return (
                  <div key={game.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/10">
                    <div>
                      <div className="text-white text-sm font-medium">{game.name}</div>
                      <div className="text-slate-500 text-xs">{game.regions.join(', ')} · {game.category}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={alreadyAdded ? 'ghost' : 'secondary'}
                      disabled={alreadyAdded}
                      onClick={() => { addItemToPhase(game); }}
                    >
                      {alreadyAdded ? 'Added' : 'Add'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewTemplatePage() {
  return (
    <ToastProvider>
      <TemplateBuilderInner />
    </ToastProvider>
  );
}
