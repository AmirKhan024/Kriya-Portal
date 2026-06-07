import { pgTable, uuid, text, timestamp, integer, real, boolean } from 'drizzle-orm/pg-core';
import { clinics } from './tenancy';
import { users } from './identity';
import { members } from './clinical';

export const games = pgTable('games', {
  id:         uuid('id').primaryKey().defaultRandom(),
  name:       text('name').notNull(),
  slug:       text('slug').notNull().unique(),
  regions:    text('regions').notNull(),
  category:   text('category').notNull(),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const program_templates = pgTable('program_templates', {
  id:           uuid('id').primaryKey().defaultRandom(),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  created_by:   uuid('created_by').references(() => users.id),
  name:         text('name').notNull(),
  segment:      text('segment').notNull(),
  status:       text('status').notNull().default('draft'),
  created_at:   timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  published_at: timestamp('published_at', { mode: 'date' }),
});

export const program_instances = pgTable('program_instances', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  member_id:          uuid('member_id').notNull().references(() => members.id),
  clinic_id:          uuid('clinic_id').notNull().references(() => clinics.id),
  source_template_id: uuid('source_template_id').references(() => program_templates.id),
  prescription_id:    uuid('prescription_id'),
  version:            integer('version').notNull().default(1),
  status:             text('status').notNull().default('draft'),
  current_phase:      integer('current_phase').notNull().default(1),
  created_at:         timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updated_at:         timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const program_phases = pgTable('program_phases', {
  id:              uuid('id').primaryKey().defaultRandom(),
  instance_id:     uuid('instance_id').references(() => program_instances.id),
  template_id:     uuid('template_id').references(() => program_templates.id),
  order:           integer('order').notNull(),
  name:            text('name'),
  duration_weeks:  integer('duration_weeks'),
});

export const care_videos = pgTable('care_videos', {
  id:           uuid('id').primaryKey().defaultRandom(),
  title:        text('title').notNull(),
  status:       text('status').notNull().default('draft'),
  playback_id:  text('playback_id'),
  regions:      text('regions'),
  conditions:   text('conditions'),
  language:     text('language').notNull().default('en'),
  visibility:   text('visibility').notNull().default('all'),
  created_at:   timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  published_at: timestamp('published_at', { mode: 'date' }),
});

export const program_items = pgTable('program_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  phase_id:            uuid('phase_id').notNull().references(() => program_phases.id),
  clinic_id:           uuid('clinic_id').notNull().references(() => clinics.id),
  game_id:             uuid('game_id').references(() => games.id),
  video_id:            uuid('video_id').references(() => care_videos.id),
  frequency_per_week:  integer('frequency_per_week').notNull().default(3),
  gating_verdict:      text('gating_verdict'),
  is_overridden:       boolean('is_overridden').notNull().default(false),
});

export const video_assignments = pgTable('video_assignments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  member_id:   uuid('member_id').notNull().references(() => members.id),
  video_id:    uuid('video_id').notNull().references(() => care_videos.id),
  clinic_id:   uuid('clinic_id').notNull().references(() => clinics.id),
  assigned_by: uuid('assigned_by').references(() => users.id),
  assigned_at: timestamp('assigned_at', { mode: 'date' }).notNull().defaultNow(),
});

export const activity_sessions = pgTable('activity_sessions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  member_id:    uuid('member_id').notNull().references(() => members.id),
  clinic_id:    uuid('clinic_id').notNull().references(() => clinics.id),
  game_id:      uuid('game_id').references(() => games.id),
  video_id:     uuid('video_id').references(() => care_videos.id),
  type:         text('type').notNull(),
  score:        real('score'),
  duration_sec: integer('duration_sec'),
  completed_at: timestamp('completed_at', { mode: 'date' }).notNull().defaultNow(),
});
