import type {
  Lead,
  LeadFilters,
  LeadStats,
  LeadStatus,
  ScanRunSummary,
  Territory,
} from "../types";

export interface LeadPage {
  rows: Lead[];
  total: number;
}

export interface Facets {
  states: string[];
  cities: string[];
}

/** Fields a scan is allowed to overwrite on an existing lead. */
export type LeadUpsert = Omit<Lead, "id" | "status" | "notes" | "discoveredAt">;

export interface UpsertResult {
  inserted: number;
  updated: number;
}

export interface LeadPatch {
  status?: LeadStatus;
  notes?: string;
}

/**
 * Storage contract. Two implementations ship: an in-process memory store for
 * local dev / demo, and Postgres for anything that needs to survive a deploy.
 */
export interface Store {
  readonly kind: "memory" | "postgres";
  /** True when the store is backed by demo rows rather than scanned data. */
  isDemo(): Promise<boolean>;
  init(): Promise<void>;

  listLeads(filters: LeadFilters): Promise<LeadPage>;
  getLead(id: string): Promise<Lead | null>;
  upsertLeads(leads: LeadUpsert[]): Promise<UpsertResult>;
  patchLead(id: string, patch: LeadPatch): Promise<Lead | null>;
  deleteLead(id: string): Promise<boolean>;
  stats(): Promise<LeadStats>;
  facets(): Promise<Facets>;

  listTerritories(): Promise<Territory[]>;
  createTerritory(
    t: Omit<Territory, "id" | "createdAt" | "lastScannedAt" | "leadsFound">,
  ): Promise<Territory>;
  updateTerritory(id: string, patch: Partial<Territory>): Promise<Territory | null>;
  deleteTerritory(id: string): Promise<boolean>;

  recordScan(summary: ScanRunSummary): Promise<void>;
  recentScans(limit?: number): Promise<ScanRunSummary[]>;
}
