/**
 * Channel selection (feature 2c). Pure + unit-tested.
 *
 * Picks the highest-priority opted-in channel from NUDGE_CHANNELS (currently
 * Telegram-only). A caller may *request* a specific channel; it is honoured only
 * if the member is opted in to it — a request can never bypass the opt-in
 * (consistent with the events RLS lens: a filter never widens scope).
 *
 * DOCUMENTED DEFAULT — there is no per-member channel-preference column yet, so
 * the route supplies a default opt-in map. When a real `member_channel_preferences`
 * / consent gate lands, pass the member's true preferences here unchanged.
 */
import { NUDGE_CHANNELS, type NudgeChannel } from './constants';

export type ChannelOptIn = Record<NudgeChannel, boolean>;

export type ChannelChoice = { channel: NudgeChannel; reason: string };

export function selectChannel(
  optIn: ChannelOptIn,
  requested?: NudgeChannel | null,
): ChannelChoice | null {
  if (requested) {
    if (optIn[requested]) return { channel: requested, reason: 'requested' };
    return null; // requested a channel the member is not opted in to
  }
  for (const channel of NUDGE_CHANNELS) {
    if (optIn[channel]) return { channel, reason: 'priority' };
  }
  return null; // no opted-in channel
}
