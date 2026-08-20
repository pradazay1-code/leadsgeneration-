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
>;

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
}
