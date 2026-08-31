"use client";

import { Gauge } from "lucide-react";
import { cn } from "@/lib/cn";

export interface QuotaState {
  key: string;
  label: string;
  monthlyUsed: number;
  dailyUsed: number;
  monthlyCap?: number;
  dailyCap?: number;
  blocked: boolean;
  blockedReason?: string;
  utilisation: number;
  freeTierNote: string;
  resetsDaily: string;
  resetsMonthly: string;
}

function Bar({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          pct >= 100 ? "bg-red-400" : pct >= 75 ? "bg-amber-400" : "bg-brand",
        )}
        style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

/**
 * Live API budget. Every provider call is counted before it goes out, and a
 * provider is skipped entirely once its cap is hit — the caps sit below each
 * vendor's free tier so usage can't spill into billing.
 */
export function QuotaPanel({ quotas }: { quotas: QuotaState[] }) {
  const inUse = quotas.filter((q) => q.monthlyUsed > 0 || q.dailyUsed > 0 || q.blocked);
  const shown = inUse.length ? inUse : quotas.slice(0, 5);

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Gauge className="size-4 text-ink-3" />
        <h2 className="text-sm font-semibold text-ink">API budget</h2>
        <span className="text-[11px] text-ink-3">Hard caps, set below each free tier</span>
      </header>

      <ul className="divide-y divide-line">
        {shown.map((q) => (
          <li key={q.key} className="px-4 py-3">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-ink">{q.label}</span>
              {q.blocked ? (
                <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold bg-red-500/10 text-red-300">
                  {q.blockedReason ?? "Paused"}
                </span>
              ) : (
                <span className="text-[11px] tabular-nums text-ink-3">
                  {q.monthlyCap !== undefined
                    ? `${q.monthlyUsed.toLocaleString()} / ${q.monthlyCap.toLocaleString()} this month`
                    : `${q.dailyUsed.toLocaleString()} / ${q.dailyCap?.toLocaleString() ?? "∞"} today`}
                </span>
              )}
            </div>

            {q.monthlyCap !== undefined && q.monthlyCap > 0 ? (
              <Bar used={q.monthlyUsed} cap={q.monthlyCap} />
            ) : q.dailyCap !== undefined && q.dailyCap > 0 ? (
              <Bar used={q.dailyUsed} cap={q.dailyCap} />
            ) : null}

            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
              {q.dailyCap !== undefined && q.dailyCap > 0 ? (
                <>
                  {q.dailyUsed}/{q.dailyCap} today ·{" "}
                </>
              ) : null}
              {q.freeTierNote}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
