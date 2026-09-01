import type {
  Lead,
  LeadFilters,
  LeadStats,
  LeadStatus,
  ScanRunSummary,
  Territory,
} from "../types";
import type {
  Activity,
  ActivityInput,
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
  Task,
  TaskWithLead,
} from "../crm/types";

export interface LeadPage {
  rows: Lead[];
  total: number;
}

export interface Facets {
  states: string[];
  cities: string[];
  tags: string[];
}

/** Fields a scan is allowed to overwrite on an existing lead. */
export type LeadUpsert = Omit<
  Lead,
  | "id"
  | "status"
  | "notes"
  | "discoveredAt"
  | "pipelineId"
  | "stageId"
  | "valueCents"
  | "tags"
  | "customFields"
  | "nextActionAt"
  | "lastContactedAt"
  | "doNotContact"
> & {
  /**
   * Every key this business matched on this run. `sourceId` is the strongest
   * of them; the rest are recorded as aliases so a future scan that only
   * learns one of them still resolves to this same lead.
   */
  identityKeys?: string[];
};

export interface UpsertResult {
  inserted: number;
  updated: number;
  /** Ids of rows created by this call, so the scan can log discovery activity. */
  insertedIds: string[];
}

/** Everything a user is allowed to change on a lead by hand. */
export interface LeadPatch {
  status?: LeadStatus;
  notes?: string;
  stageId?: string | null;
  pipelineId?: string | null;
  valueCents?: number;
  tags?: string[];
  customFields?: Record<string, string>;
  nextActionAt?: string | null;
  lastContactedAt?: string | null;
  doNotContact?: boolean;
}

export interface TaskInput {
  leadId: string | null;
  title: string;
  notes?: string;
  type?: Task["type"];
  priority?: Task["priority"];
  dueAt?: string | null;
  enrollmentId?: string | null;
}

export interface TaskFilters {
  /** Only tasks due at or before this ISO timestamp. */
  dueBefore?: string;
  includeCompleted?: boolean;
  leadId?: string;
  limit?: number;
}

/**
 * Storage contract. Two implementations ship: an in-process memory store for
 * local dev, and Postgres for anything that needs to survive a deploy.
 */
export interface Store {
  readonly kind: "memory" | "postgres";
  init(): Promise<void>;

  /* ------------------------------------------------------------- leads */
  listLeads(filters: LeadFilters): Promise<LeadPage>;
  getLead(id: string): Promise<Lead | null>;
  upsertLeads(leads: LeadUpsert[]): Promise<UpsertResult>;
  patchLead(id: string, patch: LeadPatch): Promise<Lead | null>;
  deleteLead(id: string): Promise<boolean>;
  /** Bulk stage/status/tag changes from the leads table. */
  bulkPatchLeads(ids: string[], patch: LeadPatch): Promise<number>;
  stats(): Promise<LeadStats>;
  facets(): Promise<Facets>;

  /* ------------------------------------------------------- territories */
  listTerritories(): Promise<Territory[]>;
  createTerritory(
    t: Omit<Territory, "id" | "createdAt" | "lastScannedAt" | "leadsFound" | "lat" | "lng">,
  ): Promise<Territory>;
  updateTerritory(id: string, patch: Partial<Territory>): Promise<Territory | null>;
  deleteTerritory(id: string): Promise<boolean>;

  /* -------------------------------------------------------------- scans */
  recordScan(summary: ScanRunSummary): Promise<void>;
  recentScans(limit?: number): Promise<ScanRunSummary[]>;

  /* -------------------------------------------------------------- prefs */
  getPref(key: string): Promise<unknown | null>;
  setPref(key: string, value: unknown): Promise<void>;

  /* ---------------------------------------------------------- pipelines */
  listPipelines(): Promise<PipelineWithStages[]>;
  createPipeline(name: string, niche: Pipeline["niche"]): Promise<PipelineWithStages>;
  updatePipeline(id: string, patch: Partial<Pipeline>): Promise<Pipeline | null>;
  deletePipeline(id: string): Promise<boolean>;
  createStage(pipelineId: string, name: string, position: number): Promise<PipelineStage>;
  updateStage(id: string, patch: Partial<PipelineStage>): Promise<PipelineStage | null>;
  deleteStage(id: string): Promise<boolean>;
  /** Default pipeline for a niche, falling back to the global default. */
  defaultPipelineFor(niche: string): Promise<PipelineWithStages | null>;

