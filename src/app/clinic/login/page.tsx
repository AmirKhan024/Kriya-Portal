'use client';

import { useRouter } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { ToastProvider } from '@/components/ui/Toast';
import { tokenStore } from '@/lib/api-client';

export default function ClinicLoginPage() {
  const router = useRouter();

  function handleSuccess(data: { access_token: string; refresh_token: string; user: Record<string, unknown> }) {
    tokenStore.set(data.access_token, data.refresh_token);
    router.push('/clinic/staff');
  }

  return (
    <ToastProvider>
      <main className="min-h-screen bg-[#05080f] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl">
          <LoginForm portalLabel="Clinic Portal" onSuccess={handleSuccess} />
        </div>
      </main>
    </ToastProvider>
  );
}
