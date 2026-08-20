"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GripVertical, Phone, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime, telHref } from "@/lib/format";
import type { PipelineWithStages } from "@/lib/crm/types";
import type { Lead } from "@/lib/types";
import { Banner } from "./LeadsWorkspace";
import { Button, ScoreBar, SourceBadges, Spinner } from "./ui";

/** Cents → "$1.2k" / "$450". Compact because it sits in a card header. */
export function money(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

interface BoardData {
  pipelines: PipelineWithStages[];
  leads: Lead[];
}

function LeadCard({
  lead,
  onDragStart,
  onOpen,
  dragging,
}: {
  lead: Lead;
  onDragStart: () => void;
  onOpen: () => void;
  dragging: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={cn(
        "group cursor-pointer rounded-lg border border-line bg-surface-2 p-3 transition-colors",
        "hover:border-line-strong hover:bg-surface-3",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 cursor-grab text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{lead.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-ink-3">
            {lead.city ? `${lead.city}${lead.state ? `, ${lead.state}` : ""}` : "—"}
            {lead.valueCents > 0 ? ` · ${money(lead.valueCents)}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-2 pl-5">
        <ScoreBar score={lead.score} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
        <SourceBadges sources={lead.sources} />
        {lead.phone ? (
          <a
            href={telHref(lead.phone)}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-brand focus-ring"
          >
            <Phone className="size-3" />
            {lead.phone}
          </a>
        ) : null}
      </div>

      {lead.nextActionAt ? (
        <p
          className={cn(
            "mt-2 pl-5 text-[11px]",
            Date.parse(lead.nextActionAt) < Date.now() ? "text-amber-400" : "text-ink-3",
          )}
        >
          Next: {relativeTime(lead.nextActionAt)}
        </p>
      ) : null}
    </div>
  );
}

export function PipelineBoard({ onOpenLead }: { onOpenLead: (lead: Lead) => void }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, lRes] = await Promise.all([
        fetch("/api/pipelines", { cache: "no-store" }),
        // The board wants everything regardless of score, ordered by value.
        fetch("/api/leads?minScore=0&limit=500&sort=score_desc", { cache: "no-store" }),
      ]);
      const pBody = await pRes.json();
      const lBody = await lRes.json();
      if (!pRes.ok) throw new Error(pBody.error ?? "Failed to load pipelines");
      if (!lRes.ok) throw new Error(lBody.error ?? "Failed to load leads");

      setData({ pipelines: pBody.pipelines, leads: lBody.rows });
      setPipelineId((prev) => prev ?? pBody.pipelines[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pipeline = useMemo(
    () => data?.pipelines.find((p) => p.id === pipelineId) ?? data?.pipelines[0] ?? null,
    [data, pipelineId],
  );

  /** Move a lead to another stage, optimistically. */
  const moveLead = useCallback(
    async (leadId: string, stageId: string) => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              leads: prev.leads.map((l) =>
                l.id === leadId ? { ...l, stageId, pipelineId: pipeline?.id ?? l.pipelineId } : l,
              ),
            }
          : prev,
      );
      try {
        const res = await fetch(`/api/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId, pipelineId: pipeline?.id ?? null }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Move failed");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not move that lead");
        void load();
      }
    },
    [pipeline, load],
  );

  if (loading && !data) {
    return (
      <div className="panel flex items-center justify-center gap-2 py-24 text-sm text-ink-3">
        <Spinner />
        Loading the board…
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="panel px-6 py-16 text-center text-sm text-ink-3">
        No pipelines yet. They&apos;re created automatically on first run — try reloading.
      </div>
    );
  }

  const leadsForPipeline = data?.leads ?? [];

  return (
    <div className="space-y-4">
      {error ? (
        <Banner tone="bad" title="Something went wrong" body={error} onDismiss={() => setError(null)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {data?.pipelines.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPipelineId(p.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-ring",
                p.id === pipeline.id
                  ? "border-brand/50 bg-brand/15 text-brand"
                  : "border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        <Button size="sm" variant="subtle" onClick={load} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3" style={{ minWidth: `${pipeline.stages.length * 270}px` }}>
          {pipeline.stages.map((stage) => {
            const stageLeads = leadsForPipeline.filter((l) => l.stageId === stage.id);
            const value = stageLeads.reduce((n, l) => n + l.valueCents, 0);

            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage.id);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverStage(null);
                  if (draggingId) void moveLead(draggingId, stage.id);
                  setDraggingId(null);
                }}
                className={cn(
                  "flex w-[258px] shrink-0 flex-col rounded-xl border bg-surface transition-colors",
                  overStage === stage.id ? "border-brand/50 bg-brand/5" : "border-line",
                )}
              >
                <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{stage.name}</p>
                    <p className="text-[11px] text-ink-3">
                      {stageLeads.length} lead{stageLeads.length === 1 ? "" : "s"}
                      {value > 0 ? ` · ${money(value)}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      stage.isWon
                        ? "bg-brand/15 text-brand"
                        : stage.isLost
                          ? "bg-red-500/10 text-red-300"
                          : "bg-surface-3 text-ink-3",
                    )}
                  >
                    {stage.probability}%
                  </span>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ maxHeight: "62vh" }}>
                  {stageLeads.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[11px] text-ink-3">
                      Drop leads here
                    </p>
                  ) : (
                    stageLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        dragging={draggingId === lead.id}
                        onDragStart={() => setDraggingId(lead.id)}
                        onOpen={() => onOpenLead(lead)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
