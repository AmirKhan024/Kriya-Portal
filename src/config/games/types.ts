/**
 * Game configuration type — all game metadata lives in TypeScript.
 * The DB `games` table only stores: id, name, category, isActive, isKriya360, sortOrder.
 * Everything else (instructions, calibration, scoring bands) is here.
 */

export type GameCategory = 'balance' | 'reflex' | 'rom' | 'mobility' | 'posture';

export type ScoringMetric =
  | 'duration_seconds'
  | 'rep_count'
  | 'angle_degrees'
  | 'reaction_time_ms'
  | 'sway_area_cm2'
  | 'hold_duration_seconds'
  | 'accuracy_percent'
  | 'distance_cm';

export interface ScoringBand {
  ageMin: number;
  ageMax: number;
  gender: 'male' | 'female' | 'all';
  excellent: number;
  good: number;
  fair: number;
  poor: number;
}

/**
 * Basic-info screen (Layer 2a) — the first thing the user sees after
 * age/gender. Answers: "what is this game and what will I learn?" before
 * showing step-by-step mechanics.
 */
export interface GameBasicInfo {
  /** 1–2 sentence plain-language summary (max ~140 chars to stay mobile-friendly) */
  tagline: string;
  /**
   * The outcome the user gets from playing. Shown as a badge/chip next to the
   * tagline. Examples: "ROM score + symmetry index", "Reflex age", "Balance score".
   */
  outcome: string;
  /** Path to the hero image shown on the basic-info screen */
  heroImage: string;
  /**
   * Optional bullet highlights — kept deliberately short (max 3).
   * If omitted, the basic-info screen is just tagline + outcome + hero.
   */
  highlights?: string[];
  /** Approx duration shown on the basic-info screen ("30 seconds", "2 minutes") */
  durationLabel?: string;
  /** Posture indicator ("standing", "seated", "any") shown as a chip */
  posture?: 'standing' | 'seated' | 'any';
}

/**
 * A single slide in the new swipeable instruction carousel (Layer 2b).
 * Image-first with a short text overlay — NOT the verbose step list
 * (that lives on the detailed-instructions screen).
 */
export interface InstructionSlide {
  /** Path to image in /public/games/[id]/ */
  image: string;
  /** Short caption overlaid on the image (~8 words max for mobile readability) */
  caption: string;
  /**
   * Optional step tag shown in the corner (e.g. "Step 1", "Phase 2").
   * If omitted, no tag is rendered.
   */
  stepTag?: string;
}

/**
 * Detailed instructions screen (Layer 2c, opt-in).
 * Shown only if the user taps "I want detailed instructions" on the
 * swipeable carousel. Matches the v5-reference HTML structure: title +
 * subtitle + audio (Web Speech TTS), quick-steps, safety, and an optional
 * image panel the user can expand.
 */
export interface DetailedInstructions {
  /** Title shown at the top (usually the game name) */
  title: string;
  /** One-line subtitle directly under the title */
  subtitle: string;
  /** Numbered quick-steps — kept concise; each item is one sentence. */
  quickSteps: string[];
  /** Safety notice shown in the red-bordered callout (non-dismissable) */
  safetyNotice: string;
  /**
   * Optional image walkthrough shown when user taps "Show me pictures".
   * Each step has an image + caption + optional step tag.
   */
  imageSteps?: Array<{
    image: string;
    caption: string;
    stepTag?: string;
  }>;
}

export interface GameConfig {
  /** Must match the `id` column in the DB `games` table */
  id: string;
  /** Human-readable name */
  name: string;
  /** Movement dimension */
  category: GameCategory;
  /** 1 = beginner, 2 = intermediate, 3 = advanced */
  difficulty: 1 | 2 | 3;
  /** Game duration in seconds */
  durationSeconds: number;
  /** Whether this game is part of the Kriya360 bundle */
  isKriya360: boolean;
  /**
   * Whether this game appears in the public catalogue UI.
   * Defaults to true. When false, the game is hidden from /app/move
   * but its code, config, and historical user data remain intact —
   * direct URLs and report pages for past sessions still work.
   * Used to soft-deprecate games without breaking legacy data.
   */
  isVisible?: boolean;
  /** Display order within its category */
  sortOrder: number;
  /** Short description for the game card */
  description: string;
  /**
   * Basic-info screen content (Layer 2a).
   * Optional for backwards-compat with games that pre-date the v5 UX;
   * the shell falls back to the `description` field when absent.
   */
  basicInfo?: GameBasicInfo;
  /**
   * Swipeable instruction slides (Layer 2b) — image-first, short caption.
   * When populated, the shell renders the new v5 carousel. When empty,
   * the shell falls back to the legacy text-first instruction layer using
   * the `instructions` field below.
   */
  swipeSlides?: InstructionSlide[];
  /**
   * Detailed instructions content (Layer 2c).
   * Opt-in screen opened from the "I want detailed instructions" CTA.
   * Absent when not authored yet; the carousel's secondary CTA is then hidden.
   */
  detailedInstructions?: DetailedInstructions;
  /**
   * Legacy instruction slides (pre-v5 text-first design).
   * Kept for backwards-compat with games that haven't been migrated.
   * @deprecated Prefer swipeSlides + detailedInstructions. Will be removed
   * once every game has been migrated to the v5 UX.
   */
  instructions: Array<{
    /** Path to image in /public/games/[id]/ */
    image: string;
    /** Instructional text for this step */
    text: string;
  }>;
  /** Calibration requirements for MediaPipe */
  calibration: {
    /** MediaPipe landmark names that must be visible */
    requiredLandmarks: string[];
    /** Minimum confidence threshold (0.0 – 1.0) */
    confidenceThreshold: number;
    /** Text shown to user during calibration */
    instruction: string;
    /** V2-parity gates (optional — default true for all 8 V2-source games) */
    /** Check trunk vertical span is in distance band (not too far / too close) */
    requireDistanceBand?: boolean;
    /** Check shoulder midpoint vs hip midpoint lateral offset < 0.06 (standing straight) */
    requireStandingStraight?: boolean;
    /** Check both wrists below shoulders (arms relaxed at sides) */
    requireArmsRelaxed?: boolean;
    /** Check user is turned 90° to camera (FA4 hip hinge needs side profile) */
    requireSideProfile?: boolean;
    /** Both wrists above shoulders by ≥0.05 norm units (KS5 deep squat) */
    requireArmsOverhead?: boolean;
    /** Both wrists near hip landmarks (KS2 hip gate hands-on-hips pose) */
    requireHandsOnHips?: boolean;
    /** Both wrists forward of body and between shoulder/hip Y (KS6 cossack) */
    requireArmsForward?: boolean;
  };
  /** Scoring configuration */
  scoring: {
    /** What the game measures */
    metric: ScoringMetric;
    /** Whether higher scores are better */
    higherIsBetter: boolean;
    /** Age-adjusted scoring bands */
    bands: ScoringBand[];
  };
}
