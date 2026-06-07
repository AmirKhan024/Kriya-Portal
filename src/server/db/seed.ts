import 'dotenv/config';
import { db } from './index';
import {
  clinics, branches, entitlements, users, user_roles,
  members, consents, member_assignments, assessments, category_scores, pain_flags, games,
} from './schema';
import bcrypt from 'bcryptjs';

const SEED_CLINIC_ID  = '00000000-0000-0000-0000-000000000001';
const SEED_BRANCH_ID  = '00000000-0000-0000-0000-000000000002';
const SEED_OPS_ID     = '00000000-0000-0000-0000-000000000003';
const SEED_ADMIN_ID   = '00000000-0000-0000-0000-000000000004';

async function seed() {
  console.log('Seeding database...');

  await db.insert(clinics).values({
    id: SEED_CLINIC_ID,
    name: 'Test Clinic Mumbai',
    city: 'Mumbai',
    type: 'physio',
    status: 'active',
  }).onConflictDoNothing();

  await db.insert(branches).values({
    id: SEED_BRANCH_ID,
    clinic_id: SEED_CLINIC_ID,
    name: 'Main Branch',
  }).onConflictDoNothing();

  await db.insert(entitlements).values({
    clinic_id: SEED_CLINIC_ID,
    quick_scan: true,
    deep_scan: true,
    care_programs: true,
    pain_gating: true,
    seats_total: 5,
  }).onConflictDoNothing();

  const opsHash = await bcrypt.hash('dev_ops_pass', 12);
  await db.insert(users).values({
    id: SEED_OPS_ID,
    email: 'ops@kriya.dev',
    name: 'Kriya Ops',
    password_hash: opsHash,
    status: 'active',
  }).onConflictDoNothing();

  const adminHash = await bcrypt.hash('dev_admin_pass', 12);
  await db.insert(users).values({
    id: SEED_ADMIN_ID,
    clinic_id: SEED_CLINIC_ID,
    branch_id: SEED_BRANCH_ID,
    email: 'admin@testclinic.dev',
    name: 'Clinic Admin',
    password_hash: adminHash,
    status: 'active',
  }).onConflictDoNothing();

  await db.insert(user_roles).values({
    user_id: SEED_OPS_ID,
    role: 'ops',
  }).onConflictDoNothing();

  await db.insert(user_roles).values({
    user_id: SEED_ADMIN_ID,
    role: 'clinic_admin',
    clinic_id: SEED_CLINIC_ID,
    branch_id: SEED_BRANCH_ID,
  }).onConflictDoNothing();

  // ── Phase 1d seed data ────────────────────────────────────────────────────
  const SEED_CLINICIAN_ID  = '00000000-0000-0000-0000-000000000012';
  const SEED_MEMBER_ID     = '00000000-0000-0000-0000-000000000010';
  const SEED_ASSESSMENT_ID = '00000000-0000-0000-0000-000000000011';

  const clinicianHash = await bcrypt.hash('dev_clinician_pass', 12);
  await db.insert(users).values({
    id: SEED_CLINICIAN_ID,
    clinic_id: SEED_CLINIC_ID,
    branch_id: SEED_BRANCH_ID,
    email: 'clinician@testclinic.dev',
    name: 'Dr. Arjun Mehta',
    password_hash: clinicianHash,
    status: 'active',
  }).onConflictDoNothing();

  await db.insert(user_roles).values({
    user_id: SEED_CLINICIAN_ID,
    role: 'ortho',
    clinic_id: SEED_CLINIC_ID,
    branch_id: SEED_BRANCH_ID,
  }).onConflictDoNothing();

  await db.insert(members).values({
    id: SEED_MEMBER_ID,
    clinic_id: SEED_CLINIC_ID,
    branch_id: SEED_BRANCH_ID,
    mobile: '9876543210',
    name: 'Ravi Kumar',
    age: 38,
    sex: 'male',
    segment: 'care',
    status: 'assessed',
    complaint: 'Lower back pain for 3 weeks, worsens on sitting',
  }).onConflictDoNothing();

  await db.insert(consents).values({
    member_id: SEED_MEMBER_ID,
    clinic_id: SEED_CLINIC_ID,
    type: 'clinical',
    method: 'verbal',
  }).onConflictDoNothing();

  await db.insert(member_assignments).values({
    member_id: SEED_MEMBER_ID,
    clinician_id: SEED_CLINICIAN_ID,
    clinic_id: SEED_CLINIC_ID,
  }).onConflictDoNothing();

  await db.insert(assessments).values({
    id: SEED_ASSESSMENT_ID,
    member_id: SEED_MEMBER_ID,
    clinic_id: SEED_CLINIC_ID,
    clinician_id: SEED_CLINICIAN_ID,
    type: 'deep',
    status: 'completed',
    musculage: 44,
    completed_at: new Date(),
  }).onConflictDoNothing();

  const seedCategoryScores = [
    { category: 'reflex',   score: 62 },
    { category: 'balance',  score: 48 },
    { category: 'rom',      score: 35 },
    { category: 'mobility', score: 41 },
  ];
  for (const cs of seedCategoryScores) {
    await db.insert(category_scores).values({
      assessment_id: SEED_ASSESSMENT_ID,
      clinic_id: SEED_CLINIC_ID,
      category: cs.category,
      score: cs.score,
    }).onConflictDoNothing();
  }

  await db.insert(pain_flags).values({
    member_id: SEED_MEMBER_ID,
    clinic_id: SEED_CLINIC_ID,
    region: 'lower_back',
    severity: 6,
    type: 'acute',
    active: 'true',
    set_by: SEED_CLINICIAN_ID,
  }).onConflictDoNothing();

  const seedGames = [
    { id: '10000000-0000-0000-0000-000000000001', name: 'Bird Dog',        slug: 'bird-dog',        regions: '["lower_back","core"]',       category: 'stability' },
    { id: '10000000-0000-0000-0000-000000000002', name: 'Dead Bug',        slug: 'dead-bug',        regions: '["core","lower_back"]',       category: 'stability' },
    { id: '10000000-0000-0000-0000-000000000003', name: 'Pallof Press',    slug: 'pallof-press',    regions: '["core","shoulder"]',         category: 'stability' },
    { id: '10000000-0000-0000-0000-000000000004', name: 'Standing Balance',slug: 'standing-balance',regions: '["ankle","knee"]',            category: 'balance' },
    { id: '10000000-0000-0000-0000-000000000005', name: 'Hip Hinge',       slug: 'hip-hinge',       regions: '["lower_back","hip"]',        category: 'mobility' },
    { id: '10000000-0000-0000-0000-000000000006', name: 'Squat',           slug: 'squat',           regions: '["knee","lower_back","hip"]', category: 'strength' },
    { id: '10000000-0000-0000-0000-000000000007', name: 'Shoulder Press',  slug: 'shoulder-press',  regions: '["shoulder","neck"]',         category: 'strength' },
    { id: '10000000-0000-0000-0000-000000000008', name: 'Lateral Raise',   slug: 'lateral-raise',   regions: '["shoulder"]',               category: 'strength' },
  ];
  for (const g of seedGames) {
    await db.insert(games).values(g).onConflictDoNothing();
  }

  console.log('Phase 1d seed complete:');
  console.log('  clinician@testclinic.dev / dev_clinician_pass (role: ortho)');
  console.log('  Seed member ID:', SEED_MEMBER_ID);
  console.log('  Seed assessment ID:', SEED_ASSESSMENT_ID);

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
