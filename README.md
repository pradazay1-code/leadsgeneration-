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

## The two keys that matter

There is **no Google dependency anywhere in this app.** Discovery runs on Mapbox, plus a
web-research pass, plus free supplements.

| Source | Cost | What it does |
|---|---|---|
| **Mapbox Search Box** | Free: 25,000 searches/month | **Your main source.** Free-text POI search returning phone + website. Also powers the geocoder every radius search needs. |
| **Brave Search** | Free: 2,000 queries/month | **Deep web research.** Finds businesses no map contains, and confirms a business genuinely has no website. |
| Geoapify | Free: 3,000/day | Backup geocoder + an OSM-derived place source. |
| BizData | Free, no key | Real-estate only, thin OSM coverage. Supplement. |
| OpenStreetMap Overpass | Free, no key | Few US service businesses are mapped. Supplement. |
| Yelp Fusion | Trial, then **pay-per-call** | Best review counts. **Ships disabled** — see below. |

Be realistic about the keyless sources on their own. OpenStreetMap-derived data (BizData,
Overpass, Geoapify) covers roughly **20–40% of US small businesses**, and junk removal
companies are barely mapped at all — most are one truck and a phone number nobody has
added to OSM. Mapbox and Brave are what make the daily scan actually productive.

### Mapbox — the main source

