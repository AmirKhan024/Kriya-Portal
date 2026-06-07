'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api-client';
import { parseAccessToken } from '@/store/auth';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const tokens = tokenStore.get();
    if (!tokens?.access) {
      router.replace('/clinic/login');
      return;
    }

    const payload = parseAccessToken(tokens.access) as Record<string, unknown> | null;
    const role = payload?.role as string;

    if (role === 'ops') {
      router.replace('/ops/clinics');
    } else if (role) {
      router.replace('/clinic/members');
    } else {
      tokenStore.clear();
      router.replace('/clinic/login');
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#05080f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
