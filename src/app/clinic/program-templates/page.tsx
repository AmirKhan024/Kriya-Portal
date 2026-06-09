'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { ToastProvider, useToast } from '@/components/ui/Toast';

type Template = {
  id: string;
  name: string;
  segment: 'care' | 'wellness';
  status: 'draft' | 'published';
  phase_count: number;
  item_count: number;
  created_at: string;
};

function TemplateLibraryInner() {
  const router = useRouter();
  const { toast } = useToast();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'care' | 'wellness'>('care');
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens.access) { router.push('/clinic/login'); return; }
    const payload = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    const role = (payload?.role as string) ?? '';
    if (role !== 'clinic_admin') { router.push('/clinic/members'); return; }
    setIsAdmin(true);
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    setLoading(true);
    const res = await apiClient.get<Template[]>('/api/v1/program-templates');
    setLoading(false);
    if (res.data) setTemplates(res.data);
    else toast({ variant: 'error', title: 'Failed to load templates', message: res.error?.message });
  }

  async function handlePublish(id: string) {
    setPublishingId(id);
    const res = await apiClient.post(`/api/v1/program-templates/${id}/publish`);
    setPublishingId(null);
    if (res.error) {
      toast({ variant: 'error', title: 'Publish failed', message: res.error.message });
      return;
    }
    toast({ variant: 'success', title: 'Template published' });
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, status: 'published' } : t));
  }

  const filtered = templates.filter(t => t.segment === activeTab);

  return (
    <div className="min-h-screen bg-[#05080f]">
      <nav className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-slate-400 hover:text-white text-sm">← Back</button>
          <span className="text-slate-600">/</span>
          <span className="text-white font-medium text-sm">Program Templates</span>
        </div>
        {isAdmin && (
          <Button variant="primary" onClick={() => router.push('/clinic/program-templates/new')}>
            + New Template
          </Button>
        )}
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Program Templates</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 rounded-xl p-1 w-fit border border-white/10">
          {(['care', 'wellness'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={[
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize',
                activeTab === tab
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white',
              ].join(' ')}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <p className="text-slate-400 text-sm">No {activeTab} templates yet.</p>
            {isAdmin && (
              <Button variant="secondary" onClick={() => router.push('/clinic/program-templates/new')}>
                Create first template
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(template => (
              <div
                key={template.id}
                className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-5 py-4"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-medium text-sm">{template.name}</h3>
                    <StatusChip status={template.status} />
                  </div>
                  <div className="text-slate-500 text-xs mt-1">
                    {template.phase_count} phase{template.phase_count !== 1 ? 's' : ''} · {template.item_count} exercise{template.item_count !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {template.status === 'draft' && isAdmin && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={publishingId === template.id}
                      onClick={() => handlePublish(template.id)}
                    >
                      Publish
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push(`/clinic/program-templates/new/${template.id}`)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function TemplateLibraryPage() {
  return (
    <ToastProvider>
      <TemplateLibraryInner />
    </ToastProvider>
  );
}
