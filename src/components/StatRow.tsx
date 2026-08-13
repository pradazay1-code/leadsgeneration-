"use client";

import { CalendarClock, Globe2, Inbox, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LeadStats } from "@/lib/types";

interface Tile {
  key: string;
  label: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  accent: string;
  onClick?: () => void;
}

function StatTile({ tile }: { tile: Tile }) {
  const Wrapper = tile.onClick ? "button" : "div";
  return (
    <Wrapper
      {...(tile.onClick ? { type: "button" as const, onClick: tile.onClick } : {})}
      className={cn(
        "panel flex items-start gap-3 p-4 text-left transition-colors",
        tile.onClick && "hover:border-line-strong hover:bg-surface-2 focus-ring",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          tile.accent,
        )}
      >
        <tile.icon className="size-[18px]" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-ink">
          {tile.value}
        </div>
        <div className="mt-1.5 text-[13px] font-medium text-ink-2">{tile.label}</div>
        <div className="mt-0.5 truncate text-[11px] text-ink-3">{tile.hint}</div>
      </div>
    </Wrapper>
  );
}

export function StatRow({
  stats,
  onFilterUntouched,
  onFilterNoWebsite,
  onFilterThisWeek,
}: {
  stats: LeadStats;
  onFilterUntouched: () => void;
  onFilterNoWebsite: () => void;
  onFilterThisWeek: () => void;
}) {
  const tiles: Tile[] = [
    {
      key: "total",
      label: "Leads in pipeline",
      value: stats.total,
      hint: `Average opportunity score ${stats.avgScore}`,
      icon: Sparkles,
      accent: "border-brand/25 bg-brand/10 text-brand",
    },
    {
      key: "week",
      label: "Found this week",
      value: stats.newThisWeek,
      hint: `${stats.newToday} in the last 24 hours`,
      icon: CalendarClock,
      accent: "border-sky-500/25 bg-sky-500/10 text-sky-300",
      onClick: onFilterThisWeek,
    },
    {
      key: "untouched",
      label: "Not contacted yet",
      value: stats.untouched,
      hint: "Sitting in “New” — nobody has reached out",
      icon: Inbox,
      accent: "border-amber-500/25 bg-amber-500/10 text-amber-300",
      onClick: onFilterUntouched,
    },
    {
      key: "nosite",
      label: "No website at all",
      value: stats.noWebsite,
      hint: "The easiest opening line you have",
      icon: Globe2,
      accent: "border-violet-500/25 bg-violet-500/10 text-violet-300",
      onClick: onFilterNoWebsite,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <StatTile key={t.key} tile={t} />
      ))}
    </div>
  );
}
