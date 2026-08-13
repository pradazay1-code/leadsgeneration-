import "server-only";
import { MemoryStore } from "./memory";
import type { Store } from "./store";

let cached: Promise<Store> | null = null;

async function build(): Promise<Store> {
  // Loaded lazily so the `postgres` driver never has to initialise when the
  // app is running in demo/memory mode.
  const { connectionString, PostgresStore } = await import("./postgres");

  if (connectionString()) {
    const store = new PostgresStore();
    try {
      await store.init();
      return store;
    } catch (err) {
      console.error(
        "[leadsignal] Postgres unavailable, falling back to in-memory store:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const memory = new MemoryStore();
  await memory.init();
  return memory;
}

/** Resolve the active store, building (and migrating) it once per process. */
export function getStore(): Promise<Store> {
  if (!cached) {
    cached = build().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

export type { Store } from "./store";
