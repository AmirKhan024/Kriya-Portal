import { pgTable, uuid, text, timestamp, integer, real } from 'drizzle-orm/pg-core';
import { clinics, branches } from './tenancy';
import { users } from './identity';

export const members = pgTable('members', {
  id:         uuid('id').primaryKey().defaultRandom(),
  clinic_id:  uuid('clinic_id').notNull().references(() => clinics.id),
  branch_id:  uuid('branch_id').references(() => branches.id),
  mobile:     text('mobile').notNull(),
  name:       text('name').notNull(),
  age:        integer('age'),
  sex:        text('sex'),
  segment:    text('segment').notNull().default('care'),
  status:     text('status').notNull().default('new'),
  complaint:  text('complaint'),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const consents = pgTable('consents', {
  id:           uuid('id').primaryKey().defaultRandom(),
  member_id:    uuid('member_id').notNull().references(() => members.id),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  type:         text('type').notNull(),
  method:       text('method'),
  granted_at:   timestamp('granted_at', { mode: 'date' }).notNull().defaultNow(),
  withdrawn_at: timestamp('withdrawn_at', { mode: 'date' }),
});

export const member_assignments = pgTable('member_assignments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  member_id:    uuid('member_id').notNull().references(() => members.id),
  clinician_id: uuid('clinician_id').notNull().references(() => users.id),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  started_at:   timestamp('started_at', { mode: 'date' }).notNull().defaultNow(),
  ended_at:     timestamp('ended_at', { mode: 'date' }),
});

export const assessments = pgTable('assessments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  member_id:     uuid('member_id').notNull().references(() => members.id),
  clinic_id:     uuid('clinic_id').notNull().references(() => clinics.id),
  clinician_id:  uuid('clinician_id').references(() => users.id),
  type:          text('type').notNull(),
  status:        text('status').notNull().default('in_progress'),
  musculage:     real('musculage'),
  created_at:    timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  completed_at:  timestamp('completed_at', { mode: 'date' }),
});

export const category_scores = pgTable('category_scores', {
  id:            uuid('id').primaryKey().defaultRandom(),
  assessment_id: uuid('assessment_id').notNull().references(() => assessments.id),
  clinic_id:     uuid('clinic_id').notNull().references(() => clinics.id),
  category:      text('category').notNull(),
  score:         real('score').notNull(),
  raw_metrics:   text('raw_metrics'),
});

export const pain_flags = pgTable('pain_flags', {
  id:         uuid('id').primaryKey().defaultRandom(),
  member_id:  uuid('member_id').notNull().references(() => members.id),
  clinic_id:  uuid('clinic_id').notNull().references(() => clinics.id),
  region:     text('region').notNull(),
  severity:   integer('severity').notNull(),
  type:       text('type').notNull(),
  active:     text('active').notNull().default('true'),
  set_by:     uuid('set_by').references(() => users.id),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const prescriptions = pgTable('prescriptions', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  member_id:          uuid('member_id').notNull().references(() => members.id),
  assessment_id:      uuid('assessment_id').references(() => assessments.id),
  clinic_id:          uuid('clinic_id').notNull().references(() => clinics.id),
  clinician_id:       uuid('clinician_id').references(() => users.id),
  status:             text('status').notNull().default('draft'),
  pdf_url:            text('pdf_url'),
  qr_code:            text('qr_code'),
  findings:           text('findings'),
  impression:         text('impression'),
  contraindications:  text('contraindications'),
  created_at:         timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  sent_at:            timestamp('sent_at', { mode: 'date' }),
  activated_at:       timestamp('activated_at', { mode: 'date' }),
});
