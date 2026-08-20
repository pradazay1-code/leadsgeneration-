import "server-only";
import type { ProviderStatus, SourceId } from "../types";
import { bizdataProvider } from "./bizdata";
import { geoapifyProvider } from "./geoapify";
import { googleProvider } from "./google";
import { osmProvider } from "./osm";
import type { SourceProvider } from "./types";
import { yelpProvider } from "./yelp";

/** All known providers, in merge-priority order (richest data first). */
export const ALL_PROVIDERS: SourceProvider[] = [
  googleProvider,
  yelpProvider,
  geoapifyProvider,
  bizdataProvider,
  osmProvider,
];

/** Providers ready to run right now. */
export function configuredProviders(): SourceProvider[] {
  return ALL_PROVIDERS.filter((p) => p.isConfigured());
}

export function providerStatuses(): ProviderStatus[] {
  // Free sources first — they're the default path.
  const order: SourceId[] = ["google_places", "geoapify", "yelp", "bizdata", "osm"];
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
