# 📈 Stock Wizard

An analytical stock market scanner that runs around the clock and does two jobs:

1. **Day-trade candidates** — every weekday morning it scans the market for short-term
   momentum setups: unusual volume, strong trend alignment, healthy RSI, accelerating
   MACD, and enough daily range to be worth trading.
2. **Long-term picks** — durable compounders in confirmed uptrends: above their 200-day
   average, strong 6–12 month performance, shallow drawdowns, consistent positive months,
   real profitability, and sane valuations.

Every pick gets a transparent **0–100 score** with the exact signals and warnings behind
it, and the top picks are **texted to your phone via SMS** before the market opens.

## How it works

- **Data**: live quotes + 18 months of daily candles from Yahoo Finance (free, no API key),
  covering ~150 liquid large-caps **plus** Yahoo's "most actives" and "day gainers"
  screeners so fresh momentum names enter the funnel automatically.
- **Two-stage funnel**: one batched quote pass over the whole universe → liquidity filter
  ($5+ price, $20M+ daily dollar volume) → full indicator scoring (SMA/EMA, RSI-14,
  MACD, ATR%, relative volume, max drawdown, positive-month share) on the top candidates.
- **Always on**: the dashboard re-scans every 15 minutes (ISR caching); a Vercel Cron job
  runs every weekday at 12:45 UTC (8:45 AM ET, pre-market) and sends the SMS alert.

## Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. Go to [vercel.com/new](https://vercel.com/new), import the repo, and click **Deploy**.
   It's a standard Next.js app — no build configuration needed.
3. In the Vercel project → **Settings → Environment Variables**, add:

   | Variable | Required | What it is |
   |---|---|---|
   | `CRON_SECRET` | recommended | Any long random string. Vercel sends it with cron requests so strangers can't trigger your SMS. |
   | `TWILIO_ACCOUNT_SID` | for SMS | From your [Twilio console](https://console.twilio.com) dashboard. |
   | `TWILIO_AUTH_TOKEN` | for SMS | Same place. |
   | `TWILIO_FROM_NUMBER` | for SMS | Your Twilio phone number, e.g. `+15551234567`. |
   | `ALERT_PHONE_NUMBER` | for SMS | Your cell number, e.g. `+15559876543`. |
   | `SITE_URL` | optional | Your deployed URL, appended to each SMS. |

4. Redeploy after adding the variables.

### Setting up SMS (Twilio)

1. Create a free trial account at [twilio.com](https://www.twilio.com/try-twilio) — the
   trial includes credit and a free phone number.
2. Verify your own cell number in the console (trial accounts can only text verified numbers).
3. Copy the Account SID, Auth Token, and your Twilio number into the env vars above.

Trial messages are prefixed with "Sent from your Twilio trial account" — upgrading
(a few dollars) removes that. If you skip Twilio entirely, everything else still works;
the cron just logs picks without texting.

### The daily schedule

`vercel.json` registers the cron:

```json
{ "path": "/api/cron/daily", "schedule": "45 12 * * 1-5" }
```

That's 8:45 AM ET on weekdays (during daylight saving; 7:45 AM ET in winter — adjust to
`45 13 * * 1-5` in November if you care about the exact hour). On Vercel's free Hobby
plan, cron timing can drift within the hour — the picks are computed at send time, so
they're always fresh.

You can also trigger a scan manually:

- `https://your-app.vercel.app/api/scan` — JSON results, no SMS.
- `https://your-app.vercel.app/api/cron/daily` — full scan + SMS (needs the
  `Authorization: Bearer <CRON_SECRET>` header if you set one).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Create a `.env.local` with the Twilio vars if you want to
test SMS locally.

## Reading the scores

- **75+ (green)** — high-conviction setup
- **55–74 (blue)** — solid
- **Below 55** — marginal; day-trade picks under 40 and long-term picks under 50 are
  dropped entirely rather than shown

Every card lists its signals *and its warnings*. Read the warnings first.

## ⚠️ Disclaimer

This is an educational analysis tool, **not financial advice**. Scores are computed from
historical prices and public data; past performance does not predict future results — no
tool can reliably predict short-term stock moves. Day trading carries a high risk of
loss, and most retail day traders lose money. Position sizing, stop losses, and only
risking money you can afford to lose matter more than any scanner. Consider consulting a
licensed financial advisor.
