import { randomUUID } from "node:crypto";
import type { LeadFilters, ScanRunSummary, Territory, Lead, LeadStats } from "../types";
import { computeStats, matchesFilters, sortLeads } from "./filters";
import { DEFAULT_PIPELINES, DEFAULT_SEQUENCES, DEFAULT_TEMPLATES } from "../crm/defaults";
import type {
  Activity,
  ActivityInput,
  ActivityType,
  DashboardSummary,
  MessageTemplate,
  Pipeline,
  PipelineStage,
  PipelineWithStages,
  SavedView,
  Sequence,
  SequenceEnrollment,
  SequenceStep,
  SequenceWithSteps,
  StageRollup,
  Task,
  TaskWithLead,
} from "../crm/types";
import type {
  Facets,
  LeadPage,
  LeadPatch,
  LeadUpsert,
  ResearchTargetInput,
  Store,
  TaskFilters,
  TaskInput,
  UpsertResult,
} from "./store";

interface MemoryState {
  leads: Map<string, Lead>;
  territories: Map<string, Territory>;
  scans: ScanRunSummary[];
  prefs: Map<string, unknown>;
  pipelines: Map<string, Pipeline>;
  stages: Map<string, PipelineStage>;
  activities: Map<string, Activity>;
  tasks: Map<string, Task>;
  sequences: Map<string, Sequence>;
  steps: Map<string, SequenceStep>;
  enrollments: Map<string, SequenceEnrollment>;
  templates: Map<string, MessageTemplate>;
  savedViews: Map<string, SavedView>;
  usage: Map<string, number>;
  /** identity key -> lead id, so dedupe survives between scans. */
  identities: Map<string, string>;
  /** url -> what researching it found, so credits are never spent twice. */
  research: Map<
    string,
    { domain: string; outcome: string; leadId: string | null; researchedAt: string }
  >;
  seeded: boolean;
}

/**
 * Held on globalThis so Next's dev-mode module reloading doesn't wipe the data
 * on every edit. This store starts empty — the app never fabricates leads.
 */
const globalRef = globalThis as unknown as { __leadsignalMemory?: MemoryState };

function state(): MemoryState {
  if (!globalRef.__leadsignalMemory) {
    globalRef.__leadsignalMemory = {
      leads: new Map(),
      territories: new Map(),
      scans: [],
      prefs: new Map(),
      pipelines: new Map(),
      stages: new Map(),
      activities: new Map(),
      tasks: new Map(),
      sequences: new Map(),
      steps: new Map(),
      enrollments: new Map(),
      templates: new Map(),
      savedViews: new Map(),
      usage: new Map(),
      identities: new Map(),
      research: new Map(),
      seeded: false,
    };
  }
  return globalRef.__leadsignalMemory;
}

const OUTREACH_TYPES: ActivityType[] = ["call", "email", "sms", "meeting"];

