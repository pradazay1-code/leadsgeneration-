"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Filter,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  SearchX,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_FILTERS,
  loadFilters,
  saveFilters,
  toQuery,
  type FilterState,
} from "@/lib/filterState";
import type { Lead, LeadStats, LeadStatus, ScanRunSummary } from "@/lib/types";
import { FilterRail } from "./FilterRail";
import { LeadDrawer } from "./LeadDrawer";
import { LeadTable, SortSelect } from "./LeadTable";
import { StatRow } from "./StatRow";
import { Button, Chip, EmptyState, Spinner } from "./ui";

interface LeadsResponse {
  rows: Lead[];
  total: number;
  facets: { states: string[]; cities: string[] };
  storeKind: string;
}

interface StatsResponse {
  stats: LeadStats;
  recentScans: ScanRunSummary[];
  demoData: boolean;
  placesConfigured: boolean;
  storeKind: string;
}

const PRESETS: Array<{ label: string; hint: string; patch: Partial<FilterState> }> = [
  {
    label: "Best fit",
    hint: "The default view — newer businesses with thin online presence",
    patch: { ...DEFAULT_FILTERS },
  },
  {
    label: "No website",
    hint: "Businesses with no site at all",
    patch: { hasWebsite: false, minScore: 0 },
  },
  {
    label: "Brand new",
    hint: "Five reviews or fewer",
    patch: { maxReviews: 5, minScore: 0 },
  },
  {
    label: "Untouched",
    hint: "Nobody has reached out yet",
    patch: { statuses: ["new"] },
  },
  {
    label: "Found this week",
    hint: "Discovered in the last seven days",
    patch: { withinDays: 7 },
  },
];

/** Shallow equality against the parts of a preset we care about. */
function presetActive(filters: FilterState, patch: Partial<FilterState>): boolean {
  return (Object.keys(patch) as Array<keyof FilterState>).every((key) => {
    const want = patch[key];
    const have = filters[key];
    if (Array.isArray(want) && Array.isArray(have)) {
      return want.length === have.length && want.every((v) => (have as unknown[]).includes(v));
    }
    return want === have;
  });
}

