'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { GameEligibility } from '@/modules/pain-gating/engine';
import { EligibilityBadge } from './EligibilityBadge';
import { dbg } from '@/lib/debug';

/**
 * Game catalog with a server-computed eligibility verdict per rehab game (feature 1c).
 * Blocked games are visually locked and un-selectable. `can_override` (Ortho/Physio)
 * surfaces a hint; the actual override happens in the program builder (Dev B).
 */
export function GameEligibilityList({ memberId }: { memberId: string }) {
  const [games, setGames] = useState<GameEligibility[] | null>(null);
  const [canOverride, setCanOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dbg('GameEligibilityList:load', { memberId });
    apiClient.get<GameEligibility[]>(`/api/v1/members/${memberId}/game-eligibility`).then((res) => {
      dbg('GameEligibilityList:load ←', res);
      if (res.error || !res.data) {
        setError(res.error?.message ?? 'Failed to load eligibility');
        return;
      }
      setGames(res.data);
      setCanOverride(Boolean((res.meta as { can_override?: boolean } | undefined)?.can_override));
    });
  }, [memberId]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (!games) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-white/5 rounded-xl animate-pulse" />)}
      </div>
    );
  }
  if (games.length === 0) {
    return <p className="text-sm text-slate-500">No games in the catalog yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Server-computed safety per game for this member’s pain map.</p>
        {canOverride && (
          <span className="text-xs text-purple-300">You can override blocked games in the program builder</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {games.map((g) => {
          const blocked = g.verdict === 'blocked';
          return (
            <div
              key={g.game_id}
              title={g.reason ?? undefined}
              className={[
                'flex items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3',
                blocked ? 'bg-red-500/[0.04] opacity-70 cursor-not-allowed' : 'bg-white/5',
              ].join(' ')}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {blocked && <span aria-hidden className="text-red-400">🔒</span>}
                  <span className="text-sm font-medium text-white truncate">{g.game_name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{g.category}</span>
                </div>
                {(g.reason || g.modifications) && (
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {g.reason}{g.modifications ? ` · ${g.modifications}` : ''}
                  </div>
                )}
              </div>
              <EligibilityBadge verdict={g.verdict} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
