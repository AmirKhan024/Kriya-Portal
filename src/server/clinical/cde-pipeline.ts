import Groq from 'groq-sdk';
import { runTreeWalker } from './tree-walker';
import { getGameEligibility } from './eligibility-fixture';
import type { StructuredFindings, TreeWalkerOutput } from './tree-walker';
import type { GameEligibility } from './eligibility-fixture';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── Stage 1: Extract structured findings from raw clinical data ──────────────
// Groq identifies what it sees — it NEVER decides safety.
async function extractFindings(input: {
  complaint: string;
  musculage: number;
  categoryScores: { category: string; score: number }[];
  painFlags: { region: string; severity: number; type: string }[];
  memberAge: number;
}): Promise<StructuredFindings> {
  try {
    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 800,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a clinical data extraction assistant for a physiotherapy platform.
Extract structured clinical information from the patient data provided.
Return ONLY valid JSON matching the schema exactly. No prose, no markdown, no explanation.
Never diagnose. Never recommend treatment. Only extract what is explicitly present in the data.`,
        },
        {
          role: 'user',
          content: `Extract clinical findings from this patient data:

COMPLAINT: ${input.complaint}
AGE: ${input.memberAge}
MUSCULAGE: ${input.musculage} (movement age — lower than chronological is good)
CATEGORY SCORES (0-100): ${input.categoryScores.map(s => `${s.category}: ${s.score}`).join(', ')}
PAIN FLAGS: ${input.painFlags.map(f => `${f.region}: severity ${f.severity}/10, ${f.type}`).join('; ') || 'None recorded'}

Return JSON matching this schema exactly:
{
  "regions": ["string"],
  "pain_severity": number,
  "pain_type": "acute" | "chronic" | "mixed",
  "primary_complaint": "string (one sentence, the patient's main issue)",
  "red_flags": ["string (only include: night_pain, neurological_symptoms, unexplained_weight_loss, bilateral_symptoms, bowel_bladder — only if explicitly mentioned)"],
  "duration_weeks": number,
  "aggravating_factors": ["string"],
  "relieving_factors": ["string"]
}`,
        },
      ],
    });
    const text = response.choices[0]?.message?.content ?? '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as StructuredFindings;
  } catch (err) {
    console.error('[CDE] extractFindings fell back to deterministic findings:', err instanceof Error ? err.message : err);
    return {
      regions: input.painFlags.map(f => f.region),
      pain_severity: input.painFlags.reduce((max, f) => Math.max(max, f.severity), 0),
      pain_type: input.painFlags.some(f => f.type === 'acute') ? 'acute' : 'chronic',
      primary_complaint: input.complaint,
      red_flags: [],
      duration_weeks: 2,
      aggravating_factors: [],
      relieving_factors: [],
    };
  }
}

export type ProseSections = {
  findings_prose: string;
  impression_prose: string;
  contraindications_prose: string;
  program_rationale_prose: string;
  safety_note_prose: string;
};

// ── Stage 4: Format the deterministic output as a readable clinical letter ───
// Groq can only phrase — it CANNOT alter contraindications or eligibility verdicts.
async function formatLetterProse(input: {
  memberName: string;
  memberAge: number;
  clinicName: string;
  clinicianName: string;
  findings: StructuredFindings;
  treeWalkerOutput: TreeWalkerOutput;
  eligibleGames: GameEligibility[];
  blockedGames: GameEligibility[];
  modifiedGames: GameEligibility[];
}): Promise<ProseSections> {
  const { memberName, memberAge, clinicName, clinicianName, findings,
    treeWalkerOutput, eligibleGames, blockedGames, modifiedGames } = input;

  try {
    const response = await groq.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 1200,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a clinical letter writing assistant for a physiotherapy clinic.
Write professional, warm, and clear clinical letter sections.
Return ONLY valid JSON. No markdown, no prose outside the JSON.
Use clear language suitable for both clinicians and patients.
Never add contraindications or game restrictions that are not in the input data.`,
        },
        {
          role: 'user',
          content: `Write these sections for a clinical letter for ${memberName}, age ${memberAge}.
Clinic: ${clinicName}. Clinician: ${clinicianName}.

CLINICAL DATA (do not add to or modify the safety content):
Complaint: ${findings.primary_complaint}
Affected regions: ${findings.regions.join(', ')}
Pain severity: ${findings.pain_severity}/10 (${findings.pain_type})
DX summary: ${treeWalkerOutput.dx_summary}
Contraindications: ${treeWalkerOutput.contraindications.join('; ')}
Precautions: ${treeWalkerOutput.precautions.join('; ')}
Eligible exercises: ${eligibleGames.map(g => g.game_name).join(', ') || 'None'}
Modified exercises: ${modifiedGames.map(g => `${g.game_name} (${g.modifications})`).join(', ') || 'None'}
Locked exercises: ${blockedGames.map(g => g.game_name).join(', ') || 'None'}

Return JSON with these keys (each value is 1-3 sentences, professional clinical tone):
{
  "findings_prose": "Paragraph describing the patient's presentation",
  "impression_prose": "Clinical impression paragraph (1-2 sentences)",
  "contraindications_prose": "Paragraph listing what the patient should avoid and why",
  "program_rationale_prose": "Why this exercise approach was chosen for this patient",
  "safety_note_prose": "Safety note reminding patient this complements, not replaces, in-clinic care"
}`,
        },
      ],
    });
    const text = response.choices[0]?.message?.content ?? '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as ProseSections;
  } catch (err) {
    console.error('[CDE] formatLetterProse fell back to deterministic prose:', err instanceof Error ? err.message : err);
    return {
      findings_prose: `${memberName} presents with ${findings.primary_complaint} affecting the ${findings.regions.join(' and ')} with a pain severity of ${findings.pain_severity}/10.`,
      impression_prose: treeWalkerOutput.dx_summary,
      contraindications_prose: `The following activities should be avoided: ${treeWalkerOutput.contraindications.join('; ')}.`,
      program_rationale_prose: `The exercise program has been selected to support recovery while respecting current pain levels.`,
      safety_note_prose: `This program complements in-clinic care. Consult your clinician if symptoms worsen.`,
    };
  }
}

