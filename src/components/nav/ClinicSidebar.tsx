'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRole } from '@/hooks/useRole';
import { UserMenu } from './UserMenu';

type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  clinicianOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: '/clinic/members',
    label: 'Members',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    href: '/clinic/staff',
    label: 'Staff',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    adminOnly: true,
  },
  {
    href: '/clinic/program-templates',
    label: 'Templates',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  },
  {
    href: '/clinic/dashboards/prescription',
    label: 'Rx Dashboard',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    clinicianOnly: true,
  },
  {
    href: '/clinic/dashboards/conversion',
    label: 'Conversion',
    icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    clinicianOnly: true,
  },
  {
    href: '/clinic/settings',
    label: 'Settings',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    adminOnly: true,
  },
  {
    href: '/clinic/billing',
    label: 'Billing',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    adminOnly: true,
  },
];

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={path} />
    </svg>
  );
}

export function ClinicSidebar() {
  const pathname = usePathname();
  const role = useRole();

  // Hide sidebar on auth pages
  if (pathname.endsWith('/login') || pathname.endsWith('/invite-activate')) {
    return null;
  }

  const isAdmin = role === 'clinic_admin';
  const isClinician = role === 'ortho' || role === 'physio' || role === 'clinic_admin';

  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.clinicianOnly && !isClinician) return false;
    return true;
  });

  return (
    <aside className="w-60 shrink-0 bg-slate-900/80 border-r border-white/10 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-teal-400 rounded-lg flex items-center justify-center">
            <span className="text-slate-900 font-bold text-sm">K</span>
          </div>
          <span className="text-white font-semibold text-base">Kriya Portal</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map(item => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-teal-400/15 text-teal-300 border border-teal-400/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <NavIcon path={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/10">
        <UserMenu />
      </div>
    </aside>
  );
}
