import "server-only";
import postgres, { type Sql } from "postgres";
import type {
  Lead,
  LeadFilters,
  LeadSort,
  LeadStats,
  LeadStatus,
  NicheId,
  PresenceTier,
  ScanCandidate,
  ScanRunSummary,
  ScoreSignal,
  SourceScanStat,
  SourceId,
  SourceRefs,
  Territory,
} from "../types";
import { LEAD_STATUSES } from "../types";
import { TIER_ORDER } from "../scoring";
import type {
  Facets, LeadPage, LeadPatch, LeadUpsert, Store, TaskFilters, TaskInput, UpsertResult,
} from "./store";
import type {
  Activity, ActivityInput, DashboardSummary, MessageTemplate, Pipeline, PipelineStage,
  PipelineWithStages, SavedView, Sequence, SequenceEnrollment, SequenceStep,
  SequenceWithSteps, Task, TaskWithLead,
} from "../crm/types";
import * as crm from "./postgres-crm";

export function connectionString(): string | null {
  return (
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    null
  );
}

const globalRef = globalThis as unknown as { __leadsignalSql?: Sql };

function client(): Sql {
  if (!globalRef.__leadsignalSql) {
    const url = connectionString();
    if (!url) throw new Error("No POSTGRES_URL / DATABASE_URL configured");
    globalRef.__leadsignalSql = postgres(url, {
      // Serverless functions are short-lived; a small pool avoids exhausting
      // connection limits on hosted Postgres.
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: url.includes("sslmode=disable") ? false : "require",
    });
  }
  return globalRef.__leadsignalSql;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/**
 * postgres.js types `sql.json()` against its own narrow JSONValue shape, which
 * rejects plain interface arrays like ScoreSignal[]. Everything we pass here is
 * genuinely JSON-serialisable, so widen it in one place.
 */
function jsonb(value: unknown) {
  return client().json(value as never);
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function toLead(r: Row): Lead {
  return {
    id: String(r.id),
    sourceId: r.source_id,
    source: r.source as SourceId,
    sources: ((r.sources ?? []) as SourceId[]).length
      ? (r.sources as SourceId[])
      : [r.source as SourceId],
    sourceRefs: (r.source_refs ?? {}) as SourceRefs,
    name: r.name,
    niche: r.niche as NicheId,
    phone: r.phone,
    website: r.website,
    websiteHost: r.website_host,
    address: r.address,
    city: r.city,
    state: r.state,
    postalCode: r.postal_code,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    mapsUrl: r.maps_url,
    rating: numOrNull(r.rating),
    reviewCount: numOrNull(r.review_count),
    photoCount: numOrNull(r.photo_count),
    hasHours: r.has_hours === null || r.has_hours === undefined ? null : Boolean(r.has_hours),
    businessStatus: r.business_status,
    categories: (r.categories ?? []) as string[],
    score: Number(r.score ?? 0),
    tier: r.tier as PresenceTier,
    signals: (r.signals ?? []) as ScoreSignal[],
    status: r.status as LeadStatus,
    notes: r.notes ?? "",
    pipelineId: r.pipeline_id ? String(r.pipeline_id) : null,
    stageId: r.stage_id ? String(r.stage_id) : null,
    valueCents: Number(r.value_cents ?? 0),
    tags: (r.tags ?? []) as string[],
    customFields: (r.custom_fields ?? {}) as Record<string, string>,
    nextActionAt: r.next_action_at ? new Date(r.next_action_at).toISOString() : null,
    lastContactedAt: r.last_contacted_at ? new Date(r.last_contacted_at).toISOString() : null,
    doNotContact: Boolean(r.do_not_contact),
    discoveredAt: new Date(r.discovered_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    territoryId: r.territory_id ? String(r.territory_id) : null,
  };
}

function toTerritory(r: Row): Territory {
  return {
    id: String(r.id),
    label: r.label,
    area: r.area,
    state: r.state,
    niches: (r.niches ?? []) as NicheId[],
    radiusKm: Number(r.radius_km ?? 15),
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    enabled: Boolean(r.enabled),
    createdAt: new Date(r.created_at).toISOString(),
    lastScannedAt: r.last_scanned_at ? new Date(r.last_scanned_at).toISOString() : null,
    leadsFound: Number(r.leads_found ?? 0),
  };
}

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private ready: Promise<void> | null = null;

  async init(): Promise<void> {
    if (!this.ready) this.ready = this.migrate();
    return this.ready;
  }

  private async migrate(): Promise<void> {
    const sql = client();
    await sql`
      CREATE TABLE IF NOT EXISTS territories (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        label           text        NOT NULL,
        area            text        NOT NULL,
        state           text        NOT NULL DEFAULT '',
        niches          jsonb       NOT NULL DEFAULT '[]'::jsonb,
        radius_km       integer     NOT NULL DEFAULT 15,
        lat             double precision,
        lng             double precision,
        enabled         boolean     NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),
        last_scanned_at timestamptz,
        leads_found     integer     NOT NULL DEFAULT 0
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS leads (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id       text        NOT NULL UNIQUE,
        source          text        NOT NULL DEFAULT 'manual',
        sources         jsonb       NOT NULL DEFAULT '[]'::jsonb,
        source_refs     jsonb       NOT NULL DEFAULT '{}'::jsonb,
        name            text        NOT NULL,
        niche           text        NOT NULL,
        phone           text,
        website         text,
        website_host    text,
        address         text,
        city            text,
        state           text,
        postal_code     text,
        lat             double precision,
        lng             double precision,
        maps_url        text,
        rating          double precision,
        review_count    integer,
        photo_count     integer,
        has_hours       boolean,
        business_status text,
        categories      jsonb       NOT NULL DEFAULT '[]'::jsonb,
        score           integer     NOT NULL DEFAULT 0,
        tier            text        NOT NULL DEFAULT 'weak',
        signals         jsonb       NOT NULL DEFAULT '[]'::jsonb,
        status          text        NOT NULL DEFAULT 'new',
        notes           text        NOT NULL DEFAULT '',
        discovered_at   timestamptz NOT NULL DEFAULT now(),
        last_seen_at    timestamptz NOT NULL DEFAULT now(),
        territory_id    uuid REFERENCES territories(id) ON DELETE SET NULL
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS scan_runs (
        id                   bigserial PRIMARY KEY,
        started_at           timestamptz NOT NULL,
        finished_at          timestamptz NOT NULL,
        territories_scanned  integer NOT NULL DEFAULT 0,
        places_inspected     integer NOT NULL DEFAULT 0,
        new_leads            integer NOT NULL DEFAULT 0,
        updated_leads        integer NOT NULL DEFAULT 0,
        skipped              integer NOT NULL DEFAULT 0,
        sources_used         jsonb   NOT NULL DEFAULT '[]'::jsonb,
        source_stats         jsonb   NOT NULL DEFAULT '[]'::jsonb,
        errors               jsonb   NOT NULL DEFAULT '[]'::jsonb,
        demo_mode            boolean NOT NULL DEFAULT false
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS app_prefs (
        key        text PRIMARY KEY,
        value      jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;

    // Idempotent upgrades for databases created by earlier versions.
    await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_refs jsonb NOT NULL DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE leads ALTER COLUMN review_count DROP NOT NULL`;
    await sql`ALTER TABLE leads ALTER COLUMN photo_count DROP NOT NULL`;
    await sql`ALTER TABLE leads ALTER COLUMN has_hours DROP NOT NULL`;
    await sql`ALTER TABLE territories ADD COLUMN IF NOT EXISTS radius_km integer NOT NULL DEFAULT 15`;
    await sql`ALTER TABLE territories ADD COLUMN IF NOT EXISTS lat double precision`;
    await sql`ALTER TABLE territories ADD COLUMN IF NOT EXISTS lng double precision`;
    await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS sources_used jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS source_stats jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS candidates jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS rejection_counts jsonb NOT NULL DEFAULT '{}'::jsonb`;

    await sql`CREATE INDEX IF NOT EXISTS leads_score_idx ON leads (score DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_discovered_idx ON leads (discovered_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_niche_idx ON leads (niche)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_tier_idx ON leads (tier)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_sources_idx ON leads USING gin (sources)`;

    await crm.migrateCrm(sql);
  }

  private whereClause(f: LeadFilters) {
    const sql = client();
    const conds: ReturnType<Sql>[] = [];

    if (f.niches?.length) conds.push(sql`niche = ANY(${f.niches})`);
    if (f.tiers?.length) conds.push(sql`tier = ANY(${f.tiers})`);
    if (f.statuses?.length) conds.push(sql`status = ANY(${f.statuses})`);
    if (f.states?.length) conds.push(sql`state = ANY(${f.states})`);
    if (f.cities?.length) conds.push(sql`city = ANY(${f.cities})`);
    if (f.stageIds?.length) conds.push(sql`stage_id = ANY(${f.stageIds}::uuid[])`);
    if (f.tags?.length) conds.push(sql`tags ?| ${sql.array(f.tags)}`);
    if (f.dueOnly) {
      conds.push(sql`EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = leads.id AND t.completed_at IS NULL AND t.due_at IS NOT NULL AND t.due_at <= now())`);
    }
    if (f.untouchedOnly) {
      conds.push(sql`NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = leads.id AND a.type IN ('call','email','sms','meeting'))`);
    }
    if (f.sources?.length) {
      // jsonb "contains any of these keys" — sources is a JSON array of strings.
      conds.push(sql`sources ?| ${sql.array(f.sources)}`);
    }
    if (typeof f.minScore === "number") conds.push(sql`score >= ${f.minScore}`);
    if (typeof f.maxScore === "number") conds.push(sql`score <= ${f.maxScore}`);
    if (typeof f.maxReviews === "number") {
      conds.push(sql`(review_count IS NULL OR review_count <= ${f.maxReviews})`);
    }
    if (f.hasWebsite === true) conds.push(sql`website IS NOT NULL AND website <> ''`);
    if (f.hasWebsite === false) conds.push(sql`(website IS NULL OR website = '')`);
    if (f.hasPhone === true) conds.push(sql`phone IS NOT NULL AND phone <> ''`);
    if (f.hasPhone === false) conds.push(sql`(phone IS NULL OR phone = '')`);
    if (typeof f.discoveredWithinDays === "number") {
      conds.push(
        sql`discovered_at >= now() - (${f.discoveredWithinDays} || ' days')::interval`,
      );
    }
    if (f.q) {
      const like = `%${f.q}%`;
      conds.push(
        sql`(name ILIKE ${like} OR city ILIKE ${like} OR address ILIKE ${like} OR phone ILIKE ${like} OR website_host ILIKE ${like} OR notes ILIKE ${like})`,
      );
    }

    if (!conds.length) return sql`TRUE`;
    return conds.reduce((acc, cond) => sql`${acc} AND ${cond}`);
  }

  private orderClause(sort: LeadSort = "score_desc") {
    const sql = client();
    switch (sort) {
      case "score_asc":
        return sql`score ASC, review_count DESC NULLS LAST`;
      case "newest":
        return sql`discovered_at DESC`;
      case "oldest":
        return sql`discovered_at ASC`;
      case "reviews_asc":
        return sql`review_count ASC NULLS FIRST, score DESC`;
      case "reviews_desc":
        return sql`review_count DESC NULLS LAST`;
      case "name_asc":
        return sql`name ASC`;
      default:
        return sql`score DESC, review_count ASC NULLS FIRST`;
    }
  }

  async listLeads(filters: LeadFilters): Promise<LeadPage> {
    await this.init();
    const sql = client();
    const where = this.whereClause(filters);
    const order = this.orderClause(filters.sort);
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const [rows, counted] = await Promise.all([
      sql<Row[]>`SELECT * FROM leads WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      sql<Row[]>`SELECT count(*)::int AS n FROM leads WHERE ${where}`,
    ]);

    return { rows: rows.map(toLead), total: Number(counted[0]?.n ?? 0) };
  }

  async getLead(id: string): Promise<Lead | null> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`SELECT * FROM leads WHERE id = ${id}`;
    return rows[0] ? toLead(rows[0]) : null;
  }

  async upsertLeads(incoming: LeadUpsert[]): Promise<UpsertResult> {
    await this.init();
    if (!incoming.length) return { inserted: 0, updated: 0, insertedIds: [] };
    const sql = client();

    let inserted = 0;
    let updated = 0;
    const insertedIds: string[] = [];

    // Every new lead lands in its niche's pipeline at the first stage, so the
    // kanban board is populated without the user assigning anything by hand.
    const pipelines = await crm.listPipelines(sql);
    const entryFor = (niche: string) => {
      const p = pipelines.find((x) => x.niche === niche) ?? pipelines.find((x) => x.isDefault) ?? pipelines[0];
      const stage = p?.stages.find((s2) => !s2.isWon && !s2.isLost) ?? p?.stages[0];
      return { pipelineId: p?.id ?? null, stageId: stage?.id ?? null };
    };

    for (const l of incoming) {
      const entry = entryFor(l.niche);
      // `xmax = 0` is the standard Postgres trick for telling an INSERT apart
      // from an ON CONFLICT UPDATE in the RETURNING clause.
      const rows = await sql<Row[]>`
        INSERT INTO leads (
          source_id, source, sources, source_refs, name, niche, phone, website,
          website_host, address, city, state, postal_code, lat, lng, maps_url,
          rating, review_count, photo_count, has_hours, business_status,
          categories, score, tier, signals, last_seen_at, territory_id,
          pipeline_id, stage_id
        ) VALUES (
          ${l.sourceId}, ${l.source}, ${jsonb(l.sources)}, ${jsonb(l.sourceRefs)},
          ${l.name}, ${l.niche}, ${l.phone}, ${l.website}, ${l.websiteHost},
          ${l.address}, ${l.city}, ${l.state}, ${l.postalCode}, ${l.lat}, ${l.lng},
          ${l.mapsUrl}, ${l.rating}, ${l.reviewCount}, ${l.photoCount},
          ${l.hasHours}, ${l.businessStatus}, ${jsonb(l.categories)}, ${l.score},
          ${l.tier}, ${jsonb(l.signals)}, ${l.lastSeenAt}, ${l.territoryId},
          ${entry.pipelineId}, ${entry.stageId}
        )
        ON CONFLICT (source_id) DO UPDATE SET
          source = EXCLUDED.source,
          sources = EXCLUDED.sources,
          source_refs = EXCLUDED.source_refs,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          website = EXCLUDED.website,
          website_host = EXCLUDED.website_host,
          address = EXCLUDED.address,
          city = EXCLUDED.city,
          state = EXCLUDED.state,
          postal_code = EXCLUDED.postal_code,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          maps_url = EXCLUDED.maps_url,
          rating = EXCLUDED.rating,
          review_count = EXCLUDED.review_count,
          photo_count = EXCLUDED.photo_count,
          has_hours = EXCLUDED.has_hours,
          business_status = EXCLUDED.business_status,
          categories = EXCLUDED.categories,
          score = EXCLUDED.score,
          tier = EXCLUDED.tier,
          signals = EXCLUDED.signals,
          last_seen_at = EXCLUDED.last_seen_at
        RETURNING id, (xmax = 0) AS is_insert`;

      if (rows[0]?.is_insert) {
        inserted += 1;
        insertedIds.push(String(rows[0].id));
      } else updated += 1;
    }

    return { inserted, updated, insertedIds };
  }

  async patchLead(id: string, patch: LeadPatch): Promise<Lead | null> {
    await this.init();
    const sql = client();

    // Capture the prior stage so a move can be written to the timeline.
    const before = "stageId" in patch ? await this.getLead(id) : null;

    const rows = await sql<Row[]>`
      UPDATE leads SET
        status            = COALESCE(${patch.status ?? null}, status),
        notes             = COALESCE(${patch.notes ?? null}, notes),
        stage_id          = CASE WHEN ${"stageId" in patch} THEN ${patch.stageId ?? null}::uuid ELSE stage_id END,
        pipeline_id       = CASE WHEN ${"pipelineId" in patch} THEN ${patch.pipelineId ?? null}::uuid ELSE pipeline_id END,
        value_cents       = COALESCE(${patch.valueCents ?? null}, value_cents),
        tags              = COALESCE(${patch.tags ? jsonb(patch.tags) : null}, tags),
        custom_fields     = COALESCE(${patch.customFields ? jsonb(patch.customFields) : null}, custom_fields),
        next_action_at    = CASE WHEN ${"nextActionAt" in patch} THEN ${patch.nextActionAt ?? null} ELSE next_action_at END,
        last_contacted_at = CASE WHEN ${"lastContactedAt" in patch} THEN ${patch.lastContactedAt ?? null} ELSE last_contacted_at END,
        do_not_contact    = COALESCE(${patch.doNotContact ?? null}, do_not_contact)
      WHERE id = ${id}
      RETURNING *`;
    if (!rows[0]) return null;
    const lead = toLead(rows[0]);

    if (before && before.stageId !== lead.stageId) {
      const stages = (await crm.listPipelines(sql)).flatMap((p) => p.stages);
      const from = stages.find((s2) => s2.id === before.stageId)?.name ?? "unassigned";
      const to = stages.find((s2) => s2.id === lead.stageId)?.name ?? "unassigned";
      await crm.logActivity(sql, {
        leadId: id,
        type: "stage_change",
        body: `${from} → ${to}`,
        outcome: null,
        meta: { from, to },
        actor: "me",
        durationMinutes: null,
      });
    }
    return lead;
  }

  async bulkPatchLeads(ids: string[], patch: LeadPatch): Promise<number> {
    let n = 0;
    for (const id of ids) {
      if (await this.patchLead(id, patch)) n += 1;
    }
    return n;
  }

  async deleteLead(id: string): Promise<boolean> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`DELETE FROM leads WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  async stats(): Promise<LeadStats> {
    await this.init();
    const sql = client();

    const [totals, tiers, statuses, niches] = await Promise.all([
      sql<Row[]>`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE discovered_at >= now() - interval '1 day')::int AS new_today,
          count(*) FILTER (WHERE discovered_at >= now() - interval '7 days')::int AS new_week,
          count(*) FILTER (WHERE status = 'new')::int AS untouched,
          count(*) FILTER (WHERE website IS NULL OR website = '')::int AS no_website,
          COALESCE(round(avg(score)), 0)::int AS avg_score
        FROM leads`,
      sql<Row[]>`SELECT tier, count(*)::int AS n FROM leads GROUP BY tier`,
      sql<Row[]>`SELECT status, count(*)::int AS n FROM leads GROUP BY status`,
      sql<Row[]>`SELECT niche, count(*)::int AS n FROM leads GROUP BY niche`,
    ]);

    const byTier = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<PresenceTier, number>;
    for (const r of tiers) if (r.tier in byTier) byTier[r.tier as PresenceTier] = Number(r.n);

    const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
    for (const r of statuses) if (r.status in byStatus) byStatus[r.status as LeadStatus] = Number(r.n);

    const byNiche: Record<NicheId, number> = { junk_removal: 0, real_estate: 0 };
    for (const r of niches) if (r.niche in byNiche) byNiche[r.niche as NicheId] = Number(r.n);

    const t = totals[0] ?? {};
    return {
      total: Number(t.total ?? 0),
      newToday: Number(t.new_today ?? 0),
      newThisWeek: Number(t.new_week ?? 0),
      untouched: Number(t.untouched ?? 0),
      noWebsite: Number(t.no_website ?? 0),
      byTier,
      byStatus,
      byNiche,
      avgScore: Number(t.avg_score ?? 0),
    };
  }

  async facets(): Promise<Facets> {
    await this.init();
    const sql = client();
    const [states, cities, tags] = await Promise.all([
      sql<Row[]>`SELECT DISTINCT state FROM leads WHERE state IS NOT NULL AND state <> '' ORDER BY state`,
      sql<Row[]>`SELECT DISTINCT city FROM leads WHERE city IS NOT NULL AND city <> '' ORDER BY city`,
      sql<Row[]>`SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM leads ORDER BY tag`,
    ]);
    return {
      states: states.map((r) => r.state),
      cities: cities.map((r) => r.city),
      tags: tags.map((r) => r.tag),
    };
  }

  async listTerritories(): Promise<Territory[]> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`SELECT * FROM territories ORDER BY label ASC`;
    return rows.map(toTerritory);
  }

  async createTerritory(
    t: Omit<Territory, "id" | "createdAt" | "lastScannedAt" | "leadsFound" | "lat" | "lng">,
  ): Promise<Territory> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`
      INSERT INTO territories (label, area, state, niches, radius_km, enabled)
      VALUES (${t.label}, ${t.area}, ${t.state}, ${jsonb(t.niches)}, ${t.radiusKm}, ${t.enabled})
      RETURNING *`;
    return toTerritory(rows[0]);
  }

  async updateTerritory(id: string, patch: Partial<Territory>): Promise<Territory | null> {
    await this.init();
    const sql = client();
    // lat/lng can be explicitly set back to null (stale geocode), so they use
    // presence checks rather than COALESCE.
    const latProvided = "lat" in patch;
    const lngProvided = "lng" in patch;
    const rows = await sql<Row[]>`
      UPDATE territories SET
        label           = COALESCE(${patch.label ?? null}, label),
        area            = COALESCE(${patch.area ?? null}, area),
        state           = COALESCE(${patch.state ?? null}, state),
        niches          = COALESCE(${patch.niches ? jsonb(patch.niches) : null}, niches),
        radius_km       = COALESCE(${patch.radiusKm ?? null}, radius_km),
        lat             = CASE WHEN ${latProvided} THEN ${patch.lat ?? null} ELSE lat END,
        lng             = CASE WHEN ${lngProvided} THEN ${patch.lng ?? null} ELSE lng END,
        enabled         = COALESCE(${patch.enabled ?? null}, enabled),
        last_scanned_at = COALESCE(${patch.lastScannedAt ?? null}, last_scanned_at),
        leads_found     = COALESCE(${patch.leadsFound ?? null}, leads_found)
      WHERE id = ${id}
      RETURNING *`;
    return rows[0] ? toTerritory(rows[0]) : null;
  }

  async deleteTerritory(id: string): Promise<boolean> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`DELETE FROM territories WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  async recordScan(s: ScanRunSummary): Promise<void> {
    await this.init();
    const sql = client();
    await sql`
      INSERT INTO scan_runs (
        started_at, finished_at, territories_scanned, places_inspected,
        new_leads, updated_leads, skipped, sources_used, source_stats, errors, demo_mode,
        candidates, rejection_counts
      ) VALUES (
        ${s.startedAt}, ${s.finishedAt}, ${s.territoriesScanned}, ${s.placesInspected},
        ${s.newLeads}, ${s.updatedLeads}, ${s.skipped}, ${jsonb(s.sourcesUsed)},
        ${jsonb(s.sourceStats)}, ${jsonb(s.errors)}, ${s.noSourcesConfigured},
        ${jsonb(s.candidates)}, ${jsonb(s.rejectionCounts)}
      )`;
  }

  async recentScans(limit = 10): Promise<ScanRunSummary[]> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: new Date(r.finished_at).toISOString(),
      territoriesScanned: Number(r.territories_scanned),
      placesInspected: Number(r.places_inspected),
      newLeads: Number(r.new_leads),
      updatedLeads: Number(r.updated_leads),
      skipped: Number(r.skipped),
      sourcesUsed: (r.sources_used ?? []) as SourceId[],
      sourceStats: (r.source_stats ?? []) as SourceScanStat[],
      candidates: (r.candidates ?? []) as ScanCandidate[],
      rejectionCounts: (r.rejection_counts ?? {}) as Record<string, number>,
      errors: (r.errors ?? []) as string[],
      noSourcesConfigured: Boolean(r.demo_mode),
    }));
  }

  async getPref(key: string): Promise<unknown | null> {
    await this.init();
    const sql = client();
    const rows = await sql<Row[]>`SELECT value FROM app_prefs WHERE key = ${key}`;
    return rows[0]?.value ?? null;
  }

  async setPref(key: string, value: unknown): Promise<void> {
    await this.init();
    const sql = client();
    await sql`
      INSERT INTO app_prefs (key, value, updated_at)
      VALUES (${key}, ${jsonb(value)}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  /* ------------------------------------------------------------- CRM --- */

  async listPipelines(): Promise<PipelineWithStages[]> {
    await this.init();
    return crm.listPipelines(client());
  }
  async createPipeline(name: string, niche: Pipeline["niche"]): Promise<PipelineWithStages> {
    await this.init();
    return crm.createPipeline(client(), name, niche);
  }
  async updatePipeline(id: string, patch: Partial<Pipeline>): Promise<Pipeline | null> {
    await this.init();
    return crm.updatePipeline(client(), id, patch);
  }
  async deletePipeline(id: string): Promise<boolean> {
    await this.init();
    return crm.deletePipeline(client(), id);
  }
  async createStage(pipelineId: string, name: string, position: number): Promise<PipelineStage> {
    await this.init();
    return crm.createStage(client(), pipelineId, name, position);
  }
  async updateStage(id: string, patch: Partial<PipelineStage>): Promise<PipelineStage | null> {
    await this.init();
    return crm.updateStage(client(), id, patch);
  }
  async deleteStage(id: string): Promise<boolean> {
    await this.init();
    return crm.deleteStage(client(), id);
  }
  async defaultPipelineFor(niche: string): Promise<PipelineWithStages | null> {
    await this.init();
    return crm.defaultPipelineFor(client(), niche);
  }

  async listActivities(leadId: string, limit?: number): Promise<Activity[]> {
    await this.init();
    return crm.listActivities(client(), leadId, limit);
  }
  async logActivity(input: ActivityInput): Promise<Activity> {
    await this.init();
    return crm.logActivity(client(), input);
  }
  async deleteActivity(id: string): Promise<boolean> {
    await this.init();
    return crm.deleteActivity(client(), id);
  }

  async listTasks(filters: TaskFilters): Promise<TaskWithLead[]> {
    await this.init();
    return crm.listTasks(client(), filters);
  }
  async createTask(input: TaskInput): Promise<Task> {
    await this.init();
    return crm.createTask(client(), input);
  }
  async updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    await this.init();
    return crm.updateTask(client(), id, patch);
  }
  async deleteTask(id: string): Promise<boolean> {
    await this.init();
    return crm.deleteTask(client(), id);
  }

  async listSequences(): Promise<SequenceWithSteps[]> {
    await this.init();
    return crm.listSequences(client());
  }
  async createSequence(seq: Omit<Sequence, "id" | "createdAt">): Promise<Sequence> {
    await this.init();
    return crm.createSequence(client(), seq);
  }
  async updateSequence(id: string, patch: Partial<Sequence>): Promise<Sequence | null> {
    await this.init();
    return crm.updateSequence(client(), id, patch);
  }
  async deleteSequence(id: string): Promise<boolean> {
    await this.init();
    return crm.deleteSequence(client(), id);
  }
  async replaceSequenceSteps(
    sequenceId: string,
    steps: Array<Omit<SequenceStep, "id" | "sequenceId">>,
  ): Promise<SequenceStep[]> {
    await this.init();
    return crm.replaceSequenceSteps(client(), sequenceId, steps);
  }
  async enrollLead(sequenceId: string, leadId: string): Promise<SequenceEnrollment> {
    await this.init();
    return crm.enrollLead(client(), sequenceId, leadId);
  }
  async listEnrollments(leadId?: string): Promise<SequenceEnrollment[]> {
    await this.init();
    return crm.listEnrollments(client(), leadId);
  }
  async updateEnrollment(
    id: string,
    patch: Partial<SequenceEnrollment>,
  ): Promise<SequenceEnrollment | null> {
    await this.init();
    return crm.updateEnrollment(client(), id, patch);
  }
  async dueEnrollments(at: string): Promise<SequenceEnrollment[]> {
    await this.init();
    return crm.dueEnrollments(client(), at);
  }

  async listTemplates(): Promise<MessageTemplate[]> {
    await this.init();
    return crm.listTemplates(client());
  }
  async createTemplate(t: Omit<MessageTemplate, "id" | "createdAt">): Promise<MessageTemplate> {
    await this.init();
    return crm.createTemplate(client(), t);
  }
  async updateTemplate(id: string, patch: Partial<MessageTemplate>): Promise<MessageTemplate | null> {
    await this.init();
    return crm.updateTemplate(client(), id, patch);
  }
  async deleteTemplate(id: string): Promise<boolean> {
    await this.init();
    return crm.deleteTemplate(client(), id);
  }

  async listSavedViews(): Promise<SavedView[]> {
    await this.init();
    return crm.listSavedViews(client());
  }
  async createSavedView(name: string, filters: Record<string, unknown>): Promise<SavedView> {
    await this.init();
    return crm.createSavedView(client(), name, filters);
  }
  async deleteSavedView(id: string): Promise<boolean> {
    await this.init();
    return crm.deleteSavedView(client(), id);
  }

  async dashboard(): Promise<DashboardSummary> {
    await this.init();
    return crm.dashboard(client());
  }
}
