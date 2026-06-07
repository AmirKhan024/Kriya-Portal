-- Kriya Clinic Portal — Row Level Security
-- Run this in the Supabase SQL editor AFTER running migrations.
-- See /docs/RLS.md for the full instructions.

-- Enable RLS on all tables
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pain_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinician_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE override_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_rollups ENABLE ROW LEVEL SECURITY;

-- Service role bypass: API layer uses Supabase service role key which bypasses RLS.
-- App-level enforcement: every API route checks clinic_id from the JWT.
-- RLS is a second safety layer for direct DB access (Supabase Studio, migrations, etc.)

-- Default deny for authenticated (JWT) role — app routes use service_role
CREATE POLICY "deny_all_authenticated" ON members
  FOR ALL TO authenticated USING (false);

-- Per-feature policies are added as each feature is built (Phase 1+).
-- Pattern for tenant-scoped tables:
--
--   CREATE POLICY "clinic_isolation_<table>" ON <table>
--     FOR ALL TO authenticated
--     USING (clinic_id = (current_setting('app.clinic_id', true))::uuid);
--
-- The app sets `app.clinic_id` via SET LOCAL before queries when running
-- with an authenticated (non-service-role) connection.
