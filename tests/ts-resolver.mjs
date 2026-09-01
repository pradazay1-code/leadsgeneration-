/**
 * Module resolution hook for the test runner.
 *
 * The app is written for Next's bundler, which resolves extensionless imports
 * ("./merge") and the "@/" alias. Node's ESM loader does neither, so without
 * this only dependency-free modules could be tested — which left the scan
 * pipeline, the part most worth testing, untestable.
 *
 * With this hook the real modules load unmodified under `node --test`, so the
 * tests exercise production code rather than a copy of it.
 *
 * Usage (see package.json):
 *   node --experimental-strip-types --conditions=react-server \
 *        --import ./tests/ts-resolver.mjs --test 'tests/*.test.ts'
 *
 * `--conditions=react-server` makes the `server-only` marker package resolve
 * to its empty build instead of the module that throws.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Extensions and index files to try, in the order a bundler would. */
const CANDIDATES = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

function firstExisting(basePath) {
  if (existsSync(basePath) && !existsSync(`${basePath}/`)) return basePath;
  for (const ext of CANDIDATES) {
    const candidate = `${basePath}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // "@/lib/scan" -> <repo>/src/lib/scan.ts
  if (specifier.startsWith("@/")) {
    const hit = firstExisting(resolvePath(SRC, specifier.slice(2)));
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }

  // Relative imports without an extension.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const hit = firstExisting(resolvePath(parentDir, specifier));
      if (hit) return nextResolve(pathToFileURL(hit).href, context);
      throw err;
    }
  }

  return nextResolve(specifier, context);
}
