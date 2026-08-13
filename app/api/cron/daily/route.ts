// Vercel Cron target — runs every weekday at 12:45 UTC (8:45 AM ET, pre-market),
// scans the market, and texts the top picks via Twilio SMS.
//
// Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` when the
// CRON_SECRET env var is set; requests without it are rejected so strangers
// can't burn your Twilio credits by hitting the URL.

import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scanner";
import { formatAlert, sendSms, smsConfigured } from "@/lib/notify";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runScan();
    const message = formatAlert(result);

    let sms: { ok: boolean; detail: string };
    if (smsConfigured()) {
      sms = await sendSms(message);
    } else {
      sms = { ok: false, detail: "SMS skipped — Twilio env vars not set" };
    }

    return NextResponse.json({
      ok: true,
      dayTrades: result.dayTrades.map((p) => ({ symbol: p.symbol, score: p.score })),
      longTerm: result.longTerm.map((p) => ({ symbol: p.symbol, score: p.score })),
      sms,
      message,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
