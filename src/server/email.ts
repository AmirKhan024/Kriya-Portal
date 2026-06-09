import 'server-only';
import nodemailer from 'nodemailer';

/**
 * Transactional email via Brevo SMTP (free tier). Stub-safe: when the SMTP env is
 * absent, sendEmail() is a no-op that returns { stubbed: true } and never throws,
 * so invites still work (the activation link is also shown in the UI to copy).
 *
 * Env: BREVO_SMTP_KEY (the xsmtpsib-… key), BREVO_SMTP_LOGIN (Brevo account email),
 * EMAIL_FROM (verified Brevo sender; defaults to the login).
 */
type SendResult = { sent: boolean; stubbed?: boolean; id?: string; error?: string };

const KEY = process.env.BREVO_SMTP_KEY;
const LOGIN = process.env.BREVO_SMTP_LOGIN;
const FROM = process.env.EMAIL_FROM || LOGIN || '';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Kriya Care';

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<SendResult> {
  if (!KEY || !LOGIN || !FROM) return { sent: false, stubbed: true };
  try {
    const transport = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      auth: { user: LOGIN, pass: KEY },
    });
    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { sent: true, id: info.messageId };
  } catch (err) {
    console.error('[email] send failed (non-fatal):', err);
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const ROLE_LABELS: Record<string, string> = {
  clinic_admin: 'Clinic Admin', ortho: 'Orthopaedic', physio: 'Physiotherapist',
  trainer: 'Trainer', front_desk: 'Front Desk',
};

/** HTML for a staff/admin invite email. */
export function inviteEmailHtml(name: string, activationUrl: string, clinicName: string, role?: string): string {
  const roleLine = role ? `as <strong>${ROLE_LABELS[role] ?? role}</strong> ` : '';
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
    <div style="background:#05080f;border-radius:16px;padding:28px;color:#e2e8f0">
      <div style="display:inline-block;width:36px;height:36px;background:#2dd4bf;border-radius:10px;text-align:center;line-height:36px;color:#05080f;font-weight:700;font-size:18px">K</div>
      <h1 style="font-size:20px;margin:18px 0 6px">You're invited to ${clinicName}</h1>
      <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px">
        Hi ${name}, you've been invited to the Kriya Clinic Portal ${roleLine}— set your password to activate your account.
      </p>
      <a href="${activationUrl}" style="display:inline-block;background:#2dd4bf;color:#05080f;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:10px;font-size:14px">Activate your account</a>
      <p style="color:#64748b;font-size:12px;line-height:1.6;margin:20px 0 0">
        Or paste this link into your browser:<br><span style="color:#5eead4;word-break:break-all">${activationUrl}</span>
      </p>
    </div>
  </div>`;
}
