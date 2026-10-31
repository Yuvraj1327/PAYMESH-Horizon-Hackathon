"use client";

import { useState } from "react";

/**
 * A controlled value whose source of truth is external (here: the URL) but which reflects the user's input
 * immediately. Once the external value changes (for any reason) it takes over again — no effects needed.
 */
export function useOptimisticValue<T>(external: T): [T, (v: T) => void] {
  const [local, setLocal] = useState<{ base: T; value: T } | null>(null);
  const value = local && Object.is(local.base, external) ? local.value : external;
  return [value, (v: T) => setLocal({ base: external, value: v })];
}
