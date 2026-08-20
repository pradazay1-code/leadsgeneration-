"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ListTodo, Phone, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime, telHref } from "@/lib/format";
import type { TaskWithLead } from "@/lib/crm/types";
import { Button, Chip, EmptyState, Spinner } from "./ui";

type Scope = "today" | "all" | "done";

const SCOPES: Array<{ id: Scope; label: string; hint: string }> = [
  { id: "today", label: "Due now", hint: "Overdue and due today" },
  { id: "all", label: "All open", hint: "Everything not yet done" },
  { id: "done", label: "Completed", hint: "Recently finished" },
];

/** Group tasks into overdue / today / later so the list reads as a plan. */
function bucketOf(task: TaskWithLead): "overdue" | "today" | "later" | "someday" {
  if (!task.dueAt) return "someday";
  const due = Date.parse(task.dueAt);
  const endOfToday = new Date().setHours(23, 59, 59, 999);
  if (due < Date.now()) return "overdue";
  if (due <= endOfToday) return "today";
  return "later";
}

const BUCKET_LABELS = {
  overdue: "Overdue",
  today: "Today",
  later: "Coming up",
  someday: "No date",
} as const;

export function TaskList() {
  const [scope, setScope] = useState<Scope>("today");
  const [tasks, setTasks] = useState<TaskWithLead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope === "today") params.set("scope", "today");
      if (scope === "done") params.set("includeCompleted", "true");
      const res = await fetch(`/api/tasks?${params}`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { tasks: TaskWithLead[] };
        setTasks(
          scope === "done" ? body.tasks.filter((t) => t.completedAt) : body.tasks,
        );
      }
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const setDone = async (id: string, done: boolean) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    void load();
  };

  const remove = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, TaskWithLead[]>();
    for (const t of tasks) {
      const key = scope === "done" ? "done" : bucketOf(t);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks, scope]);

  const order: Array<keyof typeof BUCKET_LABELS | "done"> =
    scope === "done" ? ["done"] : ["overdue", "today", "later", "someday"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {SCOPES.map((s) => (
          <Chip key={s.id} active={scope === s.id} onClick={() => setScope(s.id)} title={s.hint}>
            {s.label}
          </Chip>
        ))}
      </div>

      <div className="panel min-h-[320px] overflow-hidden">
        {loading && !tasks.length ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-ink-3">
            <Spinner />
            Loading…
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={scope === "done" ? <CheckCircle2 className="size-5" /> : <ListTodo className="size-5" />}
            title={scope === "done" ? "Nothing completed yet" : "No tasks here"}
            description={
              scope === "done"
                ? "Completed follow-ups will collect here."
                : "Open a lead and schedule a follow-up — the calls you book today are the deals you close next month."
            }
          />
        ) : (
          order.map((bucket) => {
            const list = grouped.get(bucket);
            if (!list?.length) return null;
            return (
              <section key={bucket}>
                <header
                  className={cn(
                    "border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wider",
                    bucket === "overdue" ? "bg-amber-500/5 text-amber-400" : "text-ink-3",
                  )}
                >
                  {bucket === "done" ? "Completed" : BUCKET_LABELS[bucket]} · {list.length}
                </header>
                <ul className="divide-y divide-line">
                  {list.map((t) => (
                    <li key={t.id} className="group flex items-start gap-3 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDone(t.id, !t.completedAt)}
                        aria-label={t.completedAt ? "Reopen" : "Mark done"}
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors focus-ring",
                          t.completedAt
                            ? "border-brand bg-brand/20 text-brand"
                            : "border-line-strong hover:border-brand hover:bg-brand/20",
                        )}
                      >
                        {t.completedAt ? <CheckCircle2 className="size-3" /> : null}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-[13px]",
                            t.completedAt ? "text-ink-3 line-through" : "text-ink",
                          )}
                        >
                          {t.title}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-ink-3">
                          {t.leadName ?? "No lead"}
                          {t.leadCity ? ` · ${t.leadCity}` : ""}
                          {t.dueAt ? ` · ${relativeTime(t.dueAt)}` : ""}
                        </p>
                        {t.notes ? (
                          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-3">
                            {t.notes}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {t.leadPhone ? (
                          <a href={telHref(t.leadPhone)} className="focus-ring">
                            <Button size="sm" variant="subtle" tabIndex={-1}>
                              <Phone className="size-3.5" />
                              Call
                            </Button>
                          </a>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(t.id)}
                          title="Delete task"
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
