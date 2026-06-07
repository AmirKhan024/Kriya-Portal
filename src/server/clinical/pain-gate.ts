export type GatingVerdict = 'eligible' | 'modified' | 'capped' | 'blocked';

export function computeGatingVerdict(
  gameRegions: string[],
  flags: { region: string; severity: number; type: string }[]
): GatingVerdict {
  for (const flag of flags) {
    if (!gameRegions.includes(flag.region)) continue;
    if (flag.type === 'acute' && flag.severity >= 5) return 'blocked';
    if (flag.severity >= 3) return 'capped';
    return 'modified';
  }
  return 'eligible';
}
