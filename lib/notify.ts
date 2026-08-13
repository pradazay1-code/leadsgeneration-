// SMS alerts via the Twilio REST API (plain fetch — no SDK needed).
// Configure with env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_FROM_NUMBER, ALERT_PHONE_NUMBER. If any are missing the scan
// still runs; it just skips the text message.

import type { ScanResult } from "./scanner";

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER &&
      process.env.ALERT_PHONE_NUMBER,
  );
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

export async function sendSms(body: string): Promise<{ ok: boolean; detail: string }> {
  if (!smsConfigured()) return { ok: false, detail: "SMS not configured (missing env vars)" };
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
    const text = await res.text();
    console.error("Twilio send failed:", res.status, text);
    return { ok: false, detail: `Twilio error ${res.status}` };
  }
  return { ok: true, detail: "SMS sent" };
}
