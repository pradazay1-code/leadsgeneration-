import { randomUUID } from "node:crypto";
import type { LeadFilters, LeadStats, ScanRunSummary, Territory, Lead } from "../types";
import { buildDemoLeads, buildDemoTerritories } from "./demo";
import { computeStats, matchesFilters, sortLeads } from "./filters";
import type { Facets, LeadPage, LeadPatch, LeadUpsert, Store, UpsertResult } from "./store";

interface MemoryState {
  leads: Map<string, Lead>;
  territories: Map<string, Territory>;
  scans: ScanRunSummary[];
  seeded: boolean;
}

/**
 * Held on globalThis so Next's dev-mode module reloading doesn't wipe the data
 * on every edit.
 */
const globalRef = globalThis as unknown as { __leadsignalMemory?: MemoryState };

function state(): MemoryState {
  if (!globalRef.__leadsignalMemory) {
    globalRef.__leadsignalMemory = {
      leads: new Map(),
      territories: new Map(),
      scans: [],
      seeded: false,
    };
  }
  return globalRef.__leadsignalMemory;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  async init(): Promise<void> {
    const s = state();
    if (s.seeded) return;
    s.seeded = true;
    // Seed demo content only when nothing real has been scanned yet.
    if (s.leads.size === 0) {
      for (const lead of buildDemoLeads()) s.leads.set(lead.id, lead);
    }
    if (s.territories.size === 0) {
      for (const t of buildDemoTerritories()) s.territories.set(t.id, t);
    }
  }

  async isDemo(): Promise<boolean> {
    const s = state();
    return [...s.leads.values()].every((l) => l.source === "demo");
  }

  async listLeads(filters: LeadFilters): Promise<LeadPage> {
    const all = [...state().leads.values()].filter((l) => matchesFilters(l, filters));
    const sorted = sortLeads(all, filters.sort);
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 100;
    return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
  }

  async getLead(id: string): Promise<Lead | null> {
    return state().leads.get(id) ?? null;
  }

  async upsertLeads(incoming: LeadUpsert[]): Promise<UpsertResult> {
    const s = state();
    const bySource = new Map([...s.leads.values()].map((l) => [l.sourceId, l]));
    let inserted = 0;
    let updated = 0;

    for (const row of incoming) {
      const existing = bySource.get(row.sourceId);
      if (existing) {
        // Preserve everything the user owns: status, notes, discovery date.
        s.leads.set(existing.id, { ...existing, ...row, id: existing.id, status: existing.status, notes: existing.notes, discoveredAt: existing.discoveredAt });
        updated += 1;
      } else {
        const id = randomUUID();
        const lead: Lead = { ...row, id, status: "new", notes: "", discoveredAt: row.lastSeenAt };
        s.leads.set(id, lead);
        bySource.set(row.sourceId, lead);
        inserted += 1;
      }
    }

    // First real scan clears the fictional demo rows so they can never be
    // confused with scanned businesses.
    if (inserted > 0) {
      for (const [id, lead] of s.leads) {
        if (lead.source === "demo") s.leads.delete(id);
      }
    }

    return { inserted, updated };
  }

  async patchLead(id: string, patch: LeadPatch): Promise<Lead | null> {
    const s = state();
    const existing = s.leads.get(id);
    if (!existing) return null;
    const next: Lead = {
      ...existing,
      status: patch.status ?? existing.status,
      notes: patch.notes ?? existing.notes,
    };
    s.leads.set(id, next);
    return next;
  }

  async deleteLead(id: string): Promise<boolean> {
    return state().leads.delete(id);
  }

  async stats(): Promise<LeadStats> {
    return computeStats([...state().leads.values()]);
  }

  async facets(): Promise<Facets> {
    const leads = [...state().leads.values()];
    return {
      states: [...new Set(leads.map((l) => l.state).filter((v): v is string => Boolean(v)))].sort(),
      cities: [...new Set(leads.map((l) => l.city).filter((v): v is string => Boolean(v)))].sort(),
    };
  }

  async listTerritories(): Promise<Territory[]> {
    return [...state().territories.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  async createTerritory(
    t: Omit<Territory, "id" | "createdAt" | "lastScannedAt" | "leadsFound">,
  ): Promise<Territory> {
    const territory: Territory = {
      ...t,
      id: randomUUID(),
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

  async recordScan(summary: ScanRunSummary): Promise<void> {
    const s = state();
    s.scans.unshift(summary);
    s.scans = s.scans.slice(0, 30);
  }

  async recentScans(limit = 10): Promise<ScanRunSummary[]> {
    return state().scans.slice(0, limit);
  }
}