export type CDEResult = {
  findings: StructuredFindings;
  treeWalkerOutput: TreeWalkerOutput;
  eligibility: GameEligibility[];
  prose: ProseSections;
};

export async function runCDEPipeline(input: {
  memberId: string;
  clinicId: string;
  complaint: string;
  musculage: number;
  categoryScores: { category: string; score: number }[];
  painFlags: { region: string; severity: number; type: string }[];
  memberAge: number;
  memberName: string;
  clinicName: string;
  clinicianName: string;
}): Promise<CDEResult> {
  // Stage 1: LLM extracts structured findings
  const findings = await extractFindings({
    complaint: input.complaint,
    musculage: input.musculage,
    categoryScores: input.categoryScores,
    painFlags: input.painFlags,
    memberAge: input.memberAge,
  });

  // Stage 2: Deterministic TreeWalker — no LLM, same inputs → same output
  const treeWalkerOutput = runTreeWalker(findings);

  // Stage 3: Game eligibility (fixture until Dev A ships the real endpoint)
  const eligibility = await getGameEligibility(input.memberId, input.clinicId);

  // Stage 4: LLM formats the letter prose (cannot alter Stage 2/3 safety output)
  const eligibleGames = eligibility.filter(g => g.verdict === 'eligible');
  const modifiedGames = eligibility.filter(g => g.verdict === 'modified' || g.verdict === 'capped');
  const blockedGames  = eligibility.filter(g => g.verdict === 'blocked');

  const prose = await formatLetterProse({
    memberName: input.memberName,
    memberAge: input.memberAge,
    clinicName: input.clinicName,
    clinicianName: input.clinicianName,
    findings,
    treeWalkerOutput,
    eligibleGames,
    blockedGames,
    modifiedGames,
  });

  return { findings, treeWalkerOutput, eligibility, prose };
}