1. [console.mapbox.com](https://console.mapbox.com/account/access-tokens/) → copy your
   **default public token** (`pk....`). No extra scopes needed.
2. Vercel → Settings → Environment Variables → `MAPBOX_ACCESS_TOKEN` → **Redeploy**
   (env vars only take effect on a new deployment).

Two things make Mapbox the right primary. Its search is *free-text* — the app asks for
"junk removal" directly, so there's no category taxonomy to guess wrong. And it returns a
website when it knows of one, so **"no website" from Mapbox is evidence, not a gap** —
which is the heaviest single signal in the score.

### Brave Search — the research pass

1. [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com/app/keys) →
   free "Data for Search" plan → create a key.
2. Add it as `BRAVE_API_KEY` and redeploy.

Map data can only ever tell you "no website *in my dataset*". A web search tells you
whether one exists at all. That's the difference between a guess and a qualified lead, so
the scarce 2,000/month budget is spent on verification first and bulk discovery second.

### Yelp is off on purpose

Yelp Fusion bills per call once the 30-day trial ends, so its cap ships at **0** — adding
`YELP_API_KEY` alone will not turn it on. Raise `YELP_MONTHLY_CAP` deliberately if you
decide to pay for it.

---

## Staying inside the free tiers

Every outbound API call is counted in Postgres, and budget is **reserved before the call
is made**, not after. That ordering is the whole mechanism: if usage were recorded after
the response came back, two scans running at once would each read the same pre-call total
and sail past the cap together.

- Caps default to about **80% of each vendor's free tier**, leaving headroom for calls the
  vendor counts but this app never sees (retries, redirects).
- Both a **monthly** and a **daily** ceiling apply, so one runaway day can't eat the month.
- Hitting a cap **pauses that one source** for the rest of the period. The scan carries on
  with whatever still has budget and tells you which source was paused and why — it does
  not fail, and it does not spill into paid usage.
- Live counters, caps, and reset dates are on **Settings → API usage**.
- Every cap is overridable by env var (see `.env.example`) if you want a tighter budget.

The enforcement logic is covered by tests: `npm test`.

## Setup

1. **Import to Vercel** — framework auto-detects as Next.js, nothing to configure.
2. **Add Postgres** — Vercel → Storage → Create Database → Postgres. `POSTGRES_URL` is
   injected automatically. **Without this, scanned leads vanish**: serverless requests
   hit different machines, so in-memory leads disappear the moment you reload. The API
   usage counters live here too, so the spend caps also need it to hold across requests.
3. **Add `MAPBOX_ACCESS_TOKEN`** and **`BRAVE_API_KEY`** (see above). Optionally
   `GEOAPIFY_API_KEY`.
4. **Redeploy.**
5. Open **Settings → System check**. It runs a live test query against every source and
   tells you what's still broken and how to fix it. Everything should read *Working*.
6. Add a territory ("Norwood, MA"), hit **Scan now**.

Other env vars: `CRON_SECRET` (locks the daily scan endpoint — `openssl rand -hex 32`),
`APP_PASSWORD` (password-gates the whole app), `BIZDATA_DISABLED=1` / `OSM_DISABLED=1`.

## When a scan finds nothing

The scan result banner shows a **per-source breakdown** (`Mapbox: 42 listings · Web
research: 6 · OpenStreetMap: 0`), so a zero is never silent. Common causes:

- **No source connected** — the banner says so outright. Add the Mapbox token.
- **Only keyless sources connected** — expect very few hits, especially for junk removal.
- **A source is paused on quota** — the banner names it and says when it resets. Check
  Settings → API usage.
- **Town not recognised** — use `Town, ST` format.
- **Everything filtered out** — the banner says "found N listings but none cleared the
  bar". Those were established businesses or franchises. Drop the minimum score slider
  to see them.
- **Time budget reached** — scans stop cleanly at ~45s (Vercel's function ceiling) and
  save what they found. Run again, or split big territories into individual towns.

## Outreach sequences

Multi-touch cadences run themselves. Two ship by default: a phone-led 5-touch for
owner-operators, and a fast-track for leads with no website at all.

- **Steps become tasks by default.** Call steps always do. Email and SMS steps do too,
  with the message already written, unless you connect a sender.
- **Connect a sender to automate.** `RESEND_API_KEY` + `OUTREACH_FROM_EMAIL` for email,
  Twilio credentials for SMS. Steps then send themselves and log to the timeline.
- **Merge fields** are filled per lead. `{{gap}}` is the one that matters — it writes out
  that specific business's biggest weakness in plain English ("I couldn't find a website
  for you on any of the map or search listings", "you've only got 2 reviews so far"),
  which is why these read as observations rather than spam.
- **Guardrails, always on:** no sends to do-not-contact leads, cadences stop the moment a
  lead is marked won/lost/ignored, nothing goes out on Sundays or outside 8am–7pm local,
  and a per-run cap (`OUTREACH_DAILY_CAP`, default 50) means a misconfigured sequence
  can't blast a whole territory. Failed sends defer and retry rather than skipping a touch.
- Steps fire via cron three times a day, so anything deferred outside business hours gets
  picked up. You can also hit **Run due steps now** on the Sequences page.

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
- **API usage** — live counters against every free-tier cap, with reset dates, so you can
  see exactly how much budget a scan spent before it spends any more.

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
| No website found by a source that would know — Mapbox or web search (confirmed) | +30 |
| No website found on any source checked | +22 |
| Only a Facebook/Linktree/free-builder page | +22 |
| Only a brokerage/portal profile (kw.com, realtor.com, …) | +18 |
| Not listed on any review platform checked | +20 |
| 0 / ≤3 / ≤10 / ≤25 combined reviews | +24 / +20 / +15 / +9 |
| Found on only one platform | +6 |
| Phone listed | +6 |
| Missing photos / hours (only when a source reported them) | +9 / +7 |
| Has a real independent website | −10 |
| Listed on 3+ platforms | −6 |
| 61–150 / 150+ combined reviews | −12 / −25 |

Franchises (1-800-GOT-JUNK, Junk King, Keller Williams, RE/MAX, …), closed listings, and
off-niche matches are dropped before scoring. Re-scans refresh public data but never
touch your pipeline status, notes, or discovery dates; leads dedupe on phone number,
falling back to name + town.

## Data use

Every source is an **official API used under your own key and that vendor's terms** —
this app scrapes no website. OpenStreetMap-derived data (Mapbox, Geoapify, BizData,
Overpass) is ODbL, attributed in the app. Check DNC rules before cold-calling, and keep
outreach honest: the suggested openers name a real observed gap, not a fake audit.
