import { describe, it, expect } from 'vitest';
import {
  createMemberSchema, painFlagInputSchema, consentInputSchema, assignmentInputSchema,
} from './schemas';

describe('createMemberSchema', () => {
  const base = { name: 'Ravi Kumar', mobile: '9876543210' };

  it('accepts a minimal valid member', () => {
    const r = createMemberSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('accepts a full valid member with pain map + consent', () => {
    const r = createMemberSchema.safeParse({
      ...base,
      age: 38, sex: 'male', segment: 'care', complaint: 'Lower back pain',
      pain_map: [{ region: 'lower_back', severity: 6, type: 'acute' }],
      consent: { type: 'clinical', method: 'verbal' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects a missing name', () => {
    expect(createMemberSchema.safeParse({ mobile: '9876543210' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(createMemberSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
  });

  it.each(['12345', 'abcdefghij', 'phone-number', '++91999'])(
    'rejects invalid mobile %s',
    (mobile) => {
      expect(createMemberSchema.safeParse({ ...base, mobile }).success).toBe(false);
    },
  );

  it.each(['9876543210', '+919876543210', '912345678901', '98765 43210', '+91-98765-43210'])(
    'accepts valid mobile %s (formatting allowed, normalized later)',
    (mobile) => {
      expect(createMemberSchema.safeParse({ ...base, mobile }).success).toBe(true);
    },
  );

  it('rejects age out of range', () => {
    expect(createMemberSchema.safeParse({ ...base, age: 130 }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, age: -1 }).success).toBe(false);
  });

  it('rejects an unknown sex / segment', () => {
    expect(createMemberSchema.safeParse({ ...base, sex: 'unknown' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, segment: 'vip' }).success).toBe(false);
  });
});

describe('painFlagInputSchema', () => {
  it('accepts severity 0 and 10 (boundaries)', () => {
    expect(painFlagInputSchema.safeParse({ region: 'knee', severity: 0, type: 'chronic' }).success).toBe(true);
    expect(painFlagInputSchema.safeParse({ region: 'knee', severity: 10, type: 'acute' }).success).toBe(true);
  });

  it('rejects severity outside 0–10', () => {
    expect(painFlagInputSchema.safeParse({ region: 'knee', severity: 11, type: 'acute' }).success).toBe(false);
    expect(painFlagInputSchema.safeParse({ region: 'knee', severity: -1, type: 'acute' }).success).toBe(false);
  });

  it('rejects a non-integer severity', () => {
    expect(painFlagInputSchema.safeParse({ region: 'knee', severity: 4.5, type: 'acute' }).success).toBe(false);
  });

  it('rejects an unknown region or type', () => {
    expect(painFlagInputSchema.safeParse({ region: 'face', severity: 5, type: 'acute' }).success).toBe(false);
    expect(painFlagInputSchema.safeParse({ region: 'knee', severity: 5, type: 'sharp' }).success).toBe(false);
  });
});

describe('consentInputSchema', () => {
  it('defaults type to clinical', () => {
    const r = consentInputSchema.safeParse({ method: 'verbal' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe('clinical');
  });

  it('requires a valid method', () => {
    expect(consentInputSchema.safeParse({ method: 'smoke-signal' }).success).toBe(false);
    expect(consentInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('assignmentInputSchema', () => {
  it('requires a uuid clinician_id', () => {
    expect(assignmentInputSchema.safeParse({ clinician_id: 'not-a-uuid' }).success).toBe(false);
    expect(assignmentInputSchema.safeParse({ clinician_id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
  });
});
