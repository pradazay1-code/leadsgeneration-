import "server-only";
import type { ProviderStatus, SourceId } from "../types";
import { bizdataProvider } from "./bizdata";
import { mapboxProvider } from "./mapbox";
import { webProvider } from "./web";
import { geoapifyProvider } from "./geoapify";
import { osmProvider } from "./osm";
import type { SourceProvider } from "./types";
import { yelpProvider } from "./yelp";
import { firecrawlConfigured } from "../research/firecrawl";

/**
 * Execution order for a scan. Mapbox leads because it has the best coverage
 * and the largest free allowance; web research goes last because Brave's free
 * plan is the scarcest budget in the system, so it should only spend on what
 * the map sources couldn't answer.
 *
 * This is *not* merge priority — field conflicts are resolved by
 * SOURCE_PRIORITY in ./types.
 */
export const ALL_PROVIDERS: SourceProvider[] = [
  mapboxProvider,
  yelpProvider,
  geoapifyProvider,
  bizdataProvider,
  osmProvider,
  webProvider,
];

/** Providers ready to run right now. */
export function configuredProviders(): SourceProvider[] {
  return ALL_PROVIDERS.filter((p) => p.isConfigured());
}

export function providerStatuses(): ProviderStatus[] {
  // Settings-page order: the ones that matter most first, supplements after.
  const order: SourceId[] = ["mapbox", "web", "geoapify", "yelp", "bizdata", "osm"];
  const fromProviders = order.map((id) => {
    const p = ALL_PROVIDERS.find((x) => x.id === id)!;
    return {
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      needsKey: p.needsKey,
      detail: p.statusDetail(),
    };
  });

  // Deep research isn't a plain search provider — it plans queries, filters
  // against what's already known and only then enriches — so it's driven
  // directly by the scan rather than through the provider loop. It still
  // belongs in the same status list.
  const research: ProviderStatus = {
    id: "firecrawl",
    label: "Deep research",
    configured: firecrawlConfigured(),
    needsKey: true,
    detail: firecrawlConfigured()
      ? "Connected. Searches from several angles for businesses the maps miss, skips anything already known, then reads the survivors for owner name, email and founding year."
      : "Set FIRECRAWL_API_KEY to enable. This is the source that finds brand-new operators the map data has never heard of, and the only one that pulls owner names.",
  };

  return [fromProviders[0], research, ...fromProviders.slice(1)];
}

export { SourceError } from "./types";
export type { SearchContext, SourceProvider, SourceRecord } from "./types";
