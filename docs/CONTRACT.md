# API Contract — Kriya Clinic Portal

This is the frozen Phase 0 contract. All API routes, types, and conventions below
are non-negotiable. Deviations require a documented ADR.

---

## JWT Payload

```typescript
type JwtPayload = {
  sub: string;            // user_id (uuid)
  clinic_id: string|null; // null for ops users
  branch_id: string|null;
  role: UserRole;
  iat: number;
  exp: number;
}
```

- Algorithm: HS256
- Access token TTL: 900s (15 min)
- Refresh token TTL: 604800s (7 days)
- Invite token TTL: 259200s (72 hours)

---

## Response Envelope

Every API response **must** use this shape:

```typescript
type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { page?: number; total?: number; cursor?: string };
}
```

Success: `data` is set, `error` is `null`.
Failure: `data` is `null`, `error` is set.

---

## Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `AUTH_REQUIRED` | 401 | Missing or invalid token |
| `TOKEN_EXPIRED` | 401 | Token has expired |
| `TENANT_MISMATCH` | 403 | Cross-tenant access attempt |
| `ENTITLEMENT_REQUIRED` | 403 | Module not enabled for this clinic |
| `FORBIDDEN` | 403 | Role not authorised |
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation |
| `CONFLICT` | 409 | Duplicate resource |
| `NOT_FOUND` | 404 | Resource not found |

---

## Role Enum

```typescript
type UserRole =
  | 'ops'           // Kriya platform owner — sees all clinics
  | 'clinic_admin'  // Manages staff, members, settings within a clinic
  | 'ortho'         // Can override pain-locked exercises
  | 'physio'        // Can override pain-locked exercises
  | 'trainer'       // Cannot override; no clinical actions
  | 'front_desk';   // No clinical actions
```

Qualified roles (can override pain locks): `ortho`, `physio`
Clinical roles: `ortho`, `physio`, `clinic_admin`
Admin roles: `ops`, `clinic_admin`

---

## Seed Credentials (dev only)

| Role | Email | Password |
|---|---|---|
| Ops | ops@kriya.dev | dev_ops_pass |
| Clinic Admin | admin@testclinic.dev | dev_admin_pass |

## Seed UUIDs (stable, hard-coded)

```
SEED_CLINIC_ID  = 00000000-0000-0000-0000-000000000001
SEED_BRANCH_ID  = 00000000-0000-0000-0000-000000000002
SEED_OPS_ID     = 00000000-0000-0000-0000-000000000003
SEED_ADMIN_ID   = 00000000-0000-0000-0000-000000000004
```

---

## How to Run Migrations & Seed

```bash
# 1. Set DATABASE_URL in .env.local
# 2. Generate migration SQL
npm run db:generate

# 3. Push schema to Supabase
npm run db:migrate

# 4. Apply RLS (Supabase Studio → SQL Editor → paste src/server/db/rls.sql)

# 5. Seed dev data
npm run seed
```

---

## API Route Prefix

All routes: `/api/v1/…`
Auth bearer: `Authorization: Bearer <access_token>`
Tenant: derived from JWT `clinic_id`
Idempotency: writes accept `Idempotency-Key` header

---

## Folder Layout

```
src/
  app/
    (ops)/          ← Ops portal pages (route group)
    (clinic)/       ← Clinic portal pages (route group)
    api/v1/         ← All API routes
  server/
    db/             ← Drizzle client, schema, migrations, seed, emit
    auth/           ← JWT helpers, password helpers, route middleware
  lib/              ← Typed API client
  types/            ← Shared Zod + TS types
  components/       ← UI + auth components
  middleware.ts     ← Next.js edge middleware
```
