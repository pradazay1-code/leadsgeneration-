import "server-only";

/**
 * Which commit is actually serving this page.
 *
 * Vercel injects these at build time. Without them on screen, "the new feature
 * isn't there" is indistinguishable from "the deployment is older than the
 * feature" — and those have completely different fixes.
 */
export interface BuildInfo {
  /** Short commit SHA, or null when not built on Vercel. */
  sha: string | null;
  /** Branch this deployment was built from. */
  branch: string | null;
  /** "production" | "preview" | "development". */
  env: string | null;
  /** Subject line of the deployed commit. */
  message: string | null;
}

function clean(v: string | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

export function buildInfo(): BuildInfo {
  const sha = clean(process.env.VERCEL_GIT_COMMIT_SHA);
  return {
    sha: sha ? sha.slice(0, 7) : null,
    branch: clean(process.env.VERCEL_GIT_COMMIT_REF),
    env: clean(process.env.VERCEL_ENV),
    message: clean(process.env.VERCEL_GIT_COMMIT_MESSAGE)?.split("\n")[0] ?? null,
  };
}
