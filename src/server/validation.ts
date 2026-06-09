import { z } from 'zod';

/**
 * UUID-shaped string that ALSO accepts the platform's seed IDs
 * (e.g. `00000000-0000-0000-0000-000000000010`, `10000000-...`). Those are not
 * RFC-4122-conformant — their version/variant nibbles are `0` — so zod v4's
 * `.uuid()` rejects them, which broke request bodies that reference seed games,
 * members, clinicians, branches, etc. (a 400 "Invalid input").
 *
 * Every id validated here is still existence- and tenant-checked against the DB,
 * so loosening the *format* check adds no security risk. Use this instead of
 * `z.string().uuid()` for ids passed in API request bodies.
 */
export const uuidish = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');
