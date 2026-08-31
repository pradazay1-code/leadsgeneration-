import "server-only";

/**
 * Environment variable diagnostics.
 *
 * "I added the keys but the app doesn't see them" has several very different
 * causes — wrong variable name, added to the Preview environment but not
 * Production, pasted with surrounding quotes, or simply never redeployed — and
 * from the outside they all look identical. This reports which names the
 * running process can actually see, so the cause is visible.
 *
 * Values are NEVER returned. Only whether something is set, its length, and
 * whether its shape matches what the vendor issues.
 */

export interface EnvVarSpec {
  name: string;
  /** Other names the code also accepts. */
  aliases?: string[];
  label: string;
  required: boolean;
  /** What a real key from this vendor starts with. */
  expectedPrefix?: string[];
  /** Roughly how long a real key is, for spotting truncation. */
  minLength?: number;
  hint: string;
}

export const ENV_SPECS: EnvVarSpec[] = [
  {
    name: "MAPBOX_ACCESS_TOKEN",
    aliases: ["MAPBOX_TOKEN", "NEXT_PUBLIC_MAPBOX_TOKEN"],
    label: "Mapbox",
    required: true,
    expectedPrefix: ["pk.", "sk."],
    minLength: 40,
    hint: "Default public token from console.mapbox.com/account/access-tokens (starts with pk.).",
  },
  {
    name: "FIRECRAWL_API_KEY",
    label: "Firecrawl (deep research)",
    required: true,
    expectedPrefix: ["fc-"],
    minLength: 20,
    hint: "API key from the Firecrawl dashboard (starts with fc-).",
  },
  {
    name: "BRAVE_API_KEY",
    label: "Brave Search",
    required: false,
    minLength: 20,
    hint: "Free 'Data for Search' key from api-dashboard.search.brave.com.",
  },
  {
    name: "GEOAPIFY_API_KEY",
    label: "Geoapify (backup geocoder)",
    required: false,
    minLength: 20,
    hint: "Optional. Backup geocoder behind Mapbox.",
  },
  {
    name: "YELP_API_KEY",
    label: "Yelp",
    required: false,
    minLength: 40,
    hint: "Optional, and capped at 0 by default because it bills per call.",
  },
  {
    name: "POSTGRES_URL",
    aliases: ["DATABASE_URL", "POSTGRES_PRISMA_URL"],
    label: "Postgres",
    required: true,
    expectedPrefix: ["postgres://", "postgresql://"],
    minLength: 20,
    hint: "Injected automatically by Vercel when you create the database under Storage.",
  },
];

export interface EnvVarReport {
  name: string;
  label: string;
  required: boolean;
  /** Set under its own name, or under one of its aliases. */
  present: boolean;
  /** Which name it was actually found under. */
  foundAs: string | null;
  length: number;
  /** Problems that would make a set variable still not work. */
  problems: string[];
  hint: string;
}

export interface EnvReport {
  vars: EnvVarReport[];
  /**
   * Names in the environment that look like near-misses for something we
   * expect — the usual sign of a typo or a remembered-wrong variable name.
   * Names only; values are never read.
   */
  possibleTypos: Array<{ found: string; didYouMean: string }>;
  /** True when Vercel injected its own vars, i.e. this really is a Vercel deploy. */
  onVercel: boolean;
}

/** Vendor words used to spot a near-miss variable name. */
const VENDOR_HINTS: Array<{ word: string; canonical: string }> = [
  { word: "MAPBOX", canonical: "MAPBOX_ACCESS_TOKEN" },
  { word: "FIRECRAWL", canonical: "FIRECRAWL_API_KEY" },
  { word: "BRAVE", canonical: "BRAVE_API_KEY" },
  { word: "GEOAPIFY", canonical: "GEOAPIFY_API_KEY" },
  { word: "YELP", canonical: "YELP_API_KEY" },
];

function inspect(spec: EnvVarSpec): EnvVarReport {
  const names = [spec.name, ...(spec.aliases ?? [])];
  let foundAs: string | null = null;
  let raw: string | undefined;

  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== "") {
      foundAs = n;
      raw = v;
      break;
    }
  }

  const problems: string[] = [];
  const value = raw ?? "";
  const trimmed = value.trim();

  if (foundAs) {
    if (trimmed.length !== value.length) {
      problems.push("Has leading or trailing whitespace — re-paste it without the extra spaces.");
    }
    if (/^["']|["']$/.test(trimmed)) {
      problems.push(
        "Wrapped in quotes. Vercel stores the value literally, so the quotes become part of the key — remove them.",
      );
    }
    if (spec.minLength && trimmed.replace(/^["']|["']$/g, "").length < spec.minLength) {
      problems.push(`Only ${trimmed.length} characters — looks truncated or incomplete.`);
    }
    if (spec.expectedPrefix?.length) {
      const bare = trimmed.replace(/^["']|["']$/g, "");
      if (!spec.expectedPrefix.some((p) => bare.startsWith(p))) {
        problems.push(
          `Doesn't start with ${spec.expectedPrefix.join(" or ")} — this may be the wrong key, or a key from a different service.`,
        );
      }
    }
    if (foundAs !== spec.name) {
      problems.push(`Found as ${foundAs}. That works, but ${spec.name} is the documented name.`);
    }
  }

  return {
    name: spec.name,
    label: spec.label,
    required: spec.required,
    present: Boolean(foundAs),
    foundAs,
    length: trimmed.length,
    problems,
    hint: spec.hint,
  };
}

export function envReport(): EnvReport {
  const vars = ENV_SPECS.map(inspect);

  // A variable set under a name nothing reads is invisible to the app, and is
  // by far the most common reason keys "don't work".
  const known = new Set(ENV_SPECS.flatMap((s) => [s.name, ...(s.aliases ?? [])]));
  const possibleTypos: EnvReport["possibleTypos"] = [];
  for (const name of Object.keys(process.env)) {
    if (known.has(name)) continue;
    const hit = VENDOR_HINTS.find((h) => name.toUpperCase().includes(h.word));
    if (hit) possibleTypos.push({ found: name, didYouMean: hit.canonical });
  }

  return {
    vars,
    possibleTypos,
    onVercel: Boolean(process.env.VERCEL || process.env.VERCEL_ENV),
  };
}
