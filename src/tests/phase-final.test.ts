import { describe, it, expect } from 'vitest';

// ── Navigation auth guard logic ────────────────────────────────────────────────
describe('Navigation auth guards', () => {
  function resolveRedirect(role: string | null, hasToken: boolean): string {
    if (!hasToken) return '/clinic/login';
    if (role === 'ops') return '/ops/clinics';
    if (role) return '/clinic/members';
    return '/clinic/login';
  }

  it('redirects unauthenticated user to clinic login', () => {
    expect(resolveRedirect(null, false)).toBe('/clinic/login');
  });

  it('redirects ops user to ops clinics', () => {
    expect(resolveRedirect('ops', true)).toBe('/ops/clinics');
  });

  it('redirects clinic user to members list', () => {
    expect(resolveRedirect('clinic_admin', true)).toBe('/clinic/members');
    expect(resolveRedirect('ortho', true)).toBe('/clinic/members');
    expect(resolveRedirect('physio', true)).toBe('/clinic/members');
  });

  it('redirects user with invalid token to login', () => {
    expect(resolveRedirect(null, true)).toBe('/clinic/login');
  });
});

// ── Sidebar visibility rules ─────────────────────────────────────────────────
describe('Sidebar nav item visibility', () => {
  type NavItem = { adminOnly?: boolean; clinicianOnly?: boolean; label: string };

  function filterNavItems(items: NavItem[], role: string): NavItem[] {
    const isAdmin = role === 'clinic_admin';
    const isClinician = ['ortho', 'physio', 'clinic_admin'].includes(role);
    return items.filter(item => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.clinicianOnly && !isClinician) return false;
      return true;
    });
  }

  const ALL_ITEMS: NavItem[] = [
    { label: 'Members' },
    { label: 'Staff', adminOnly: true },
    { label: 'Templates' },
    { label: 'Rx Dashboard', clinicianOnly: true },
    { label: 'Conversion', clinicianOnly: true },
    { label: 'Settings', adminOnly: true },
    { label: 'Billing', adminOnly: true },
  ];

  it('clinic_admin sees all items', () => {
    const items = filterNavItems(ALL_ITEMS, 'clinic_admin');
    expect(items).toHaveLength(7);
  });

  it('ortho sees Members, Templates, Dashboards but not Staff/Settings/Billing', () => {
    const items = filterNavItems(ALL_ITEMS, 'ortho');
    const labels = items.map(i => i.label);
    expect(labels).toContain('Members');
    expect(labels).toContain('Rx Dashboard');
    expect(labels).not.toContain('Staff');
    expect(labels).not.toContain('Settings');
    expect(labels).not.toContain('Billing');
  });

  it('trainer sees Members and Templates only (no dashboards, no admin)', () => {
    const items = filterNavItems(ALL_ITEMS, 'trainer');
    const labels = items.map(i => i.label);
    expect(labels).toContain('Members');
    expect(labels).toContain('Templates');
    expect(labels).not.toContain('Rx Dashboard');
    expect(labels).not.toContain('Staff');
  });

  it('front_desk sees Members and Templates only', () => {
    const items = filterNavItems(ALL_ITEMS, 'front_desk');
    const labels = items.map(i => i.label);
    expect(labels).toContain('Members');
    expect(labels).not.toContain('Rx Dashboard');
    expect(labels).not.toContain('Settings');
  });
});

// ── Member list pagination ────────────────────────────────────────────────────
describe('Member list pagination', () => {
  function computePagination(total: number, page: number, limit: number) {
    return {
      pages:   Math.ceil(total / limit),
      hasPrev: page > 1,
      hasNext: page < Math.ceil(total / limit),
      offset:  (page - 1) * limit,
    };
  }

  it('computes correct page count', () => {
    expect(computePagination(100, 1, 20).pages).toBe(5);
    expect(computePagination(21, 1, 20).pages).toBe(2);
    expect(computePagination(20, 1, 20).pages).toBe(1);
  });

  it('first page has no previous, has next when multiple pages', () => {
    const p = computePagination(100, 1, 20);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(true);
  });

  it('last page has previous, no next', () => {
    const p = computePagination(100, 5, 20);
    expect(p.hasPrev).toBe(true);
    expect(p.hasNext).toBe(false);
  });

  it('computes correct offset', () => {
    expect(computePagination(100, 3, 20).offset).toBe(40);
    expect(computePagination(100, 1, 20).offset).toBe(0);
  });

  it('single page: no prev, no next', () => {
    const p = computePagination(10, 1, 20);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(false);
  });
});

// ── IoT entitlement gating ────────────────────────────────────────────────────
describe('IoT entitlement gating', () => {
  function shouldShowIoT(entitlements: { iot: boolean } | null): boolean {
    return entitlements?.iot === true;
  }

  it('shows IoT panel when iot entitlement is true', () => {
    expect(shouldShowIoT({ iot: true })).toBe(true);
  });

  it('hides IoT panel when iot entitlement is false', () => {
    expect(shouldShowIoT({ iot: false })).toBe(false);
  });

  it('hides IoT panel when entitlements is null', () => {
    expect(shouldShowIoT(null)).toBe(false);
  });
});

// ── Member list search/filter ─────────────────────────────────────────────────
describe('Member list filter logic', () => {
  type Member = { name: string; mobile: string; status: string; branch_id: string };
  const testMembers: Member[] = [
    { name: 'Ravi Kumar',   mobile: '9876543210', status: 'assessed',   branch_id: 'b1' },
    { name: 'Priya Sharma', mobile: '9876543211', status: 'new',        branch_id: 'b1' },
    { name: 'Amit Desai',   mobile: '9876543212', status: 'on_program', branch_id: 'b2' },
  ];

  function filterMembers(
    items: Member[],
    search?: string,
    status?: string,
    branchId?: string
  ): Member[] {
    return items.filter(m => {
      if (search && !m.name.toLowerCase().includes(search.toLowerCase()) &&
          !m.mobile.includes(search)) return false;
      if (status && m.status !== status) return false;
      if (branchId && m.branch_id !== branchId) return false;
      return true;
    });
  }

  it('returns all when no filters', () => {
    expect(filterMembers(testMembers)).toHaveLength(3);
  });

  it('filters by name (case-insensitive)', () => {
    expect(filterMembers(testMembers, 'ravi')).toHaveLength(1);
    expect(filterMembers(testMembers, 'PRIYA')).toHaveLength(1);
  });

  it('filters by mobile', () => {
    expect(filterMembers(testMembers, '9876543212')).toHaveLength(1);
  });

  it('filters by status', () => {
    expect(filterMembers(testMembers, undefined, 'new')).toHaveLength(1);
    expect(filterMembers(testMembers, undefined, 'assessed')).toHaveLength(1);
  });

  it('filters by branch', () => {
    expect(filterMembers(testMembers, undefined, undefined, 'b1')).toHaveLength(2);
    expect(filterMembers(testMembers, undefined, undefined, 'b2')).toHaveLength(1);
  });

  it('combines filters', () => {
    expect(filterMembers(testMembers, 'ravi', 'assessed', 'b1')).toHaveLength(1);
    expect(filterMembers(testMembers, 'ravi', 'new', 'b1')).toHaveLength(0);
  });
});
