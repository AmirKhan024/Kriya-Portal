'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Table, type Column } from '@/components/ui-a/Table';
import { Badge, type BadgeTone } from '@/components/ui-a/Badge';
import { NUDGE_CHANNELS, type NudgeChannel, type NudgeStatus } from '@/modules/nudges/constants';
import { telegramConnectLink } from '@/modules/nudges/telegram';
import { dbg, dbgError } from '@/lib/debug';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '';

type Nudge = {
  id: string;
  member_id: string;
  channel: string;
  message: string | null;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  sent_by_name: string | null;
};

const STATUS_TONE: Record<NudgeStatus, BadgeTone> = {
  scheduled: 'amber',
  sent: 'teal',
  responded: 'green',
  failed: 'red',
};

/**
 * Manual nudge panel + history (feature 2c). Compose a message → POST /v1/nudges
 * (channel auto-selects WhatsApp→push→SMS unless one is chosen); the history
 * below lists every nudge with a status badge and a "Mark responded" action.
 */
export function NudgePanel({ memberId, telegramConnected = false }: { memberId: string; telegramConnected?: boolean }) {
  const { toast } = useToast();
  const [nudges, setNudges] = useState<Nudge[] | null>(null);
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<'' | NudgeChannel>('');
  const [sending, setSending] = useState(false);

  async function load() {
    dbg('NudgePanel:load', { memberId });
    const res = await apiClient.get<Nudge[]>(`/api/v1/nudges?member_id=${memberId}`);
    dbg('NudgePanel:load ←', res);
    if (res.error || !res.data) {
      toast({ variant: 'error', title: 'Failed to load nudges', message: res.error?.message });
      setNudges([]);
      return;
    }
    setNudges(res.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { member_id: memberId, message: message.trim() };
      if (channel) body.channel = channel;
      dbg('NudgePanel:send →', body);
      const res = await apiClient.post<Nudge>('/api/v1/nudges', body);
      dbg('NudgePanel:send ←', res);
      if (res.error || !res.data) {
        if (res.error?.code === 'CONFLICT') {
          toast({ variant: 'error', title: 'Frequency cap reached', message: res.error.message });
        } else {
          toast({ variant: 'error', title: 'Could not send nudge', message: res.error?.message });
        }
        return;
      }
      toast({ variant: 'success', title: `Nudge sent via ${res.data.channel}` });
      setMessage('');
      setChannel('');
      await load();
    } catch (err) {
      dbgError('NudgePanel:send failed', err);
      toast({ variant: 'error', title: 'Network error' });
    } finally {
      setSending(false);
    }
  }

  async function markResponded(id: string) {
    dbg('NudgePanel:respond →', { id });
    const res = await apiClient.patch<Nudge>(`/api/v1/nudges/${id}`, { status: 'responded' });
    dbg('NudgePanel:respond ←', res);
    if (res.error) {
      toast({ variant: 'error', title: 'Could not update', message: res.error.message });
      return;
    }
    await load();
  }

  const columns: Column<Nudge>[] = [
    {
      key: 'time',
      header: 'When',
      render: (n) => (
        <span className="text-slate-400 text-xs whitespace-nowrap">
          {new Date(n.sent_at ?? n.created_at).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      render: (n) => <span className="capitalize text-slate-300">{n.channel}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (n) => (
        <Badge tone={STATUS_TONE[n.status as NudgeStatus] ?? 'gray'}>{n.status}</Badge>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      render: (n) => <span className="text-slate-300">{n.message ?? <span className="text-slate-600">—</span>}</span>,
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (n) =>
        n.status === 'sent' ? (
          <button
            onClick={() => markResponded(n.id)}
            className="text-xs text-teal-400 hover:text-teal-300 transition-colors whitespace-nowrap"
          >
            Mark responded
          </button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Telegram connection */}
      <div className={`rounded-2xl border px-4 py-3 text-sm ${telegramConnected ? 'bg-green-500/10 border-green-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
        {telegramConnected ? (
          <span className="text-green-300"><span className="font-semibold">✓ Telegram connected.</span> Nudges &amp; reminders reach this member.</span>
        ) : BOT_USERNAME ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-amber-300">Not connected — the member taps this link &amp; presses <span className="font-mono">Start</span> to receive messages.</span>
            <a href={telegramConnectLink(BOT_USERNAME, memberId)} target="_blank" rel="noreferrer" className="text-teal-400 hover:text-teal-300 underline whitespace-nowrap">Connect Telegram →</a>
          </div>
        ) : (
          <span className="text-amber-300">Telegram bot not configured (<span className="font-mono">NEXT_PUBLIC_TELEGRAM_BOT_USERNAME</span>). Nudges are stubbed until set.</span>
        )}
      </div>

      {/* Compose */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Send a nudge</h3>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Encourage the member to do their next session…"
          className="w-full rounded-xl bg-[#05080f] border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-teal-400/60 resize-none"
        />
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as '' | NudgeChannel)}
              className="rounded-lg bg-[#05080f] border border-white/10 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-teal-400/60"
            >
              <option value="">Auto (WhatsApp → push → SMS)</option>
              {NUDGE_CHANNELS.map((c) => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
          </label>
          <Button size="sm" loading={sending} disabled={!message.trim()} onClick={send}>
            Send nudge
          </Button>
        </div>
      </div>

      {/* History */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">History</h3>
        {nudges === null ? (
          <div className="h-24 bg-white/5 rounded-2xl animate-pulse" />
        ) : (
          <Table columns={columns} rows={nudges} empty="No nudges sent yet." />
        )}
      </div>
    </div>
  );
}
