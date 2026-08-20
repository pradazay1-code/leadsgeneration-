"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Database,
  Globe,
  KeyRound,
  Map,
  RefreshCw,
  Star,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { TIER_META, TIER_ORDER } from "@/lib/scoring";
import { NICHE_LIST } from "@/lib/niches";
import type { LeadStats, ProviderStatus, ScanRunSummary, SourceId } from "@/lib/types";
import { Banner } from "./LeadsWorkspace";
import { SetupChecklist } from "./SetupChecklist";
import { Button, SOURCE_META, Spinner } from "./ui";

interface StatsResponse {
  stats: LeadStats;
  recentScans: ScanRunSummary[];
  providers: ProviderStatus[];
  storeKind: string;
}

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  bizdata: Globe,
  osm: Map,
  geoapify: Map,
  yelp: Star,
  google_places: KeyRound,
};

function StatusLine({
  ok,
  label,
  detail,
  icon: Icon,
  badge,
}: {
  ok: boolean;
  label: string;
  detail: string;
  icon: LucideIcon;
  badge?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-line px-4 py-3.5 first:border-t-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{label}</span>
          {badge ? (
            <span className="rounded border border-line bg-surface-2 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-3">
              {badge}
            </span>
          ) : null}
          {ok ? (
            <CheckCircle2 className="size-3.5 text-brand" />
          ) : (
            <XCircle className="size-3.5 text-amber-400" />
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{detail}</p>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const [meta, setMeta] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load settings");
      setMeta(body as StatsResponse);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Scan failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="panel flex items-center justify-center gap-2 py-20 text-sm text-ink-3">
        <Spinner />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <Banner tone="bad" title="Something went wrong" body={error} onDismiss={() => setError(null)} />
      ) : null}

      <SetupChecklist />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Data sources */}
        <section className="panel overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Data sources</h2>
            <Button size="sm" variant="primary" onClick={scan} disabled={scanning}>
              {scanning ? <Spinner /> : <RefreshCw className="size-3.5" />}
              {scanning ? "Scanning…" : "Run scan now"}
            </Button>
          </header>

          {meta?.providers.map((p) => (
            <StatusLine
              key={p.id}
              icon={PROVIDER_ICONS[p.id] ?? Globe}
              ok={p.configured}
              label={SOURCE_META[p.id as SourceId]?.label ?? p.label}
              badge={p.needsKey ? "key required" : "free"}
              detail={p.detail}
            />
          ))}

          <div className="border-t border-line px-4 py-3">
            <p className="text-[11px] leading-relaxed text-ink-3">
              Business data includes content © OpenStreetMap contributors (ODbL) via BizData and
              Overpass. Yelp data © Yelp — each lead links back to its Yelp page.
            </p>
          </div>
        </section>

        {/* Storage + schedule */}
        <section className="panel h-fit overflow-hidden">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Storage & schedule</h2>
          </header>
          <StatusLine
            icon={Database}
            ok={meta?.storeKind === "postgres"}
            label="Database"
            detail={
              meta?.storeKind === "postgres"
                ? "Postgres connected. Leads, notes, territories, and your saved filter view all live server-side — open the app from any device and it's identical."
                : "In-memory only. Anything you scan or annotate is lost when the server restarts. In Vercel: Storage → Create Database → Postgres, then redeploy — POSTGRES_URL is injected automatically."
            }
          />
          <StatusLine
            icon={Clock}
            ok
            label="Daily scan"
            detail="Vercel Cron hits /api/cron/scan at 11:00 UTC every day and sweeps every enabled territory across all connected sources. Set CRON_SECRET so nobody else can trigger it."
          />
        </section>
      </div>

      {/* Pipeline breakdown */}
      <section className="panel overflow-hidden">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Pipeline breakdown</h2>
        </header>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              By online presence
            </p>
            {TIER_ORDER.map((tier) => {
              const n = meta?.stats.byTier[tier] ?? 0;
              const total = meta?.stats.total || 1;
              return (
                <div key={tier} className="mb-2 last:mb-0">
                  <div className="mb-1 flex justify-between text-[12px]">
                    <span className="text-ink-2">{TIER_META[tier].label}</span>
                    <span className="tabular-nums text-ink-3">{n}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        tier === "none" && "bg-emerald-400",
                        tier === "minimal" && "bg-sky-400",
                        tier === "weak" && "bg-amber-400",
                        tier === "established" && "bg-zinc-600",
                      )}
                      style={{ width: `${Math.round((n / total) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              By industry
            </p>
            {NICHE_LIST.map((n) => (
              <div key={n.id} className="flex justify-between py-1 text-[13px]">
                <span className="text-ink-2">{n.label}</span>
                <span className="tabular-nums text-ink-3">{meta?.stats.byNiche[n.id] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scan history */}
      <section className="panel overflow-hidden">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Recent scans</h2>
        </header>
        {meta?.recentScans.length ? (
          <ul className="divide-y divide-line">
            {meta.recentScans.map((s) => (
              <li key={s.startedAt} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-[13px]">
                <span className="w-24 shrink-0 text-ink-3">{relativeTime(s.startedAt)}</span>
                <span className="text-ink-2">
                  <span className="font-medium text-brand">{s.newLeads}</span> new
                </span>
                <span className="text-ink-3">{s.updatedLeads} refreshed</span>
                <span className="text-ink-3">{s.placesInspected} checked</span>
                <span className="text-ink-3">
                  {s.sourceStats?.length
                    ? s.sourceStats
                        .map((st) => `${SOURCE_META[st.source]?.label ?? st.source} ${st.skipped ? "skipped" : st.returned}`)
                        .join(" · ")
                    : s.sourcesUsed.length
                      ? s.sourcesUsed.map((x) => SOURCE_META[x]?.label ?? x).join(" + ")
                      : "no sources ran"}
                </span>
                {s.errors.length ? (
                  <span className="text-amber-400" title={s.errors.join("\n")}>
                    {s.errors.length} warning{s.errors.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-ink-3">
            No scans have run yet.
          </p>
        )}
      </section>

      {/* How scoring works */}
      <section className="panel overflow-hidden">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">How the score works</h2>
        </header>
        <div className="space-y-3 px-4 py-4 text-[13px] leading-relaxed text-ink-2">
          <p>
            Every business found on any source is merged into one lead (matched by phone number,
            then by name + town) and scored 0–100 on how much it looks like a newer operator who
            hasn&apos;t built a marketing footprint yet. The score is normalised against what the
            connected sources can actually know, so numbers stay comparable as you add keys.
          </p>
          <ul className="space-y-1.5 text-ink-3">
            <li>
              <span className="text-ink-2">No website found</span> is the biggest positive — a
              social page, free site-builder page, or brokerage subdomain counts as almost-none.
            </li>
            <li>
              <span className="text-ink-2">Review count across platforms</span> is the best public
              proxy for business age. Zero-to-five combined reviews scores high; not appearing on
              any review platform at all scores even higher; 100+ is treated as an entrenched
              competitor and scores negative.
            </li>
            <li>
              <span className="text-ink-2">Found on only one platform</span> adds points — nobody
              else lists them yet. Listed everywhere subtracts.
            </li>
            <li>
              <span className="text-ink-2">National chains and large brokerages</span> are dropped
              entirely, along with closed listings and off-niche matches.
            </li>
          </ul>
          <p>Open any lead to see the exact line-by-line breakdown behind its number.</p>
        </div>
      </section>
    </div>
  );
}
