'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Table, type Column } from '@/components/ui-a/Table';
import { Badge } from '@/components/ui-a/Badge';
import { MiniBar } from '@/components/ui-a/Chart';
import { MemberStatusBadge } from '@/components/members/MemberStatusBadge';
import { dbg } from '@/lib/debug';

type MemberRow = {
  id: string; name: string; mobile: string; age: number | null; sex: string | null;
  segment: string; status: string; branch_id: string | null;
  musculage: number | null; adherence: number | null; at_risk: boolean; risk_reason: string | null;
};

const QUEUES = [
  { key: 'all', label: 'All', risk: '' },
  { key: 'new', label: 'New', risk: 'new' },
  { key: 'flagged', label: 'Flagged', risk: 'flagged' },
  { key: 'low', label: 'Low adherence', risk: 'low_adherence' },
] as const;

function adherenceColor(a: number): string {
  if (a >= 80) return 'bg-green-400';
  if (a >= 50) return 'bg-teal-400';
  if (a >= 30) return 'bg-amber-400';
  return 'bg-red-400';
}

function MembersList() {
  const router = useRouter();
  const { toast } = useToast();
  const [authChecked, setAuthChecked] = useState(false);
  const [queue, setQueue] = useState<(typeof QUEUES)[number]['key']>('all');
  const [segment, setSegment] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get().access) { router.push('/clinic/login'); return; }
    setAuthChecked(true);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    const risk = QUEUES.find((x) => x.key === queue)?.risk ?? '';
    const params = new URLSearchParams();
    if (risk) params.set('risk', risk);
    if (segment) params.set('segment', segment);
    if (q.trim()) params.set('q', q.trim());
    const url = `/api/v1/members${params.toString() ? `?${params}` : ''}`;
    dbg('MembersList:load', url);
    const res = await apiClient.get<MemberRow[]>(url);
    dbg('MembersList:load ←', res);
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to load members', message: res.error?.message });
      setRows([]);
    } else {
      setRows(res.data);
    }
    setLoading(false);
  }, [queue, segment, q, toast]);

  // Reload on queue/segment change; debounce search.
  useEffect(() => {
    if (!authChecked) return;
    const t = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [authChecked, queue, segment, q, load]);

  const columns: Column<MemberRow>[] = [
    {
      key: 'name', header: 'Member',
      render: (m) => (
        <div>
          <div className="font-medium text-white">{m.name}</div>
          <div className="text-slate-500 text-xs">{m.mobile}</div>
        </div>
      ),
    },
    { key: 'segment', header: 'Segment', render: (m) => <Badge tone={m.segment === 'care' ? 'blue' : 'gray'}>{m.segment}</Badge> },
    { key: 'musculage', header: 'Musculage', render: (m) => <span className="text-white tabular-nums">{m.musculage ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (m) => <MemberStatusBadge status={m.status} /> },
    {
      key: 'adherence', header: 'Adherence',
      render: (m) => (m.adherence == null
        ? <span className="text-slate-600 text-xs">—</span>
        : <MiniBar value={m.adherence} colorClass={adherenceColor(m.adherence)} label={`${m.adherence}%`} />),
    },
    {
      key: 'risk', header: 'At-risk',
      render: (m) => (m.at_risk ? <Badge tone="red">{m.risk_reason ?? 'At-risk'}</Badge> : <span className="text-slate-600 text-xs">—</span>),
    },
  ];

  if (!authChecked) return <div className="min-h-screen" />;

  return (
    <div>
      <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
            <span className="text-slate-900 font-bold text-sm">K</span>
          </div>
          <span className="text-white font-semibold text-sm">Members</span>
        </div>
        <Button variant="primary" size="sm" onClick={() => router.push('/members/new')}>+ Add member</Button>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Action queue */}
        <div className="flex gap-1 border-b border-white/10 mb-4 overflow-x-auto">
          {QUEUES.map((t) => (
            <button
              key={t.key}
              onClick={() => setQueue(t.key)}
              className={[
                'px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                queue === t.key ? 'border-teal-400 text-white' : 'border-transparent text-slate-400 hover:text-white',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or mobile…"
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-teal-400 w-64"
          />
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-400"
          >
            <option value="" className="bg-slate-900">All segments</option>
            <option value="care" className="bg-slate-900">Care</option>
            <option value="wellness" className="bg-slate-900">Wellness</option>
          </select>
          <span className="text-xs text-slate-500 ml-auto">{rows.length} member{rows.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <Table
            columns={columns}
            rows={rows}
            onRowClick={(m) => router.push(`/members/${m.id}`)}
            empty={queue === 'all' ? 'No members yet. Add your first member.' : 'No members in this queue.'}
          />
        )}
      </main>
    </div>
  );
}

export default function MembersListPage() {
  return (
    <ToastProvider>
      <MembersList />
    </ToastProvider>
  );
}
