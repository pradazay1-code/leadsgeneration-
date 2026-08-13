"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { NICHE_LIST } from "@/lib/niches";
import { relativeTime } from "@/lib/format";
import type { NicheId, ScanRunSummary, Territory } from "@/lib/types";
import { Banner } from "./LeadsWorkspace";
import { Button, Chip, EmptyState, Label, Spinner, inputClass } from "./ui";

export function TerritoryManager() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanRunSummary | null>(null);

  const [area, setArea] = useState("");
  const [label, setLabel] = useState("");
  const [niches, setNiches] = useState<NicheId[]>(["junk_removal", "real_estate"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/territories", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load territories");
      setTerritories(body.territories as Territory[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load territories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!area.trim() || !niches.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/territories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area: area.trim(), label: label.trim() || area.trim(), niches }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not add that territory");
      setArea("");
      setLabel("");
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that territory");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: Territory) => {
    setTerritories((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)));
    await fetch(`/api/territories/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    void load();
  };

  const remove = async (t: Territory) => {
    setTerritories((prev) => prev.filter((x) => x.id !== t.id));
    await fetch(`/api/territories/${t.id}`, { method: "DELETE" });
    void load();
  };

  const scanOne = async (t: Territory) => {
    setScanningId(t.id);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ territoryIds: [t.id] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Scan failed");
      setScanResult(body.summary as ScanRunSummary);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanningId(null);
    }
  };

  return (
    <div className="space-y-5">
      {error ? (
        <Banner tone="bad" title="Something went wrong" body={error} onDismiss={() => setError(null)} />
      ) : null}

      {scanResult ? (
        <Banner
          tone={scanResult.errors.length ? "warn" : "good"}
          title={
            scanResult.demoMode
              ? "Scan skipped — no Places API key configured"
              : `Scan finished — ${scanResult.newLeads} new, ${scanResult.updatedLeads} refreshed`
          }
          body={
            scanResult.errors.length
              ? scanResult.errors.slice(0, 3).join(" · ")
              : `Checked ${scanResult.placesInspected} businesses, filtered out ${scanResult.skipped}.`
          }
          onDismiss={() => setScanResult(null)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* List */}
        <div className="panel overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-ink-3">
              <Spinner />
              Loading…
            </div>
          ) : territories.length === 0 ? (
            <EmptyState
              icon={<MapPin className="size-5" />}
              title="No territories yet"
              description="A territory is a town plus the industries you want swept there. The daily scan walks every enabled territory each morning."
            />
          ) : (
            <ul className="divide-y divide-line">
              {territories.map((t) => (
                <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "font-medium",
                          t.enabled ? "text-ink" : "text-ink-3 line-through",
                        )}
                      >
                        {t.label}
                      </span>
                      {t.niches.map((n) => (
                        <span
                          key={n}
                          className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-3"
                        >
                          {NICHE_LIST.find((x) => x.id === n)?.shortLabel ?? n}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-[13px] text-ink-3">
                      Searching “{t.area}” ·{" "}
                      {t.lastScannedAt ? `last swept ${relativeTime(t.lastScannedAt)}` : "never swept"}
                      {t.leadsFound > 0 ? ` · ${t.leadsFound} hits so far` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => scanOne(t)}
                      disabled={scanningId === t.id}
                      title="Scan just this territory now"
                    >
                      {scanningId === t.id ? <Spinner /> : <RefreshCw className="size-3.5" />}
                      Scan
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle(t)}
                      title={t.enabled ? "Pause daily scanning" : "Resume daily scanning"}
                    >
                      <Power className={cn("size-3.5", t.enabled ? "text-brand" : "text-ink-3")} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(t)} title="Delete">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add form */}
        <form onSubmit={create} className="panel h-fit p-4">
          <h2 className="mb-4 text-sm font-semibold text-ink">Add a territory</h2>

          <div className="mb-4">
            <Label htmlFor="area">Town or area</Label>
            <input
              id="area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Norwood, MA"
              className={inputClass}
              required
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
              Use “Town, ST”. One town per territory gives tighter results than a whole county.
            </p>
          </div>

          <div className="mb-4">
            <Label htmlFor="label">Nickname (optional)</Label>
            <input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="South Shore run"
              className={inputClass}
            />
          </div>

          <div className="mb-5">
            <Label>Industries to sweep</Label>
            <div className="flex flex-wrap gap-1.5">
              {NICHE_LIST.map((n) => (
                <Chip
                  key={n.id}
                  active={niches.includes(n.id)}
                  onClick={() =>
                    setNiches((prev) =>
                      prev.includes(n.id) ? prev.filter((x) => x !== n.id) : [...prev, n.id],
                    )
                  }
                >
                  {n.shortLabel}
                </Chip>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={saving || !area.trim() || !niches.length}
          >
            {saving ? <Spinner /> : <Plus className="size-4" />}
            Add territory
          </Button>
        </form>
      </div>
    </div>
  );
}
