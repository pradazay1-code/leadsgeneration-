// Vercel Cron target — runs every weekday at 12:45 UTC (8:45 AM ET, pre-market),
// scans the market, and pushes the top picks to every configured notification
// channel (ntfy / Telegram / Twilio SMS — see lib/notify.ts).
//
// Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` when the
// CRON_SECRET env var is set; requests without it are rejected so strangers
// can't spam your phone by hitting the URL.

import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scanner";
import { formatAlert, sendAlert } from "@/lib/notify";

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
    const notifications = await sendAlert(message);

    return NextResponse.json({
      ok: true,
      dayTrades: result.dayTrades.map((p) => ({ symbol: p.symbol, score: p.score })),
      longTerm: result.longTerm.map((p) => ({ symbol: p.symbol, score: p.score })),
      notifications,
      message,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
