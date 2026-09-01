/**
 * Installs the TypeScript/alias resolution hook for the test runner.
 *
 * Hooks have to be registered rather than merely imported — `--import` on the
 * hook module itself would just execute it and register nothing.
 */
import { register } from "node:module";

register("./ts-resolver.mjs", import.meta.url);
