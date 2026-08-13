import { scoreBusiness, normaliseHost } from "../scoring";
import type { Lead, LeadStatus, NicheId, Territory } from "../types";

/**
 * Sample data so the app is explorable before a Places API key is attached.
 *
 * Every record here is FICTIONAL. Names are invented and all phone numbers use
 * the 555-01xx range reserved for fiction, so nothing in this file can be
 * mistaken for — or accidentally dial — a real business. Demo rows are tagged
 * `source: "demo"` and the UI badges them as sample data.
 */
interface DemoSeed {
  name: string;
  niche: NicheId;
  city: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number;
  photoCount: number;
  hasHours: boolean;
  categories: string[];
  status?: LeadStatus;
  daysAgo: number;
  notes?: string;
}

const SEEDS: DemoSeed[] = [
  // ---- Junk removal -------------------------------------------------------
  {
    name: "Same Day Junk Guys",
    niche: "junk_removal",
    city: "Stoughton",
    phone: "(555) 0142",
    website: null,
    rating: null,
    reviewCount: 0,
    photoCount: 0,
    hasHours: false,
    categories: ["moving_company", "point_of_interest"],
    daysAgo: 0,
  },
  {
    name: "Bay State Hauling & Cleanouts",
    niche: "junk_removal",
    city: "Braintree",
    phone: "(555) 0118",
    website: null,
    rating: 5,
    reviewCount: 3,
    photoCount: 1,
    hasHours: false,
    categories: ["moving_company", "establishment"],
    daysAgo: 0,
  },
  {
    name: "Ledgewood Debris Removal",
    niche: "junk_removal",
    city: "Canton",
    phone: "(555) 0177",
    website: "https://facebook.com/ledgewooddebris",
    rating: 4.9,
    reviewCount: 7,
    photoCount: 2,
    hasHours: false,
    categories: ["moving_company"],
    daysAgo: 1,
  },
  {
    name: "Two Brothers Junk Removal",
    niche: "junk_removal",
    city: "Norwood",
    phone: "(555) 0163",
    website: null,
    rating: 4.7,
    reviewCount: 11,
    photoCount: 0,
    hasHours: true,
    categories: ["moving_company", "general_contractor"],
    status: "contacted",
    daysAgo: 3,
    notes: "Left a voicemail Tue. Owner does estate cleanouts, no booking form anywhere.",
  },
  {
    name: "Neponset Carting Co.",
    niche: "junk_removal",
    city: "Walpole",
    phone: "(555) 0109",
    website: "https://neponsetcarting.wixsite.com/hauling",
    rating: 4.4,
    reviewCount: 16,
    photoCount: 3,
    hasHours: true,
    categories: ["moving_company"],
    daysAgo: 4,
  },
  {
    name: "Clear It Out Cleanout Services",
    niche: "junk_removal",
    city: "Taunton",
    phone: "(555) 0155",
    website: null,
    rating: 4.8,
    reviewCount: 5,
    photoCount: 0,
    hasHours: false,
    categories: ["moving_company", "establishment"],
    status: "responded",
    daysAgo: 6,
    notes: "Texted back — wants to see pricing for a site + missed-call text-back.",
  },
  {
    name: "Old Colony Rubbish Removal",
    niche: "junk_removal",
    city: "Attleboro",
    phone: "(555) 0131",
    website: null,
    rating: 4.6,
    reviewCount: 22,
    photoCount: 4,
    hasHours: true,
    categories: ["moving_company"],
    daysAgo: 9,
  },
  {
    name: "Granite City Dumpster Rental",
    niche: "junk_removal",
    city: "Quincy",
    phone: "(555) 0188",
    website: "https://granitecitydumpster.com",
    rating: 4.9,
    reviewCount: 84,
    photoCount: 12,
    hasHours: true,
    categories: ["moving_company", "storage"],
    daysAgo: 11,
  },
  {
    name: "Pilgrim Estate Cleanout",
    niche: "junk_removal",
    city: "Plymouth",
    phone: "(555) 0124",
    website: null,
    rating: null,
    reviewCount: 1,
    photoCount: 0,
    hasHours: false,
    categories: ["moving_company"],
    status: "qualified",
    daysAgo: 13,
    notes: "Booked a call for Thursday. Two trucks, all word of mouth right now.",
  },
  {
    name: "Blue Hills Junk & Demo",
    niche: "junk_removal",
    city: "Randolph",
    phone: "(555) 0196",
    website: "https://linktr.ee/bluehillsjunk",
    rating: 4.3,
    reviewCount: 9,
    photoCount: 1,
    hasHours: false,
    categories: ["general_contractor", "moving_company"],
    daysAgo: 16,
  },
  {
    name: "Southcoast Trash Away",
    niche: "junk_removal",
    city: "Fall River",
    phone: null,
    website: null,
    rating: null,
    reviewCount: 2,
    photoCount: 0,
    hasHours: false,
    categories: ["moving_company"],
    daysAgo: 19,
  },
  {
    name: "Charles River Hauling",
    niche: "junk_removal",
    city: "Dedham",
    phone: "(555) 0170",
    website: null,
    rating: 5,
    reviewCount: 4,
    photoCount: 0,
    hasHours: false,
    categories: ["moving_company"],
    status: "won",
    daysAgo: 24,
    notes: "Closed — site + CRM onboarding starts next week.",
  },

  // ---- Real estate --------------------------------------------------------
  {
    name: "Marisol Vega Realty Group",
    niche: "real_estate",
    city: "Brockton",
    phone: "(555) 0102",
    website: null,
    rating: 5,
    reviewCount: 2,
    photoCount: 0,
    hasHours: false,
    categories: ["real_estate_agency", "point_of_interest"],
    daysAgo: 0,
  },
  {
    name: "Northfield Home Partners",
    niche: "real_estate",
    city: "Framingham",
    phone: "(555) 0147",
    website: "https://agents.kw.com/northfield-home-partners",
    rating: 4.9,
    reviewCount: 6,
    photoCount: 1,
    hasHours: false,
    categories: ["real_estate_agency"],
    daysAgo: 1,
  },
  {
    name: "Harborline Properties",
    niche: "real_estate",
    city: "Weymouth",
    phone: "(555) 0139",
    website: null,
    rating: null,
    reviewCount: 0,
    photoCount: 0,
    hasHours: false,
    categories: ["real_estate_agency"],
    daysAgo: 2,
  },
  {
    name: "T. Okonkwo Real Estate",
    niche: "real_estate",
    city: "Worcester",
    phone: "(555) 0114",
    website: "https://facebook.com/okonkworealestate",
    rating: 4.8,
    reviewCount: 8,
    photoCount: 2,
    hasHours: false,
    categories: ["real_estate_agency"],
    status: "contacted",
    daysAgo: 4,
    notes: "DM'd on FB. Solo agent, 11 listings last year, zero lead capture.",
  },
  {
    name: "Merrimack Valley Listing Co.",
    niche: "real_estate",
    city: "Lowell",
    phone: "(555) 0161",
    website: null,
    rating: 4.5,
    reviewCount: 13,
    photoCount: 3,
    hasHours: true,
    categories: ["real_estate_agency"],
    daysAgo: 5,
  },
  {
    name: "Anchor & Oak Residential",
    niche: "real_estate",
    city: "New Bedford",
    phone: "(555) 0126",
    website: "https://anchorandoak.godaddysites.com",
    rating: null,
    reviewCount: 1,
    photoCount: 0,
    hasHours: false,
    categories: ["real_estate_agency"],
    daysAgo: 7,
  },
  {
    name: "Fairview Property Management",
    niche: "real_estate",
    city: "Malden",
    phone: "(555) 0183",
    website: null,
    rating: 4.1,
    reviewCount: 19,
    photoCount: 2,
    hasHours: true,
    categories: ["real_estate_agency"],
    daysAgo: 10,
  },
  {
    name: "D. Whitaker Homes",
    niche: "real_estate",
    city: "Haverhill",
    phone: "(555) 0158",
    website: "https://dwhitaker.realtor.com/profile",
    rating: 5,
    reviewCount: 4,
    photoCount: 1,
    hasHours: false,
    categories: ["real_estate_agency"],
    daysAgo: 12,
  },
  {
    name: "Cranberry Coast Realty",
    niche: "real_estate",
    city: "Wareham",
    phone: "(555) 0135",
    website: null,
    rating: null,
    reviewCount: 3,
    photoCount: 0,
    hasHours: false,
    categories: ["real_estate_agency"],
    status: "qualified",
    daysAgo: 15,
    notes: "Two-agent shop. Wants IDX + follow-up automation. Proposal sent.",
  },
  {
    name: "Summit Line Brokerage",
    niche: "real_estate",
    city: "Pittsfield",
    phone: "(555) 0111",
    website: "https://summitlinebrokerage.com",
    rating: 4.9,
    reviewCount: 132,
    photoCount: 18,
    hasHours: true,
    categories: ["real_estate_agency"],
    daysAgo: 18,
  },
  {
    name: "Bristol Ave Properties",
    niche: "real_estate",
    city: "Attleboro",
    phone: "(555) 0173",
    website: null,
    rating: 4.6,
    reviewCount: 6,
    photoCount: 0,
    hasHours: false,
    categories: ["real_estate_agency"],
    status: "lost",
    daysAgo: 27,
    notes: "Signed with a cousin who 'does websites'. Re-touch in Q3.",
  },
];

