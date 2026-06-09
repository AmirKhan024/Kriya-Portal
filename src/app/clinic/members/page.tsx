'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { useClinicId } from '@/hooks/useRole';
import { StatusChip } from '@/components/ui/StatusChip';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type Member = {
  id: string;
  name: string;
  mobile: string;
  age: number | null;
  sex: string | null;
  segment: string;
  status: string;
  complaint: string | null;
  branch_id: string | null;
  created_at: string;
};

type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  pages: number;
};

type Branch = { id: string; name: string };

const MEMBER_STATUSES = [
  'new', 'assessed', 'prescribed', 'on_program', 'at_risk', 'retained', 'lapsed', 'discharged',
];

const STATUS_LABELS: Record<string, string> = {
  new:         'New',
  assessed:    'Assessed',
  prescribed:  'Prescribed',
  on_program:  'On Program',
  at_risk:     'At Risk',
  retained:    'Retained',
  lapsed:      'Lapsed',
  discharged:  'Discharged',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function truncate(str: string | null, max: number) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function RowActions({ member }: { member: Member }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-slate-900 border border-white/10 rounded-xl shadow-xl z-50 py-1">
            <button
              onClick={() => { setOpen(false); router.push(`/clinic/members/${member.id}/prescriptions/new`); }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              New Prescription
            </button>
            <button
              onClick={() => { setOpen(false); router.push(`/clinic/members/${member.id}/program`); }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              View Program
            </button>
            <button
              onClick={() => { setOpen(false); router.push(`/clinic/members/${member.id}/prescriptions`); }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              Prescriptions
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MembersPageInner() {
  const router = useRouter();
  const { toast } = useToast();
  const clinicId = useClinicId();

  const [members, setMembers] = useState<Member[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, pages: 1 });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Load branches once
  useEffect(() => {
    if (!clinicId) return;
    apiClient.get<Branch[]>(`/api/v1/clinics/${clinicId}/branches`).then(res => {
      if (res.data) setBranches(res.data);
    });
  }, [clinicId]);

  const fetchMembers = useCallback(() => {
    if (clinicId === null) return;
    if (!clinicId) {
      router.push('/clinic/login');
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (branchFilter) params.set('branch_id', branchFilter);

    apiClient.get<Member[]>(`/api/v1/clinics/${clinicId}/members?${params}`).then(res => {
      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Failed to load members', message: res.error?.message });
        if (res.error?.code === 'AUTH_REQUIRED') router.push('/clinic/login');
      } else {
        setMembers(res.data);
        const resMeta = (res as { data: Member[]; meta?: PaginationMeta }).meta;
        if (resMeta) setMeta(resMeta);
      }
      setLoading(false);
    });
  }, [clinicId, page, search, statusFilter, branchFilter]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, branchFilter]);

  const hasFilters = search || statusFilter || branchFilter;

  return (
    <div className="min-h-screen bg-[#05080f]">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Members</h1>
          {!loading && (
            <span className="px-2 py-0.5 rounded-lg bg-white/10 text-slate-400 text-xs font-medium">
              {meta.total}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          onClick={() => router.push('/clinic/members/new')}
        >
          Add Member
        </Button>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <Input
            placeholder="Search name or mobile..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-white/5 border border-white/10 text-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400/50"
        >
          <option value="">All Statuses</option>
          {MEMBER_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
          ))}
        </select>

        {branches.length > 0 && (
          <select
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value)}
            className="bg-white/5 border border-white/10 text-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400/50"
          >
            <option value="">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        {hasFilters && (
          <button
            onClick={() => { setSearchInput(''); setStatusFilter(''); setBranchFilter(''); }}
            className="text-xs text-slate-400 hover:text-white transition-colors underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-400 text-base">
              {hasFilters
                ? 'No members match your filters. Try clearing the search.'
                : 'No members yet. Click “Add Member” to register one.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wide border-b border-white/10">
                  <th className="pb-3 font-medium pr-4">Name</th>
                  <th className="pb-3 font-medium pr-4">Mobile</th>
                  <th className="pb-3 font-medium pr-4">Age</th>
                  <th className="pb-3 font-medium pr-4">Status</th>
                  <th className="pb-3 font-medium pr-4">Complaint</th>
                  <th className="pb-3 font-medium pr-4">Segment</th>
                  <th className="pb-3 font-medium pr-4">Joined</th>
                  <th className="pb-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {members.map(m => (
                  <tr key={m.id} className="hover:bg-white/3 transition-colors">
                    <td className="py-3.5 pr-4">
                      <Link
                        href={`/clinic/members/${m.id}/program`}
                        className="text-white font-medium hover:text-teal-300 transition-colors"
                      >
                        {m.name}
                      </Link>
                    </td>
                    <td className="py-3.5 pr-4 text-slate-400">{m.mobile}</td>
                    <td className="py-3.5 pr-4 text-slate-400">{m.age ?? '—'}</td>
                    <td className="py-3.5 pr-4">
                      <StatusChip status={m.status} />
                    </td>
                    <td className="py-3.5 pr-4 text-slate-400 max-w-xs">
                      {truncate(m.complaint, 40)}
                    </td>
                    <td className="py-3.5 pr-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        m.segment === 'care'
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-teal-500/15 text-teal-400'
                      }`}>
                        {m.segment === 'care' ? 'Care' : 'Wellness'}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4 text-slate-500">{formatDate(m.created_at)}</td>
                    <td className="py-3.5">
                      <RowActions member={m} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && meta.pages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-slate-500">Page {meta.page} of {meta.pages}</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(p => p - 1)}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= meta.pages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MembersPage() {
  return (
    <ToastProvider>
      <MembersPageInner />
    </ToastProvider>
  );
}
