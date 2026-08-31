import type { NicheId } from "./types";

export interface NicheConfig {
  id: NicheId;
  label: string;
  shortLabel: string;
  /** Text queries fed to Places Text Search, `{area}` replaced with the territory. */
  queries: string[];
  /**
   * Provider category strings that confirm a result really is in this niche.
   * A result matching none of these is treated as a weak match and needs a
   * name-keyword hit instead.
   */
  includeTypes: string[];
  /** Words in the business name that confirm the niche. */
  nameKeywords: string[];
  /**
   * National franchises and big brokerages. These are disqualified outright:
   * they have corporate marketing teams and never buy from a local agency.
   */
  franchises: string[];
  /**
   * Domains that indicate the business is riding someone else's web presence
   * (a brokerage portal, a directory, a social page) rather than owning one.
   * Treated as "weak" rather than "has a real website".
   */
  parasiteDomains: string[];
  /** Copy shown in the UI to explain what a good lead looks like here. */
  pitchNote: string;
}

/**
 * Domains that are never a real business website regardless of niche —
 * social pages, link-in-bio tools, drag-and-drop free tiers and directories.
 * A business whose only "website" is one of these still needs what we sell.
 */
export const GENERIC_WEAK_DOMAINS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linktr.ee",
  "linkedin.com",
  "nextdoor.com",
  "yelp.com",
  "yelp.to",
  "business.site",
  "sites.google.com",
  "wixsite.com",
  "wix.com",
  "weebly.com",
  "godaddysites.com",
  "square.site",
  "squarespace.com",
  "myshopify.com",
  "wordpress.com",
  "blogspot.com",
  "webnode.com",
  "jimdosite.com",
  "carrd.co",
  "thumbtack.com",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "porch.com",
  "bark.com",
  "manta.com",
  "bbb.org",
  "yellowpages.com",
  "mapquest.com",
  "groupon.com",
  "taskrabbit.com",
];

export const NICHES: Record<NicheId, NicheConfig> = {
  junk_removal: {
    id: "junk_removal",
    label: "Junk Removal & Hauling",
    shortLabel: "Junk Removal",
    queries: [
      "junk removal {area}",
      "junk hauling service {area}",
      "trash removal service {area}",
      "estate cleanout service {area}",
      "furniture removal {area}",
      "debris removal {area}",
      "dumpster rental {area}",
      "garage cleanout {area}",
    ],
    includeTypes: [
      "junk_removal",
      "dumpster_rental",
      "moving_company",
      "general_contractor",
      "storage",
      "point_of_interest",
      "establishment",
      "local_services",
    ],
    nameKeywords: [
      "junk",
      "haul",
      "hauling",
      "cleanout",
      "clean out",
      "clean-out",
      "debris",
      "rubbish",
      "trash",
      "dumpster",
      "disposal",
      "removal",
      "carting",
      "demo",
      "declutter",
    ],
    franchises: [
      "1-800-got-junk",
      "1 800 got junk",
      "got junk",
      "college hunks",
      "junk king",
      "jdog",
      "junkluggers",
      "the junkluggers",
      "loadup",
      "stand up guys",
      "junk doctors",
      "smash my trash",
      "bin there dump that",
      "redbox+",
      "waste management",
      "republic services",
      "casella",
      "junk shot",
      "dumpster dudez",
      "z best junk",
      "just junk",
      "junk bear",
      "trash daddy",
    ],
    parasiteDomains: [],
    pitchNote:
      "Best targets are owner-operator haulers running off a truck and a cell number — no site, a handful of reviews, and no way to book online.",
  },

  real_estate: {
    id: "real_estate",
    label: "Real Estate Agents & Brokers",
    shortLabel: "Real Estate",
    queries: [
      "real estate agent {area}",
      "realtor {area}",
      "real estate broker {area}",
      "real estate agency {area}",
      "property management {area}",
      "home buyer agent {area}",
      "listing agent {area}",
    ],
    includeTypes: [
      "real_estate_agency",
      "point_of_interest",
      "establishment",
      "finance",
      "lawyer",
    ],
    nameKeywords: [
      "real estate",
      "realty",
      "realtor",
      "properties",
      "property",
      "homes",
      "home group",
      "broker",
      "brokerage",
      "estates",
      "land",
      "residential",
      "listing",
      "re/max",
      "group",
      "team",
    ],
    franchises: [
      "keller williams",
      "re/max",
      "remax",
      "coldwell banker",
      "century 21",
      "berkshire hathaway homeservices",
      "sotheby's international",
      "sothebys international",
      "compass real estate",
      "compass inc",
      "douglas elliman",
      "exp realty",
      "ex p realty",
      "redfin",
      "zillow",
      "opendoor",
      "offerpad",
      "howard hanna",
      "weichert",
      "era real estate",
      "better homes and gardens real estate",
      "corcoran",
      "engel & völkers",
      "engel and volkers",
      "william raveis",
      "gibson sotheby",
    ],
    /**
     * Agents hosted on a brokerage or portal subdomain do not control their own
     * funnel — exactly the person who buys an independent site + CRM.
     */
    parasiteDomains: [
      "kw.com",
      "kwrealty.com",
      "remax.com",
      "coldwellbanker.com",
      "century21.com",
      "c21.com",
      "bhhs.com",
      "bhhsne.com",
      "compass.com",
      "exprealty.com",
      "sothebysrealty.com",
      "elliman.com",
      "realtor.com",
      "zillow.com",
      "trulia.com",
      "homes.com",
      "redfin.com",
      "raveis.com",
      "homesmart.com",
      "realtyonegroup.com",
      "weichert.com",
      "era.com",
      "point2homes.com",
      "sites.kw.com",
      "yourcbl.com",
      "movoto.com",
      "har.com",
    ],
    pitchNote:
      "Best targets are solo agents and 2–3 person teams with no independent site (or only a brokerage subdomain) and a thin review count — they need lead capture and a CRM, not a logo.",
  },
};

export const NICHE_LIST = Object.values(NICHES);

export function getNiche(id: NicheId): NicheConfig {
  return NICHES[id];
}

export function isNicheId(value: string): value is NicheId {
  return value === "junk_removal" || value === "real_estate";
}
