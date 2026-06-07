import { OpsSidebar } from '@/components/nav/OpsSidebar';

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#05080f] flex">
      <OpsSidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
