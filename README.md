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
| **Mapbox Search Box** | Free: 25,000 searches/month | **Your map layer.** Free-text POI search returning phone + website. Also powers the geocoder every radius search needs. |
| **Firecrawl** | Free: 500 credits, then paid | **The deep research agent.** Finds businesses no map contains, and the only source that returns **owner names**. |
| **Brave Search** | Free: 2,000 queries/month | Cheap web verification — confirms a business genuinely has no website. |
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

### Firecrawl — the deep research agent

1. [firecrawl.dev](https://firecrawl.dev) → dashboard → API keys (starts with `fc-`).
2. Add it as `FIRECRAWL_API_KEY` and redeploy.

This is the part that finds the businesses nobody else is calling. A plain search for
"junk removal Norwood MA" returns the same ten established companies every time — the
ones with an SEO budget, which is exactly the wrong end of the market. So the agent
searches from six angles per territory instead:

| Angle | What it catches |
|---|---|
| Launch language — *"now open"*, *"just launched"* | Businesses in their first months |
| `site:facebook.com` | Operators whose only presence is a Facebook page |
| Independent sites, portals excluded | Real businesses buried under Yelp and Angi |
| Pages published in the last month | Write-ups and listings too new to rank |
| Adjacent service terms | Operators who describe themselves differently |
| Hiring posts | Businesses trading and growing with no website at all |

Then, **before spending anything**, it discards every result that is already one of your
leads, already researched in a previous run, or a directory/franchise page. Only the
survivors get read — and that read is what pulls **owner name, email, phone and founding
year** off the business's own site.

### Brave Search — cheap verification

1. [api-dashboard.search.brave.com](https://api-dashboard.search.brave.com/app/keys) →
   free "Data for Search" plan → create a key.
2. Add it as `BRAVE_API_KEY` and redeploy.

Map data can only ever tell you "no website *in my dataset*". A web search tells you
whether one exists at all. That's the difference between a guess and a qualified lead, so
the scarce 2,000/month budget is spent on verification first and bulk discovery second.

## Why you don't get the same leads twice

Two mechanisms, and they solve different halves of the problem.

**Identity.** A business doesn't have one key, it has several — phone number, website
domain, and name+city. Any shared key means the same business, and matching is
*transitive*: a map listing with only a phone, a research hit with that phone and a
domain, and a directory entry with only that domain all collapse into one lead. Every key
a lead has ever matched on is stored, so a hauler found this week under just a name and
next week with a phone number lands on the same row instead of arriving as a fresh lead.

Shared hosts are never identities — two businesses both having a Facebook page doesn't
make them one business.

The known limit: a business that changes its trading name *and* has no phone or domain in
common between the two sightings won't be matched. Matching on name similarity alone
would risk merging two genuinely different local operators, which loses a real lead
silently — a worse failure than showing you a duplicate.

**The research registry.** Every URL the agent looks at is recorded with its outcome,
including the rejections. A page is never read twice, and the dead ends stay dead. The
scan banner shows the funnel — how many results were skipped as already yours, already
researched, or directory noise — so you can see the filtering working.

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
- Firecrawl is metered in **credits, not calls** — a search is ~1, an extraction ~5 — and
  its search and scrape budgets draw on one shared pool, so their two caps are sized to
  *sum* to the free 500 rather than each fitting under it separately. On a paid plan,
  raise both together.
- Both a **monthly** and a **daily** ceiling apply, so one runaway day can't eat the month.
- Hitting a cap **pauses that one source** for the rest of the period. The scan carries on
  with whatever still has budget and tells you which source was paused and why — it does
  not fail, and it does not spill into paid usage.
- Live counters, caps, and reset dates are on **Settings → API usage**.
- Every cap is overridable by env var (see `.env.example`) if you want a tighter budget.

Enforcement is covered by tests, including the concurrency case: `npm test`.

## Tests

```bash
npm test     # 122 tests, no dependencies beyond Node
```

`tests/provider-contracts.test.ts` intercepts `fetch` and asserts the exact URL,
method, auth header and parameter names each provider builds against what the vendor
documents. It can't prove a vendor accepts the request, but it catches the failure that
has actually bitten this project: a correctly-formed request sent to the wrong parameter
name, which comes back empty and looks identical to "there are no businesses here".

`tests/scan.e2e.test.ts` drives the **real** `runScan` against the **real** store —
merging, identity, scoring, franchise rejection, quota benching, persistence and re-scan
behaviour are all production code. Only the providers are stand-ins, since the third-party
APIs are the one part CI can't reach and the least likely thing to be wrong; the bugs live
in how their results get combined.

A resolver hook (`tests/ts-resolver.mjs`) teaches Node's test runner the extensionless
imports and `@/` alias that Next's bundler handles, so the tests import the shipping
modules rather than a copy of them.

## Setup

1. **Import to Vercel** — framework auto-detects as Next.js, nothing to configure.
2. **Add Postgres** — Vercel → Storage → Create Database → Postgres. `POSTGRES_URL` is
   injected automatically. **Without this, scanned leads vanish**: serverless requests
   hit different machines, so in-memory leads disappear the moment you reload. The API
   usage counters live here too, so the spend caps also need it to hold across requests.
3. **Add `MAPBOX_ACCESS_TOKEN`**, **`FIRECRAWL_API_KEY`** and **`BRAVE_API_KEY`** (see
   above). Optionally `GEOAPIFY_API_KEY`.
4. **Redeploy.**
5. Open **Settings → System check**. It runs a live test query against every source and
   tells you what's still broken and how to fix it. Everything should read *Working*.
   It also lists which env var names the running app can actually see, and shows a
   redacted sample of what each provider returned — a source that comes back empty is
   otherwise indistinguishable from one being parsed wrongly. **Copy report** puts all
   of it on the clipboard, with API keys stripped, for sharing when something's wrong.
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
  save what they found. Sources are queried concurrently and territories are scanned
  least-recently-first, so consecutive runs work through the whole list rather than
  restarting on the same few towns.
- **Out of area** — results are filtered to the territory radius. Mapbox's proximity
  only *biases* results, so a search near Norwood really does return businesses from
  across the state; the banner names anything dropped and how far away it was.

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
- **Owner details** — where deep research found them: owner or principal's name, direct
  email, and the year the business started, shown on the lead's drawer.

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
| No website found by a source that would know — Mapbox, research or web search | +30 |
| Started trading this year or last (stated on their own site) | +26 |
| Started trading within 3 years | +16 |
| Describes itself as newly opened / just launched | +18 |
| Trading 12+ years — long established | −18 |
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
