import { describe, it, expect } from 'vitest';
import { verdictStyle } from './verdict-style';

describe('verdictStyle', () => {
  it('maps each verdict to a label + color class', () => {
    expect(verdictStyle('eligible').label).toBe('Eligible');
    expect(verdictStyle('eligible').cls).toContain('green');
    expect(verdictStyle('modified').cls).toContain('teal');
    expect(verdictStyle('capped').cls).toContain('amber');
    expect(verdictStyle('blocked').label).toBe('Blocked');
    expect(verdictStyle('blocked').cls).toContain('red');
  });
});
