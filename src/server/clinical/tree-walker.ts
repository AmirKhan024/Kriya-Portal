export type StructuredFindings = {
  regions: string[];
  pain_severity: number;
  pain_type: 'acute' | 'chronic' | 'mixed';
  primary_complaint: string;
  red_flags: string[];
  duration_weeks: number;
  aggravating_factors: string[];
  relieving_factors: string[];
};

export type TreeWalkerOutput = {
  dx_summary: string;
  contraindications: string[];
  precautions: string[];
  program_seed: {
    category: string;
    priority: 'high' | 'medium' | 'low';
    rationale: string;
  }[];
  red_flag_alert: string | null;
};

const REGION_CONTRAINDICATIONS: Record<string, { acute: string[]; chronic: string[] }> = {
  lower_back: {
    acute: [
      'High-impact activities (running, jumping)',
      'Heavy axial loading (barbell squats, deadlifts)',
      'Uncontrolled lumbar flexion under load',
      'Prolonged static sitting or standing',
    ],
    chronic: [
      'Uncontrolled end-range lumbar flexion',
      'Activities that provoke sharp pain',
    ],
  },
  neck: {
    acute: [
      'Cervical rotation under load',
      'Overhead pressing or pulling',
      'Contact sports or high-impact activities',
    ],
    chronic: ['Sustained forward head posture', 'Heavy overhead loading'],
  },
  shoulder: {
    acute: [
      'Overhead pressing or reaching',
      'External rotation under load',
      'Contact or throwing sports',
    ],
    chronic: ['Heavy overhead loading', 'Activities above shoulder height when painful'],
  },
  knee: {
    acute: [
      'Full-depth squatting or lunging',
      'Single-leg landing or jumping',
      'High-impact running or pivoting',
    ],
    chronic: ['Deep squatting if painful', 'High-impact plyometrics'],
  },
  hip: {
    acute: [
      'Deep hip flexion beyond 90°',
      'Loaded single-leg stance',
      'High-impact activities',
    ],
    chronic: ['End-range hip flexion under load'],
  },
  ankle: {
    acute: [
      'Weight-bearing on unstable surfaces',
      'High-impact landing or jumping',
      'Forced dorsiflexion',
    ],
    chronic: ['Uncontrolled ankle inversion movements'],
  },
};

const RED_FLAG_ALERTS: Record<string, string> = {
  night_pain:
    '⚠️ Night pain reported — consider referral to rule out non-mechanical cause.',
  neurological_symptoms:
    '⚠️ Neurological symptoms reported — urgent medical review recommended before exercise.',
  unexplained_weight_loss:
    '⚠️ Unexplained weight loss — medical evaluation required before exercise prescription.',
  bilateral_symptoms:
    '⚠️ Bilateral symptoms — consider central cause, refer for imaging.',
  bowel_bladder:
    '⚠️ Bowel/bladder symptoms — immediate medical referral required.',
};

function buildProgramSeed(
  regions: string[],
  severity: number,
  painType: string
): TreeWalkerOutput['program_seed'] {
  const seed: TreeWalkerOutput['program_seed'] = [];

  if (regions.some(r => ['lower_back', 'hip', 'core'].includes(r))) {
    seed.push({
      category: 'stability',
      priority: 'high',
      rationale: 'Core and lumbar stabilisation is foundational for back and hip conditions',
    });
  }

  if (severity >= 5 || painType === 'chronic') {
    seed.push({
      category: 'rom',
      priority: severity >= 7 ? 'medium' : 'high',
      rationale: 'Gentle mobility work to restore movement without provoking symptoms',
    });
  }

  if (regions.some(r => ['knee', 'ankle', 'hip'].includes(r))) {
    seed.push({
      category: 'balance',
      priority: 'medium',
      rationale: 'Proprioceptive training to support joint stability during recovery',
    });
  }

  seed.push({
    category: 'strength',
    priority: severity >= 6 && painType === 'acute' ? 'low' : 'medium',
    rationale: 'Progressive loading to rebuild tissue tolerance and prevent recurrence',
  });

  return seed;
}

export function runTreeWalker(findings: StructuredFindings): TreeWalkerOutput {
  const { regions, pain_severity, pain_type, primary_complaint, red_flags, duration_weeks } =
    findings;

  const regionLabels = regions.map(r => r.replace(/_/g, ' ')).join(' and ');
  const acuityLabel =
    pain_type === 'acute'
      ? `acute (${duration_weeks} week${duration_weeks === 1 ? '' : 's'})`
      : pain_type === 'chronic'
        ? 'chronic'
        : 'mixed acute-on-chronic';

  const complaint = primary_complaint.endsWith('.')
    ? primary_complaint
    : primary_complaint + '.';
  const dx_summary = `${acuityLabel.charAt(0).toUpperCase() + acuityLabel.slice(1)} ${regionLabels} pain (severity ${pain_severity}/10). ${complaint} Exercise prescription adjusted for current pain presentation.`;

  const contraindications: string[] = [];
  for (const region of regions) {
    const rules = REGION_CONTRAINDICATIONS[region];
    if (rules) {
      const list = pain_type === 'acute' ? rules.acute : rules.chronic;
      contraindications.push(...list);
    }
  }
  const uniqueContraindications = Array.from(new Set(contraindications));

  const precautions: string[] = [
    'Stop any exercise that provokes sharp, shooting, or worsening pain',
    'Monitor for increased pain or new symptoms after sessions',
    'Progress loads and volumes gradually — tolerance-led, not calendar-led',
  ];
  if (pain_severity >= 7) {
    precautions.push('Start with gentle, low-load movements only — upgrade as pain allows');
  }

  const alertMessages = red_flags.map(rf => RED_FLAG_ALERTS[rf]).filter(Boolean);
  const red_flag_alert = alertMessages.length > 0 ? alertMessages.join(' ') : null;

  const program_seed = buildProgramSeed(regions, pain_severity, pain_type);

  return { dx_summary, contraindications: uniqueContraindications, precautions, program_seed, red_flag_alert };
}
