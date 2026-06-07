import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { clinics } from './tenancy';
import { users } from './identity';
import { members } from './clinical';

export const nudges = pgTable('nudges', {
  id:           uuid('id').primaryKey().defaultRandom(),
  member_id:    uuid('member_id').notNull().references(() => members.id),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  sent_by:      uuid('sent_by').references(() => users.id),
  channel:      text('channel').notNull(),
  message:      text('message'),
  status:       text('status').notNull().default('scheduled'),
  scheduled_at: timestamp('scheduled_at', { mode: 'date' }),
  sent_at:      timestamp('sent_at', { mode: 'date' }),
  responded_at: timestamp('responded_at', { mode: 'date' }),
  created_at:   timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id:         uuid('id').primaryKey().defaultRandom(),
  clinic_id:  uuid('clinic_id').references(() => clinics.id),
  user_id:    uuid('user_id').references(() => users.id),
  member_id:  uuid('member_id').references(() => members.id),
  type:       text('type').notNull(),
  title:      text('title').notNull(),
  body:       text('body').notNull(),
  read_at:    timestamp('read_at', { mode: 'date' }),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const clinician_availability = pgTable('clinician_availability', {
  id:           uuid('id').primaryKey().defaultRandom(),
  clinician_id: uuid('clinician_id').notNull().references(() => users.id),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  day_of_week:  text('day_of_week').notNull(),
  start_time:   text('start_time').notNull(),
  end_time:     text('end_time').notNull(),
  is_available: text('is_available').notNull().default('true'),
});

export const appointments = pgTable('appointments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  member_id:    uuid('member_id').notNull().references(() => members.id),
  clinician_id: uuid('clinician_id').notNull().references(() => users.id),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  slot:         timestamp('slot', { mode: 'date' }).notNull(),
  type:         text('type').notNull(),
  status:       text('status').notNull().default('booked'),
  created_at:   timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});
