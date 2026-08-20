"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  Check,
  CircleDot,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import {
  CALL_OUTCOMES,
  type Activity,
  type ActivityType,
  type CallOutcome,
  type SequenceEnrollment,
  type SequenceWithSteps,
  type TaskWithLead,
} from "@/lib/crm/types";
import { Button, Spinner, inputClass } from "./ui";

const ACTIVITY_META: Record<ActivityType, { Icon: LucideIcon; label: string; className: string }> = {
  note: { Icon: StickyNote, label: "Note", className: "text-ink-2" },
  call: { Icon: Phone, label: "Call", className: "text-brand" },
  email: { Icon: Mail, label: "Email", className: "text-sky-300" },
  sms: { Icon: MessageSquare, label: "Text", className: "text-violet-300" },
  meeting: { Icon: Users, label: "Meeting", className: "text-amber-300" },
  stage_change: { Icon: CircleDot, label: "Stage", className: "text-ink-3" },
  status_change: { Icon: CircleDot, label: "Status", className: "text-ink-3" },
  task_completed: { Icon: Check, label: "Task done", className: "text-brand" },
  sequence_enrolled: { Icon: Zap, label: "Sequence", className: "text-amber-300" },
  sequence_step: { Icon: Zap, label: "Sequence step", className: "text-amber-300" },
  discovered: { Icon: Zap, label: "Discovered", className: "text-ink-3" },
  rescanned: { Icon: Zap, label: "Refreshed", className: "text-ink-3" },
};

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Connected",
  voicemail: "Voicemail",
  no_answer: "No answer",
  wrong_number: "Wrong number",
  not_interested: "Not interested",
  interested: "Interested",
  booked: "Booked a call",
};

