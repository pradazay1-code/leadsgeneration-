# 📈 Stock Wizard

An analytical stock market scanner that runs around the clock and does two jobs:

1. **Day-trade candidates** — every weekday morning it scans the market for short-term
   momentum setups: unusual volume, strong trend alignment, healthy RSI, accelerating
   MACD, and enough daily range to be worth trading.
2. **Long-term picks** — durable compounders in confirmed uptrends: above their 200-day
   average, strong 6–12 month performance, shallow drawdowns, consistent positive months,
   real profitability, and sane valuations.

Every pick gets a transparent **0–100 score** with the exact signals and warnings behind
it, and the top picks are **pushed to your phone** before the market opens — free
forever via [ntfy](https://ntfy.sh) or Telegram, or by SMS via Twilio if you prefer.

## How it works

- **Data**: live quotes + 18 months of daily candles from Yahoo Finance (free, no API key),
  covering ~150 liquid large-caps **plus** Yahoo's "most actives" and "day gainers"
  screeners so fresh momentum names enter the funnel automatically.
- **Two-stage funnel**: one batched quote pass over the whole universe → liquidity filter
  ($5+ price, $20M+ daily dollar volume) → full indicator scoring (SMA/EMA, RSI-14,
  MACD, ATR%, relative volume, max drawdown, positive-month share) on the top candidates.
- **Always on**: the dashboard re-scans every 15 minutes (ISR caching); a Vercel Cron job
  runs every weekday at 12:45 UTC (8:45 AM ET, pre-market) and pushes the alert to your
  phone.

## Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. Go to [vercel.com/new](https://vercel.com/new), import the repo, and click **Deploy**.
   It's a standard Next.js app — no build configuration needed.
3. In the Vercel project → **Settings → Environment Variables**, add:

   | Variable | Required | What it is |
   |---|---|---|
   | `CRON_SECRET` | recommended | Any long random string. Vercel sends it with cron requests so strangers can't spam your phone. |
   | `NTFY_TOPIC` | for free push | Your secret ntfy topic name (see below). **This is the free option.** |
   | `TELEGRAM_BOT_TOKEN` | for Telegram | Bot token from @BotFather (also free). |
   | `TELEGRAM_CHAT_ID` | for Telegram | Your chat ID (see below). |
   | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` / `ALERT_PHONE_NUMBER` | for SMS | Only if you want real SMS via [Twilio](https://console.twilio.com) (paid after trial). |
   | `SITE_URL` | optional | Your deployed URL, appended to each alert. |

4. Redeploy after adding the variables. Every configured channel gets the alert;
   configure one, two, or all three.

### 🆓 Free phone notifications with ntfy (recommended, ~2 minutes)

[ntfy.sh](https://ntfy.sh) is a free, open-source push service — no account, no credit
card, unlimited notifications:

1. Install the **ntfy** app ([App Store](https://apps.apple.com/us/app/ntfy/id1625396347) /
   [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. In the app, tap **+** and subscribe to a topic with a name nobody could guess —
   the topic name is effectively your password, so use something like
   `stock-wizard-isaiah-x7k2m9`, not `stocks`.
3. Set `NTFY_TOPIC` to that exact topic name in Vercel and redeploy. Done — the
   pre-market alert now pushes straight to your phone.

Optional: `NTFY_SERVER` if you self-host ntfy, `NTFY_TOKEN` if your server needs auth.

### Free alerts via Telegram (alternative)

1. In Telegram, message **@BotFather** → `/newbot` → copy the bot token.
2. Send your new bot any message, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy the
   `"chat":{"id":...}` number.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Vercel and redeploy.

### SMS via Twilio (optional, paid after trial)

Create an account at [twilio.com](https://www.twilio.com/try-twilio), verify your cell
number, and fill in the four Twilio env vars. Trial credit runs out eventually, which
is why ntfy is the default recommendation.

If you configure no channel at all, everything else still works; the cron just logs
picks without notifying.

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

- `https://your-app.vercel.app/api/scan` — JSON results, no notification.
- `https://your-app.vercel.app/api/cron/daily` — full scan + phone alert (needs the
  `Authorization: Bearer <CRON_SECRET>` header if you set one).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Create a `.env.local` with your notification vars (e.g.
`NTFY_TOPIC=...`) to test alerts locally.

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
