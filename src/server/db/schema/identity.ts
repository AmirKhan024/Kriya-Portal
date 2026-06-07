import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { clinics, branches } from './tenancy';

export const users = pgTable('users', {
  id:            uuid('id').primaryKey().defaultRandom(),
  clinic_id:     uuid('clinic_id').references(() => clinics.id),
  branch_id:     uuid('branch_id').references(() => branches.id),
  email:         text('email').notNull().unique(),
  name:          text('name').notNull(),
  password_hash: text('password_hash'),
  status:        text('status').notNull().default('invited'),
  activated_at:  timestamp('activated_at', { mode: 'date' }),
  created_at:    timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updated_at:    timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id:   uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export const user_roles = pgTable('user_roles', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull().references(() => users.id),
  role:       text('role').notNull(),
  clinic_id:  uuid('clinic_id').references(() => clinics.id),
  branch_id:  uuid('branch_id').references(() => branches.id),
  granted_at: timestamp('granted_at', { mode: 'date' }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  user_id:    uuid('user_id').notNull().references(() => users.id),
  expires_at: timestamp('expires_at', { mode: 'date' }).notNull(),
  revoked_at: timestamp('revoked_at', { mode: 'date' }),
  created_at: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});