  /* --------------------------------------------------------- activities */
  listActivities(leadId: string, limit?: number): Promise<Activity[]>;
  logActivity(input: ActivityInput): Promise<Activity>;
  deleteActivity(id: string): Promise<boolean>;

  /* -------------------------------------------------------------- tasks */
  listTasks(filters: TaskFilters): Promise<TaskWithLead[]>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task | null>;
  deleteTask(id: string): Promise<boolean>;

  /* ---------------------------------------------------------- sequences */
  listSequences(): Promise<SequenceWithSteps[]>;
  createSequence(seq: Omit<Sequence, "id" | "createdAt">): Promise<Sequence>;
  updateSequence(id: string, patch: Partial<Sequence>): Promise<Sequence | null>;
  deleteSequence(id: string): Promise<boolean>;
  replaceSequenceSteps(
    sequenceId: string,
    steps: Array<Omit<SequenceStep, "id" | "sequenceId">>,
  ): Promise<SequenceStep[]>;

  enrollLead(sequenceId: string, leadId: string): Promise<SequenceEnrollment>;
  listEnrollments(leadId?: string): Promise<SequenceEnrollment[]>;
  updateEnrollment(
    id: string,
    patch: Partial<SequenceEnrollment>,
  ): Promise<SequenceEnrollment | null>;
  /** Active enrollments whose next step is due at or before `at`. */
  dueEnrollments(at: string): Promise<SequenceEnrollment[]>;

  /* ---------------------------------------------------------- templates */
  listTemplates(): Promise<MessageTemplate[]>;
  createTemplate(t: Omit<MessageTemplate, "id" | "createdAt">): Promise<MessageTemplate>;
  updateTemplate(id: string, patch: Partial<MessageTemplate>): Promise<MessageTemplate | null>;
  deleteTemplate(id: string): Promise<boolean>;

  /* -------------------------------------------------------- saved views */
  listSavedViews(): Promise<SavedView[]>;
  createSavedView(name: string, filters: Record<string, unknown>): Promise<SavedView>;
  deleteSavedView(id: string): Promise<boolean>;

  /* ---------------------------------------------------------- dashboard */
  dashboard(): Promise<DashboardSummary>;

  /** Current number of leads per territory id. */
  countLeadsByTerritory(): Promise<Map<string, number>>;

  /* -------------------------------------------------------- api quotas */
  /** Calls recorded for a provider in a period ("month"/"day" + period key). */
  getUsage(key: string, periodType: "month" | "day", period: string): Promise<number>;
  /**
   * Add `count` to both the current month and day, returning the resulting
   * totals. Must be atomic: the returned numbers are what make it safe for
   * two scans to reserve budget at the same time. A negative `count` refunds
   * a reservation that turned out to exceed the cap.
   */
  incrementUsage(key: string, count: number): Promise<{ monthly: number; daily: number }>;

  /* --------------------------------------------------------- identities */
  /**
   * Map identity keys to the leads already holding them. The scan uses this to
   * recognise a business it has seen before, even when this run matched it on
   * a different key than last time.
   */
  resolveIdentities(keys: string[]): Promise<Map<string, string>>;

  /* ------------------------------------------------------------ research */
  /** URLs already researched, out of the given set. Keeps credits from being spent twice. */
  seenResearchUrls(urls: string[]): Promise<Set<string>>;
  /** Domains already researched, out of the given set. */
  seenResearchDomains(domains: string[]): Promise<Set<string>>;
  /** Record what a research attempt found, including the misses. */
  recordResearch(entries: ResearchTargetInput[]): Promise<void>;
  /** How many pages the agent has looked at, for the settings panel. */
  researchStats(): Promise<{ total: number; converted: number }>;
}

/** Outcome of researching one page. */
export type ResearchOutcome =
  /** Produced a usable business record. */
  | "lead"
  /** Read fine, but wasn't a business we want (aggregator, wrong niche, franchise). */
  | "rejected"
  /** Couldn't be read at all. */
  | "unreadable";

export interface ResearchTargetInput {
  url: string;
  domain: string;
  niche: string | null;
  outcome: ResearchOutcome;
  leadId?: string | null;
}
