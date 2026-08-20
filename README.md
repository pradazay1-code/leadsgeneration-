# LeadSignal

A lead-discovery app for a marketing agency that sells websites, marketing, and CRM
solutions to **junk removal companies** and **real estate agents**.

It sweeps the towns you choose, merges what it finds across data sources into one lead
per business, and keeps only the ones that look like **newer operators with little or no
online presence**. Established players and national franchises are filtered out
automatically.

**It never shows made-up data.** If the list is empty, nothing has been found yet — and
the built-in **System check** tells you exactly why.

---

## Read this first: you need a Google Places key

Be realistic about the free sources. OpenStreetMap-derived data (BizData, Overpass)
covers roughly **20–40% of US small businesses**, and junk removal companies are barely
mapped at all — most are one truck and a phone number that nobody has added to OSM.
OpenStreetMap's geocoder also routinely blocks cloud hosts like Vercel.

**For a system that actually finds leads every day, connect Google Places.** It's the
only source with real coverage of these two niches, it needs no geocoder, and its
"no website on file" is authoritative rather than a guess.

| Source | Cost | Reality |
|---|---|---|
| **Google Places (New)** | Free monthly allowance, then paid | **Required for real results.** Comprehensive coverage of both niches. |
| **Geoapify** | Free tier, 3,000 req/day | Fixes the **geocoder** (see below) and adds an OSM-derived place source. |
| **Yelp Fusion** | 30-day trial (5,000 calls), then pay-per-call | Strong second source; best supplier of review counts. |
| BizData | Free, no key | Real-estate only, thin OSM coverage. Supplement. |
| OpenStreetMap Overpass | Free, no key | Few US service businesses are mapped. Supplement. |

### Why a Geoapify key is worth setting

Radius-based searching needs to turn "Norwood, MA" into coordinates. The free
OpenStreetMap geocoder (Nominatim) routinely refuses requests from cloud hosts like
Vercel, which silently disabled every radius search in production. `GEOAPIFY_API_KEY`
gives you a key-based geocoder that works from Vercel, which re-enables the
OpenStreetMap radius search as a side effect, and adds Geoapify Places as its own
source. It does not replace Google Places — Geoapify's business data is also
OpenStreetMap-derived, so its coverage of US service businesses has the same limits.

### Getting the Google Places key

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. APIs & Services → Library → enable **Places API (New)**.
3. Attach a billing account (required even inside the free allowance).
4. Credentials → Create credentials → API key.
5. Vercel → your project → Settings → Environment Variables → `GOOGLE_PLACES_API_KEY` →
   **Redeploy** (env vars only take effect on a new deployment).

Set a budget alert in Google Cloud. A handful of territories scanned daily normally
stays inside the free allowance.

---

## Setup

1. **Import to Vercel** — framework auto-detects as Next.js, nothing to configure.
2. **Add Postgres** — Vercel → Storage → Create Database → Postgres. `POSTGRES_URL` is
   injected automatically. **Without this, scanned leads vanish**: serverless requests
   hit different machines, so in-memory leads disappear the moment you reload.
3. **Add `GOOGLE_PLACES_API_KEY`** (see above), and optionally `GEOAPIFY_API_KEY` and
   `YELP_API_KEY`.
4. **Redeploy.**
5. Open **Settings → System check**. It runs a live test query against every source and
   tells you what's still broken and how to fix it. Everything should read *Working*.
6. Add a territory ("Norwood, MA"), hit **Scan now**.

Other env vars: `CRON_SECRET` (locks the daily scan endpoint — `openssl rand -hex 32`),
`APP_PASSWORD` (password-gates the whole app), `BIZDATA_DISABLED=1` / `OSM_DISABLED=1`.

## When a scan finds nothing

The scan result banner shows a **per-source breakdown** (`Google: 42 listings · Yelp:
skipped · OpenStreetMap: 0`), so a zero is never silent. Common causes:

- **No source connected** — the banner says so outright. Add the Google key.
- **Only free sources connected** — expect very few hits, especially for junk removal.
- **Town not recognised** — use `Town, ST` format.
- **Everything filtered out** — the banner says "found N listings but none cleared the
  bar". Those were established businesses or franchises. Drop the minimum score slider
  to see them.
- **Time budget reached** — scans stop cleanly at ~45s (Vercel's function ceiling) and
  save what they found. Run again, or split big territories into individual towns.

## What you get

- **Leads workspace** — one row per business, merged across sources, with "Seen on"
  badges. Click a row for the score breakdown, tap-to-call, links to each platform
  listing, a suggested cold-open line built from that lead's biggest gap, pipeline
  stages, and autosaving notes.
- **Opportunity score (0–100)** — higher = newer, thinner footprint. Normalised against
  what the connected sources can actually know, so scores stay comparable as you add keys.
- **Filters** — industry, presence tier, score, review count, website/phone, discovery
  window, pipeline status, source platform, state, town, search, plus presets. Your view
  syncs server-side, so any device shows the same workspace.
- **Territories** — town + industries + radius. Daily cron sweeps every enabled one.
- **CSV export** of the filtered view.
- **System check** — live probe of database, territories, geocoder, and every source.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## How scoring works

Weights in [`src/lib/scoring.ts`](src/lib/scoring.ts), niche queries and franchise
blocklists in [`src/lib/niches.ts`](src/lib/niches.ts), cross-source merging in
[`src/lib/merge.ts`](src/lib/merge.ts).

| Signal | Points |
|---|---|
| No website on file with Google (confirmed) | +30 |
| No website found on any source checked | +22 |
| Only a Facebook/Linktree/free-builder page | +22 |
| Only a brokerage/portal profile (kw.com, realtor.com, …) | +18 |
| Not listed on any review platform checked | +20 |
| 0 / ≤3 / ≤10 / ≤25 combined reviews | +24 / +20 / +15 / +9 |
| Found on only one platform | +6 |
| Phone listed | +6 |
| Missing photos / hours (when Google checked) | +9 / +7 |
| Has a real independent website | −10 |
| Listed on 3+ platforms | −6 |
| 61–150 / 150+ combined reviews | −12 / −25 |

Franchises (1-800-GOT-JUNK, Junk King, Keller Williams, RE/MAX, …), closed listings, and
off-niche matches are dropped before scoring. Re-scans refresh public data but never
touch your pipeline status, notes, or discovery dates; leads dedupe on phone number,
falling back to name + town.

## Data use

Google and Yelp data come through their official APIs under your own keys and their
terms — this app does not scrape either site. OpenStreetMap-derived data is ODbL,
attributed in the app. Check DNC rules before cold-calling, and keep outreach honest:
the suggested openers name a real observed gap, not a fake audit.
