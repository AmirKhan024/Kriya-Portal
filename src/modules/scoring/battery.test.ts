import { describe, it, expect } from 'vitest';
import { QUICK_BATTERY, DEEP_BATTERY, batteryFor, sampleMetrics } from './battery';
import { isKnownTestId } from './categories';

describe('scan batteries', () => {
  it('reference only known test ids', () => {
    for (const g of [...QUICK_BATTERY, ...DEEP_BATTERY]) {
      expect(isKnownTestId(g.test_id), g.test_id).toBe(true);
    }
  });

  it('quick is non-empty; deep covers all 4 categories', () => {
    expect(QUICK_BATTERY.length).toBeGreaterThan(0);
    const cats = new Set(DEEP_BATTERY.map((g) => g.category));
    expect(cats).toEqual(new Set(['reflex', 'balance', 'rom', 'mobility']));
  });

  it('batteryFor selects by type', () => {
    expect(batteryFor('quick')).toBe(QUICK_BATTERY);
    expect(batteryFor('deep')).toBe(DEEP_BATTERY);
  });
});

describe('sampleMetrics (interim capture)', () => {
  it('always includes the test_id and a scoreable payload', () => {
    for (const g of DEEP_BATTERY) {
      const m = sampleMetrics(g.test_id);
      expect(m.test_id).toBe(g.test_id);
    }
    expect(sampleMetrics('BB1')).toHaveProperty('breachCount');
    expect(sampleMetrics('NN1')).toHaveProperty('customMetrics');
  });
});
