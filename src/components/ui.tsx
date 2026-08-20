import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TIER_META } from "@/lib/scoring";
import type { LeadStatus, PresenceTier, SourceId } from "@/lib/types";

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "subtle" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-[#04150e] font-semibold hover:bg-[#4ade9f] active:bg-[#2bbd88] disabled:hover:bg-brand",
  subtle:
    "bg-surface-3 text-ink border border-line-strong hover:bg-[#26262e] hover:border-[#3f3f4a]",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
};

export function Button({
  variant = "subtle",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap transition-colors focus-ring",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- Badge */

export function Badge({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4",
        "border border-line bg-surface-2 text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- TierBadge */

const TIER_CLASSES: Record<PresenceTier, string> = {
  none: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  minimal: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  weak: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  established: "border-line-strong bg-surface-3 text-ink-3",
};

export function TierBadge({ tier, className }: { tier: PresenceTier; className?: string }) {
  return (
    <Badge title={TIER_META[tier].description} className={cn(TIER_CLASSES[tier], className)}>
      {TIER_META[tier].label}
    </Badge>
  );
}

/* ----------------------------------------------------------- SourceBadge */

export const SOURCE_META: Record<SourceId, { label: string; className: string }> = {
  bizdata: { label: "BizData", className: "border-teal-500/30 bg-teal-500/10 text-teal-300" },
  osm: { label: "OSM", className: "border-lime-500/30 bg-lime-500/10 text-lime-300" },
  geoapify: { label: "Geoapify", className: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  yelp: { label: "Yelp", className: "border-red-500/25 bg-red-500/10 text-red-300" },
  google_places: { label: "Google", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  manual: { label: "Manual", className: "border-line-strong bg-surface-3 text-ink-3" },
};

/** Compact row of platform badges showing where a lead was seen. */
export function SourceBadges({ sources, className }: { sources: SourceId[]; className?: string }) {
  const visible = sources.filter((s) => s !== "manual");
  if (!visible.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {visible.map((s) => (
        <span
          key={s}
          title={`Seen on ${SOURCE_META[s].label}`}
          className={cn(
            "rounded border px-1 py-px text-[10px] font-semibold leading-4",
            SOURCE_META[s].className,
          )}
        >
          {SOURCE_META[s].label}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------ StatusPill */

export const STATUS_META: Record<LeadStatus, { label: string; className: string }> = {
  new: { label: "New", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  contacted: { label: "Contacted", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  responded: { label: "Responded", className: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  qualified: { label: "Qualified", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  won: { label: "Won", className: "border-brand/40 bg-brand/15 text-brand" },
  lost: { label: "Lost", className: "border-red-500/25 bg-red-500/10 text-red-300" },
  ignored: { label: "Ignored", className: "border-line-strong bg-surface-3 text-ink-3" },
};

export function StatusPill({ status }: { status: LeadStatus }) {
  const meta = STATUS_META[status];
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

/* ---------------------------------------------------------------- ScoreBar */

/** Score colour tracks the same emerald→zinc ramp as the presence tiers. */
export function scoreColor(score: number): string {
  if (score >= 70) return "#34d399";
  if (score >= 50) return "#38bdf8";
  if (score >= 35) return "#fbbf24";
  return "#71717a";
}

export function ScoreBar({ score, className }: { score: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className="w-7 shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums"
        style={{ color: scoreColor(score) }}
      >
        {score}
      </span>
      <div
        className="h-1.5 w-full min-w-10 overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`Opportunity score ${score} out of 100`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(score, 3)}%`, backgroundColor: scoreColor(score) }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Fields */

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3"
    >
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-3 " +
  "transition-colors hover:border-line-strong focus:border-brand/60 focus-ring";

/* ------------------------------------------------------------------ Chips */

export function Chip({
  active,
  onClick,
  children,
  className,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-ring",
        active
          ? "border-brand/50 bg-brand/15 text-brand"
          : "border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Spinner */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      aria-hidden
    />
  );
}

/* ------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-3">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-3">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
