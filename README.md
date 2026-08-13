# LeadSignal

A lead-discovery app for a marketing agency that sells websites, marketing, and CRM
solutions to **junk removal companies** and **real estate agents**.

Every morning it sweeps the towns you tell it to watch across **multiple data sources**,
merges everything it finds into one lead per business, and keeps only the ones that look
like **newer operators with little or no online presence** — no website, few or no
reviews, listed on only one platform. Established players and national franchises are
filtered out automatically, because they already have what you sell.

## Data sources

| Source | Cost | What it contributes |
|---|---|---|
| **BizData** (`bizdata-web.vercel.app`) | Free, **no key needed** | OpenStreetMap-backed business search — names, phones, websites, hours. Covers the real-estate niche. |
| **OpenStreetMap Overpass** | Free, **no key needed** | Direct OSM queries with name-pattern matching — this is what finds junk removal companies (OSM has no category for them). |
| **Yelp Fusion API** (optional) | 30-day trial (5,000 calls), then pay-per-call from $7.99/1k | The main source of **review counts** — the best public signal of how new a business is. Also catches businesses OSM doesn't have. Official API; scraping Yelp's site violates their ToS and breaks constantly, so this uses the sanctioned route. |
| **Google Places API (New)** (optional) | Monthly free allowance, then paid | The only source whose "no website on file" is definitive; adds photos/hours completeness signals. |

**The free pair works with zero setup** — deploy and hit "Scan now". Each additional key
makes the scoring smarter, and the score is normalised against what the connected
sources can actually know, so numbers stay comparable as you add keys.

Attribution: business data includes content © OpenStreetMap contributors (ODbL). Yelp
data © Yelp, and each Yelp-found lead links back to its Yelp page.

## What you get

- **Leads workspace** — one row per business, merged across sources (matched by phone
  number, then name + town), with "Seen on" badges. Click any row for the score
  breakdown, tap-to-call, links to each platform listing, a suggested cold-open line
  written from that lead's biggest gap, pipeline stages (new → contacted → responded →
  qualified → won/lost), and autosaving notes.
- **Opportunity score (0–100)** — higher = newer business, thinner footprint. "Not
  listed on any review platform" and "found on only one platform" are scored signals,
  with the exact breakdown shown on every lead.
- **Filters** — industry, presence tier, minimum score, max combined reviews,
  has-website/phone, discovery window, pipeline status, **source platform**, state,
  town, free-text search, plus one-click presets. Your saved view syncs **server-side**,
  so any device shows the same workspace.
- **Territories** — town + industries + search radius. The daily cron sweeps every
  enabled territory; scan any one on demand.
- **CSV export** of the current filtered view, with source platforms and Yelp links.

Until the first scan runs, the app shows clearly-labelled fictional sample data.

## Deploy to Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new). Framework: **Next.js**,
   no settings to change. It deploys and runs on the free sources immediately.

2. **Make data permanent (do this one)**: in your Vercel project → **Storage** →
   **Create Database** → Postgres (Neon). `POSTGRES_URL` is injected automatically —
   redeploy and every lead, note, territory, and your saved filter view lives
   server-side. Open the app from your phone, laptop, anywhere — same pipeline.

3. **Optional keys** (Project → Settings → Environment Variables):

   | Variable | What it does |
   |---|---|
   | `YELP_API_KEY` | Enables Yelp — recommended, it grades business age by review count. Get one at business.yelp.com (30-day trial). |
   | `GOOGLE_PLACES_API_KEY` | Enables Google Places — definitive website data. |
   | `CRON_SECRET` | Locks the daily-scan endpoint (`openssl rand -hex 32`). Vercel Cron sends it automatically. |
   | `APP_PASSWORD` | Puts a password gate in front of the whole app. |
   | `BIZDATA_BASE_URL` / `OVERPASS_URL` | Override the free endpoints if you self-host them. |
   | `BIZDATA_DISABLED=1` / `OSM_DISABLED=1` | Turn a free source off. |

4. The daily sweep is wired in `vercel.json` (11:00 UTC ≈ 6–7 AM Eastern). Add your
   territories, hit **Scan now** once, and start calling.

## Local development

```bash
npm install
cp .env.example .env.local   # everything optional — free sources work with no keys
npm run dev
```

## How scoring works

Weights live in [`src/lib/scoring.ts`](src/lib/scoring.ts); niche queries, franchise
blocklists, and "not a real website" domains in [`src/lib/niches.ts`](src/lib/niches.ts);
cross-source merging in [`src/lib/merge.ts`](src/lib/merge.ts). The short version:

| Signal | Points |
|---|---|
| No website on file with Google (confirmed) | +30 |
| No website found on any source checked | +22 |
| Only a Facebook/Linktree/free-builder page | +22 |
| Only a brokerage/portal profile (kw.com, realtor.com, …) | +18 |
| Not listed on any review platform checked | +20 |
| 0 / ≤3 / ≤10 / ≤25 combined reviews | +24 / +20 / +15 / +9 |
| Found on only one platform | +6 |
| Phone listed (you can actually reach them) | +6 |
| Missing photos / hours (when Google checked) | +9 / +7 |
| Has a real independent website | −10 |
| Listed on 3+ platforms | −6 |
| 61–150 / 150+ combined reviews | −12 / −25 |

The raw total is normalised against the best case achievable with the sources that were
actually checked, so 80 means the same thing in free-only mode as with every key set.

National franchises (1-800-GOT-JUNK, Junk King, Keller Williams, RE/MAX, …), closed
listings, and off-niche matches are dropped before they reach the list. Re-scans refresh
public data but never touch your pipeline status, notes, or discovery dates, and leads
never duplicate — they dedupe on phone number (falling back to name + town).

## Notes on data use

BizData and Overpass serve OpenStreetMap data under the ODbL (attribution shown in the
app). Yelp and Google data come through their official APIs under your own keys and
their terms — this app deliberately does not scrape either site's HTML. OSM's US
coverage of small-business fields (phone, website) runs roughly 20–40%, which is exactly
why the scanner cross-references multiple sources and marks "no website found" as
unverified until a definitive source confirms it. Check DNC rules before cold-calling,
and keep outreach honest: the suggested openers name a real observed gap, not a fake
audit.