export function LeadsWorkspace() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [meta, setMeta] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanRunSummary | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);

  const requestId = useRef(0);

  // Restore the last-used filter set and rail state on first paint.
  useEffect(() => {
    setFilters(loadFilters());
    try {
      setRailOpen(window.localStorage.getItem("leadsignal.rail") !== "closed");
    } catch {
      // Ignore storage failures.
    }
    setHydrated(true);
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((open) => {
      try {
        window.localStorage.setItem("leadsignal.rail", open ? "closed" : "open");
      } catch {
        // Ignore storage failures.
      }
      return !open;
    });
  }, []);

  const query = useMemo(() => toQuery(filters).toString(), [filters]);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (res.ok) setMeta((await res.json()) as StatsResponse);
    } catch {
      // Stats are decorative; a failure here shouldn't block the table.
    }
  }, []);

  // Debounced fetch whenever the filters change.
  useEffect(() => {
    if (!hydrated) return;
    saveFilters(filters);

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/leads?${query}`, { cache: "no-store" });
        const body = await res.json();
        if (id !== requestId.current) return;

        if (!res.ok) throw new Error(body.error ?? "Failed to load leads");
        setData(body as LeadsResponse);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : "Failed to load leads");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, hydrated, filters]);

  useEffect(() => {
    if (hydrated) void loadMeta();
  }, [hydrated, loadMeta]);

  const patchLead = useCallback(
    async (id: string, patch: { status?: LeadStatus; notes?: string }) => {
      // Optimistic — the pipeline chips should feel instant.
      setData((prev) =>
        prev
          ? { ...prev, rows: prev.rows.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
          : prev,
      );
      setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));

      try {
        const res = await fetch(`/api/leads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
        void loadMeta();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    },
    [loadMeta],
  );

  const deleteLead = useCallback(
    async (id: string) => {
      setData((prev) =>
        prev ? { ...prev, rows: prev.rows.filter((l) => l.id !== id), total: prev.total - 1 } : prev,
      );
      try {
        await fetch(`/api/leads/${id}`, { method: "DELETE" });
        void loadMeta();
      } catch {
        setError("Could not remove that lead");
      }
    },
    [loadMeta],
  );

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Scan failed");
      setScanResult(body.summary as ScanRunSummary);
      requestId.current += 1;
      const refreshed = await fetch(`/api/leads?${query}`, { cache: "no-store" });
      if (refreshed.ok) setData((await refreshed.json()) as LeadsResponse);
      void loadMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [query, loadMeta]);

  const rows = data?.rows ?? [];
  const facets = data?.facets ?? { states: [], cities: [] };

  const rail = (
    <FilterRail
      filters={filters}
      onChange={setFilters}
      onReset={() => setFilters(DEFAULT_FILTERS)}
      facets={facets}
      resultCount={data?.total ?? 0}
    />
  );

  return (
    <div className="space-y-5">
      {/* Environment banners */}
      {meta && !meta.placesConfigured ? (
        <Banner
          tone="warn"
          title="Running on sample data"
          body="No Google Places API key is set, so the daily scan can't run yet. Every lead below is fictional placeholder data. Add GOOGLE_PLACES_API_KEY in Settings to start finding real businesses."
        />
      ) : null}

      {meta?.placesConfigured && meta.storeKind === "memory" ? (
        <Banner
          tone="warn"
          title="Leads aren't being saved"
          body="No database is connected, so scanned leads live in memory and disappear when the server restarts. Connect a Postgres database (POSTGRES_URL) to keep your pipeline."
        />
      ) : null}

      {scanResult ? (
        <Banner
          tone={scanResult.errors.length ? "warn" : "good"}
          title={
            scanResult.demoMode
              ? "Scan skipped"
              : `Scan finished — ${scanResult.newLeads} new, ${scanResult.updatedLeads} refreshed`
          }
          body={
            scanResult.errors.length
              ? scanResult.errors.slice(0, 3).join(" · ")
              : `Checked ${scanResult.placesInspected} businesses across ${scanResult.territoriesScanned} territor${scanResult.territoriesScanned === 1 ? "y" : "ies"}. ${scanResult.skipped} filtered out as too established or off-niche.`
          }
          onDismiss={() => setScanResult(null)}
        />
      ) : null}

      {error ? (
        <Banner tone="bad" title="Something went wrong" body={error} onDismiss={() => setError(null)} />
      ) : null}

      {meta ? (
        <StatRow
          stats={meta.stats}
          onFilterUntouched={() => setFilters((f) => ({ ...f, statuses: ["new"] }))}
          onFilterNoWebsite={() => setFilters((f) => ({ ...f, hasWebsite: false, minScore: 0 }))}
          onFilterThisWeek={() => setFilters((f) => ({ ...f, withinDays: 7 }))}
        />
      ) : null}

      {/* Presets + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <Chip
              key={p.label}
              active={presetActive(filters, p.patch)}
              onClick={() => setFilters((f) => ({ ...f, ...p.patch }))}
              title={p.hint}
            >
              {p.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SortSelect value={filters.sort} onChange={(sort) => setFilters((f) => ({ ...f, sort }))} />
          <Button
            size="sm"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setMobileFiltersOpen((v) => !v)}
          >
            <Filter className="size-3.5" />
            Filters
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="hidden lg:inline-flex"
            onClick={toggleRail}
            title={railOpen ? "Hide the filter panel for a wider table" : "Show the filter panel"}
          >
            {railOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            {railOpen ? "Hide filters" : "Filters"}
          </Button>
          <a href={`/api/leads/export?${query}`} className="focus-ring">
            <Button size="sm" variant="subtle" tabIndex={-1}>
              <Download className="size-3.5" />
              Export CSV
            </Button>
          </a>
          <Button size="sm" variant="primary" onClick={runScan} disabled={scanning}>
            {scanning ? <Spinner /> : <RefreshCw className="size-3.5" />}
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-5",
          railOpen && "lg:grid-cols-[248px_minmax(0,1fr)]",
        )}
      >
        <div
          className={cn(
            mobileFiltersOpen ? "block" : "hidden",
            railOpen ? "lg:block" : "lg:hidden",
          )}
        >
          {rail}
        </div>

        <div className="panel min-h-[420px] overflow-hidden">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-3">
              <Spinner />
              Loading leads…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title="No leads match these filters"
              description="Loosen the score threshold or clear a filter or two. If the pipeline is empty entirely, add a territory and run a scan."
              action={
                <Button variant="subtle" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Reset filters
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                <span className="text-[13px] text-ink-3">
                  Showing <span className="font-medium text-ink-2">{rows.length}</span> of{" "}
                  <span className="font-medium text-ink-2">{data?.total ?? 0}</span> leads
                </span>
                {loading ? <Spinner className="text-ink-3" /> : null}
              </div>
              <LeadTable leads={rows} selectedId={selected?.id ?? null} onSelect={setSelected} />
              {data && data.total > rows.length ? (
                <div className="border-t border-line px-4 py-3 text-center text-[12px] text-ink-3">
                  Showing the first {rows.length}. Narrow the filters or export to CSV for the
                  full {data.total}.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {selected ? (
        <LeadDrawer
          lead={rows.find((l) => l.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onPatch={patchLead}
          onDelete={deleteLead}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Banner */

const BANNER_TONES = {
  good: { wrap: "border-brand/30 bg-brand/10", icon: "text-brand", Icon: Sparkles },
  warn: { wrap: "border-amber-500/30 bg-amber-500/10", icon: "text-amber-300", Icon: AlertTriangle },
  bad: { wrap: "border-red-500/30 bg-red-500/10", icon: "text-red-300", Icon: AlertTriangle },
} as const;

export function Banner({
  tone,
  title,
  body,
  onDismiss,
}: {
  tone: keyof typeof BANNER_TONES;
  title: string;
  body: string;
  onDismiss?: () => void;
}) {
  const { wrap, icon, Icon } = BANNER_TONES[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", wrap)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{body}</p>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-ink-3 transition-colors hover:text-ink focus-ring"
          aria-label="Dismiss"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
