'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, tokenStore } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Table, type Column } from '@/components/ui-a/Table';
import { Badge, type BadgeTone } from '@/components/ui-a/Badge';
import { type VideoStatus } from '@/modules/videos/constants';
import { dbg } from '@/lib/debug';

type Video = {
  id: string; title: string; status: string; playback_id: string | null;
  regions: string | null; conditions: string | null; language: string; visibility: string;
};

const STATUS_TONE: Record<VideoStatus, BadgeTone> = { draft: 'gray', ready: 'amber', published: 'green' };

function VideoLibrary() {
  const router = useRouter();
  const { toast } = useToast();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [title, setTitle] = useState('');
  const [regions, setRegions] = useState('');
  const [conditions, setConditions] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    dbg('VideoLibrary:load');
    const res = await apiClient.get<Video[]>('/api/v1/videos');
    setVideos(res.data ?? []);
  }

  useEffect(() => {
    if (!tokenStore.get().access) { router.push('/ops/login'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (!title.trim() || !file) return;
    setSaving(true);
    try {
      // 1 · create the draft + get a signed Storage upload URL
      const res = await apiClient.post<{ video: { id: string }; upload: { signed_url: string | null; stubbed: boolean } }>('/api/v1/videos', {
        title: title.trim(),
        regions: regions.trim() || undefined,
        conditions: conditions.trim() || undefined,
      });
      dbg('VideoLibrary:create ←', res);
      if (res.error || !res.data) {
        if (res.error?.code === 'FORBIDDEN') toast({ variant: 'error', title: 'Ops only', message: 'Only ops can upload videos' });
        else toast({ variant: 'error', title: 'Could not create', message: res.error?.message });
        return;
      }
      const { video, upload } = res.data;

      // 2 · upload the file to the signed URL (skipped in stub mode — no Storage configured)
      if (upload.signed_url) {
        const put = await fetch(upload.signed_url, { method: 'PUT', headers: { 'content-type': file.type || 'video/mp4' }, body: file });
        if (!put.ok) { toast({ variant: 'error', title: 'Upload failed', message: `Storage returned ${put.status}` }); return; }
      }

      // 3 · mark ready
      await apiClient.post(`/api/v1/videos/${video.id}/ready`);
      toast({ variant: 'success', title: upload.stubbed ? 'Video created (Storage not configured — stub)' : 'Video uploaded — ready to publish' });
      setTitle(''); setRegions(''); setConditions(''); setFile(null);
      await load();
    } catch (err) {
      dbg('VideoLibrary:create failed', err);
      toast({ variant: 'error', title: 'Upload error' });
    } finally {
      setSaving(false);
    }
  }

  async function publish(id: string) {
    const res = await apiClient.post(`/api/v1/videos/${id}/publish`);
    if (res.error) { toast({ variant: 'error', title: 'Could not publish', message: res.error.message }); return; }
    toast({ variant: 'success', title: 'Published' });
    await load();
  }

  const columns: Column<Video>[] = [
    { key: 'title', header: 'Title', render: (v) => <span className="text-white">{v.title}</span> },
    { key: 'tags', header: 'Regions / Conditions', render: (v) => <span className="text-slate-400 text-xs">{[v.regions, v.conditions].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'status', header: 'Status', render: (v) => <Badge tone={STATUS_TONE[v.status as VideoStatus] ?? 'gray'}>{v.status}</Badge> },
    {
      key: 'action', header: '', align: 'right',
      render: (v) => v.status === 'ready' ? (
        <button onClick={() => publish(v.id)} className="text-xs text-teal-400 hover:text-teal-300">Publish</button>
      ) : null,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Care video library</h1>

      <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">New video</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="rounded-lg bg-[#05080f] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-400/60" />
          <input value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="Regions (e.g. lower_back)" className="rounded-lg bg-[#05080f] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-400/60" />
          <input value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Conditions" className="rounded-lg bg-[#05080f] border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-400/60" />
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-white/20" />
          <Button size="sm" loading={saving} disabled={!title.trim() || !file} onClick={create}>Upload video</Button>
          <span className="text-xs text-slate-500">mp4/webm · up to 50 MB (free tier)</span>
        </div>
      </div>

      <div className="mt-6">
        {videos === null ? <div className="h-24 bg-white/5 rounded-2xl animate-pulse" /> : <Table columns={columns} rows={videos} empty="No videos yet." />}
      </div>
    </div>
  );
}

export default function VideosPage() {
  return (
    <ToastProvider>
      <VideoLibrary />
    </ToastProvider>
  );
}
