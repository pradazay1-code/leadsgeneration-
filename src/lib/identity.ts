/**
 * Business identity: deciding when two records describe the same real company.
 *
 * This is what stops the same operator being handed to you twice. The hard part
 * isn't matching within one scan — it's matching *across* scans, when the
 * evidence changes. A hauler found on Mapbox with only a name, then found next
 * week by the research agent with a phone number, must land on the same row
 * rather than appearing as a fresh lead.
 *
 * So a record doesn't have one key, it has several — phone, website domain,
 * name+city — and any shared key means the same business. Storage keeps every
 * key it has ever seen for a lead (see the lead_identities table), which is
 * what makes the match survive from one run to the next.
 *
 * Deliberately free of runtime imports so the rules are directly testable.
 */

export interface IdentityInput {
  name: string;
  phone?: string | null;
  city?: string | null;
  website?: string | null;
}

/**
 * Hosts shared by many different businesses, so the domain says nothing about
 * *which* business this is.
 *
 * Related to but not the same as GENERIC_WEAK_DOMAINS in niches.ts: that list
 * answers "is this a real website?" for scoring, this one answers "does this
 * domain identify one company?". A parked Wix subdomain is a weak website but
 * still a unique identifier; facebook.com is neither.
 */
const SHARED_WEB_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "m.facebook.com",
  "instagram.com",
  "linkedin.com",
  "linktr.ee",
  "nextdoor.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "yelp.com",
  "yelp.to",
  "google.com",
  "sites.google.com",
  "business.site",
  "mapquest.com",
  "bbb.org",
  "thumbtack.com",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "porch.com",
  "houzz.com",
  "yellowpages.com",
  "manta.com",
  "bizapedia.com",
  "zillow.com",
  "realtor.com",
  "trulia.com",
  "redfin.com",
  "homes.com",
  "compass.com",
  "kw.com",
  "remax.com",
  "century21.com",
  "coldwellbanker.com",
  "exprealty.com",
  "sothebysrealty.com",
  "wixsite.com",
  "wix.com",
  "weebly.com",
  "squarespace.com",
  "square.site",
  "godaddysites.com",
  "myshopify.com",
  "wordpress.com",
  "blogspot.com",
  "webnode.com",
  "jimdosite.com",
  "carrd.co",
  "wordpress.org",
  "craigslist.org",
  "indeed.com",
  "glassdoor.com",
]);

/** Multi-part public suffixes common enough to matter for US small business. */
const COMPOUND_TLDS = new Set(["co.uk", "com.au", "co.nz", "com.br", "co.in", "org.uk"]);

/** Last 10 digits of a US phone number, or null when it isn't one. */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  // 555-01xx is the reserved fictional range, and a leading 0 or 1 in the area
  // code or exchange is not a dialable US number.
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) return null;
  return ten;
}

/**
 * Registrable domain for a URL or host, lowercased and stripped of `www.`.
 * Returns null for shared hosts, since those identify a platform rather than
 * a business.
 */
export function apexDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host: string;
  try {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }

  host = host.replace(/^www\./, "");
  if (!host.includes(".")) return null;

  const parts = host.split(".");
  const lastTwo = parts.slice(-2).join(".");
  const apex = COMPOUND_TLDS.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;

  // Check both the full host and the apex: `mybiz.wixsite.com` has a shared
  // apex, and `facebook.com` is shared outright.
  if (SHARED_WEB_HOSTS.has(host) || SHARED_WEB_HOSTS.has(apex)) return null;
  return apex;
}

/** True when a URL lives on a platform shared by many businesses. */
export function isSharedHost(url: string | null | undefined): boolean {
  if (!url) return false;
  return apexDomain(url) === null;
}

const NAME_NOISE =
  /\b(llc|l\.l\.c|inc|co|corp|corporation|company|ltd|limited|the|of|and|&|services?|service|group|team|solutions?|enterprises?)\b/g;

/** Business name reduced to its distinctive words. */
export function normaliseName(name: string): string {
  return (
    name
      .toLowerCase()
      // Keep dots through the noise pass so "inc." and "l.l.c" still match,
      // then drop all punctuation so "Acme Hauling Services, Inc." and
      // "Acme Hauling" land on the same string.
      .replace(/[^a-z0-9\s&.]/g, " ")
      .replace(NAME_NOISE, " ")
      .replace(/[^a-z0-9\s&]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function nameCityKey(name: string, city: string | null | undefined): string {
  return `${normaliseName(name)}|${(city ?? "").toLowerCase().trim()}`;
}

/**
 * Every key a record could be matched on, strongest evidence first.
 *
 * Order matters: the first key becomes the lead's canonical id, and a phone
 * number is the most durable thing a small business has — they change websites
 * and trading names far more often than they change their number.
 */
export function identityKeysFor(rec: IdentityInput): string[] {
  const keys: string[] = [];

  const p = phoneKey(rec.phone);
  if (p) keys.push(`p:${p}`);

  const d = apexDomain(rec.website);
  if (d) keys.push(`d:${d}`);

  const n = normaliseName(rec.name);
  // A name with nothing distinctive left ("The Company") would collide with
  // every other such name in town, so it can't be an identity.
  if (n.length >= 3) keys.push(`n:${nameCityKey(rec.name, rec.city)}`);

  return keys;
}

/** The key a record is stored under. Null when nothing distinctive was found. */
export function canonicalIdentity(rec: IdentityInput): string | null {
  return identityKeysFor(rec)[0] ?? null;
}

/**
 * Group items that share any identity key.
 *
 * Union-find rather than a single-key map, because identity is transitive: a
 * Mapbox record with a phone, a Firecrawl record with that phone and a domain,
 * and a directory record with only that domain are all one business — even
 * though the first and last share no key directly.
 */
export function groupByIdentity<T>(
  items: T[],
  getKeys: (item: T) => string[],
): Array<{ keys: string[]; items: T[] }> {
  const parent = new Map<string, string>();

  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression, so repeated lookups stay flat.
    let cur = k;
    while (parent.get(cur) !== undefined && parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  // An item with no keys at all can't be matched to anything, so it gets a
  // synthetic key and stands alone rather than being silently dropped.
  const itemKeys = items.map((item, i) => {
    const keys = getKeys(item);
    return keys.length ? keys : [`x:${i}`];
  });

  for (const keys of itemKeys) {
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (let i = 1; i < keys.length; i += 1) union(keys[0], keys[i]);
  }

  const groups = new Map<string, { keys: Set<string>; items: T[] }>();
  items.forEach((item, i) => {
    const root = find(itemKeys[i][0]);
    let group = groups.get(root);
    if (!group) {
      group = { keys: new Set(), items: [] };
      groups.set(root, group);
    }
    group.items.push(item);
    for (const k of itemKeys[i]) group.keys.add(k);
  });

  return [...groups.values()].map((g) => ({
    // Sorted so the canonical key is deterministic: phone beats domain beats
    // name, matching identityKeysFor's own ordering.
    keys: [...g.keys].sort(compareKeyStrength),
    items: g.items,
  }));
}

const KEY_RANK: Record<string, number> = { p: 0, d: 1, n: 2, x: 3 };

function compareKeyStrength(a: string, b: string): number {
  const ra = KEY_RANK[a[0]] ?? 9;
  const rb = KEY_RANK[b[0]] ?? 9;
  return ra !== rb ? ra - rb : a.localeCompare(b);
}
