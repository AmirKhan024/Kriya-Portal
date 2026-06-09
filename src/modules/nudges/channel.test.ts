import { describe, it, expect } from 'vitest';
import { selectChannel, type ChannelOptIn } from './channel';

const all: ChannelOptIn = { whatsapp: true, push: true, sms: true };

describe('selectChannel (WhatsApp → push → SMS, opted-in only)', () => {
  it('picks the highest-priority opted-in channel', () => {
    expect(selectChannel(all)).toEqual({ channel: 'whatsapp', reason: 'priority' });
  });

  it('falls through to the next channel when a higher one is opted out', () => {
    expect(selectChannel({ whatsapp: false, push: true, sms: true })).toEqual({ channel: 'push', reason: 'priority' });
    expect(selectChannel({ whatsapp: false, push: false, sms: true })).toEqual({ channel: 'sms', reason: 'priority' });
  });

  it('returns null when no channel is opted in', () => {
    expect(selectChannel({ whatsapp: false, push: false, sms: false })).toBeNull();
  });

  it('honours a requested channel only if opted in', () => {
    expect(selectChannel(all, 'sms')).toEqual({ channel: 'sms', reason: 'requested' });
  });

  it('refuses a requested channel the member is opted out of (never widens)', () => {
    expect(selectChannel({ whatsapp: false, push: true, sms: true }, 'whatsapp')).toBeNull();
  });
});
