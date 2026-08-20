"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  MapPin,
  Phone,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { NICHES } from "@/lib/niches";
import { TIER_META } from "@/lib/scoring";
import { formatDate, relativeTime, telHref } from "@/lib/format";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/types";
import { Button, STATUS_META, ScoreBar, SourceBadges, TierBadge, inputClass } from "./ui";
import { LeadActivityPanel } from "./LeadActivityPanel";

/** Build a first-line opener from whichever gap scored highest. */
function suggestedOpener(lead: Lead): string {
  const top = [...lead.signals].sort((a, b) => b.points - a.points)[0];
  const town = lead.city ?? "your area";
  const niche = lead.niche === "junk_removal" ? "junk removal" : "real estate";

  switch (top?.key) {
    case "no_website":
    case "no_website_unverified":
      return `Hi — I was looking for ${niche} in ${town} and found your listing, but couldn't find a website anywhere. Are you taking on more jobs right now? I build sites and follow-up systems for ${niche} businesses and I'd put one together for you.`;
    case "weak_website":
      return `Hi — found you while searching ${niche} in ${town}. Looks like the ${lead.websiteHost ?? "social page"} is doing all the work right now. I set up proper sites and lead follow-up for ${niche} businesses — worth a quick look?`;
    case "parasite_website":
      return `Hi — I came across your ${lead.websiteHost ?? "brokerage"} page while searching agents in ${town}. Every lead off that page belongs to the brokerage, not you. I set up independent sites and CRMs so agents own their pipeline — open to a 10-minute call?`;
    case "not_on_review_platforms":
      return `Hi — I was searching ${niche} in ${town} and you're not showing up on Yelp or the other places people actually look. That's leaving jobs on the table every week. I set up listings, reviews and follow-up for ${niche} businesses — want me to show you what's missing?`;
    case "reviews_0":
    case "reviews_1_3":
      return `Hi — saw you're up and running in ${town}. You've got almost no reviews yet, which is usually the single biggest thing holding new ${niche} businesses back. I run review and follow-up systems — want me to show you what it'd look like?`;
    case "no_photos":
    case "no_hours":
      return `Hi — found your listing while searching ${niche} in ${town}. Your profile is missing a few things that decide whether people call you or the next result. Happy to walk you through it — no charge for the audit.`;
    default:
      return `Hi — I was searching ${niche} in ${town} and came across your business. I help ${niche} companies get found and follow up with leads automatically. Worth a quick conversation?`;
  }
}

const SOURCE_LINK_LABELS: Partial<Record<string, string>> = {
  yelp: "Yelp listing",
  google_places: "Google Maps",
  bizdata: "OpenStreetMap entry",
  geoapify: "OpenStreetMap entry",
  osm: "OpenStreetMap entry",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Button
      size="sm"
      variant="subtle"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard can be blocked by permissions; silently ignore.
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-[13px]">
      <dt className="w-28 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink-2">{children}</dd>
    </div>
  );
}

