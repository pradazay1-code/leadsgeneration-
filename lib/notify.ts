// Push alerts to your phone. Three channels, all optional — every configured
// one gets the message, and the scan still runs fine if none are set up.
//
//   1. ntfy (recommended, free forever): install the ntfy app, subscribe to a
//      secret topic, set NTFY_TOPIC. Optional NTFY_SERVER for self-hosted.
//   2. Telegram (free): create a bot with @BotFather, set TELEGRAM_BOT_TOKEN
//      and TELEGRAM_CHAT_ID.
//   3. Twilio SMS (paid after trial): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//      TWILIO_FROM_NUMBER, ALERT_PHONE_NUMBER.

import type { ScanResult } from "./scanner";

export interface ChannelResult {
  channel: string;
  ok: boolean;
  detail: string;
}

export function formatAlert(result: ScanResult): string {
  const date = new Date(result.generatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const line = (picks: ScanResult["dayTrades"]) =>
    picks
      .slice(0, 4)
      .map((p) => `${p.symbol} ${p.score}`)
      .join(", ") || "none today";
  const url = process.env.SITE_URL ? `\n${process.env.SITE_URL}` : "";
  return (
    `Stock Wizard ${date}\n` +
    `DAY TRADES: ${line(result.dayTrades)}\n` +
    `LONG TERM: ${line(result.longTerm)}` +
    url +
    `\nNot financial advice.`
  );
}

// --- ntfy.sh (free push notifications) ---

function ntfyConfigured(): boolean {
  return Boolean(process.env.NTFY_TOPIC);
}

async function sendNtfy(body: string): Promise<ChannelResult> {
  const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");
  const topic = process.env.NTFY_TOPIC!;
  const headers: Record<string, string> = {
    Title: "Stock Wizard — today's picks",
    Priority: "high",
    Tags: "chart_with_upwards_trend",
  };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    console.error("ntfy send failed:", res.status, await res.text());
    return { channel: "ntfy", ok: false, detail: `ntfy error ${res.status}` };
  }
  return { channel: "ntfy", ok: true, detail: "push sent" };
}

// --- Telegram bot ---

function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendTelegram(body: string): Promise<ChannelResult> {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: body }),
    },
  );
  if (!res.ok) {
    console.error("Telegram send failed:", res.status, await res.text());
    return { channel: "telegram", ok: false, detail: `Telegram error ${res.status}` };
  }
  return { channel: "telegram", ok: true, detail: "message sent" };
}

// --- Twilio SMS ---

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER &&
      process.env.ALERT_PHONE_NUMBER,
  );
}

async function sendTwilio(body: string): Promise<ChannelResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: process.env.ALERT_PHONE_NUMBER!,
      From: process.env.TWILIO_FROM_NUMBER!,
      Body: body,
    }),
  });
  if (!res.ok) {
    console.error("Twilio send failed:", res.status, await res.text());
    return { channel: "sms", ok: false, detail: `Twilio error ${res.status}` };
  }
  return { channel: "sms", ok: true, detail: "SMS sent" };
}

// --- unified entry point ---

export function anyChannelConfigured(): boolean {
  return ntfyConfigured() || telegramConfigured() || twilioConfigured();
}

export async function sendAlert(body: string): Promise<ChannelResult[]> {
  const jobs: Promise<ChannelResult>[] = [];
  if (ntfyConfigured()) jobs.push(sendNtfy(body));
  if (telegramConfigured()) jobs.push(sendTelegram(body));
  if (twilioConfigured()) jobs.push(sendTwilio(body));
  if (jobs.length === 0) {
    return [{ channel: "none", ok: false, detail: "no notification channel configured" }];
  }
  return Promise.all(
    jobs.map((j) =>
      j.catch((err) => ({
        channel: "unknown",
        ok: false,
        detail: (err as Error).message,
      })),
    ),
  );
}
