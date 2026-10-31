const inflight = new Map<string, Promise<unknown>>();

/** Runs `fn` once per key at a time: a second call with the same key while the first is pending shares its promise. */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
