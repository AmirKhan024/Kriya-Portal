import { describe, it, expect } from 'vitest';
import { normalizeMobile, deriveSegment, painMapToRows } from './logic';

describe('normalizeMobile', () => {
  it('strips spaces, dashes and parentheses', () => {
    expect(normalizeMobile('98765 43210')).toBe('9876543210');
    expect(normalizeMobile('987-654-3210')).toBe('9876543210');
    expect(normalizeMobile(' (987) 654 3210 ')).toBe('9876543210');
  });

  it('preserves a single leading +', () => {
    expect(normalizeMobile('+91 98765 43210')).toBe('+919876543210');
  });
});

describe('deriveSegment', () => {
  it('returns explicit segment when provided', () => {
    expect(deriveSegment({ segment: 'wellness', complaint: 'back pain' })).toBe('wellness');
    expect(deriveSegment({ segment: 'care' })).toBe('care');
  });

  it('derives care when a complaint is present', () => {
    expect(deriveSegment({ complaint: 'Lower back pain' })).toBe('care');
  });

  it('derives wellness when no complaint', () => {
    expect(deriveSegment({})).toBe('wellness');
    expect(deriveSegment({ complaint: '   ' })).toBe('wellness');
  });
});

describe('painMapToRows', () => {
  it('returns [] for undefined or empty input', () => {
    expect(painMapToRows('m1', 'c1', 'u1', undefined)).toEqual([]);
    expect(painMapToRows('m1', 'c1', 'u1', [])).toEqual([]);
  });

  it('maps pain map entries to active pain_flag rows', () => {
    const rows = painMapToRows('m1', 'c1', 'u1', [
      { region: 'lower_back', severity: 6, type: 'acute' },
      { region: 'knee', severity: 2, type: 'chronic' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      member_id: 'm1', clinic_id: 'c1', region: 'lower_back', severity: 6,
      type: 'acute', active: 'true', set_by: 'u1',
    });
    expect(rows[1].region).toBe('knee');
    expect(rows.every((r) => r.active === 'true')).toBe(true);
  });
});
