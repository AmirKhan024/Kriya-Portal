import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

// APPEND-ONLY — never update or delete rows
export const events = pgTable('events', {
  id:        uuid('id').primaryKey().defaultRandom(),
  type:      text('type').notNull(),
  actor:     uuid('actor'),
  clinic_id: uuid('clinic_id'),
  subject:   text('subject'),
  payload:   text('payload'),
  ts:        timestamp('ts', { mode: 'date' }).notNull().defaultNow(),
});

export const analytics_rollups = pgTable('analytics_rollups', {
  id:          uuid('id').primaryKey().defaultRandom(),
  clinic_id:   uuid('clinic_id'),
  metric:      text('metric').notNull(),
  value:       text('value').notNull(),
  period:      text('period').notNull(),
  computed_at: timestamp('computed_at', { mode: 'date' }).notNull().defaultNow(),
});
