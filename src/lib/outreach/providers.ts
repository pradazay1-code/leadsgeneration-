import "server-only";

/**
 * Outbound message senders. Both are optional: with no provider configured the
 * cadence runner falls back to creating a task with the rendered message, so
 * you copy-paste and send it yourself. Nothing silently disappears.
 */

export type Channel = "email" | "sms";

export interface SendResult {
  ok: boolean;
  /** Provider-side message id, when the send succeeded. */
  id?: string;
  error?: string;
  /** True when no provider is configured, so the caller falls back to a task. */
  notConfigured?: boolean;
}

export interface SenderStatus {
  channel: Channel;
  configured: boolean;
  detail: string;
}

/* ------------------------------------------------------------------ email */

function resendKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null;
}

function fromAddress(): string | null {
  return process.env.OUTREACH_FROM_EMAIL?.trim() || null;
}

export function emailConfigured(): boolean {
  return Boolean(resendKey() && fromAddress());
}

/**
 * Send via Resend. Chosen because it's a single HTTP call with no SDK, has a
 * usable free tier, and requires a verified sending domain — which keeps this
 * from becoming an easy spam cannon.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  replyTo?: string,
): Promise<SendResult> {
  const key = resendKey();
  const from = fromAddress();
  if (!key || !from) {
    return {
      ok: false,
      notConfigured: true,
      error: "Email sending isn't configured (needs RESEND_API_KEY and OUTREACH_FROM_EMAIL).",
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        // Plain text keeps deliverability high and avoids rendering surprises.
        text: body,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: data.message ?? `Resend returned ${res.status}` };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Email send failed" };
  }
}

/* -------------------------------------------------------------------- sms */

function twilioCreds(): { sid: string; token: string; from: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  return sid && token && from ? { sid, token, from } : null;
}

export function smsConfigured(): boolean {
  return Boolean(twilioCreds());
}

/** E.164-ish normalisation for US numbers. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const creds = twilioCreds();
  if (!creds) {
    return {
      ok: false,
      notConfigured: true,
      error:
        "SMS sending isn't configured (needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER).",
    };
  }

  const normalised = toE164(to);
  if (!normalised) return { ok: false, error: `"${to}" isn't a valid phone number` };

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.sid}:${creds.token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: normalised, From: creds.from, Body: body }).toString(),
      },
    );

    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: data.message ?? `Twilio returned ${res.status}` };
    }
    return { ok: true, id: data.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMS send failed" };
  }
}

/* --------------------------------------------------------------- guards */

/**
 * Business-hours guard. Cold outreach outside 8am–7pm local is both illegal in
 * places and a good way to get blocked, so the runner defers rather than sends.
 * Hours are interpreted in OUTREACH_TIMEZONE_OFFSET (hours from UTC, default
 * -5 = US Eastern).
 */
export function withinSendingHours(now = new Date()): boolean {
  if (process.env.OUTREACH_IGNORE_HOURS === "1") return true;

  const offset = Number(process.env.OUTREACH_TIMEZONE_OFFSET ?? -5);
  const local = new Date(now.getTime() + offset * 3600_000);
  const hour = local.getUTCHours();
  const day = local.getUTCDay();

  // No Sunday sends; Mon–Sat 08:00–19:00.
  if (day === 0) return false;
  return hour >= 8 && hour < 19;
}

/** Per-run cap so a misconfigured cadence can't blast a whole territory. */
export function dailySendCap(): number {
  const raw = Number(process.env.OUTREACH_DAILY_CAP ?? 50);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 50;
}

export function senderStatuses(): SenderStatus[] {
  return [
    {
      channel: "email",
      configured: emailConfigured(),
      detail: emailConfigured()
        ? `Connected via Resend, sending from ${fromAddress()}.`
        : "Not configured. Sequence email steps become tasks with the message pre-written, so you can send them yourself. Set RESEND_API_KEY and OUTREACH_FROM_EMAIL to send automatically.",
    },
    {
      channel: "sms",
      configured: smsConfigured(),
      detail: smsConfigured()
        ? "Connected via Twilio."
        : "Not configured. Sequence text steps become tasks with the message pre-written. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER to send automatically.",
    },
  ];
}
