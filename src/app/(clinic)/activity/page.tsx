'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui-a/Badge';
import { Table, type Column } from '@/components/ui-a/Table';
import { ALL_EVENT_TYPES, eventLabel, eventTone } from '@/modules/events/display';
import { dbg } from '@/lib/debug';

type EventRow = {
  id: string; type: string; actor: string | null; actor_name: string | null;
  clinic_id: string | null; subject: string | null; payload: unknown; ts: string;
};

const ADMIN_LIKE = ['ops', 'clinic_admin'];

function buildQuery(f: { type: string; subject: string; from: string; to: string; actor: string }, cursor?: string | null) {
  const p = new URLSearchParams();
  if (f.type) p.set('type', f.type);
  if (f.subject.trim()) p.set('subject', f.subject.trim());
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.actor.trim()) p.set('actor', f.actor.trim());
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

function ActivityLog() {
  const router = useRouter();
  const { toast } = useToast();
  const [authChecked, setAuthChecked] = useState(false);
  const [role, setRole] = useState<string>('');
  const [rows, setRows] = useState<EventRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [type, setType] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectDebounced, setSubjectDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) { router.push('/clinic/login'); return; }
    const payload = parseAccessToken(tokens.access);
    setRole((payload?.role as string) ?? '');
    setAuthChecked(true);
  }, [router]);

  // Debounce the subject search.
  useEffect(() => {
    const t = setTimeout(() => setSubjectDebounced(subject), 350);
    return () => clearTimeout(t);
  }, [subject]);

  const filters = { type, subject: subjectDebounced, from, to, actor };

  const load = useCallback(async (reset: boolean, nextCursor?: string | null) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    const qs = buildQuery(filters, reset ? null : nextCursor);
    const url = `/api/v1/events${qs ? `?${qs}` : ''}`;
    dbg('ActivityLog:load', { reset, url });
    const res = await apiClient.get<EventRow[]>(url);
    dbg('ActivityLog:load ←', res);
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to load activity', message: res.error?.message });
    } else {
      setRows((prev) => (reset ? res.data! : [...prev, ...res.data!]));
      setCursor((res.meta as { cursor?: string | null } | undefined)?.cursor ?? null);
    }
    setLoading(false);
    setLoadingMore(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, subjectDebounced, from, to, actor, toast]);

  useEffect(() => {
    if (!authChecked) return;
    load(true);
  }, [authChecked, type, subjectDebounced, from, to, actor, load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const qs = buildQuery(filters);
      const res = await apiClient.post<{ csv: string; count: number; capped: boolean }>(`/api/v1/events/export${qs ? `?${qs}` : ''}`, {});
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Export failed', message: res.error?.message });
        return;
      }
      const blob = new Blob([res.data.csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ variant: 'success', title: `Exported ${res.data.count} event${res.data.count === 1 ? '' : 's'}${res.data.capped ? ' (capped at 5000)' : ''}` });
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<EventRow>[] = [
    { key: 'ts', header: 'Time', render: (e) => <span className="text-slate-400 text-xs whitespace-nowrap">{new Date(e.ts).toLocaleString()}</span> },
    { key: 'type', header: 'Event', render: (e) => <Badge tone={eventTone(e.type)}>{eventLabel(e.type)}</Badge> },
    { key: 'actor', header: 'Actor', render: (e) => <span className="text-slate-300">{e.actor_name ?? <span className="text-slate-600">system</span>}</span> },
    { key: 'subject', header: 'Subject', render: (e) => <span className="text-slate-500 text-xs font-mono">{e.subject ?? '—'}</span> },
    {
      key: 'payload', header: 'Details',
      render: (e) => (e.payload && Object.keys(e.payload as object).length
        ? <details className="text-xs"><summary className="text-slate-500 cursor-pointer">view</summary><pre className="text-slate-400 mt-1 whitespace-pre-wrap break-all">{JSON.stringify(e.payload, null, 2)}</pre></details>
        : <span className="text-slate-600 text-xs">—</span>),
    },
  ];

  if (!authChecked) return <div className="min-h-screen" />;

  return (
    <div>
      <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center"><span className="text-slate-900 font-bold text-sm">K</span></div>
          <span className="text-white font-semibold text-sm">Activity log</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {ADMIN_LIKE.includes(role) && (
            <button onClick={() => router.push('/analytics')} className="text-slate-400 hover:text-white">Analytics</button>
          )}
          <button onClick={() => router.push('/members')} className="text-slate-400 hover:text-white">Members →</button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select value={type} onChange={(e) => setType(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400">
            <option value="" className="bg-slate-900">All events</option>
            {ALL_EVENT_TYPES.map((t) => <option key={t} value={t} className="bg-slate-900">{eventLabel(t)}</option>)}
          </select>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (e.g. member:…)" className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-teal-400 w-56" />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400" />
          {ADMIN_LIKE.includes(role) && (
            <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor id" className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-teal-400 w-44" />
          )}
          <Button variant="secondary" size="sm" loading={exporting} onClick={exportCsv} className="ml-auto">Export CSV</Button>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-white/5 rounded-xl animate-pulse" />)}</div>
        ) : (
          <>
            <Table columns={columns} rows={rows} empty="No activity matches these filters." />
            {cursor && (
              <div className="flex justify-center mt-4">
                <Button variant="secondary" size="sm" loading={loadingMore} onClick={() => load(false, cursor)}>Load more</Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function ActivityLogPage() {
  return (
    <ToastProvider>
      <ActivityLog />
    </ToastProvider>
  );
}
