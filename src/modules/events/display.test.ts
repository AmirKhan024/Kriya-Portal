import { describe, it, expect } from 'vitest';
import { eventLabel, eventTone, ALL_EVENT_TYPES, EVENT_LABELS } from './display';

describe('event display', () => {
  it('labels known events and falls back to the raw type', () => {
    expect(eventLabel('member.created')).toBe('Member created');
    expect(eventLabel('assessment.completed')).toBe('Scan completed');
    expect(eventLabel('totally.unknown')).toBe('totally.unknown');
  });

  it('tones events by domain', () => {
    expect(eventTone('member.created')).toBe('blue');
    expect(eventTone('assessment.completed')).toBe('teal');
    expect(eventTone('painflag.set')).toBe('amber');
    expect(eventTone('painlock.overridden')).toBe('red');
    expect(eventTone('nudge.sent')).toBe('purple');
    expect(eventTone('activity.completed')).toBe('green');
    expect(eventTone('something.else')).toBe('gray');
  });

  it('exposes every event type for the filter dropdown', () => {
    expect(ALL_EVENT_TYPES.length).toBe(Object.keys(EVENT_LABELS).length);
    expect(ALL_EVENT_TYPES).toContain('prescription.sent');
  });
});
