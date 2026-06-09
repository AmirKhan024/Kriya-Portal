import { describe, it, expect } from 'vitest';
import { isWatchComplete } from './watch';

describe('isWatchComplete (>= 90%)', () => {
  it('is true at/above the threshold, false below', () => {
    expect(isWatchComplete(89)).toBe(false);
    expect(isWatchComplete(90)).toBe(true);
    expect(isWatchComplete(100)).toBe(true);
  });
});
