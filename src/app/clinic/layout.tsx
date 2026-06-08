import { ClinicSidebar } from '@/components/nav/ClinicSidebar';

export default function ClinicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#05080f] flex">
      <ClinicSidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
