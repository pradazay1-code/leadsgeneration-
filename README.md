# LeadSignal

A lead-discovery app for a marketing agency that sells websites, marketing, and CRM
solutions to **junk removal companies** and **real estate agents**.

Every morning it sweeps the towns you tell it to watch, pulls every junk removal and
real estate business it can find from Google Places, and keeps only the ones that look
like **newer operators with little or no online presence** — no website, a handful of
reviews, a bare listing. Established players with real sites and hundreds of reviews are
filtered out automatically, because they already have what you sell.

## What you get

- **Leads workspace** — a scored, sortable, filterable table of prospects. Click any row
  for a detail drawer with the score breakdown, one-tap call / copy / Maps links, a
  suggested cold-open line written from that lead's biggest gap, pipeline status chips
  (new → contacted → responded → qualified → won/lost), and notes that autosave.
- **Opportunity score (0–100)** — higher = newer business, thinner footprint, better fit.
  The exact reasons (+32 no website, +22 only 3 reviews, …) are shown for every lead.
- **Filters** — industry, online-presence tier, minimum score, max review count,
  has-website / has-phone, discovery window, pipeline status, state, town, and free-text
  search. Presets like *No website* and *Brand new* are one click. Your filter set is
  remembered between visits.
- **Territories** — each territory is a town + the industries to sweep there. The daily
  cron walks every enabled territory; you can also scan any territory (or everything)
  on demand.
- **CSV export** — the current filtered view, formatted for Excel/Sheets.
- **Runs on Vercel** — daily scan via Vercel Cron, Postgres for storage, optional
  password gate for the whole app.

Until you add a Places API key the app runs on clearly-labelled fictional sample data so
you can explore the UI. The first real scan replaces it.

## Deploy to Vercel

1. **Push this repo to GitHub** (already done if you're reading this there) and import it
   in [Vercel](https://vercel.com/new). Framework preset: **Next.js** — no build settings
   to change.

2. **Get a Google Places API key**
   - In [Google Cloud Console](https://console.cloud.google.com/), create a project.
   - Enable **Places API (New)**.
   - Create an API key (Credentials → Create credentials → API key). Restrict it to the
     Places API (New) for safety.
   - Google gives a recurring monthly free allowance for Places; a few territories
     scanned daily generally stays inside it. Set a budget alert anyway.

3. **Create a Postgres database** — Vercel Postgres/Neon (Storage tab in Vercel),
   [Neon](https://neon.tech) directly, or Supabase all work. Copy the **pooled**
   connection string.

4. **Set environment variables** in Vercel → Project → Settings → Environment Variables:

   | Variable | Required | What it does |
   |---|---|---|
   | `GOOGLE_PLACES_API_KEY` | Yes, for real data | Lets the scanner query Google Places. |
   | `POSTGRES_URL` | Strongly recommended | Persists leads/notes/territories. Without it, data lives in memory and vanishes on restart. |
   | `CRON_SECRET` | Recommended | Locks the cron endpoint. Generate with `openssl rand -hex 32`. Vercel Cron sends it automatically. |
   | `APP_PASSWORD` | Optional | Puts a password gate in front of the whole app. |

5. **Deploy.** The daily scan is wired in `vercel.json` (11:00 UTC ≈ 6–7 AM Eastern).
   Change the schedule there if you want a different hour.

6. **Add your territories** (Territories page), hit **Scan now**, and start calling.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in what you have; empty = demo mode
npm run dev
```

## How scoring works

Signals and weights live in [`src/lib/scoring.ts`](src/lib/scoring.ts); niche queries,
franchise blocklists, and "not a real website" domains in
[`src/lib/niches.ts`](src/lib/niches.ts). The short version:

| Signal | Points |
|---|---|
| No website anywhere | +32 |
| Only a Facebook/Instagram/Linktree/free-builder page | +22 |
| Only a brokerage/portal profile (kw.com, realtor.com, …) | +18 |
| 0 reviews / ≤3 / ≤10 / ≤25 | +26 / +22 / +16 / +9 |
| No photos · no hours · no rating | +9 · +7 · +6 |
| Phone listed (you can actually reach them) | +6 |
| Has a real independent website | −10 |
| 61–150 reviews / 150+ reviews | −12 / −25 |

National franchises (1-800-GOT-JUNK, Junk King, Keller Williams, RE/MAX, …), permanently
closed listings, and off-niche results are dropped before they ever reach the list.
Leads below score 30 are skipped by the scanner as already-established.

Re-scans refresh public data (reviews, website, phone) but never touch your pipeline
status, notes, or the original discovery date, and nothing is ever double-added — leads
dedupe on their Google Place ID.

## Notes on data use

Lead data comes from the Google Places API under your own API key and is subject to
Google's terms. The app stores only business-level contact info (name, phone, address,
listing stats) — the stuff a business publishes to be found. Check DNC rules before
cold-calling numbers in your area, and keep outreach honest: the suggested openers name
a real observed gap, not a fake audit.
