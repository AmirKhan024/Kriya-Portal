# Row Level Security — Kriya Clinic Portal

## How to apply RLS

1. Run migrations first: `npm run db:migrate`
2. Open Supabase Studio → SQL Editor
3. Paste and run the contents of `src/server/db/rls.sql`

## Two-layer isolation model

```
Request
  ↓
App layer  ─── JWT clinic_id check (every route)
  ↓
Database   ─── RLS policy (second defence, catches direct-DB access)
```

- **App layer**: Every API route calls `requireSameTenant(user, resourceClinicId)` before
  touching any data. This is enforced in `src/server/auth/middleware.ts`.
- **DB layer**: RLS ensures that even if the app layer is bypassed (e.g. a bug, direct
  Supabase Studio query, migration script), data from Clinic A never leaks to Clinic B.

## Security test (run on every PR)

Write an automated test that:
1. Creates two clinics (A and B) in the test DB
2. Authenticates as a user of Clinic A
3. Attempts to read Clinic B's members via the API
4. Asserts: response returns empty array or 403, never Clinic B's data

This test must be green before any PR can merge.

## Per-feature policy pattern

When building each feature, add a policy to the relevant table:

```sql
CREATE POLICY "clinic_isolation_members" ON members
  FOR ALL TO authenticated
  USING (clinic_id = (current_setting('app.clinic_id', true))::uuid);
```

The API sets `app.clinic_id` via `SET LOCAL` when using authenticated connections.
For service-role connections (the default in this app), RLS is bypassed at the DB level
and enforced entirely at the app level.
