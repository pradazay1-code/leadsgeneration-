import "server-only";
import { reserve } from "../quota";
import { SourceError, fetchJson } from "../sources/types";

/**
 * Thin Firecrawl client. Two endpoints matter for lead work:
 *
 *  - POST /v2/search  — web search that can also return page content, so one
 *    call does what a search API plus a fetch would take two to do.
 *  - POST /v2/scrape  — fetch one page, optionally running an LLM extraction
 *    against a JSON schema. This is how owner names and emails get pulled off
 *    a business's own site.
 *
 * Firecrawl bills in *credits*, not calls, and structured extraction costs
 * several credits per page. Every method here reserves the credits it is about
 * to spend before spending them, so the budget can't be overrun by a scan that
 * fans out further than expected.
 *
 * Docs: https://docs.firecrawl.dev/features/search and /features/scrape
 */
const BASE = "https://api.firecrawl.dev";

/** Credits Firecrawl charges for an LLM-backed JSON extraction, per page. */
const EXTRACT_CREDIT_COST = 5;

export function firecrawlKey(): string | null {
  return process.env.FIRECRAWL_API_KEY?.trim() || null;
}

export function firecrawlConfigured(): boolean {
  return Boolean(firecrawlKey());
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export interface SearchHit {
  url: string;
  title: string;
  description: string;
  /** Page body, present only when the search asked for content. */
  markdown?: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  // v2 groups results by source; v1 returned a flat array. Both are handled.
  data?:
    | {
        web?: Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
        news?: Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
      }
    | Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
  error?: string;
}

export interface SearchOptions {
  limit?: number;
  /** Free-text locale hint, e.g. "Massachusetts, United States". */
  location?: string;
  /**
   * Google-style recency filter. "qdr:y" = past year, "qdr:m" = past month.
   * This is the cheapest way to bias results toward businesses that only
   * recently started showing up online.
   */
  recency?: "qdr:m" | "qdr:y" | null;
  /** Pull page bodies alongside the result list. Costs more credits. */
  withContent?: boolean;
  signal?: AbortSignal;
}

/**
 * Run one web search. Returns [] rather than throwing when the budget is spent,
 * so a research pass degrades to "found less" instead of failing outright.
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const key = firecrawlKey();
  if (!key) return [];

  const limit = Math.min(opts.limit ?? 10, 20);
  // Roughly one credit per ten results, plus a credit per page when content is
  // attached. Reserve the worst case; unused reservation is simply budget the
  // period doesn't get back, which is the safe direction to err in.
  const credits = Math.max(1, Math.ceil(limit / 10)) + (opts.withContent ? limit : 0);
  const allowed = await reserve("firecrawl_search", credits);
  if (!allowed.ok) return [];

  const body: Record<string, unknown> = {
    query,
    limit,
    sources: ["web"],
  };
  if (opts.location) body.location = opts.location;
  if (opts.recency) body.tbs = opts.recency;
  if (opts.withContent) {
    body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  }

  const res = await fetchJson<FirecrawlSearchResponse>(
    `${BASE}/v2/search`,
    {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
      signal: opts.signal,
      timeoutMs: 45_000,
    },
    "firecrawl",
  );

  const rows = Array.isArray(res.data) ? res.data : (res.data?.web ?? []);
  return rows
    .filter((r): r is { url: string } & typeof r => Boolean(r.url))
    .map((r) => ({
      url: r.url,
      title: r.title?.trim() ?? "",
      description: r.description?.trim() ?? "",
      markdown: r.markdown,
    }));
}

/**
 * What a business page is asked to give up. Kept deliberately small: every
 * field here is one a salesperson would actually use on a first call, and a
 * bigger schema makes the extraction slower, pricier and more prone to drift.
 */
export interface ExtractedBusiness {
  businessName: string | null;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  /** Year the business says it started, when the page claims one. */
  foundedYear: number | null;
  /** Page language suggesting a recent launch ("now open", "just launched"). */
  newBusinessLanguage: boolean | null;
  servicesOffered: string[] | null;
  /** True when the site is a single-page placeholder rather than a real site. */
  looksLikePlaceholder: boolean | null;
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    businessName: { type: "string" },
    ownerName: {
      type: "string",
      description: "Name of the owner, founder or principal agent, if stated",
    },
    email: { type: "string" },
    phone: { type: "string" },
    city: { type: "string" },
    state: { type: "string", description: "Two-letter US state code" },
    foundedYear: {
      type: "number",
      description: "Year the business was founded or started, if stated",
    },
    newBusinessLanguage: {
      type: "boolean",
      description:
        "True if the page describes the business as new, recently opened, newly launched or under new ownership",
    },
    servicesOffered: { type: "array", items: { type: "string" } },
    looksLikePlaceholder: {
      type: "boolean",
      description:
        "True if this is a parked domain, a template with placeholder text, or a single contact page rather than a real business site",
    },
  },
} as const;

const EXTRACT_PROMPT =
  "Extract details about the business whose website this is. Only report values actually stated on the page — leave a field out entirely rather than guessing or inferring it.";

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    json?: Record<string, unknown>;
    markdown?: string;
    metadata?: { title?: string; description?: string; sourceURL?: string; statusCode?: number };
  };
  error?: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/**
 * Scrape one business page and pull structured details out of it.
 *
 * Returns null when the budget is spent or the page can't be read — callers
 * treat that as "no new information", never as "the business has nothing".
 */
export async function extractBusiness(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedBusiness | null> {
  const key = firecrawlKey();
  if (!key) return null;

  const allowed = await reserve("firecrawl_scrape", EXTRACT_CREDIT_COST);
  if (!allowed.ok) return null;

  let res: FirecrawlScrapeResponse;
  try {
    res = await fetchJson<FirecrawlScrapeResponse>(
      `${BASE}/v2/scrape`,
      {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify({
          url,
          onlyMainContent: true,
          formats: [{ type: "json", prompt: EXTRACT_PROMPT, schema: EXTRACT_SCHEMA }],
        }),
        signal,
        timeoutMs: 60_000,
      },
      "firecrawl",
    );
  } catch (err) {
    // A page that won't load is a dead end for this one lead, not a reason to
    // abandon the research pass — unless the key itself is the problem.
    if (err instanceof SourceError && (err.status === 401 || err.status === 402)) throw err;
    return null;
  }

  const json = res.data?.json;
  if (!json) return null;

  const year = num(json.foundedYear);
  return {
    businessName: str(json.businessName),
    ownerName: str(json.ownerName),
    email: str(json.email),
    phone: str(json.phone),
    city: str(json.city),
    state: str(json.state),
    // Guard against an extraction hallucinating a nonsense year.
    foundedYear: year && year >= 1900 && year <= new Date().getUTCFullYear() + 1 ? year : null,
    newBusinessLanguage: bool(json.newBusinessLanguage),
    servicesOffered: Array.isArray(json.servicesOffered)
      ? json.servicesOffered.filter((s): s is string => typeof s === "string").slice(0, 12)
      : null,
    looksLikePlaceholder: bool(json.looksLikePlaceholder),
  };
}
