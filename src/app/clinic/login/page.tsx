'use client';

import { useRouter } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { ToastProvider } from '@/components/ui/Toast';
import { tokenStore } from '@/lib/api-client';
import { saveSessionUser } from '@/store/auth';

export default function ClinicLoginPage() {
  const router = useRouter();

  function handleSuccess(data: { access_token: string; refresh_token: string; user: Record<string, unknown> }) {
    tokenStore.set(data.access_token, data.refresh_token);
    saveSessionUser(data.user);
    // Route by role: ops to the ops console, everyone else to the clinic home
    // (/clinic/members is accessible to all clinic roles; /clinic/staff is admin-only).
    const role = data.user?.role as string | undefined;
    router.push(role === 'ops' ? '/ops/clinics' : '/clinic/members');
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
