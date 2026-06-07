'use client';

import React, { Suspense, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { apiClient, tokenStore } from '@/lib/api-client';

function decodeInviteEmail(token: string): string {
  try {
    const middle = token.split('.')[1];
    if (!middle) return '';
    const json = JSON.parse(atob(middle.replace(/-/g, '+').replace(/_/g, '/')));
    return json.email ?? '';
  } catch {
    return '';
  }
}

function ActivateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const token = searchParams.get('token') ?? '';
  const email = useMemo(() => decodeInviteEmail(token), [token]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (password.length < 8) newErrors.password = 'Password must be at least 8 characters';
    if (password !== confirm) newErrors.confirm = 'Passwords do not match';
    if (Object.keys(newErrors).length) { setErrors(newErrors); return; }

    setErrors({});
    setLoading(true);
    try {
      const res = await apiClient.post<{
        access_token: string;
        refresh_token: string;
        user: Record<string, unknown>;
      }>('/api/v1/auth/activate', { invite_token: token, password });

      if (res.error || !res.data) {
        const code = res.error?.code;
        if (code === 'TOKEN_EXPIRED') {
          toast({ variant: 'error', title: 'Invite expired.', message: 'Please ask your admin to re-invite you.' });
        } else if (code === 'CONFLICT') {
          toast({ variant: 'info', title: 'Already activated, please log in.' });
          router.push('/clinic/login');
        } else {
          toast({ variant: 'error', title: 'Activation failed', message: res.error?.message });
        }
        return;
      }

      tokenStore.set(res.data.access_token, res.data.refresh_token);
      router.push('/clinic/staff');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="text-center mb-2">
        <div className="w-10 h-10 bg-teal-400 rounded-full flex items-center justify-center mx-auto mb-3">
          <span className="text-slate-900 font-bold text-lg">K</span>
        </div>
        <h1 className="text-xl font-bold text-white">Activate your account</h1>
        {email && <p className="text-sm text-slate-400 mt-1">Setting up: {email}</p>}
      </div>

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Min. 8 characters"
        error={errors.password}
        autoComplete="new-password"
      />
      <Input
        label="Confirm password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Repeat password"
        error={errors.confirm}
        autoComplete="new-password"
      />
      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full mt-1">
        Activate account
      </Button>
    </form>
  );
}

export default function InviteActivatePage() {
  return (
    <ToastProvider>
      <main className="min-h-screen bg-[#05080f] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl">
          <Suspense fallback={<p className="text-slate-400 text-sm text-center">Loading…</p>}>
            <ActivateForm />
          </Suspense>
        </div>
      </main>
    </ToastProvider>
  );
}