/** Quick-log row: pick a channel, optionally an outcome, write a line. */
function LogForm({ leadId, onLogged }: { leadId: string; onLogged: () => void }) {
  const [type, setType] = useState<ActivityType>("call");
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch(`/api/leads/${leadId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, body, outcome: outcome || undefined }),
      });
      setBody("");
      setOutcome("");
      onLogged();
    } finally {
      setSaving(false);
    }
  };

  const channels: ActivityType[] = ["call", "email", "sms", "meeting", "note"];

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {channels.map((t) => {
          const { Icon, label } = ACTIVITY_META[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-ring",
                type === t
                  ? "border-brand/50 bg-brand/15 text-brand"
                  : "border-line bg-surface text-ink-3 hover:text-ink-2",
              )}
            >
              <Icon className="size-3" />
              {label}
            </button>
          );
        })}
      </div>

      {type === "call" ? (
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as CallOutcome | "")}
          className={cn(inputClass, "mb-2 h-9 py-0")}
        >
          <option value="">How did it go?</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
      ) : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder={
          type === "call" ? "What did they say?" : type === "note" ? "Note…" : "What did you send?"
        }
        className={cn(inputClass, "resize-y")}
      />

      <div className="mt-2 flex justify-end">
        <Button type="submit" size="sm" variant="primary" disabled={saving || (!body.trim() && !outcome)}>
          {saving ? <Spinner /> : null}
          Log {ACTIVITY_META[type].label.toLowerCase()}
        </Button>
      </div>
    </form>
  );
}

/** Add a follow-up task with one of the common due dates. */
function QuickTask({ leadId, onCreated }: { leadId: string; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async (days: number) => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const due = new Date();
      due.setDate(due.getDate() + days);
      due.setHours(9, 0, 0, 0);
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, title: title.trim(), type: "followup", dueAt: due.toISOString() }),
      });
      setTitle("");
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Follow-up task — e.g. “Call back about the quote”"
        className={inputClass}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-3">Due:</span>
        {[
          { label: "Tomorrow", days: 1 },
          { label: "In 3 days", days: 3 },
          { label: "Next week", days: 7 },
          { label: "In 2 weeks", days: 14 },
        ].map((o) => (
          <button
            key={o.days}
            type="button"
            disabled={saving || !title.trim()}
            onClick={() => create(o.days)}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40 focus-ring"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Enrol this lead into one of the saved cadences. */
function SequencePicker({ leadId, onEnrolled }: { leadId: string; onEnrolled: () => void }) {
  const [sequences, setSequences] = useState<SequenceWithSteps[]>([]);
  const [mine, setMine] = useState<SequenceEnrollment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/sequences", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as {
      sequences: SequenceWithSteps[];
      enrollments: SequenceEnrollment[];
    };
    setSequences(body.sequences.filter((s) => s.active));
    setMine(body.enrollments.filter((e) => e.leadId === leadId));
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const enroll = async (sequenceId: string) => {
    setBusy(sequenceId);
    try {
      await fetch(`/api/sequences/${sequenceId}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: [leadId] }),
      });
      await load();
      onEnrolled();
    } finally {
      setBusy(null);
    }
  };

  if (!sequences.length) return null;

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Start a sequence
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sequences.map((s) => {
          const active = mine.find((e) => e.sequenceId === s.id && e.status === "active");
          return (
            <button
              key={s.id}
              type="button"
              disabled={Boolean(active) || busy === s.id}
              onClick={() => enroll(s.id)}
              title={active ? `Already on step ${active.currentStep + 1}` : s.description}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-ring",
                active
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
                busy === s.id && "opacity-50",
              )}
            >
              <Zap className="size-3" />
              {s.name}
              {active ? ` · step ${active.currentStep + 1}` : ` · ${s.steps.length} steps`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LeadActivityPanel({ leadId }: { leadId: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<TaskWithLead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [aRes, tRes] = await Promise.all([
        fetch(`/api/leads/${leadId}/activities`, { cache: "no-store" }),
        fetch(`/api/tasks?leadId=${leadId}`, { cache: "no-store" }),
      ]);
      if (aRes.ok) setActivities((await aRes.json()).activities);
      if (tRes.ok) setTasks((await tRes.json()).tasks);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
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

  return (
    <div className="space-y-4">
      <LogForm leadId={leadId} onLogged={load} />
      <SequencePicker leadId={leadId} onEnrolled={load} />

      {/* Open tasks */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Open tasks
        </p>
        {tasks.length === 0 ? (
          <p className="mb-2 text-[12px] text-ink-3">Nothing scheduled.</p>
        ) : (
          <ul className="mb-2 space-y-1.5">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => completeTask(t.id)}
                  aria-label="Mark done"
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-line-strong transition-colors hover:border-brand hover:bg-brand/20 focus-ring"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">{t.title}</p>
                  {t.dueAt ? (
                    <p
                      className={cn(
                        "text-[11px]",
                        Date.parse(t.dueAt) < Date.now() ? "text-amber-400" : "text-ink-3",
                      )}
                    >
                      Due {relativeTime(t.dueAt)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <QuickTask leadId={leadId} onCreated={load} />
      </div>

      {/* Timeline */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          <CalendarPlus className="size-3.5" />
          Timeline
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-ink-3">
            <Spinner />
            Loading…
          </div>
        ) : activities.length === 0 ? (
          <p className="text-[12px] text-ink-3">
            Nothing logged yet. Every call, note and stage move shows up here.
          </p>
        ) : (
          <ol className="space-y-0">
            {activities.map((a, i) => {
              const { Icon, label, className } = ACTIVITY_META[a.type] ?? ACTIVITY_META.note;
              return (
                <li key={a.id} className="flex gap-3">
                  {/* Rail */}
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2",
                        className,
                      )}
                    >
                      <Icon className="size-3" />
                    </span>
                    {i < activities.length - 1 ? (
                      <span className="w-px flex-1 bg-line" aria-hidden />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[12px] font-medium text-ink-2">{label}</span>
                      {a.outcome ? (
                        <span className="rounded border border-line bg-surface-2 px-1 py-px text-[10px] font-medium text-ink-3">
                          {OUTCOME_LABELS[a.outcome]}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-ink-3">{relativeTime(a.createdAt)}</span>
                    </div>
                    {a.body ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
                        {a.body}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
