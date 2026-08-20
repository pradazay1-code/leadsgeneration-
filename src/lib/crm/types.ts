import type { NicheId } from "../types";

/* ------------------------------------------------------------- Pipelines */

/**
 * A sales pipeline. Modelled on GoHighLevel: unlimited pipelines, each with
 * ordered stages, so the junk-removal motion and the real-estate motion can
 * differ without fighting each other.
 */
export interface Pipeline {
  id: string;
  name: string;
  /** Optional niche this pipeline is the default for. */
  niche: NicheId | null;
  isDefault: boolean;
  position: number;
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  /** 0-100. Drives weighted pipeline value on the dashboard. */
  probability: number;
  /** Terminal stages: exactly one won and one lost per pipeline, by convention. */
  isWon: boolean;
  isLost: boolean;
}

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStage[];
}

/* ------------------------------------------------------------ Activities */

/**
 * Timeline entry. Everything that happens to a lead lands here — this is what
 * makes a CRM a CRM rather than a spreadsheet. Most are written automatically
 * by the system; notes and call logs come from the user.
 */
export type ActivityType =
  | "note"
  | "call"
  | "email"
  | "sms"
  | "meeting"
  | "stage_change"
  | "status_change"
  | "task_completed"
  | "sequence_enrolled"
  | "sequence_step"
  | "discovered"
  | "rescanned";

/** How a contact attempt went. Null for non-outreach activities. */
export type CallOutcome =
  | "connected"
  | "voicemail"
  | "no_answer"
  | "wrong_number"
  | "not_interested"
  | "interested"
  | "booked";

export const CALL_OUTCOMES: CallOutcome[] = [
  "connected",
  "voicemail",
  "no_answer",
  "wrong_number",
  "not_interested",
  "interested",
  "booked",
];

export interface Activity {
  id: string;
  leadId: string;
  type: ActivityType;
  /** Free text: note body, call summary, email body. */
  body: string;
  outcome: CallOutcome | null;
  /** Structured extras: {from, to} for stage changes, {subject} for email, etc. */
  meta: Record<string, unknown>;
  /** Who did it. Single-operator today, but the column is here for later. */
  actor: string;
  /** Minutes, for calls and meetings. */
  durationMinutes: number | null;
  createdAt: string;
}

export type ActivityInput = Omit<Activity, "id" | "createdAt"> & {
  createdAt?: string;
};

/* ---------------------------------------------------------------- Tasks */

export type TaskType = "call" | "email" | "sms" | "followup" | "research" | "meeting";
export type TaskPriority = "low" | "normal" | "high";

export const TASK_TYPES: TaskType[] = ["call", "email", "sms", "followup", "research", "meeting"];

export interface Task {
  id: string;
  leadId: string | null;
  title: string;
  notes: string;
  type: TaskType;
  priority: TaskPriority;
  /** ISO timestamp; null = someday/no date. */
  dueAt: string | null;
  completedAt: string | null;
  /** Set when a sequence step generated this task. */
  enrollmentId: string | null;
  createdAt: string;
}

/** Task joined with the few lead fields the list view needs. */
export interface TaskWithLead extends Task {
  leadName: string | null;
  leadPhone: string | null;
  leadCity: string | null;
  leadScore: number | null;
}

/* ------------------------------------------------------------ Sequences */

export type SequenceChannel = "call" | "email" | "sms" | "manual";

/**
 * A multi-touch outreach cadence — "Day 0 call, Day 2 email, Day 5 call…".
 * Steps generate tasks (and, once a sender is configured, real messages).
 */
export interface Sequence {
  id: string;
  name: string;
  description: string;
  niche: NicheId | null;
  active: boolean;
  createdAt: string;
}

export interface SequenceStep {
  id: string;
  sequenceId: string;
  position: number;
  /** Days after enrolment this step fires. */
  dayOffset: number;
  channel: SequenceChannel;
  /** Task title / email subject. Supports merge fields. */
  subject: string;
  /** Body with merge fields; used for the email/SMS text or the task notes. */
  body: string;
}

export interface SequenceWithSteps extends Sequence {
  steps: SequenceStep[];
}

export type EnrollmentStatus = "active" | "paused" | "completed" | "stopped";

export interface SequenceEnrollment {
  id: string;
  sequenceId: string;
  leadId: string;
  status: EnrollmentStatus;
  /** Index of the next step to fire. */
  currentStep: number;
  startedAt: string;
  nextDueAt: string | null;
  completedAt: string | null;
}

export interface EnrollmentWithContext extends SequenceEnrollment {
  sequenceName: string;
  leadName: string;
}

/* ------------------------------------------------------------ Templates */

export interface MessageTemplate {
  id: string;
  name: string;
  channel: SequenceChannel;
  subject: string;
  body: string;
  createdAt: string;
}

/* ----------------------------------------------------------- SavedViews */

/** A named filter set — GoHighLevel calls these smart lists. */
export interface SavedView {
  id: string;
  name: string;
  /** Serialised FilterState. */
  filters: Record<string, unknown>;
  position: number;
  createdAt: string;
}

/* ------------------------------------------------------------ Dashboard */

export interface StageRollup {
  stageId: string;
  stageName: string;
  probability: number;
  leadCount: number;
  valueCents: number;
  /** valueCents weighted by stage probability. */
  weightedValueCents: number;
}

export interface ActivityRollup {
  type: ActivityType;
  count: number;
}

export interface DashboardSummary {
  /** Tasks due today or earlier, not yet done. */
  tasksDue: number;
  tasksOverdue: number;
  /** Leads with no activity at all yet. */
  untouchedLeads: number;
  /** Leads whose last contact was more than 7 days ago and aren't closed. */
  goingCold: number;
  newLeadsToday: number;
  newLeadsThisWeek: number;
  totalLeads: number;
  pipelineValueCents: number;
  weightedPipelineValueCents: number;
  wonThisMonth: number;
  wonValueCentsThisMonth: number;
  stages: StageRollup[];
  /** Activity counts over the last 7 days. */
  activityLast7Days: ActivityRollup[];
  /** Calls logged per day for the last 14 days, oldest first. */
  callsByDay: Array<{ date: string; count: number }>;
}
