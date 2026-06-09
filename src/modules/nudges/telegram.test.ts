import { describe, it, expect } from 'vitest';
import { parseTelegramStart, telegramConnectLink } from './telegram';

const UUID = '00000000-0000-4000-8000-0000000000a1';

describe('parseTelegramStart', () => {
  it('extracts memberId + chatId from /start <uuid>', () => {
    expect(parseTelegramStart({ message: { text: `/start ${UUID}`, chat: { id: 12345 } } }))
      .toEqual({ memberId: UUID, chatId: '12345' });
  });

  it('ignores non-/start, bad uuid, and non-message updates', () => {
    expect(parseTelegramStart({ message: { text: 'hi', chat: { id: 1 } } })).toBeNull();
    expect(parseTelegramStart({ message: { text: '/start not-a-uuid', chat: { id: 1 } } })).toBeNull();
    expect(parseTelegramStart({ message: { text: `/start ${UUID}` } })).toBeNull(); // no chat
    expect(parseTelegramStart({})).toBeNull();
    expect(parseTelegramStart(null)).toBeNull();
  });
});

describe('telegramConnectLink', () => {
  it('builds the t.me deep link', () => {
    expect(telegramConnectLink('KriyaBot', UUID)).toBe(`https://t.me/KriyaBot?start=${UUID}`);
  });
});
