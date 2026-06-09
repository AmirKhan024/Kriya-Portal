import type { TestId, Category } from '@/types/test';

/**
 * Test-id → category mapping for the assessment battery (Dev A, feature 1c-b).
 * Mirrors the kriya-v3 catalog: NN→reflex, BB→balance, FA→rom, KS→mobility.
 * (The backend needs only this map, not the full game configs.)
 */
export const TEST_CATEGORY_MAP: Record<TestId, Category> = {
  NN1: 'reflex', NN2: 'reflex', NN3: 'reflex', NN4: 'reflex', NN5: 'reflex',
  BB1: 'balance', BB2: 'balance', BB3: 'balance', BB4: 'balance',
  FA1: 'rom', FA2: 'rom', FA3: 'rom', FA4: 'rom', FA5: 'rom', FA6: 'rom',
  KS1: 'mobility', KS2: 'mobility', KS3: 'mobility', KS4: 'mobility', KS5: 'mobility', KS6: 'mobility',
};

export const VALID_TEST_IDS = Object.keys(TEST_CATEGORY_MAP) as TestId[];

export function isKnownTestId(id: string): id is TestId {
  return id in TEST_CATEGORY_MAP;
}

export function categoryForTest(id: TestId): Category {
  return TEST_CATEGORY_MAP[id];
}

export const CATEGORIES: Category[] = ['reflex', 'balance', 'rom', 'mobility'];
