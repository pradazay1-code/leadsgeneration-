import "server-only";
import type { ProviderStatus, SourceId } from "../types";
import { bizdataProvider } from "./bizdata";
import { mapboxProvider } from "./mapbox";
import { webProvider } from "./web";
import { geoapifyProvider } from "./geoapify";
import { osmProvider } from "./osm";
import type { SourceProvider } from "./types";
import { yelpProvider } from "./yelp";

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
  // Settings-page order: the two that matter most first, supplements after.
  const order: SourceId[] = ["mapbox", "web", "geoapify", "yelp", "bizdata", "osm"];
  return order.map((id) => {
    const p = ALL_PROVIDERS.find((x) => x.id === id)!;
    return {
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      needsKey: p.needsKey,
      detail: p.statusDetail(),
    };
  });
}

export { SourceError } from "./types";
export type { SearchContext, SourceProvider, SourceRecord } from "./types";