function isoDaysAgo(days: number): string {
  // Spread rows across the day so the list does not look machine-generated.
  const jitterMs = (days * 37) % (12 * 60 * 60 * 1000);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - jitterMs).toISOString();
}

/** Build the demo leads by running the seeds through the real scoring engine. */
export function buildDemoLeads(): Lead[] {
  const leads: Lead[] = [];

  SEEDS.forEach((seed, i) => {
    const result = scoreBusiness({
      name: seed.name,
      niche: seed.niche,
      website: seed.website,
      phone: seed.phone,
      rating: seed.rating,
      reviewCount: seed.reviewCount,
      photoCount: seed.photoCount,
      hasHours: seed.hasHours,
      businessStatus: "OPERATIONAL",
      categories: seed.categories,
    });
    if (result.disqualified) return;

    const discoveredAt = isoDaysAgo(seed.daysAgo);
    leads.push({
      id: `demo-${i + 1}`,
      sourceId: `demo-${i + 1}`,
      source: "demo",
      name: seed.name,
      niche: seed.niche,
      phone: seed.phone,
      website: seed.website,
      websiteHost: normaliseHost(seed.website),
      address: `${seed.city}, MA`,
      city: seed.city,
      state: "MA",
      postalCode: null,
      lat: null,
      lng: null,
      mapsUrl: null,
      rating: seed.rating,
      reviewCount: seed.reviewCount,
      photoCount: seed.photoCount,
      hasHours: seed.hasHours,
      businessStatus: "OPERATIONAL",
      categories: seed.categories,
      score: result.score,
      tier: result.tier,
      signals: result.signals,
      status: seed.status ?? "new",
      notes: seed.notes ?? "",
      discoveredAt,
      lastSeenAt: discoveredAt,
      territoryId: null,
    });
  });

  return leads;
}

export function buildDemoTerritories(): Territory[] {
  const base = [
    { label: "South Shore", area: "Braintree, MA", niches: ["junk_removal", "real_estate"] },
    { label: "Norwood / Canton", area: "Norwood, MA", niches: ["junk_removal"] },
    { label: "Brockton area", area: "Brockton, MA", niches: ["real_estate"] },
    { label: "Metro West", area: "Framingham, MA", niches: ["junk_removal", "real_estate"] },
  ] satisfies Array<{ label: string; area: string; niches: NicheId[] }>;

  return base.map((t, i) => ({
    id: `demo-territory-${i + 1}`,
    label: t.label,
    area: t.area,
    state: "MA",
    niches: t.niches,
    enabled: true,
    createdAt: isoDaysAgo(30),
    lastScannedAt: null,
    leadsFound: 0,
  }));
}
