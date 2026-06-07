import { describe, it, expect } from 'vitest';
import { TEST_CATEGORY_MAP, VALID_TEST_IDS, isKnownTestId, categoryForTest } from './categories';

describe('test category map', () => {
  it('covers all 21 tests with the right category prefix', () => {
    expect(VALID_TEST_IDS).toHaveLength(21);
    for (const id of VALID_TEST_IDS) {
      const cat = TEST_CATEGORY_MAP[id];
      if (id.startsWith('NN')) expect(cat).toBe('reflex');
      else if (id.startsWith('BB')) expect(cat).toBe('balance');
      else if (id.startsWith('FA')) expect(cat).toBe('rom');
      else if (id.startsWith('KS')) expect(cat).toBe('mobility');
    }
  });

  it('isKnownTestId guards membership', () => {
    expect(isKnownTestId('BB1')).toBe(true);
    expect(isKnownTestId('NN5')).toBe(true);
    expect(isKnownTestId('ZZ9')).toBe(false);
    expect(isKnownTestId('')).toBe(false);
  });

  it('categoryForTest maps correctly', () => {
    expect(categoryForTest('FA3')).toBe('rom');
    expect(categoryForTest('KS6')).toBe('mobility');
  });
});
