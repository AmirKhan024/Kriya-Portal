/**
 * Shared vocabulary for the member / clinical domain (Dev A track, feature 1b).
 *
 * Region slugs are the canonical pain-flag regions. They MUST stay aligned with the
 * `games.regions` vocabulary used by the pain-gating engine (Module 1c) so that
 * `game.regions ∩ member.active_pain_flag_regions` works. The seed game catalog uses:
 * lower_back, core, shoulder, neck, ankle, knee, hip — this list is a superset.
 */

export const PAIN_REGIONS = [
  'neck',
  'shoulder',
  'upper_back',
  'lower_back',
  'hip',
  'knee',
  'ankle',
  'wrist',
  'elbow',
  'core',
] as const;

export type PainRegion = (typeof PAIN_REGIONS)[number];

export const PAIN_REGION_LABELS: Record<PainRegion, string> = {
  neck: 'Neck',
  shoulder: 'Shoulder',
  upper_back: 'Upper Back',
  lower_back: 'Lower Back',
  hip: 'Hip',
  knee: 'Knee',
  ankle: 'Ankle',
  wrist: 'Wrist',
  elbow: 'Elbow',
  core: 'Core / Trunk',
};

export const PAIN_TYPES = ['acute', 'chronic'] as const;
export type PainType = (typeof PAIN_TYPES)[number];

export const SEGMENTS = ['care', 'wellness'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEXES = ['male', 'female', 'other'] as const;
export type Sex = (typeof SEXES)[number];

export const CONSENT_TYPES = ['clinical'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_METHODS = ['verbal', 'digital'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * Member lifecycle states (the spine state machine from the brief §1).
 * 1b only ever creates members in `new`.
 */
export const MEMBER_STATUSES = [
  'new',
  'assessed',
  'prescribed',
  'on_program',
  'retained',
  'at_risk',
  'lapsed',
  'discharged',
] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * Roles permitted to CREATE a member / capture consent (RBAC table, brief §6 / arch doc).
 * Create Member: clinic_admin, ortho, physio, front_desk. Trainer and Ops cannot.
 */
export const MEMBER_CREATE_ROLES = ['clinic_admin', 'ortho', 'physio', 'front_desk'] as const;

/** Roles permitted to view/manage a clinic's full member roster (admins). */
export const MEMBER_ADMIN_ROLES = ['ops', 'clinic_admin'] as const;
