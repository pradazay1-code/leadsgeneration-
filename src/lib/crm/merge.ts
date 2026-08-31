import type { Lead } from "../types";

/**
 * Plain-English rendering of a lead's biggest weakness, used for the {{gap}}
 * merge field. This is the sentence that makes an opener land — it names a
 * real, checkable observation rather than a generic pitch.
 */
export function describeGap(lead: Lead): string {
  const top = [...lead.signals].sort((a, b) => b.points - a.points)[0];

  switch (top?.key) {
    case "no_website":
      return "I couldn't find a website for you on any of the map or search listings";
    case "no_website_unverified":
      return "I couldn't find a website for you anywhere";
    case "weak_website":
      return `your ${lead.websiteHost ?? "social page"} is doing all the work instead of a real site`;
    case "parasite_website":
      return `your only web presence is a ${lead.websiteHost ?? "brokerage"} profile, so the leads belong to them rather than you`;
    case "not_on_review_platforms":
      return "you're not showing up on the review sites people actually check";
    case "reviews_0":
      return "you don't have any reviews yet";
    case "reviews_1_3":
    case "reviews_4_10":
      return `you've only got ${lead.reviewCount} review${lead.reviewCount === 1 ? "" : "s"} so far`;
    case "no_photos":
      return "there are no photos on your listing";
    case "no_hours":
      return "your listing doesn't show any opening hours";
    case "low_rating":
      return "your star rating is holding you back in search";
    case "single_source":
      return "you're only listed in one place online";
    default:
      return "there are a few gaps in how you show up online";
  }
}

const NICHE_WORDS: Record<string, string> = {
  junk_removal: "junk removal",
  real_estate: "real estate",
};

/**
 * Substitute {{merge_fields}} in a template. Unknown fields render as an empty
 * string rather than leaking `{{whatever}}` into a message someone sends.
 */
export function renderTemplate(template: string, lead: Lead): string {
  const values: Record<string, string> = {
    business: lead.name,
    city: lead.city ?? "your area",
    state: lead.state ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    website: lead.website ?? "",
    niche: NICHE_WORDS[lead.niche] ?? lead.niche,
    gap: describeGap(lead),
    score: String(lead.score),
    reviews: lead.reviewCount === null ? "none" : String(lead.reviewCount),
  };

  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => {
    return values[key.toLowerCase()] ?? "";
  });
}

/** Every merge field the UI should advertise. */
export const MERGE_FIELDS = [
  { token: "{{business}}", description: "Business name" },
  { token: "{{city}}", description: "Town" },
  { token: "{{state}}", description: "State code" },
  { token: "{{phone}}", description: "Phone number" },
  { token: "{{email}}", description: "Email address" },
  { token: "{{niche}}", description: "“junk removal” or “real estate”" },
  { token: "{{gap}}", description: "Their biggest weakness, in plain English" },
  { token: "{{score}}", description: "Opportunity score" },
  { token: "{{reviews}}", description: "Combined review count" },
] as const;
