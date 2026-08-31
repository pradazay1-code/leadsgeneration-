import "server-only";
import type { Sql } from "postgres";
import type {
  Activity,
  ActivityInput,
  ActivityType,
  CallOutcome,
  DashboardSummary,
  MessageTemplate,
  Pipeline,
  PipelineStage,
  PipelineWithStages,
  SavedView,
  Sequence,
  SequenceChannel,
  SequenceEnrollment,
  SequenceStep,
  SequenceWithSteps,
  Task,
  TaskPriority,
  TaskType,
  TaskWithLead,
  StageRollup,
} from "../crm/types";
import { DEFAULT_PIPELINES, DEFAULT_SEQUENCES, DEFAULT_TEMPLATES } from "../crm/defaults";
import type { NicheId } from "../types";
import type { TaskFilters, TaskInput } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function jsonb(sql: Sql, value: unknown) {
  return sql.json(value as never);
}

/* ------------------------------------------------------------- migrate */

/** Create every CRM table. Idempotent, safe to run on each cold start. */
export async function migrateCrm(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS pipelines (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL,
      niche      text,
      is_default boolean NOT NULL DEFAULT false,
      position   integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      name        text NOT NULL,
      position    integer NOT NULL DEFAULT 0,
      probability integer NOT NULL DEFAULT 0,
      is_won      boolean NOT NULL DEFAULT false,
      is_lost     boolean NOT NULL DEFAULT false
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS activities (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id          uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      type             text NOT NULL,
      body             text NOT NULL DEFAULT '',
      outcome          text,
      meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
      actor            text NOT NULL DEFAULT 'me',
      duration_minutes integer,
      created_at       timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE,
      title         text NOT NULL,
      notes         text NOT NULL DEFAULT '',
      type          text NOT NULL DEFAULT 'followup',
      priority      text NOT NULL DEFAULT 'normal',
      due_at        timestamptz,
      completed_at  timestamptz,
      enrollment_id uuid,
      created_at    timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS sequences (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      description text NOT NULL DEFAULT '',
      niche       text,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS sequence_steps (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      position    integer NOT NULL DEFAULT 0,
      day_offset  integer NOT NULL DEFAULT 0,
      channel     text NOT NULL DEFAULT 'call',
      subject     text NOT NULL DEFAULT '',
      body        text NOT NULL DEFAULT ''
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sequence_id  uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      status       text NOT NULL DEFAULT 'active',
      current_step integer NOT NULL DEFAULT 0,
      started_at   timestamptz NOT NULL DEFAULT now(),
      next_due_at  timestamptz,
      completed_at timestamptz,
      UNIQUE (sequence_id, lead_id)
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS message_templates (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL,
      channel    text NOT NULL DEFAULT 'email',
      subject    text NOT NULL DEFAULT '',
      body       text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS saved_views (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL,
      filters    jsonb NOT NULL DEFAULT '{}'::jsonb,
      position   integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;

  // CRM columns on leads.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_id uuid`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_id uuid`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS value_cents integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_action_at timestamptz`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false`;

  // Deep-research findings.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_name text`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS founded_year integer`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS looks_new boolean`;

  await sql`
    CREATE TABLE IF NOT EXISTS api_usage (
      quota_key   text NOT NULL,
      period_type text NOT NULL,
      period      text NOT NULL,
      count       integer NOT NULL DEFAULT 0,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (quota_key, period_type, period)
    )`;

  // Every identity key a lead has ever matched on. This is what makes dedupe
  // survive between scans: a business first seen with only a name, later found
  // with a phone number, resolves through its stored name key to the same row
  // instead of arriving as a second copy.
  await sql`
    CREATE TABLE IF NOT EXISTS lead_identities (
      identity_key text PRIMARY KEY,
      lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      created_at   timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS lead_identities_lead_idx ON lead_identities (lead_id)`;

  // Pages the research agent has already looked at. Firecrawl credits are the
  // scarcest budget in the app, so a URL is scraped at most once and the
  // outcome is remembered — including the misses, which are the ones that
  // would otherwise be retried forever.
  await sql`
    CREATE TABLE IF NOT EXISTS research_targets (
      url          text PRIMARY KEY,
      domain       text NOT NULL,
      niche        text,
      outcome      text NOT NULL,
      lead_id      uuid REFERENCES leads(id) ON DELETE SET NULL,
      researched_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS research_targets_domain_idx ON research_targets (domain)`;

  await sql`CREATE INDEX IF NOT EXISTS activities_lead_idx ON activities (lead_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks (due_at) WHERE completed_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS tasks_lead_idx ON tasks (lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS leads_stage_idx ON leads (stage_id)`;
  await sql`CREATE INDEX IF NOT EXISTS enrollments_due_idx ON sequence_enrollments (next_due_at) WHERE status = 'active'`;

  await seedDefaults(sql);
}

/** Seed starter pipelines, sequences and templates exactly once. */
async function seedDefaults(sql: Sql): Promise<void> {
  const [{ n }] = await sql<Row[]>`SELECT count(*)::int AS n FROM pipelines`;
  if (Number(n) === 0) {
    for (const [i, seed] of DEFAULT_PIPELINES.entries()) {
      const [pipeline] = await sql<Row[]>`
        INSERT INTO pipelines (name, niche, is_default, position)
        VALUES (${seed.name}, ${seed.niche}, ${seed.isDefault}, ${i})
        RETURNING id`;
      for (const [j, stage] of seed.stages.entries()) {
        await sql`
          INSERT INTO pipeline_stages (pipeline_id, name, position, probability, is_won, is_lost)
          VALUES (${pipeline.id}, ${stage.name}, ${j}, ${stage.probability},
                  ${stage.isWon ?? false}, ${stage.isLost ?? false})`;
      }
    }
  }

  const [{ n: seqCount }] = await sql<Row[]>`SELECT count(*)::int AS n FROM sequences`;
  if (Number(seqCount) === 0) {
    for (const seed of DEFAULT_SEQUENCES) {
      const [seq] = await sql<Row[]>`
        INSERT INTO sequences (name, description, niche, active)
        VALUES (${seed.name}, ${seed.description}, ${seed.niche}, true)
        RETURNING id`;
      for (const [i, step] of seed.steps.entries()) {
        await sql`
          INSERT INTO sequence_steps (sequence_id, position, day_offset, channel, subject, body)
          VALUES (${seq.id}, ${i}, ${step.dayOffset}, ${step.channel}, ${step.subject}, ${step.body})`;
      }
    }
  }

  const [{ n: tplCount }] = await sql<Row[]>`SELECT count(*)::int AS n FROM message_templates`;
  if (Number(tplCount) === 0) {
    for (const t of DEFAULT_TEMPLATES) {
      await sql`
        INSERT INTO message_templates (name, channel, subject, body)
        VALUES (${t.name}, ${t.channel}, ${t.subject}, ${t.body})`;
    }
  }
}

/* ------------------------------------------------------------- mappers */

function toPipeline(r: Row): Pipeline {
  return {
    id: String(r.id),
    name: r.name,
    niche: (r.niche as NicheId) ?? null,
    isDefault: Boolean(r.is_default),
    position: Number(r.position ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toStage(r: Row): PipelineStage {
  return {
    id: String(r.id),
    pipelineId: String(r.pipeline_id),
    name: r.name,
    position: Number(r.position ?? 0),
    probability: Number(r.probability ?? 0),
    isWon: Boolean(r.is_won),
    isLost: Boolean(r.is_lost),
  };
}

function toActivity(r: Row): Activity {
  return {
    id: String(r.id),
    leadId: String(r.lead_id),
    type: r.type as ActivityType,
    body: r.body ?? "",
    outcome: (r.outcome as CallOutcome) ?? null,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    actor: r.actor ?? "me",
    durationMinutes: r.duration_minutes === null ? null : Number(r.duration_minutes),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toTask(r: Row): Task {
  return {
    id: String(r.id),
    leadId: r.lead_id ? String(r.lead_id) : null,
    title: r.title,
    notes: r.notes ?? "",
    type: r.type as TaskType,
    priority: r.priority as TaskPriority,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    enrollmentId: r.enrollment_id ? String(r.enrollment_id) : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toTaskWithLead(r: Row): TaskWithLead {
  return {
    ...toTask(r),
    leadName: r.lead_name ?? null,
    leadPhone: r.lead_phone ?? null,
    leadCity: r.lead_city ?? null,
    leadScore: r.lead_score === null || r.lead_score === undefined ? null : Number(r.lead_score),
  };
}

function toSequence(r: Row): Sequence {
  return {
    id: String(r.id),
    name: r.name,
    description: r.description ?? "",
    niche: (r.niche as NicheId) ?? null,
    active: Boolean(r.active),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toStep(r: Row): SequenceStep {
  return {
    id: String(r.id),
    sequenceId: String(r.sequence_id),
    position: Number(r.position ?? 0),
    dayOffset: Number(r.day_offset ?? 0),
    channel: r.channel as SequenceChannel,
    subject: r.subject ?? "",
    body: r.body ?? "",
  };
}

function toEnrollment(r: Row): SequenceEnrollment {
  return {
    id: String(r.id),
    sequenceId: String(r.sequence_id),
    leadId: String(r.lead_id),
    status: r.status,
    currentStep: Number(r.current_step ?? 0),
    startedAt: new Date(r.started_at).toISOString(),
    nextDueAt: r.next_due_at ? new Date(r.next_due_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  };
}

function toTemplate(r: Row): MessageTemplate {
  return {
    id: String(r.id),
    name: r.name,
    channel: r.channel as SequenceChannel,
    subject: r.subject ?? "",
    body: r.body ?? "",
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toSavedView(r: Row): SavedView {
  return {
    id: String(r.id),
    name: r.name,
    filters: (r.filters ?? {}) as Record<string, unknown>,
    position: Number(r.position ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/* ----------------------------------------------------------- pipelines */

export async function listPipelines(sql: Sql): Promise<PipelineWithStages[]> {
  const [pipelines, stages] = await Promise.all([
    sql<Row[]>`SELECT * FROM pipelines ORDER BY position, created_at`,
    sql<Row[]>`SELECT * FROM pipeline_stages ORDER BY position`,
  ]);
  return pipelines.map((p) => ({
    ...toPipeline(p),
    stages: stages.filter((s) => String(s.pipeline_id) === String(p.id)).map(toStage),
  }));
}

export async function createPipeline(
  sql: Sql,
  name: string,
  niche: NicheId | null,
): Promise<PipelineWithStages> {
  const [{ n }] = await sql<Row[]>`SELECT COALESCE(max(position), -1) + 1 AS n FROM pipelines`;
  const [row] = await sql<Row[]>`
    INSERT INTO pipelines (name, niche, position) VALUES (${name}, ${niche}, ${Number(n)})
    RETURNING *`;
  // A pipeline with no stages is unusable, so give it the standard set.
  const stageNames = DEFAULT_PIPELINES[0].stages;
  for (const [i, s] of stageNames.entries()) {
    await sql`
      INSERT INTO pipeline_stages (pipeline_id, name, position, probability, is_won, is_lost)
      VALUES (${row.id}, ${s.name}, ${i}, ${s.probability}, ${s.isWon ?? false}, ${s.isLost ?? false})`;
  }
  const stages = await sql<Row[]>`
    SELECT * FROM pipeline_stages WHERE pipeline_id = ${row.id} ORDER BY position`;
  return { ...toPipeline(row), stages: stages.map(toStage) };
}

export async function updatePipeline(
  sql: Sql,
  id: string,
  patch: Partial<Pipeline>,
): Promise<Pipeline | null> {
  if (patch.isDefault) await sql`UPDATE pipelines SET is_default = false`;
  const rows = await sql<Row[]>`
    UPDATE pipelines SET
      name       = COALESCE(${patch.name ?? null}, name),
      niche      = CASE WHEN ${"niche" in patch} THEN ${patch.niche ?? null} ELSE niche END,
      is_default = COALESCE(${patch.isDefault ?? null}, is_default),
      position   = COALESCE(${patch.position ?? null}, position)
    WHERE id = ${id} RETURNING *`;
  return rows[0] ? toPipeline(rows[0]) : null;
}

export async function deletePipeline(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM pipelines WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function createStage(
  sql: Sql,
  pipelineId: string,
  name: string,
  position: number,
): Promise<PipelineStage> {
  const [row] = await sql<Row[]>`
    INSERT INTO pipeline_stages (pipeline_id, name, position)
    VALUES (${pipelineId}, ${name}, ${position}) RETURNING *`;
  return toStage(row);
}

export async function updateStage(
  sql: Sql,
  id: string,
  patch: Partial<PipelineStage>,
): Promise<PipelineStage | null> {
  const rows = await sql<Row[]>`
    UPDATE pipeline_stages SET
      name        = COALESCE(${patch.name ?? null}, name),
      position    = COALESCE(${patch.position ?? null}, position),
      probability = COALESCE(${patch.probability ?? null}, probability),
      is_won      = COALESCE(${patch.isWon ?? null}, is_won),
      is_lost     = COALESCE(${patch.isLost ?? null}, is_lost)
    WHERE id = ${id} RETURNING *`;
  return rows[0] ? toStage(rows[0]) : null;
}

export async function deleteStage(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM pipeline_stages WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function defaultPipelineFor(
  sql: Sql,
  niche: string,
): Promise<PipelineWithStages | null> {
  const all = await listPipelines(sql);
  return all.find((p) => p.niche === niche) ?? all.find((p) => p.isDefault) ?? all[0] ?? null;
}

/* ---------------------------------------------------------- activities */

export async function listActivities(sql: Sql, leadId: string, limit = 100): Promise<Activity[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM activities WHERE lead_id = ${leadId}
    ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(toActivity);
}

export async function logActivity(sql: Sql, input: ActivityInput): Promise<Activity> {
  const [row] = await sql<Row[]>`
    INSERT INTO activities (lead_id, type, body, outcome, meta, actor, duration_minutes, created_at)
    VALUES (${input.leadId}, ${input.type}, ${input.body}, ${input.outcome},
            ${jsonb(sql, input.meta)}, ${input.actor}, ${input.durationMinutes},
            ${input.createdAt ?? new Date().toISOString()})
    RETURNING *`;

  // Outbound touches update the lead's last-contacted stamp, which is what the
  // "going cold" metric and the untouched filter both read.
  if (["call", "email", "sms", "meeting"].includes(input.type)) {
    await sql`UPDATE leads SET last_contacted_at = now() WHERE id = ${input.leadId}`;
  }
  return toActivity(row);
}

export async function deleteActivity(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM activities WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/* --------------------------------------------------------------- tasks */

export async function listTasks(sql: Sql, f: TaskFilters): Promise<TaskWithLead[]> {
  const conds: ReturnType<Sql>[] = [];
  if (!f.includeCompleted) conds.push(sql`t.completed_at IS NULL`);
  if (f.dueBefore) conds.push(sql`(t.due_at IS NOT NULL AND t.due_at <= ${f.dueBefore})`);
  if (f.leadId) conds.push(sql`t.lead_id = ${f.leadId}`);
  const where = conds.length ? conds.reduce((a, c) => sql`${a} AND ${c}`) : sql`TRUE`;

  const rows = await sql<Row[]>`
    SELECT t.*, l.name AS lead_name, l.phone AS lead_phone, l.city AS lead_city, l.score AS lead_score
    FROM tasks t
    LEFT JOIN leads l ON l.id = t.lead_id
    WHERE ${where}
    ORDER BY t.completed_at NULLS FIRST, t.due_at ASC NULLS LAST, t.created_at ASC
    LIMIT ${f.limit ?? 200}`;
  return rows.map(toTaskWithLead);
}

/** Keep leads.next_action_at in sync with the soonest open task. */
async function refreshNextAction(sql: Sql, leadId: string | null): Promise<void> {
  if (!leadId) return;
  await sql`
    UPDATE leads SET next_action_at = (
      SELECT min(due_at) FROM tasks
      WHERE lead_id = ${leadId} AND completed_at IS NULL AND due_at IS NOT NULL
    ) WHERE id = ${leadId}`;
}

export async function createTask(sql: Sql, input: TaskInput): Promise<Task> {
  const [row] = await sql<Row[]>`
    INSERT INTO tasks (lead_id, title, notes, type, priority, due_at, enrollment_id)
    VALUES (${input.leadId}, ${input.title}, ${input.notes ?? ""}, ${input.type ?? "followup"},
            ${input.priority ?? "normal"}, ${input.dueAt ?? null}, ${input.enrollmentId ?? null})
    RETURNING *`;
  await refreshNextAction(sql, input.leadId);
  return toTask(row);
}

export async function updateTask(sql: Sql, id: string, patch: Partial<Task>): Promise<Task | null> {
  const completedProvided = "completedAt" in patch;
  const rows = await sql<Row[]>`
    UPDATE tasks SET
      title        = COALESCE(${patch.title ?? null}, title),
      notes        = COALESCE(${patch.notes ?? null}, notes),
      type         = COALESCE(${patch.type ?? null}, type),
      priority     = COALESCE(${patch.priority ?? null}, priority),
      due_at       = CASE WHEN ${"dueAt" in patch} THEN ${patch.dueAt ?? null} ELSE due_at END,
      completed_at = CASE WHEN ${completedProvided} THEN ${patch.completedAt ?? null} ELSE completed_at END
    WHERE id = ${id} RETURNING *`;
  if (!rows[0]) return null;
  const task = toTask(rows[0]);
  await refreshNextAction(sql, task.leadId);

  // Completing a task is itself timeline-worthy.
  if (completedProvided && patch.completedAt && task.leadId) {
    await logActivity(sql, {
      leadId: task.leadId,
      type: "task_completed",
      body: task.title,
      outcome: null,
      meta: { taskType: task.type },
      actor: "me",
      durationMinutes: null,
    });
  }
  return task;
}

export async function deleteTask(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM tasks WHERE id = ${id} RETURNING lead_id`;
  if (!rows.length) return false;
  await refreshNextAction(sql, rows[0].lead_id ? String(rows[0].lead_id) : null);
  return true;
}

/* ----------------------------------------------------------- sequences */

export async function listSequences(sql: Sql): Promise<SequenceWithSteps[]> {
  const [seqs, steps] = await Promise.all([
    sql<Row[]>`SELECT * FROM sequences ORDER BY created_at`,
    sql<Row[]>`SELECT * FROM sequence_steps ORDER BY position`,
  ]);
  return seqs.map((s) => ({
    ...toSequence(s),
    steps: steps.filter((st) => String(st.sequence_id) === String(s.id)).map(toStep),
  }));
}

export async function createSequence(
  sql: Sql,
  seq: Omit<Sequence, "id" | "createdAt">,
): Promise<Sequence> {
  const [row] = await sql<Row[]>`
    INSERT INTO sequences (name, description, niche, active)
    VALUES (${seq.name}, ${seq.description}, ${seq.niche}, ${seq.active})
    RETURNING *`;
  return toSequence(row);
}

export async function updateSequence(
  sql: Sql,
  id: string,
  patch: Partial<Sequence>,
): Promise<Sequence | null> {
  const rows = await sql<Row[]>`
    UPDATE sequences SET
      name        = COALESCE(${patch.name ?? null}, name),
      description = COALESCE(${patch.description ?? null}, description),
      active      = COALESCE(${patch.active ?? null}, active)
    WHERE id = ${id} RETURNING *`;
  return rows[0] ? toSequence(rows[0]) : null;
}

export async function deleteSequence(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM sequences WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function replaceSequenceSteps(
  sql: Sql,
  sequenceId: string,
  steps: Array<Omit<SequenceStep, "id" | "sequenceId">>,
): Promise<SequenceStep[]> {
  await sql`DELETE FROM sequence_steps WHERE sequence_id = ${sequenceId}`;
  const out: SequenceStep[] = [];
  for (const [i, s] of steps.entries()) {
    const [row] = await sql<Row[]>`
      INSERT INTO sequence_steps (sequence_id, position, day_offset, channel, subject, body)
      VALUES (${sequenceId}, ${i}, ${s.dayOffset}, ${s.channel}, ${s.subject}, ${s.body})
      RETURNING *`;
    out.push(toStep(row));
  }
  return out;
}

export async function enrollLead(
  sql: Sql,
  sequenceId: string,
  leadId: string,
): Promise<SequenceEnrollment> {
  const steps = await sql<Row[]>`
    SELECT * FROM sequence_steps WHERE sequence_id = ${sequenceId} ORDER BY position LIMIT 1`;
  const firstOffset = steps[0] ? Number(steps[0].day_offset) : 0;
  const nextDue = new Date(Date.now() + firstOffset * 86400000).toISOString();

  const [row] = await sql<Row[]>`
    INSERT INTO sequence_enrollments (sequence_id, lead_id, status, current_step, next_due_at)
    VALUES (${sequenceId}, ${leadId}, 'active', 0, ${nextDue})
    ON CONFLICT (sequence_id, lead_id) DO UPDATE SET
      status = 'active', current_step = 0, next_due_at = EXCLUDED.next_due_at,
      completed_at = NULL, started_at = now()
    RETURNING *`;

  const [seq] = await sql<Row[]>`SELECT name FROM sequences WHERE id = ${sequenceId}`;
  await logActivity(sql, {
    leadId,
    type: "sequence_enrolled",
    body: `Enrolled in “${seq?.name ?? "sequence"}”`,
    outcome: null,
    meta: { sequenceId },
    actor: "me",
    durationMinutes: null,
  });
  return toEnrollment(row);
}

export async function listEnrollments(sql: Sql, leadId?: string): Promise<SequenceEnrollment[]> {
  const rows = leadId
    ? await sql<Row[]>`SELECT * FROM sequence_enrollments WHERE lead_id = ${leadId} ORDER BY started_at DESC`
    : await sql<Row[]>`SELECT * FROM sequence_enrollments ORDER BY started_at DESC LIMIT 500`;
  return rows.map(toEnrollment);
}

export async function updateEnrollment(
  sql: Sql,
  id: string,
  patch: Partial<SequenceEnrollment>,
): Promise<SequenceEnrollment | null> {
  const rows = await sql<Row[]>`
    UPDATE sequence_enrollments SET
      status       = COALESCE(${patch.status ?? null}, status),
      current_step = COALESCE(${patch.currentStep ?? null}, current_step),
      next_due_at  = CASE WHEN ${"nextDueAt" in patch} THEN ${patch.nextDueAt ?? null} ELSE next_due_at END,
      completed_at = CASE WHEN ${"completedAt" in patch} THEN ${patch.completedAt ?? null} ELSE completed_at END
    WHERE id = ${id} RETURNING *`;
  return rows[0] ? toEnrollment(rows[0]) : null;
}

export async function dueEnrollments(sql: Sql, at: string): Promise<SequenceEnrollment[]> {
  const rows = await sql<Row[]>`
    SELECT * FROM sequence_enrollments
    WHERE status = 'active' AND next_due_at IS NOT NULL AND next_due_at <= ${at}
    ORDER BY next_due_at LIMIT 200`;
  return rows.map(toEnrollment);
}

/* ----------------------------------------------------------- templates */

export async function listTemplates(sql: Sql): Promise<MessageTemplate[]> {
  const rows = await sql<Row[]>`SELECT * FROM message_templates ORDER BY created_at`;
  return rows.map(toTemplate);
}

export async function createTemplate(
  sql: Sql,
  t: Omit<MessageTemplate, "id" | "createdAt">,
): Promise<MessageTemplate> {
  const [row] = await sql<Row[]>`
    INSERT INTO message_templates (name, channel, subject, body)
    VALUES (${t.name}, ${t.channel}, ${t.subject}, ${t.body}) RETURNING *`;
  return toTemplate(row);
}

export async function updateTemplate(
  sql: Sql,
  id: string,
  patch: Partial<MessageTemplate>,
): Promise<MessageTemplate | null> {
  const rows = await sql<Row[]>`
    UPDATE message_templates SET
      name    = COALESCE(${patch.name ?? null}, name),
      channel = COALESCE(${patch.channel ?? null}, channel),
      subject = COALESCE(${patch.subject ?? null}, subject),
      body    = COALESCE(${patch.body ?? null}, body)
    WHERE id = ${id} RETURNING *`;
  return rows[0] ? toTemplate(rows[0]) : null;
}

export async function deleteTemplate(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM message_templates WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/* --------------------------------------------------------- saved views */

export async function listSavedViews(sql: Sql): Promise<SavedView[]> {
  const rows = await sql<Row[]>`SELECT * FROM saved_views ORDER BY position, created_at`;
  return rows.map(toSavedView);
}

export async function createSavedView(
  sql: Sql,
  name: string,
  filters: Record<string, unknown>,
): Promise<SavedView> {
  const [{ n }] = await sql<Row[]>`SELECT COALESCE(max(position), -1) + 1 AS n FROM saved_views`;
  const [row] = await sql<Row[]>`
    INSERT INTO saved_views (name, filters, position)
    VALUES (${name}, ${jsonb(sql, filters)}, ${Number(n)}) RETURNING *`;
  return toSavedView(row);
}

export async function deleteSavedView(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql<Row[]>`DELETE FROM saved_views WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/* ----------------------------------------------------------- dashboard */

export async function dashboard(sql: Sql): Promise<DashboardSummary> {
  const nowIso = new Date().toISOString();

  const [counts, stageRows, activityRows, callRows] = await Promise.all([
    sql<Row[]>`
      SELECT
        (SELECT count(*) FROM tasks WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at <= ${nowIso})::int AS tasks_due,
        (SELECT count(*) FROM tasks WHERE completed_at IS NULL AND due_at IS NOT NULL AND due_at < date_trunc('day', now()))::int AS tasks_overdue,
        (SELECT count(*) FROM leads l WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.type IN ('call','email','sms','meeting')))::int AS untouched,
        (SELECT count(*) FROM leads WHERE last_contacted_at IS NOT NULL AND last_contacted_at < now() - interval '7 days' AND status NOT IN ('won','lost','ignored'))::int AS going_cold,
        (SELECT count(*) FROM leads WHERE discovered_at >= now() - interval '1 day')::int AS new_today,
        (SELECT count(*) FROM leads WHERE discovered_at >= now() - interval '7 days')::int AS new_week,
        (SELECT count(*) FROM leads)::int AS total,
        (SELECT count(*) FROM leads WHERE status = 'won' AND discovered_at >= date_trunc('month', now()))::int AS won_month,
        (SELECT COALESCE(sum(value_cents), 0) FROM leads WHERE status = 'won' AND discovered_at >= date_trunc('month', now()))::bigint AS won_value_month`,
    sql<Row[]>`
      SELECT s.id, s.name, s.probability,
             count(l.id)::int AS lead_count,
             COALESCE(sum(l.value_cents), 0)::bigint AS value_cents
      FROM pipeline_stages s
      LEFT JOIN leads l ON l.stage_id = s.id
      WHERE s.is_won = false AND s.is_lost = false
      GROUP BY s.id, s.name, s.probability, s.position
      ORDER BY s.position`,
    sql<Row[]>`
      SELECT type, count(*)::int AS n FROM activities
      WHERE created_at >= now() - interval '7 days' GROUP BY type`,
    sql<Row[]>`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM activities
      WHERE type = 'call' AND created_at >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`,
  ]);

  const c = counts[0] ?? {};
  const stages: StageRollup[] = stageRows.map((r) => {
    const valueCents = Number(r.value_cents ?? 0);
    return {
      stageId: String(r.id),
      stageName: r.name,
      probability: Number(r.probability ?? 0),
      leadCount: Number(r.lead_count ?? 0),
      valueCents,
      weightedValueCents: Math.round((valueCents * Number(r.probability ?? 0)) / 100),
    };
  });

  // Fill the 14-day call series so the sparkline has no gaps.
  const byDay = new Map(callRows.map((r) => [r.day as string, Number(r.n)]));
  const callsByDay: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    callsByDay.push({ date: d, count: byDay.get(d) ?? 0 });
  }

  return {
    tasksDue: Number(c.tasks_due ?? 0),
    tasksOverdue: Number(c.tasks_overdue ?? 0),
    untouchedLeads: Number(c.untouched ?? 0),
    goingCold: Number(c.going_cold ?? 0),
    newLeadsToday: Number(c.new_today ?? 0),
    newLeadsThisWeek: Number(c.new_week ?? 0),
    totalLeads: Number(c.total ?? 0),
    pipelineValueCents: stages.reduce((n, s) => n + s.valueCents, 0),
    weightedPipelineValueCents: stages.reduce((n, s) => n + s.weightedValueCents, 0),
    wonThisMonth: Number(c.won_month ?? 0),
    wonValueCentsThisMonth: Number(c.won_value_month ?? 0),
    stages,
    activityLast7Days: activityRows.map((r) => ({ type: r.type as ActivityType, count: Number(r.n) })),
    callsByDay,
  };
}

/* --------------------------------------------------------- api quotas */

export async function getUsage(
  sql: Sql,
  key: string,
  periodType: "month" | "day",
  period: string,
): Promise<number> {
  const rows = await sql<Row[]>`
    SELECT count FROM api_usage
    WHERE quota_key = ${key} AND period_type = ${periodType} AND period = ${period}`;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Bump both period counters atomically. Upserts rather than read-modify-write
 * so concurrent serverless invocations can't lose increments and overshoot the
 * free tier.
 */
export async function incrementUsage(sql: Sql, key: string, count: number): Promise<void> {
  const now = new Date().toISOString();
  const month = now.slice(0, 7);
  const day = now.slice(0, 10);
  await sql`
    INSERT INTO api_usage (quota_key, period_type, period, count, updated_at)
    VALUES (${key}, 'month', ${month}, ${count}, now()),
           (${key}, 'day',   ${day},   ${count}, now())
    ON CONFLICT (quota_key, period_type, period)
    DO UPDATE SET count = api_usage.count + EXCLUDED.count, updated_at = now()`;
}
