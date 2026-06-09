/**
 * Mux client — feature 3a.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  ⏸  STUB — THE SINGLE EXTERNAL-SERVICE BOUNDARY for video.                │
 * │                                                                          │
 * │  The ONLY place real Mux credentials will ever live. Until MUX_TOKEN_ID/ │
 * │  MUX_TOKEN_SECRET are set, createDirectUpload returns an instant-ready    │
 * │  stub asset (so the upload→ready→publish flow works fully offline — real  │
 * │  Mux transcodes asynchronously and fires the asset.ready webhook later).  │
 * │  verifyWebhookSignature accepts when MUX_WEBHOOK_SECRET is unset.         │
 * │                                                                          │
 * │  To go live (PAUSE for keys first): swap createDirectUpload for the Mux   │
 * │  direct-upload SDK call and keep the HMAC verification below.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type DirectUpload = {
  upload_url: string;
  asset_id: string;
  playback_id: string | null;
  status: 'draft' | 'ready';
  stubbed: boolean;
};

function hasLiveCredentials(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

/**
 * Create a direct upload. Stub mode returns an instant-ready asset + playback id;
 * live mode would call Mux and return a real upload URL with the asset draft.
 */
export async function createDirectUpload(opts: { title: string; passthrough: Record<string, unknown> }): Promise<DirectUpload> {
  if (hasLiveCredentials()) {
    // ⏸ PAUSE POINT: real Mux Uploads.create(...) goes here once keys are set.
    // Not implemented this session — fall through to the stub so we never make a
    // partial, unverified upload call.
  }
  const id = crypto.randomUUID();
  void opts; // title/passthrough are forwarded to Mux in the live implementation
  return {
    upload_url: `stub://mux/upload/${id}`,
    asset_id: `stub-asset-${id}`,
    playback_id: `stub-pb-${id}`,
    status: 'ready',
    stubbed: true,
  };
}

/**
 * Verify a Mux webhook signature (`Mux-Signature: t=<ts>,v1=<hmac>`). Accepts when
 * MUX_WEBHOOK_SECRET is unset (stub/dev). Live verification is HMAC-SHA256 of
 * `<ts>.<rawBody>`.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.MUX_WEBHOOK_SECRET;
  if (!secret) return true; // stub-accept until configured
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