export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  async init(): Promise<void> {
    const s = state();
    if (s.seeded) return;
    s.seeded = true;

    // Seed CRM configuration only — never leads.
    DEFAULT_PIPELINES.forEach((seed, i) => {
      const id = randomUUID();
      s.pipelines.set(id, {
        id,
        name: seed.name,
        niche: seed.niche,
        isDefault: seed.isDefault,
        position: i,
        createdAt: new Date().toISOString(),
      });
      seed.stages.forEach((stage, j) => {
        const sid = randomUUID();
        s.stages.set(sid, {
          id: sid,
          pipelineId: id,
          name: stage.name,
          position: j,
          probability: stage.probability,
          isWon: stage.isWon ?? false,
          isLost: stage.isLost ?? false,
        });
      });
    });

    DEFAULT_SEQUENCES.forEach((seed) => {
      const id = randomUUID();
      s.sequences.set(id, {
        id,
        name: seed.name,
        description: seed.description,
        niche: seed.niche,
        active: true,
        createdAt: new Date().toISOString(),
      });
      seed.steps.forEach((step, i) => {
        const stepId = randomUUID();
        s.steps.set(stepId, { id: stepId, sequenceId: id, position: i, ...step });
      });
    });

    DEFAULT_TEMPLATES.forEach((t) => {
      const id = randomUUID();
      s.templates.set(id, { id, ...t, createdAt: new Date().toISOString() });
    });
  }

  /* ------------------------------------------------------------- leads */

  async listLeads(filters: LeadFilters): Promise<LeadPage> {
    const s = state();
    let all = [...s.leads.values()].filter((l) => matchesFilters(l, filters));

    if (filters.stageIds?.length) {
      all = all.filter((l) => l.stageId && filters.stageIds!.includes(l.stageId));
    }
    if (filters.tags?.length) {
      all = all.filter((l) => l.tags.some((t) => filters.tags!.includes(t)));
    }
    if (filters.dueOnly) {
      const now = Date.now();
      const dueLeadIds = new Set(
        [...s.tasks.values()]
          .filter((t) => !t.completedAt && t.dueAt && Date.parse(t.dueAt) <= now && t.leadId)
          .map((t) => t.leadId as string),
      );
      all = all.filter((l) => dueLeadIds.has(l.id));
    }
    if (filters.untouchedOnly) {
      const touched = new Set(
        [...s.activities.values()]
          .filter((a) => OUTREACH_TYPES.includes(a.type))
          .map((a) => a.leadId),
      );
      all = all.filter((l) => !touched.has(l.id));
    }

    const sorted = sortLeads(all, filters.sort);
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 100;
    return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
  }

  async getLead(id: string): Promise<Lead | null> {
    return state().leads.get(id) ?? null;
  }

  /** Entry pipeline + first stage for a niche, so new leads land on the board. */
  private entryFor(niche: string): { pipelineId: string | null; stageId: string | null } {
    const s = state();
    const pipelines = [...s.pipelines.values()].sort((a, b) => a.position - b.position);
    const p =
      pipelines.find((x) => x.niche === niche) ?? pipelines.find((x) => x.isDefault) ?? pipelines[0];
    if (!p) return { pipelineId: null, stageId: null };
    const stage = [...s.stages.values()]
      .filter((x) => x.pipelineId === p.id && !x.isWon && !x.isLost)
      .sort((a, b) => a.position - b.position)[0];
    return { pipelineId: p.id, stageId: stage?.id ?? null };
  }

  async upsertLeads(incoming: LeadUpsert[]): Promise<UpsertResult> {
    const s = state();
    let inserted = 0;
    let updated = 0;
    const insertedIds: string[] = [];

    for (const row of incoming) {
      const keys = row.identityKeys?.length ? row.identityKeys : [row.sourceId];
      // Any previously seen key identifies this business, so a lead found
      // under a different key last time is updated rather than duplicated.
      const existingId = keys.map((k) => s.identities.get(k)).find(Boolean) ?? null;
      const existing = existingId ? s.leads.get(existingId) : undefined;

      if (existing) {
        // Preserve everything the user owns, and never blank a field the new
        // record simply didn't know about.
        s.leads.set(existing.id, {
          ...existing,
          ...row,
          id: existing.id,
          sourceId: existing.sourceId,
          phone: row.phone ?? existing.phone,
          email: row.email ?? existing.email,
          website: row.website ?? existing.website,
          websiteHost: row.websiteHost ?? existing.websiteHost,
          address: row.address ?? existing.address,
          city: row.city ?? existing.city,
          state: row.state ?? existing.state,
          postalCode: row.postalCode ?? existing.postalCode,
          lat: row.lat ?? existing.lat,
          lng: row.lng ?? existing.lng,
          rating: row.rating ?? existing.rating,
          reviewCount: row.reviewCount ?? existing.reviewCount,
          photoCount: row.photoCount ?? existing.photoCount,
          hasHours: row.hasHours ?? existing.hasHours,
          discoveredAt: existing.discoveredAt,
        });
        for (const k of keys) if (!s.identities.has(k)) s.identities.set(k, existing.id);
        updated += 1;
      } else {
        const id = randomUUID();
        const entry = this.entryFor(row.niche);
        const lead: Lead = {
          ...row,
          id,
          status: "new",
          notes: "",
          pipelineId: entry.pipelineId,
          stageId: entry.stageId,
          valueCents: 0,
          tags: [],
          customFields: {},
          nextActionAt: null,
          lastContactedAt: null,
          doNotContact: false,
          discoveredAt: row.lastSeenAt,
        };
        s.leads.set(id, lead);
        for (const k of keys) if (!s.identities.has(k)) s.identities.set(k, id);
        inserted += 1;
        insertedIds.push(id);
      }
    }
    return { inserted, updated, insertedIds };
  }

  async patchLead(id: string, patch: LeadPatch): Promise<Lead | null> {
    const s = state();
    const existing = s.leads.get(id);
    if (!existing) return null;

    const next: Lead = { ...existing };
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.notes !== undefined) next.notes = patch.notes;
    if ("stageId" in patch) next.stageId = patch.stageId ?? null;
    if ("pipelineId" in patch) next.pipelineId = patch.pipelineId ?? null;
    if (patch.valueCents !== undefined) next.valueCents = patch.valueCents;
    if (patch.tags !== undefined) next.tags = patch.tags;
    if (patch.customFields !== undefined) next.customFields = patch.customFields;
    if ("nextActionAt" in patch) next.nextActionAt = patch.nextActionAt ?? null;
    if ("lastContactedAt" in patch) next.lastContactedAt = patch.lastContactedAt ?? null;
    if (patch.doNotContact !== undefined) next.doNotContact = patch.doNotContact;

    s.leads.set(id, next);

    if (existing.stageId !== next.stageId) {
      const from = existing.stageId ? s.stages.get(existing.stageId)?.name : undefined;
      const to = next.stageId ? s.stages.get(next.stageId)?.name : undefined;
      await this.logActivity({
        leadId: id,
        type: "stage_change",
        body: `${from ?? "unassigned"} → ${to ?? "unassigned"}`,
        outcome: null,
        meta: { from, to },
        actor: "me",
        durationMinutes: null,
      });
    }
    return next;
  }

  async bulkPatchLeads(ids: string[], patch: LeadPatch): Promise<number> {
    let n = 0;
    for (const id of ids) if (await this.patchLead(id, patch)) n += 1;
    return n;
  }

  async deleteLead(id: string): Promise<boolean> {
    const s = state();
    for (const [aid, a] of s.activities) if (a.leadId === id) s.activities.delete(aid);
    for (const [tid, t] of s.tasks) if (t.leadId === id) s.tasks.delete(tid);
    for (const [eid, e] of s.enrollments) if (e.leadId === id) s.enrollments.delete(eid);
    return s.leads.delete(id);
  }

  async stats(): Promise<LeadStats> {
    return computeStats([...state().leads.values()]);
  }

  async facets(): Promise<Facets> {
    const leads = [...state().leads.values()];
    return {
      states: [...new Set(leads.map((l) => l.state).filter((v): v is string => Boolean(v)))].sort(),
      cities: [...new Set(leads.map((l) => l.city).filter((v): v is string => Boolean(v)))].sort(),
      tags: [...new Set(leads.flatMap((l) => l.tags))].sort(),
    };
  }

  /* ------------------------------------------------------- territories */

  async listTerritories(): Promise<Territory[]> {
    return [...state().territories.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  async createTerritory(
    t: Omit<Territory, "id" | "createdAt" | "lastScannedAt" | "leadsFound" | "lat" | "lng">,
  ): Promise<Territory> {
    const territory: Territory = {
      ...t,
      id: randomUUID(),
      lat: null,
      lng: null,
      createdAt: new Date().toISOString(),
      lastScannedAt: null,
      leadsFound: 0,
    };
    state().territories.set(territory.id, territory);
    return territory;
  }

  async updateTerritory(id: string, patch: Partial<Territory>): Promise<Territory | null> {
    const s = state();
    const existing = s.territories.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id };
    s.territories.set(id, next);
    return next;
  }

  async deleteTerritory(id: string): Promise<boolean> {
    return state().territories.delete(id);
  }

  /* -------------------------------------------------------------- scans */

  async recordScan(summary: ScanRunSummary): Promise<void> {
    const s = state();
    s.scans.unshift(summary);
    s.scans = s.scans.slice(0, 30);
  }

  async recentScans(limit = 10): Promise<ScanRunSummary[]> {
    return state().scans.slice(0, limit);
  }

  async getPref(key: string): Promise<unknown | null> {
    return state().prefs.get(key) ?? null;
  }

  async setPref(key: string, value: unknown): Promise<void> {
    state().prefs.set(key, value);
  }

  /* ---------------------------------------------------------- pipelines */

  async listPipelines(): Promise<PipelineWithStages[]> {
    const s = state();
    return [...s.pipelines.values()]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        ...p,
        stages: [...s.stages.values()]
          .filter((x) => x.pipelineId === p.id)
          .sort((a, b) => a.position - b.position),
      }));
  }

  async createPipeline(name: string, niche: Pipeline["niche"]): Promise<PipelineWithStages> {
    const s = state();
    const id = randomUUID();
    s.pipelines.set(id, {
      id,
      name,
      niche,
      isDefault: false,
      position: s.pipelines.size,
      createdAt: new Date().toISOString(),
    });
    DEFAULT_PIPELINES[0].stages.forEach((stage, j) => {
      const sid = randomUUID();
      s.stages.set(sid, {
        id: sid,
        pipelineId: id,
        name: stage.name,
        position: j,
        probability: stage.probability,
        isWon: stage.isWon ?? false,
        isLost: stage.isLost ?? false,
      });
    });
    return (await this.listPipelines()).find((p) => p.id === id)!;
  }

  async updatePipeline(id: string, patch: Partial<Pipeline>): Promise<Pipeline | null> {
    const s = state();
    const existing = s.pipelines.get(id);
    if (!existing) return null;
    if (patch.isDefault) {
      for (const [pid, p] of s.pipelines) s.pipelines.set(pid, { ...p, isDefault: false });
    }
    const next = { ...s.pipelines.get(id)!, ...patch, id };
    s.pipelines.set(id, next);
    return next;
  }

  async deletePipeline(id: string): Promise<boolean> {
    const s = state();
    for (const [sid, st] of s.stages) if (st.pipelineId === id) s.stages.delete(sid);
    return s.pipelines.delete(id);
  }

  async createStage(pipelineId: string, name: string, position: number): Promise<PipelineStage> {
    const stage: PipelineStage = {
      id: randomUUID(),
      pipelineId,
      name,
      position,
      probability: 0,
      isWon: false,
      isLost: false,
    };
    state().stages.set(stage.id, stage);
    return stage;
  }

  async updateStage(id: string, patch: Partial<PipelineStage>): Promise<PipelineStage | null> {
    const s = state();
    const existing = s.stages.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id };
    s.stages.set(id, next);
    return next;
  }

  async deleteStage(id: string): Promise<boolean> {
    return state().stages.delete(id);
  }

  async defaultPipelineFor(niche: string): Promise<PipelineWithStages | null> {
    const all = await this.listPipelines();
    return all.find((p) => p.niche === niche) ?? all.find((p) => p.isDefault) ?? all[0] ?? null;
  }

  /* --------------------------------------------------------- activities */

  async listActivities(leadId: string, limit = 100): Promise<Activity[]> {
    return [...state().activities.values()]
      .filter((a) => a.leadId === leadId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async logActivity(input: ActivityInput): Promise<Activity> {
    const s = state();
    const activity: Activity = {
      ...input,
      id: randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    s.activities.set(activity.id, activity);

    if (OUTREACH_TYPES.includes(activity.type)) {
      const lead = s.leads.get(activity.leadId);
      if (lead) s.leads.set(lead.id, { ...lead, lastContactedAt: activity.createdAt });
    }
    return activity;
  }

  async deleteActivity(id: string): Promise<boolean> {
    return state().activities.delete(id);
  }

  /* -------------------------------------------------------------- tasks */

  private refreshNextAction(leadId: string | null): void {
    if (!leadId) return;
    const s = state();
    const lead = s.leads.get(leadId);
    if (!lead) return;
    const due = [...s.tasks.values()]
      .filter((t) => t.leadId === leadId && !t.completedAt && t.dueAt)
      .map((t) => t.dueAt as string)
      .sort();
    s.leads.set(leadId, { ...lead, nextActionAt: due[0] ?? null });
  }

  async listTasks(f: TaskFilters): Promise<TaskWithLead[]> {
    const s = state();
    let tasks = [...s.tasks.values()];
    if (!f.includeCompleted) tasks = tasks.filter((t) => !t.completedAt);
    if (f.leadId) tasks = tasks.filter((t) => t.leadId === f.leadId);
    if (f.dueBefore) {
      const cutoff = Date.parse(f.dueBefore);
      tasks = tasks.filter((t) => t.dueAt && Date.parse(t.dueAt) <= cutoff);
    }
    tasks.sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    });
    return tasks.slice(0, f.limit ?? 200).map((t) => {
      const lead = t.leadId ? s.leads.get(t.leadId) : null;
      return {
        ...t,
        leadName: lead?.name ?? null,
        leadPhone: lead?.phone ?? null,
        leadCity: lead?.city ?? null,
        leadScore: lead?.score ?? null,
      };
    });
  }

  async createTask(input: TaskInput): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      leadId: input.leadId,
      title: input.title,
      notes: input.notes ?? "",
      type: input.type ?? "followup",
      priority: input.priority ?? "normal",
      dueAt: input.dueAt ?? null,
      completedAt: null,
      enrollmentId: input.enrollmentId ?? null,
      createdAt: new Date().toISOString(),
    };
    state().tasks.set(task.id, task);
    this.refreshNextAction(task.leadId);
    return task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    const s = state();
    const existing = s.tasks.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id };
    s.tasks.set(id, next);
    this.refreshNextAction(next.leadId);

    if ("completedAt" in patch && patch.completedAt && next.leadId) {
      await this.logActivity({
        leadId: next.leadId,
        type: "task_completed",
        body: next.title,
        outcome: null,
        meta: { taskType: next.type },
        actor: "me",
        durationMinutes: null,
      });
    }
    return next;
  }

  async deleteTask(id: string): Promise<boolean> {
    const s = state();
    const task = s.tasks.get(id);
    if (!task) return false;
    s.tasks.delete(id);
    this.refreshNextAction(task.leadId);
    return true;
  }

  /* ---------------------------------------------------------- sequences */

  async listSequences(): Promise<SequenceWithSteps[]> {
    const s = state();
    return [...s.sequences.values()].map((seq) => ({
      ...seq,
      steps: [...s.steps.values()]
        .filter((st) => st.sequenceId === seq.id)
        .sort((a, b) => a.position - b.position),
    }));
  }

  async createSequence(seq: Omit<Sequence, "id" | "createdAt">): Promise<Sequence> {
    const created: Sequence = { ...seq, id: randomUUID(), createdAt: new Date().toISOString() };
    state().sequences.set(created.id, created);
    return created;
  }

  async updateSequence(id: string, patch: Partial<Sequence>): Promise<Sequence | null> {
    const s = state();
    const existing = s.sequences.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id };
    s.sequences.set(id, next);
    return next;
  }

  async deleteSequence(id: string): Promise<boolean> {
    const s = state();
    for (const [sid, st] of s.steps) if (st.sequenceId === id) s.steps.delete(sid);
    return s.sequences.delete(id);
  }

  async replaceSequenceSteps(
    sequenceId: string,
    steps: Array<Omit<SequenceStep, "id" | "sequenceId">>,
  ): Promise<SequenceStep[]> {
    const s = state();
    for (const [sid, st] of s.steps) if (st.sequenceId === sequenceId) s.steps.delete(sid);
    return steps.map((step, i) => {
      const created: SequenceStep = { ...step, id: randomUUID(), sequenceId, position: i };
      s.steps.set(created.id, created);
      return created;
    });
  }

  async enrollLead(sequenceId: string, leadId: string): Promise<SequenceEnrollment> {
    const s = state();
    const firstStep = [...s.steps.values()]
      .filter((st) => st.sequenceId === sequenceId)
      .sort((a, b) => a.position - b.position)[0];
    const existing = [...s.enrollments.values()].find(
      (e) => e.sequenceId === sequenceId && e.leadId === leadId,
    );
    const enrollment: SequenceEnrollment = {
      id: existing?.id ?? randomUUID(),
      sequenceId,
      leadId,
      status: "active",
      currentStep: 0,
      startedAt: new Date().toISOString(),
      nextDueAt: new Date(Date.now() + (firstStep?.dayOffset ?? 0) * 86400000).toISOString(),
      completedAt: null,
    };
    s.enrollments.set(enrollment.id, enrollment);

    await this.logActivity({
      leadId,
      type: "sequence_enrolled",
      body: `Enrolled in “${s.sequences.get(sequenceId)?.name ?? "sequence"}”`,
      outcome: null,
      meta: { sequenceId },
      actor: "me",
      durationMinutes: null,
    });
    return enrollment;
  }

  async listEnrollments(leadId?: string): Promise<SequenceEnrollment[]> {
    const all = [...state().enrollments.values()];
    return leadId ? all.filter((e) => e.leadId === leadId) : all;
  }

  async updateEnrollment(
    id: string,
    patch: Partial<SequenceEnrollment>,
  ): Promise<SequenceEnrollment | null> {
    const s = state();
    const existing = s.enrollments.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id };
    s.enrollments.set(id, next);
    return next;
  }

  async dueEnrollments(at: string): Promise<SequenceEnrollment[]> {
    const cutoff = Date.parse(at);
    return [...state().enrollments.values()].filter(
      (e) => e.status === "active" && e.nextDueAt && Date.parse(e.nextDueAt) <= cutoff,
    );
  }

  /* ---------------------------------------------------------- templates */

  async listTemplates(): Promise<MessageTemplate[]> {
    return [...state().templates.values()];
  }

  async createTemplate(t: Omit<MessageTemplate, "id" | "createdAt">): Promise<MessageTemplate> {
    const created: MessageTemplate = { ...t, id: randomUUID(), createdAt: new Date().toISOString() };
    state().templates.set(created.id, created);
    return created;
  }

  async updateTemplate(
    id: string,
    patch: Partial<MessageTemplate>,
  ): Promise<MessageTemplate | null> {
    const s = state();
    const existing = s.templates.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id };
    s.templates.set(id, next);
    return next;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return state().templates.delete(id);
  }

  /* -------------------------------------------------------- saved views */

  async listSavedViews(): Promise<SavedView[]> {
    return [...state().savedViews.values()].sort((a, b) => a.position - b.position);
  }

  async createSavedView(name: string, filters: Record<string, unknown>): Promise<SavedView> {
    const s = state();
    const view: SavedView = {
      id: randomUUID(),
      name,
      filters,
      position: s.savedViews.size,
      createdAt: new Date().toISOString(),
    };
    s.savedViews.set(view.id, view);
    return view;
  }

  async deleteSavedView(id: string): Promise<boolean> {
    return state().savedViews.delete(id);
  }

  /* ---------------------------------------------------------- dashboard */

  async dashboard(): Promise<DashboardSummary> {
    const s = state();
    const leads = [...s.leads.values()];
    const tasks = [...s.tasks.values()].filter((t) => !t.completedAt);
    const now = Date.now();
    const startOfDay = new Date().setHours(0, 0, 0, 0);

    const touched = new Set(
      [...s.activities.values()].filter((a) => OUTREACH_TYPES.includes(a.type)).map((a) => a.leadId),
    );

    const stageList = [...s.stages.values()]
      .filter((x) => !x.isWon && !x.isLost)
      .sort((a, b) => a.position - b.position);

    const stages: StageRollup[] = stageList.map((stage) => {
      const inStage = leads.filter((l) => l.stageId === stage.id);
      const valueCents = inStage.reduce((n, l) => n + l.valueCents, 0);
      return {
        stageId: stage.id,
        stageName: stage.name,
        probability: stage.probability,
        leadCount: inStage.length,
        valueCents,
        weightedValueCents: Math.round((valueCents * stage.probability) / 100),
      };
    });

    const weekAgo = now - 7 * 86400000;
    const activityCounts = new Map<ActivityType, number>();
    for (const a of s.activities.values()) {
      if (Date.parse(a.createdAt) >= weekAgo) {
        activityCounts.set(a.type, (activityCounts.get(a.type) ?? 0) + 1);
      }
    }

    const callsByDay: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
      const count = [...s.activities.values()].filter(
        (a) => a.type === "call" && a.createdAt.slice(0, 10) === date,
      ).length;
      callsByDay.push({ date, count });
    }

    const wonThisMonth = leads.filter(
      (l) => l.status === "won" && new Date(l.discoveredAt).getMonth() === new Date().getMonth(),
    );

    return {
      tasksDue: tasks.filter((t) => t.dueAt && Date.parse(t.dueAt) <= now).length,
      tasksOverdue: tasks.filter((t) => t.dueAt && Date.parse(t.dueAt) < startOfDay).length,
      untouchedLeads: leads.filter((l) => !touched.has(l.id)).length,
      goingCold: leads.filter(
        (l) =>
          l.lastContactedAt &&
          Date.parse(l.lastContactedAt) < now - 7 * 86400000 &&
          !["won", "lost", "ignored"].includes(l.status),
      ).length,
      newLeadsToday: leads.filter((l) => Date.parse(l.discoveredAt) >= now - 86400000).length,
      newLeadsThisWeek: leads.filter((l) => Date.parse(l.discoveredAt) >= weekAgo).length,
      totalLeads: leads.length,
      pipelineValueCents: stages.reduce((n, x) => n + x.valueCents, 0),
      weightedPipelineValueCents: stages.reduce((n, x) => n + x.weightedValueCents, 0),
      wonThisMonth: wonThisMonth.length,
      wonValueCentsThisMonth: wonThisMonth.reduce((n, l) => n + l.valueCents, 0),
      stages,
      activityLast7Days: [...activityCounts.entries()].map(([type, count]) => ({ type, count })),
      callsByDay,
    };
  }

  /* -------------------------------------------------------- api quotas */

  async getUsage(key: string, periodType: "month" | "day", period: string): Promise<number> {
    return state().usage.get(`${key}|${periodType}|${period}`) ?? 0;
  }

  async incrementUsage(key: string, count: number): Promise<{ monthly: number; daily: number }> {
    const s = state();
    const now = new Date().toISOString();
    const totals: Record<string, number> = {};
    for (const [type, period] of [
      ["month", now.slice(0, 7)],
      ["day", now.slice(0, 10)],
    ] as const) {
      const k = `${key}|${type}|${period}`;
      // Clamped so a refund can't drive the counter below zero.
      const next = Math.max(0, (s.usage.get(k) ?? 0) + count);
      s.usage.set(k, next);
      totals[type] = next;
    }
    return { monthly: totals.month ?? 0, daily: totals.day ?? 0 };
  }

  async countLeadsByTerritory(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const lead of state().leads.values()) {
      if (!lead.territoryId) continue;
      counts.set(lead.territoryId, (counts.get(lead.territoryId) ?? 0) + 1);
    }
    return counts;
  }

  /* --------------------------------------------------------- identities */

  async resolveIdentities(keys: string[]): Promise<Map<string, string>> {
    const s = state();
    const out = new Map<string, string>();
    for (const k of keys) {
      const id = s.identities.get(k);
      if (id) out.set(k, id);
    }
    return out;
  }

  /* ------------------------------------------------------------ research */

  async seenResearchUrls(urls: string[]): Promise<Set<string>> {
    const s = state();
    return new Set(urls.filter((u) => s.research.has(u)));
  }

  async seenResearchDomains(domains: string[]): Promise<Set<string>> {
    const s = state();
    const seen = new Set([...s.research.values()].map((r) => r.domain));
    return new Set(domains.filter((d) => seen.has(d)));
  }

  async recordResearch(entries: ResearchTargetInput[]): Promise<void> {
    const s = state();
    for (const e of entries) {
      s.research.set(e.url, {
        domain: e.domain,
        outcome: e.outcome,
        leadId: e.leadId ?? null,
        researchedAt: new Date().toISOString(),
      });
    }
  }

  async researchStats(): Promise<{ total: number; converted: number }> {
    const s = state();
    const all = [...s.research.values()];
    return { total: all.length, converted: all.filter((r) => r.outcome === "lead").length };
  }
}
