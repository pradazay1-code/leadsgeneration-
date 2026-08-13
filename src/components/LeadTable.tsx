"use client";

import { ExternalLink, Globe, Phone, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { NICHES } from "@/lib/niches";
import { relativeTime, telHref } from "@/lib/format";
import type { Lead, LeadSort } from "@/lib/types";
import { ScoreBar, SourceBadges, StatusPill, TierBadge } from "./ui";

const SORT_OPTIONS: Array<{ value: LeadSort; label: string }> = [
  { value: "score_desc", label: "Best fit first" },
  { value: "newest", label: "Newest first" },
  { value: "reviews_asc", label: "Fewest reviews" },
  { value: "score_asc", label: "Lowest score" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A–Z" },
];

export function SortSelect({
  value,
  onChange,
}: {
  value: LeadSort;
  onChange: (v: LeadSort) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-3">
      <span className="hidden sm:inline">Sort</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LeadSort)}
        className="h-8 rounded-lg border border-line bg-surface-2 px-2 text-[13px] text-ink transition-colors hover:border-line-strong focus-ring"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function WebsiteCell({ lead }: { lead: Lead }) {
  if (!lead.website) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300">
        <Globe className="size-3.5" />
        None found
      </span>
    );
  }
  return (
    <a
      href={lead.website}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-full items-center gap-1 text-[13px] text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink focus-ring"
      title={lead.website}
    >
      <span className="truncate">{lead.websiteHost ?? lead.website}</span>
      <ExternalLink className="size-3 shrink-0 opacity-60" />
    </a>
  );
}

function ReviewsCell({ lead }: { lead: Lead }) {
  if (lead.reviewCount === null) {
    return (
      <span className="text-[13px] font-medium text-emerald-300" title="Not listed on any review platform checked">
        None
      </span>
    );
  }
  if (lead.reviewCount === 0) {
    return <span className="text-[13px] font-medium text-emerald-300">0 revs</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] tabular-nums text-ink-2">
      {lead.rating !== null ? (
        <>
          <Star className="size-3 fill-amber-400/80 text-amber-400/80" />
          {lead.rating.toFixed(1)}
        </>
      ) : null}
      <span className="text-ink-3">
        {lead.reviewCount} rev{lead.reviewCount === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function DemoTag({ lead }: { lead: Lead }) {
  if (lead.source !== "demo") return null;
  return (
    <span
      className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-300"
      title="Fictional sample row — replaced the moment your first real scan runs"
    >
      Sample
    </span>
  );
}

export function LeadTable({
  leads,
  selectedId,
  onSelect,
}: {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (lead: Lead) => void;
}) {
  return (
    <>
      {/* Table — medium screens and up */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-3">
              <th scope="col" className="px-4 py-2.5 font-semibold">Business</th>
              <th scope="col" className="w-[106px] px-2 py-2.5 font-semibold">Score</th>
              <th scope="col" className="w-[80px] px-2 py-2.5 font-semibold">Reviews</th>
              <th scope="col" className="w-[128px] px-2 py-2.5 font-semibold">Website</th>
              <th scope="col" className="w-[108px] px-2 py-2.5 font-semibold">Seen on</th>
              <th scope="col" className="w-[122px] px-2 py-2.5 font-semibold">Phone</th>
              <th scope="col" className="w-[92px] px-2 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => onSelect(lead)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(lead);
                  }
                }}
                aria-selected={selectedId === lead.id}
                className={cn(
                  "cursor-pointer border-b border-line/60 transition-colors focus-ring",
                  selectedId === lead.id ? "bg-surface-2" : "hover:bg-surface-2/60",
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{lead.name}</span>
                    <DemoTag lead={lead} />
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-ink-3">
                    {NICHES[lead.niche].shortLabel}
                    {lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}
                    {` · ${relativeTime(lead.discoveredAt)}`}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <ScoreBar score={lead.score} />
                </td>
                <td className="px-2 py-3">
                  <ReviewsCell lead={lead} />
                </td>
                <td className="px-2 py-3">
                  <WebsiteCell lead={lead} />
                </td>
                <td className="px-2 py-3">
                  <SourceBadges sources={lead.sources} />
                </td>
                <td className="px-2 py-3">
                  {lead.phone ? (
                    <a
                      href={telHref(lead.phone)}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-2 hover:text-brand focus-ring"
                    >
                      <Phone className="size-3.5 shrink-0 opacity-70" />
                      {lead.phone}
                    </a>
                  ) : (
                    <span className="text-[13px] text-ink-3">—</span>
                  )}
                </td>
                <td className="px-2 py-3">
                  <StatusPill status={lead.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards — small screens */}
      <ul className="divide-y divide-line md:hidden">
        {leads.map((lead) => (
          <li key={lead.id}>
            <button
              type="button"
              onClick={() => onSelect(lead)}
              className={cn(
                "w-full px-4 py-3.5 text-left transition-colors focus-ring",
                selectedId === lead.id ? "bg-surface-2" : "active:bg-surface-2",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{lead.name}</span>
                    <DemoTag lead={lead} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    {NICHES[lead.niche].shortLabel}
                    {lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}
                  </div>
                </div>
                <StatusPill status={lead.status} />
              </div>
              <div className="mt-2.5 flex items-center gap-3">
                <ScoreBar score={lead.score} className="max-w-[140px] flex-1" />
                <TierBadge tier={lead.tier} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
                <ReviewsCell lead={lead} />
                <WebsiteCell lead={lead} />
                {lead.phone ? <span>{lead.phone}</span> : null}
              </div>
              <div className="mt-2">
                <SourceBadges sources={lead.sources} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
