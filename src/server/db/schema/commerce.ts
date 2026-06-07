import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { clinics } from './tenancy';
import { users } from './identity';
import { members } from './clinical';

export const invoices = pgTable('invoices', {
  id:              uuid('id').primaryKey().defaultRandom(),
  clinic_id:       uuid('clinic_id').notNull().references(() => clinics.id),
  razorpay_inv_id: text('razorpay_inv_id'),
  amount_paise:    integer('amount_paise').notNull(),
  status:          text('status').notNull().default('pending'),
  period_start:    timestamp('period_start', { mode: 'date' }),
  period_end:      timestamp('period_end', { mode: 'date' }),
  created_at:      timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const override_log = pgTable('override_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  member_id: uuid('member_id').notNull().references(() => members.id),
  clinic_id: uuid('clinic_id').notNull().references(() => clinics.id),
  item_id:   uuid('item_id').notNull(),
  by_user:   uuid('by_user').notNull().references(() => users.id),
  reason:    text('reason').notNull(),
  ts:        timestamp('ts', { mode: 'date' }).notNull().defaultNow(),
});
