'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Table, type Column } from '@/components/ui-a/Table';
import { Badge } from '@/components/ui-a/Badge';
import { WATCH_COMPLETE_PCT } from '@/modules/videos/constants';
import { dbg, dbgError } from '@/lib/debug';

type Video = { id: string; title: string; status: string };
type Assignment = {
  id: string; video_id: string; title: string | null; status: string | null;
  assigned_at: string; watched_pct: number; playback_url: string | null;
};

/**
 * Member-record Care Videos tab (feature 3a): assign a published video, play it
 * inline (Supabase Storage signed URL), and record a completed activity-session once
 * watched ≥90% (the clinician plays the rehab video in-session).
 */
export function VideoAssignPanel({ memberId }: { memberId: string }) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [library, setLibrary] = useState<Video[]>([]);
  const [videoId, setVideoId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [playing, setPlaying] = useState<Assignment | null>(null);
  const recorded = useRef<Set<string>>(new Set());

  async function loadAssignments() {
    dbg('VideoAssignPanel:loadAssignments', { memberId });
    const res = await apiClient.get<Assignment[]>(`/api/v1/members/${memberId}/video-assignments`);
    setAssignments(res.data ?? []);
  }
  async function loadLibrary() {
    const res = await apiClient.get<Video[]>('/api/v1/videos');
    setLibrary((res.data ?? []).filter((v) => v.status === 'published'));
  }

  useEffect(() => {
    loadAssignments();
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  async function assign() {
    if (!videoId) return;
    setAssigning(true);
    try {
      const res = await apiClient.post(`/api/v1/members/${memberId}/video-assignments`, { video_id: videoId });
      dbg('VideoAssignPanel:assign ←', res);
      if (res.error) {
        if (res.error.code === 'ENTITLEMENT_REQUIRED') toast({ variant: 'error', title: 'Care programs not enabled' });
        else toast({ variant: 'error', title: 'Could not assign', message: res.error.message });
        return;
      }
      toast({ variant: 'success', title: 'Video assigned' });
      setVideoId('');
      await loadAssignments();
    } catch (err) {
      dbgError('VideoAssignPanel:assign failed', err);
      toast({ variant: 'error', title: 'Network error' });
    } finally {
      setAssigning(false);
    }
  }

  // When the playing video crosses the watch-complete threshold, record it once.
  async function onTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    if (!playing || !v.duration || recorded.current.has(playing.video_id)) return;
    const pct = Math.round((v.currentTime / v.duration) * 100);
    if (pct < WATCH_COMPLETE_PCT) return;
    recorded.current.add(playing.video_id);
    dbg('VideoAssignPanel:watch-complete', { video_id: playing.video_id, pct });
    const res = await apiClient.post('/api/v1/activity-sessions', {
      member_id: memberId, video_id: playing.video_id, type: 'video', score: pct, duration_sec: Math.round(v.duration),
    });
    if (!res.error) {
      toast({ variant: 'success', title: 'Marked watched' });
      await loadAssignments();
    }
  }

  const columns: Column<Assignment>[] = [
    { key: 'title', header: 'Video', render: (a) => <span className="text-white">{a.title ?? a.video_id}</span> },
    { key: 'assigned', header: 'Assigned', render: (a) => <span className="text-slate-400 text-xs">{new Date(a.assigned_at).toLocaleDateString()}</span> },
    {
      key: 'watched', header: 'Watched', align: 'right',
      render: (a) => a.watched_pct >= WATCH_COMPLETE_PCT
        ? <Badge tone="green">{`${a.watched_pct}%`}</Badge>
        : <span className="text-slate-300 tabular-nums">{a.watched_pct}%</span>,
    },
    {
      key: 'play', header: '', align: 'right',
      render: (a) => a.playback_url
        ? <button onClick={() => setPlaying(a)} className="text-xs text-teal-400 hover:text-teal-300 whitespace-nowrap">▶ Play</button>
        : <span className="text-xs text-slate-600">no file</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Assign a care video</h3>
        <div className="flex items-end gap-3 flex-wrap">
          <select value={videoId} onChange={(e) => setVideoId(e.target.value)} className="rounded-lg bg-[#05080f] border border-white/10 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-teal-400/60 min-w-[16rem]">
            <option value="">{library.length ? 'Pick a published video' : 'No published videos yet'}</option>
            {library.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
          <Button size="sm" loading={assigning} disabled={!videoId} onClick={assign}>Assign</Button>
        </div>
      </div>

      {playing && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white">{playing.title ?? 'Video'}</span>
            <button onClick={() => setPlaying(null)} className="text-xs text-slate-400 hover:text-white">✕ Close</button>
          </div>
          <video src={playing.playback_url ?? undefined} controls autoPlay onTimeUpdate={onTimeUpdate} className="w-full rounded-lg bg-black max-h-[420px]" />
          <p className="text-xs text-slate-500 mt-2">Watching to {WATCH_COMPLETE_PCT}% records a completed session.</p>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Assigned videos</h3>
        {assignments === null ? <div className="h-24 bg-white/5 rounded-2xl animate-pulse" /> : <Table columns={columns} rows={assignments} empty="No videos assigned yet." />}
      </div>
    </div>
  );
}
