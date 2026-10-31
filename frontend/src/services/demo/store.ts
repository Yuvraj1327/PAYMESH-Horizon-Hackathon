import type { DemoDb } from "@/services/demo/engine";
import { createSeedDb } from "@/services/demo/seed";

/**
 * The demo "database": sample + user-created procurement records, kept in sessionStorage so pages survive a refresh
 * and vanish when the tab closes. It holds ONLY illustrative procurement data — never auth tokens, keys or payments.
 * Replaced by backend responses in live mode.
 */
const KEY = "paymesh.demo.v1";
let cache: DemoDb | null = null;

function isDb(x: unknown): x is DemoDb {
  const d = x as Partial<DemoDb> | null;
  return !!d && d.version === 1 && Array.isArray(d.requests) && Array.isArray(d.quotations) && Array.isArray(d.events);
}

export function getDb(): DemoDb {
  if (cache) return cache;
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isDb(parsed)) { cache = parsed; return cache; }
      }
    } catch { /* corrupt or unavailable storage: fall through to a fresh seed */ }
  }
  cache = createSeedDb(new Date());
  persist();
  return cache;
}

function persist(): void {
  if (typeof window === "undefined" || !cache) return;
  try { window.sessionStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage full/blocked: keep in memory */ }
}

export function mutateDb<T>(fn: (db: DemoDb) => T): T {
  const db = getDb();
  const result = fn(db);
  persist();
  return result;
}

export function resetDb(): void {
  cache = createSeedDb(new Date());
  persist();
}

/** Test helper: forget the in-memory cache. */
export function _clearCache(): void { cache = null; }
