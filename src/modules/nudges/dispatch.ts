/**
 * Nudge dispatcher — feature 2c.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  ⏸  STUB — THE SINGLE EXTERNAL-SERVICE BOUNDARY.                          │
 * │                                                                          │
 * │  This is the ONLY place real messaging credentials will ever live.       │
 * │  Until GUPSHUP_API_KEY / EXPO_ACCESS_TOKEN / SMS_PROVIDER_KEY are set,    │
 * │  this returns a deterministic stub provider id and NEVER throws, so the   │
 * │  whole nudge flow is fully exercisable offline.                          │
 * │                                                                          │
 * │  To go live (PAUSE for keys first), replace the per-channel branches:    │
 * │    whatsapp → Gupshup approved-template send                             │
 * │    push     → Expo Push → FCM/APNs                                       │
 * │    sms      → MSG91 / Twilio                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import type { NudgeChannel } from './constants';

export type DispatchInput = {
  channel: NudgeChannel;
  member_id: string;
  message: string;
};

export type DispatchResult = {
  provider: string;
  provider_message_id: string;
  status: 'sent';
  stubbed: boolean;
};

const PROVIDER_BY_CHANNEL: Record<NudgeChannel, string> = {
  whatsapp: 'gupshup',
  push: 'expo',
  sms: 'msg91',
};

/** True once a real provider credential is configured for the channel. */
function hasLiveCredential(channel: NudgeChannel): boolean {
  switch (channel) {
    case 'whatsapp':
      return Boolean(process.env.GUPSHUP_API_KEY);
    case 'push':
      return Boolean(process.env.EXPO_ACCESS_TOKEN);
    case 'sms':
      return Boolean(process.env.SMS_PROVIDER_KEY);
    default:
      return false;
  }
}

/**
 * Deliver a nudge. Currently a stub for every channel (see banner). Async so the
 * live implementation can await the provider SDK without a signature change.
 */
export async function dispatchNudge(input: DispatchInput): Promise<DispatchResult> {
  const provider = PROVIDER_BY_CHANNEL[input.channel];

  if (hasLiveCredential(input.channel)) {
    // ⏸ PAUSE POINT: real provider call goes here once keys are configured.
    // Intentionally not implemented this session — fall through to the stub so
    // we never make an unverified outbound call with a partial integration.
  }

  return {
    provider,
    provider_message_id: `stub:${input.channel}:${crypto.randomUUID()}`,
    status: 'sent',
    stubbed: true,
  };
}
