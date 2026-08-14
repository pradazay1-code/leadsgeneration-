"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  RefreshCw,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Spinner } from "./ui";

export interface CheckResult {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "off";
  detail: string;
  ms?: number;
  fix?: string;
}

export interface DiagnosticsReport {
  ranAt: string;
  probeArea: string;
  checks: CheckResult[];
  canFindLeads: boolean;
}

const STATUS_META = {
  ok: { Icon: CheckCircle2, className: "text-brand", label: "Working" },
  warn: { Icon: AlertTriangle, className: "text-amber-400", label: "Needs attention" },
  fail: { Icon: XCircle, className: "text-red-400", label: "Broken" },
  off: { Icon: CircleDashed, className: "text-ink-3", label: "Not set up" },
} as const;

function CheckRow({ check }: { check: CheckResult }) {
  const { Icon, className, label } = STATUS_META[check.status];
  return (
    <li className="flex items-start gap-3 border-t border-line px-4 py-3.5 first:border-t-0">
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{check.label}</span>
          <span className={cn("text-[11px] font-semibold uppercase tracking-wide", className)}>
            {label}
          </span>
          {typeof check.ms === "number" ? (
            <span className="text-[11px] tabular-nums text-ink-3">{check.ms} ms</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{check.detail}</p>
        {check.fix ? (
          <p className="mt-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">Fix: </span>
            {check.fix}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Live system check. Runs a real query against every configured source so a
 * scan that finds nothing always has a visible, specific reason.
 */
export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostics", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Diagnostics failed");
      setReport(body as DiagnosticsReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnostics failed");
    } finally {
      setRunning(false);
    }
  }, []);

  // Auto-run on mount so problems are visible without hunting for a button.
  useEffect(() => {
    void run();
  }, [run]);

  const broken = report?.checks.filter((c) => c.status === "fail" || c.status === "off") ?? [];

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Stethoscope className="size-4 text-ink-3" />
          <h2 className="text-sm font-semibold text-ink">System check</h2>
          {report ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                report.canFindLeads
                  ? "bg-brand/15 text-brand"
                  : "bg-amber-500/15 text-amber-300",
              )}
            >
              {report.canFindLeads ? "Ready to find leads" : `${broken.length} thing(s) to fix`}
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="subtle" onClick={run} disabled={running}>
          {running ? <Spinner /> : <RefreshCw className="size-3.5" />}
          {running ? "Testing…" : "Re-test"}
        </Button>
      </header>

      {running && !report ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3">
          <Spinner />
          Running a live test query against every source…
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-[13px] text-red-400">{error}</p>
      ) : report ? (
        <>
          {!compact ? (
            <p className="border-b border-line px-4 py-2.5 text-[12px] text-ink-3">
              Each source was probed with a real search near{" "}
              <span className="text-ink-2">{report.probeArea}</span>.
            </p>
          ) : null}
          <ul>
            {report.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