export function LeadDrawer({
  lead,
  onClose,
  onPatch,
  onDelete,
}: {
  lead: Lead;
  onClose: () => void;
  onPatch: (id: string, patch: { status?: LeadStatus; notes?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"activity" | "details">("activity");
  const [notes, setNotes] = useState(lead.notes);
  const [savingNotes, setSavingNotes] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset local note state whenever a different lead is opened.
  useEffect(() => {
    setNotes(lead.notes);
  }, [lead.id, lead.notes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced note autosave.
  const queueNoteSave = (value: string) => {
    setNotes(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSavingNotes(true);
      await onPatch(lead.id, { notes: value });
      setSavingNotes(false);
    }, 700);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const opener = suggestedOpener(lead);
  const ownerSearch = `https://www.google.com/search?q=${encodeURIComponent(
    `"${lead.name}" owner ${lead.city ?? ""} ${lead.state ?? ""}`.trim(),
  )}`;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${lead.name} details`}
        className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl animate-slide-in"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{lead.name}</h2>
              <TierBadge tier={lead.tier} />
            </div>
            <p className="mt-1 text-[13px] text-ink-3">
              {NICHES[lead.niche].shortLabel}
              {lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-ring"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-line px-5 pt-3">
          {(["activity", "details"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-t-lg px-3 py-2 text-[13px] font-medium capitalize transition-colors focus-ring",
                tab === t
                  ? "border-b-2 border-brand text-ink"
                  : "border-b-2 border-transparent text-ink-3 hover:text-ink-2",
              )}
            >
              {t === "activity" ? "Activity" : "Lead details"}
            </button>
          ))}
        </div>

        {tab === "activity" ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <LeadActivityPanel leadId={lead.id} />
          </div>
        ) : null}

        <div className={cn("flex-1 overflow-y-auto", tab === "details" ? "" : "hidden")}>
          {/* Score */}
          <section className="border-b border-line px-5 py-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Opportunity score
              </span>
              <span className="text-[11px] text-ink-3">{TIER_META[lead.tier].description}</span>
            </div>
            <ScoreBar score={lead.score} />

            <ul className="mt-4 space-y-1.5">
              {lead.signals.map((s) => (
                <li key={s.key} className="flex items-start gap-2 text-[13px]">
                  <span
                    className={cn(
                      "mt-px w-9 shrink-0 text-right font-mono text-[11px] font-semibold tabular-nums",
                      s.points > 0 ? "text-brand" : s.points < 0 ? "text-red-400" : "text-ink-3",
                    )}
                  >
                    {s.points > 0 ? `+${s.points}` : s.points}
                  </span>
                  <span className="text-ink-2">{s.label}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Quick actions */}
          <section className="border-b border-line px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {lead.phone ? (
                <>
                  <a href={telHref(lead.phone)} className="focus-ring">
                    <Button size="sm" variant="primary" tabIndex={-1}>
                      <Phone className="size-3.5" />
                      {lead.phone}
                    </Button>
                  </a>
                  <CopyButton text={lead.phone} label="Copy number" />
                </>
              ) : (
                <span className="text-[13px] text-ink-3">No phone number published.</span>
              )}

              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noopener noreferrer nofollow" className="focus-ring">
                  <Button size="sm" variant="subtle" tabIndex={-1}>
                    <ExternalLink className="size-3.5" />
                    Site
                  </Button>
                </a>
              ) : null}

              {(() => {
                const seen = new Set<string>();
                return (Object.entries(lead.sourceRefs) as Array<[string, { id: string; url: string | null }]>)
                  .filter(([source, ref]) => {
                    if (!ref?.url || !SOURCE_LINK_LABELS[source] || seen.has(ref.url)) return false;
                    seen.add(ref.url);
                    return true;
                  })
                  .map(([source, ref]) => (
                    <a
                      key={source}
                      href={ref.url!}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="focus-ring"
                    >
                      <Button size="sm" variant="subtle" tabIndex={-1}>
                        <MapPin className="size-3.5" />
                        {SOURCE_LINK_LABELS[source]}
                      </Button>
                    </a>
                  ));
              })()}

              <a href={ownerSearch} target="_blank" rel="noopener noreferrer" className="focus-ring">
                <Button size="sm" variant="subtle" tabIndex={-1}>
                  <Search className="size-3.5" />
                  Find the owner
                </Button>
              </a>
            </div>
          </section>

          {/* Suggested opener */}
          <section className="border-b border-line px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Suggested opener
              </span>
              <CopyButton text={opener} label="Copy" />
            </div>
            <p className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">
              {opener}
            </p>
            <p className="mt-2 text-[11px] text-ink-3">
              Built from this lead&apos;s strongest gap. Edit it before you send.
            </p>
          </section>

          {/* Pipeline */}
          <section className="border-b border-line px-5 py-4">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Pipeline
            </span>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPatch(lead.id, { status: s })}
                  aria-pressed={lead.status === s}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-ring",
                    lead.status === s
                      ? STATUS_META[s].className
                      : "border-line bg-surface-2 text-ink-3 hover:border-line-strong hover:text-ink-2",
                  )}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </section>

          {/* Notes */}
          <section className="border-b border-line px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Notes
              </span>
              <span className="text-[11px] text-ink-3">
                {savingNotes ? "Saving…" : "Saves automatically"}
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => queueNoteSave(e.target.value)}
              rows={4}
              placeholder="What happened on the call, who you spoke to, what to try next…"
              className={cn(inputClass, "resize-y leading-relaxed")}
            />
          </section>

          {/* Details */}
          <section className="px-5 py-4">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Details
            </span>
            <dl>
              <Row label="Address">{lead.address ?? "—"}</Row>
              <Row label="Seen on">
                <SourceBadges sources={lead.sources} />
              </Row>
              <Row label="Reviews">
                {lead.reviewCount === null
                  ? "Not listed on any review platform checked"
                  : lead.rating !== null
                    ? `${lead.rating.toFixed(1)} ★ from ${lead.reviewCount} review${lead.reviewCount === 1 ? "" : "s"} (combined)`
                    : `${lead.reviewCount} review${lead.reviewCount === 1 ? "" : "s"}, no rating yet`}
              </Row>
              <Row label="Listing photos">{lead.photoCount === null ? "Unknown" : lead.photoCount}</Row>
              <Row label="Hours listed">
                {lead.hasHours === null ? "Unknown" : lead.hasHours ? "Yes" : "No"}
              </Row>
              <Row label="Categories">
                {lead.categories.length ? lead.categories.slice(0, 6).join(", ") : "—"}
              </Row>
              <Row label="Discovered">
                {formatDate(lead.discoveredAt)} ({relativeTime(lead.discoveredAt)})
              </Row>
              <Row label="Last refreshed">{relativeTime(lead.lastSeenAt)}</Row>
            </dl>

            <div className="mt-5 border-t border-line pt-4">
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await onDelete(lead.id);
                  onClose();
                }}
              >
                <Trash2 className="size-3.5" />
                Remove this lead
              </Button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
