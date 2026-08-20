"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Mail,
  MessageSquare,
  Pause,
  Phone,
  Play,
  StickyNote,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { MERGE_FIELDS } from "@/lib/crm/merge";
import type {
  SequenceChannel,
  SequenceEnrollment,
  SequenceWithSteps,
} from "@/lib/crm/types";
import { Banner } from "./LeadsWorkspace";
import { Button, Spinner } from "./ui";

const CHANNEL_META: Record<SequenceChannel, { Icon: LucideIcon; label: string; className: string }> = {
  call: { Icon: Phone, label: "Call", className: "border-brand/30 bg-brand/10 text-brand" },
  email: { Icon: Mail, label: "Email", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  sms: { Icon: MessageSquare, label: "Text", className: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  manual: { Icon: StickyNote, label: "Manual", className: "border-line-strong bg-surface-3 text-ink-3" },
};

interface RunResult {
  processed: number;
  tasksCreated: number;
  emailsSent: number;
  smsSent: number;
  stopped: number;
  completed: number;
  deferred: number;
  errors: string[];
  log: string[];
}

export function SequencesWorkspace() {
  const [sequences, setSequences] = useState<SequenceWithSteps[]>([]);
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sequences", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load sequences");
      setSequences(body.sequences);
      setEnrollments(body.enrollments);
      setOpenId((prev) => prev ?? body.sequences[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sequences");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (seq: SequenceWithSteps) => {
    setSequences((prev) =>
      prev.map((s) => (s.id === seq.id ? { ...s, active: !s.active } : s)),
    );
    await fetch(`/api/sequences/${seq.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !seq.active }),
    });
    void load();
  };

  const runNow = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sequences/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Run failed");
      setResult(body.result as RunResult);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
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

  const activeCount = enrollments.filter((e) => e.status === "active").length;

  return (
    <div className="space-y-5">
      {error ? (
        <Banner tone="bad" title="Something went wrong" body={error} onDismiss={() => setError(null)} />
      ) : null}

      {result ? (
        <Banner
          tone={result.errors.length ? "warn" : "good"}
          title={
            result.processed === 0
              ? "Nothing was due"
              : `Ran ${result.processed} step${result.processed === 1 ? "" : "s"}`
          }
          body={
            result.errors.length
              ? result.errors.slice(0, 3).join(" · ")
              : `${result.tasksCreated} task(s) created · ${result.emailsSent} email(s) · ${result.smsSent} text(s) · ${result.completed} finished · ${result.deferred} deferred · ${result.stopped} stopped.`
          }
          detail={result.log.slice(0, 6).join("  ·  ")}
          onDismiss={() => setResult(null)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-3">
          {activeCount} lead{activeCount === 1 ? "" : "s"} currently in a cadence. Steps fire
          automatically three times a day.
        </p>
        <Button size="sm" variant="primary" onClick={runNow} disabled={running}>
          {running ? <Spinner /> : <Zap className="size-3.5" />}
          {running ? "Running…" : "Run due steps now"}
        </Button>
      </div>

      <div className="space-y-3">
        {sequences.map((seq) => {
          const seqEnrollments = enrollments.filter((e) => e.sequenceId === seq.id);
          const active = seqEnrollments.filter((e) => e.status === "active");
          const isOpen = openId === seq.id;

          return (
            <section key={seq.id} className="panel overflow-hidden">
              <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : seq.id)}
                  className="min-w-0 flex-1 text-left focus-ring"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink">{seq.name}</h2>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        seq.active ? "bg-brand/15 text-brand" : "bg-surface-3 text-ink-3",
                      )}
                    >
                      {seq.active ? "Active" : "Paused"}
                    </span>
                    <span className="text-[11px] text-ink-3">
                      {seq.steps.length} steps · {active.length} enrolled
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{seq.description}</p>
                </button>

                <Button size="sm" variant="subtle" onClick={() => toggleActive(seq)}>
                  {seq.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  {seq.active ? "Pause" : "Activate"}
                </Button>
              </header>

              {isOpen ? (
                <div className="border-t border-line">
                  <ol>
                    {seq.steps.map((step, i) => {
                      const { Icon, label, className } = CHANNEL_META[step.channel];
                      return (
                        <li key={step.id} className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
                          <div className="flex flex-col items-center">
                            <span
                              className={cn(
                                "flex size-7 shrink-0 items-center justify-center rounded-full border",
                                className,
                              )}
                            >
                              <Icon className="size-3.5" />
                            </span>
                            {i < seq.steps.length - 1 ? (
                              <span className="w-px flex-1 bg-line" aria-hidden />
                            ) : null}
                          </div>

                          <div className="min-w-0 flex-1 pb-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="text-[12px] font-semibold text-ink-2">
                                Day {step.dayOffset}
                              </span>
                              <span className="text-[11px] uppercase tracking-wide text-ink-3">
                                {label}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[13px] font-medium text-ink">{step.subject}</p>
                            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-3">
                              {step.body}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <section className="panel p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Merge fields</h2>
        <p className="mb-3 text-[12px] leading-relaxed text-ink-3">
          These are replaced with the lead&apos;s real details when a step fires.{" "}
          <span className="text-ink-2">{"{{gap}}"}</span> is the useful one — it writes out that
          specific business&apos;s biggest weakness in plain English.
        </p>
        <div className="flex flex-wrap gap-2">
          {MERGE_FIELDS.map((f) => (
            <span
              key={f.token}
              title={f.description}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink-2"
            >
              {f.token}
            </span>
          ))}
        </div>
      </section>

      {enrollments.length > 0 ? (
        <section className="panel overflow-hidden">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Enrollments</h2>
          </header>
          <ul className="divide-y divide-line">
            {enrollments.slice(0, 25).map((e) => {
              const seq = sequences.find((s) => s.id === e.sequenceId);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px]">
                  <span className="w-40 shrink-0 truncate text-ink-2">{seq?.name ?? "Sequence"}</span>
                  <span className="text-ink-3">
                    step {e.currentStep + 1}/{seq?.steps.length ?? "?"}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium",
                      e.status === "active"
                        ? "bg-brand/15 text-brand"
                        : e.status === "completed"
                          ? "bg-sky-500/10 text-sky-300"
                          : "bg-surface-3 text-ink-3",
                    )}
                  >
                    {e.status}
                  </span>
                  {e.nextDueAt ? (
                    <span className="text-ink-3">next {relativeTime(e.nextDueAt)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="panel px-4 py-10 text-center">
          <Users className="mx-auto mb-2 size-6 text-ink-3" />
          <p className="text-[13px] text-ink-2">Nobody is enrolled yet.</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Open a lead and use <span className="text-ink-2">Start a sequence</span> in the Activity
            tab.
          </p>
        </section>
      )}
    </div>
  );
}
