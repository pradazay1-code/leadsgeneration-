import { NextResponse } from "next/server";
import { buildInfo } from "@/lib/build-info";

/**
 * Which build is serving this URL.
 *
 * Deliberately public and uncached. When "the new feature isn't there", this
 * is the one endpoint that answers whether the deployment is even running the
 * code that has it — without needing to log in, and without a cached page or
 * a stale CDN edge being able to lie about it.
 *
 * Returns no secrets: a commit SHA, a branch name, and the region.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const build = buildInfo();

  return NextResponse.json(
    {
      app: "LeadSignal",
      commit: build.sha ?? "unknown (not built on Vercel)",
      branch: build.branch ?? "unknown",
      environment: build.env ?? "local",
      commitMessage: build.message,
      servedAt: new Date().toISOString(),
      region: process.env.VERCEL_REGION ?? null,
      // Bumped by hand when a change must be visibly confirmable end to end.
      marker: "mapbox+firecrawl+research",
    },
    {
      headers: {
        // Defeat every layer that could serve a stale answer to this question.
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    },
  );
}
