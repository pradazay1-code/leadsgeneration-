"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { NICHE_LIST } from "@/lib/niches";
import { TIER_META, TIER_ORDER } from "@/lib/scoring";
import { countActive, type FilterState } from "@/lib/filterState";
import { LEAD_STATUSES, type SourceId } from "@/lib/types";
import { Button, Chip, Label, SOURCE_META, STATUS_META, inputClass } from "./ui";

const FILTERABLE_SOURCES: SourceId[] = ["google_places", "geoapify", "yelp", "bizdata", "osm"];

interface Facets {
  states: string[];
  cities: string[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0">
      <Label>{title}</Label>
      {children}
    </div>
  );
}

/** Three-way toggle for yes / no / don't-care booleans. */
function TriToggle({
  value,
  onChange,
  yesLabel,
  noLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  yesLabel: string;
  noLabel: string;
}) {
  const options: Array<{ v: boolean | null; label: string }> = [
    { v: null, label: "Any" },
    { v: true, label: yesLabel },
    { v: false, label: noLabel },
  ];

  return (
    <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={cn(
            "flex-1 rounded-[6px] px-2 py-1.5 text-xs font-medium transition-colors focus-ring",
            value === o.v ? "bg-surface-3 text-ink shadow-sm" : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterRail({
  filters,
  onChange,
  onReset,
  facets,
  resultCount,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  onReset: () => void;
  facets: Facets;
  resultCount: number;
}) {
  const patch = (p: Partial<FilterState>) => onChange({ ...filters, ...p });
  const activeCount = countActive(filters);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <SlidersHorizontal className="size-4 text-ink-3" />
          Filters
          {activeCount > 0 ? (
            <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
              {activeCount}
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={onReset} title="Back to the default view">
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      </div>

      <Section title="Search">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder="Name, town, phone, notes…"
          className={inputClass}
        />
        <p className="mt-2 text-[11px] text-ink-3">
          {resultCount.toLocaleString()} lead{resultCount === 1 ? "" : "s"} match
        </p>
      </Section>

      <Section title="Industry">
        <div className="flex flex-wrap gap-1.5">
          {NICHE_LIST.map((n) => (
            <Chip
              key={n.id}
              active={filters.niches.includes(n.id)}
              onClick={() => patch({ niches: toggleIn(filters.niches, n.id) })}
              title={n.pitchNote}
            >
              {n.shortLabel}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Online presence">
        <div className="flex flex-wrap gap-1.5">
          {TIER_ORDER.map((tier) => (
            <Chip
              key={tier}
              active={filters.tiers.includes(tier)}
              onClick={() => patch({ tiers: toggleIn(filters.tiers, tier) })}
              title={TIER_META[tier].description}
            >
              {TIER_META[tier].label}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          “Established” is off by default — those are the entrenched players you asked to skip.
        </p>
      </Section>

      <Section title={`Minimum score — ${filters.minScore}`}>
        <input
          type="range"
          min={0}
          max={90}
          step={5}
          value={filters.minScore}
          onChange={(e) => patch({ minScore: Number(e.target.value) })}
          className="w-full accent-[#34d399] focus-ring"
          aria-label="Minimum opportunity score"
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-3">
          <span>Everything</span>
          <span>Only the best fits</span>
        </div>
      </Section>

      <Section title="Maximum reviews">
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "Any", value: null },
            { label: "0", value: 0 },
            { label: "≤ 5", value: 5 },
            { label: "≤ 15", value: 15 },
            { label: "≤ 40", value: 40 },
          ].map((o) => (
            <Chip
              key={String(o.value)}
              active={filters.maxReviews === o.value}
              onClick={() => patch({ maxReviews: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Review count is the best public proxy for how long they&apos;ve been running.
        </p>
      </Section>

      <Section title="Website">
        <TriToggle
          value={filters.hasWebsite}
          onChange={(v) => patch({ hasWebsite: v })}
          yesLabel="Has one"
          noLabel="None"
        />
      </Section>

      <Section title="Phone">
        <TriToggle
          value={filters.hasPhone}
          onChange={(v) => patch({ hasPhone: v })}
          yesLabel="Listed"
          noLabel="Missing"
        />
      </Section>

      <Section title="Discovered">
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "Any time", value: null },
            { label: "Today", value: 1 },
            { label: "7 days", value: 7 },
            { label: "30 days", value: 30 },
          ].map((o) => (
            <Chip
              key={String(o.value)}
              active={filters.withinDays === o.value}
              onClick={() => patch({ withinDays: o.value })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Pipeline status">
        <div className="flex flex-wrap gap-1.5">
          {LEAD_STATUSES.map((s) => (
            <Chip
              key={s}
              active={filters.statuses.includes(s)}
              onClick={() => patch({ statuses: toggleIn(filters.statuses, s) })}
            >
              {STATUS_META[s].label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Found via">
        <div className="flex flex-wrap gap-1.5">
          {FILTERABLE_SOURCES.map((s) => (
            <Chip
              key={s}
              active={filters.sources.includes(s)}
              onClick={() => patch({ sources: toggleIn(filters.sources, s) })}
            >
              {SOURCE_META[s].label}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Leads seen on any selected platform. A lead found on only one platform is often the
          least visible — and the best target.
        </p>
      </Section>

      {facets.states.length > 1 ? (
        <Section title="State">
          <div className="flex flex-wrap gap-1.5">
            {facets.states.map((s) => (
              <Chip
                key={s}
                active={filters.states.includes(s)}
                onClick={() => patch({ states: toggleIn(filters.states, s) })}
              >
                {s}
              </Chip>
            ))}
          </div>
        </Section>
      ) : null}

      {facets.cities.length > 1 ? (
        <Section title="Town">
          <div className="max-h-52 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-1.5">
              {facets.cities.map((c) => (
                <Chip
                  key={c}
                  active={filters.cities.includes(c)}
                  onClick={() => patch({ cities: toggleIn(filters.cities, c) })}
                >
                  {c}
                </Chip>
              ))}
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}
