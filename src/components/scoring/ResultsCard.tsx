import type { Category } from '@/types/test';
import { CATEGORIES } from '@/modules/scoring/categories';
import { scoreBarColor, CATEGORY_LABELS, musculageDelta } from '@/modules/scoring/score-display';

/**
 * Assessment results card (feature 1c): Musculage headline + 4 category bars.
 * Presentational — fed by the /complete response.
 */
export function ResultsCard({
  musculage,
  categories,
  memberAge,
}: {
  musculage: number | null;
  categories: Partial<Record<Category, number>>;
  memberAge?: number;
}) {
  const delta = musculageDelta(musculage, memberAge);
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <div className="flex items-baseline gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Musculage</h3>
      </div>
      <div className="flex items-end gap-3 mt-1">
        <span className="text-5xl font-bold text-teal-400 tabular-nums">{musculage ?? '—'}</span>
        <span className="text-sm text-slate-400 pb-1">{delta ?? 'movement age'}</span>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {CATEGORIES.map((cat: Category) => {
          const score = categories[cat];
          return (
            <div key={cat}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-300">{CATEGORY_LABELS[cat]}</span>
                <span className="text-slate-400 tabular-nums">{score ?? '—'}{score != null ? '/100' : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                {score != null && (
                  <div className={`h-full rounded-full ${scoreBarColor(score)}`} style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
