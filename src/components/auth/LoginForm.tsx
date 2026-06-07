'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { apiClient } from '@/lib/api-client';

interface LoginFormProps {
  portalLabel: string;
  onSuccess: (data: { access_token: string; refresh_token: string; user: Record<string, unknown> }) => void;
}

export function LoginForm({ portalLabel, onSuccess }: LoginFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!email) newErrors.email = 'Email is required';
    if (!password) newErrors.password = 'Password is required';
    if (Object.keys(newErrors).length) { setErrors(newErrors); return; }

    setErrors({});
    setLoading(true);
    try {
      const res = await apiClient.post<{
        access_token: string;
        refresh_token: string;
        user: Record<string, unknown>;
      }>('/api/v1/auth/login', { email, password });

      if (res.error || !res.data) {
        toast({ variant: 'error', title: 'Login failed', message: res.error?.message ?? 'Unknown error' });
        return;
      }
      onSuccess(res.data);
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
        <h1 className="text-xl font-bold text-white">{portalLabel}</h1>
        <p className="text-sm text-slate-400 mt-1">Sign in to continue</p>
      </div>

      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@clinic.com"
        error={errors.email}
        autoComplete="email"
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        error={errors.password}
        autoComplete="current-password"
      />
      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full mt-1">
        Sign in
      </Button>
    </form>
  );
}
