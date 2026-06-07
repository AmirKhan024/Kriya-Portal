import { pgTable, uuid, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

export const clinics = pgTable('clinics', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       text('name').notNull(),
  city:       text('city').notNull(),
  type:       text('type').notNull(),
  status:     text('status').notNull().default('pending_setup'),
  logo_url:   text('logo_url'),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const branches = pgTable('branches', {
  id:         uuid('id').primaryKey().defaultRandom(),
  clinic_id:  uuid('clinic_id').notNull().references(() => clinics.id),
  name:       text('name').notNull(),
  address:    text('address'),
  status:     text('status').notNull().default('active'),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const entitlements = pgTable('entitlements', {
  id:              uuid('id').primaryKey().defaultRandom(),
  clinic_id:       uuid('clinic_id').notNull().unique().references(() => clinics.id),
  move:            boolean('move').notNull().default(true),
  quick_scan:      boolean('quick_scan').notNull().default(true),
  deep_scan:       boolean('deep_scan').notNull().default(false),
  care_programs:   boolean('care_programs').notNull().default(true),
  pain_gating:     boolean('pain_gating').notNull().default(true),
  custom_branding: boolean('custom_branding').notNull().default(false),
  iot:             boolean('iot').notNull().default(false),
  seats_total:     integer('seats_total').notNull().default(3),
  seats_used:      integer('seats_used').notNull().default(0),
  member_cap:      integer('member_cap').notNull().default(500),
  plan:            text('plan').notNull().default('move'),
  updated_at:      timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  clinic_id:            uuid('clinic_id').notNull().references(() => clinics.id),
  razorpay_sub_id:      text('razorpay_sub_id'),
  plan:                 text('plan').notNull(),
  status:               text('status').notNull().default('active'),
  current_period_start: timestamp('current_period_start', { mode: 'date' }),
  current_period_end:   timestamp('current_period_end', { mode: 'date' }),
  created_at:           timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
