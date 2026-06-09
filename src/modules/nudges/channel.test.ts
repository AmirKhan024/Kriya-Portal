import { describe, it, expect } from 'vitest';
import { selectChannel } from './channel';

describe('selectChannel (telegram-only, opted-in only)', () => {
  it('picks telegram when opted in', () => {
    expect(selectChannel({ telegram: true })).toEqual({ channel: 'telegram', reason: 'priority' });
  });

  it('returns null when not opted in', () => {
    expect(selectChannel({ telegram: false })).toBeNull();
  });

  it('honours a requested channel only if opted in', () => {
    expect(selectChannel({ telegram: true }, 'telegram')).toEqual({ channel: 'telegram', reason: 'requested' });
    expect(selectChannel({ telegram: false }, 'telegram')).toBeNull();
  });
});
