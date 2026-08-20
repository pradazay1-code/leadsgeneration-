"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Phone,
  Snowflake,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import type { DashboardSummary } from "@/lib/crm/types";
import type { TaskWithLead } from "@/lib/crm/types";
import { money } from "./PipelineBoard";
import { Button, Spinner } from "./ui";

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint: string;
  accent: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", accent)}>
        <Icon className="size-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-ink">
          {value}
        </div>
        <div className="mt-1.5 text-[13px] font-medium text-ink-2">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-ink-3">{hint}</div>
      </div>
    </>
  );

  const className = cn(
    "panel flex items-start gap-3 p-4 text-left transition-colors",
    href && "hover:border-line-strong hover:bg-surface-2 focus-ring",
  );

  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** Bar chart of calls per day — the single best measure of outreach effort. */
function CallSparkline({ data }: { data: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-20 items-end gap-1">
      {data.map((d) => (
        <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.count} calls`}>
          <div
            className={cn(
              "w-full rounded-t transition-colors",
              d.count > 0 ? "bg-brand/70 group-hover:bg-brand" : "bg-surface-3",
            )}
            style={{ height: `${Math.max((d.count / max) * 72, 3)}px` }}
          />
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [tasks, setTasks] = useState<TaskWithLead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [dRes, tRes] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/tasks?scope=today", { cache: "no-store" }),
      ]);
      if (dRes.ok) setSummary((await dRes.json()).summary);
      if (tRes.ok) setTasks((await tRes.json()).tasks);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completeTask = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    void load();
  };

  if (loading && !summary) {
    return (
      <div className="panel flex items-center justify-center gap-2 py-24 text-sm text-ink-3">
        <Spinner />
        Loading…
      </div>
    );
  }

  const s = summary!;
  const totalActivity = s.activityLast7Days.reduce((n, a) => n + a.count, 0);
  const calls7 = s.activityLast7Days.find((a) => a.type === "call")?.count ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={Clock}
          label="Due today"
          value={s.tasksDue}
          hint={s.tasksOverdue > 0 ? `${s.tasksOverdue} overdue` : "Nothing overdue"}
          accent={
            s.tasksOverdue > 0
              ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
              : "border-brand/25 bg-brand/10 text-brand"
          }
          href="/tasks"
        />
        <Tile
          icon={TrendingUp}
          label="Pipeline value"
          value={money(s.pipelineValueCents)}
          hint={`${money(s.weightedPipelineValueCents)} weighted by stage`}
          accent="border-sky-500/25 bg-sky-500/10 text-sky-300"
          href="/pipeline"
        />
        <Tile
          icon={Sparkles}
          label="Never contacted"
          value={s.untouchedLeads}
          hint={`${s.newLeadsThisWeek} new this week`}
          accent="border-violet-500/25 bg-violet-500/10 text-violet-300"
          href="/?untouched=1"
        />
        <Tile
          icon={Snowflake}
          label="Going cold"
          value={s.goingCold}
          hint="No contact in over a week"
          accent="border-amber-500/25 bg-amber-500/10 text-amber-300"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Today's work */}
        <section className="panel overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Today&apos;s work</h2>
            <Link href="/tasks" className="text-[12px] text-ink-3 hover:text-ink focus-ring">
              View all
            </Link>
          </header>

          {tasks.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CheckCircle2 className="mx-auto mb-2 size-6 text-brand" />
              <p className="text-[13px] text-ink-2">Nothing due today.</p>
              <p className="mt-1 text-[12px] text-ink-3">
                Open a lead and schedule a follow-up, or work the untouched list.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.slice(0, 10).map((t) => {
                const overdue = t.dueAt ? Date.parse(t.dueAt) < Date.now() : false;
                return (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => completeTask(t.id)}
                      aria-label="Mark done"
                      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-line-strong transition-colors hover:border-brand hover:bg-brand/20 focus-ring"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">{t.title}</p>
                      <p className="mt-0.5 truncate text-[12px] text-ink-3">
                        {t.leadName ?? "No lead"}
                        {t.leadCity ? ` · ${t.leadCity}` : ""}
                        {t.dueAt ? (
                          <span className={overdue ? "text-amber-400" : undefined}>
                            {" · "}
                            {overdue ? "overdue " : "due "}
                            {relativeTime(t.dueAt)}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    {t.leadPhone ? (
                      <a href={`tel:${t.leadPhone.replace(/[^\d+]/g, "")}`} className="focus-ring">
                        <Button size="sm" variant="subtle" tabIndex={-1}>
                          <Phone className="size-3.5" />
                          Call
                        </Button>
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Activity + stages */}
        <div className="space-y-5">
          <section className="panel p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-ink">Calls, last 14 days</h2>
              <span className="text-[12px] tabular-nums text-ink-3">{calls7} this week</span>
            </div>
            <CallSparkline data={s.callsByDay} />
            <p className="mt-2 text-[11px] text-ink-3">
              {totalActivity} total touches logged in the last 7 days.
            </p>
          </section>

          <section className="panel overflow-hidden">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Pipeline by stage</h2>
            </header>
            <div className="space-y-2 px-4 py-3">
              {s.stages.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-ink-3">No stages yet.</p>
              ) : (
                s.stages.map((stage) => {
                  const max = Math.max(1, ...s.stages.map((x) => x.leadCount));
                  return (
                    <div key={stage.stageId}>
                      <div className="mb-1 flex justify-between text-[12px]">
                        <span className="truncate text-ink-2">{stage.stageName}</span>
                        <span className="shrink-0 tabular-nums text-ink-3">
                          {stage.leadCount}
                          {stage.valueCents > 0 ? ` · ${money(stage.valueCents)}` : ""}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-sky-400/80"
                          style={{ width: `${(stage.leadCount / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {s.tasksOverdue > 0 ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <p className="text-[13px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">{s.tasksOverdue} overdue task
                {s.tasksOverdue === 1 ? "" : "s"}.</span>{" "}
                Follow-ups that slip are where most deals die.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
