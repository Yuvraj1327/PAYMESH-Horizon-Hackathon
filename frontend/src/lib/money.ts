/** Exact decimal helpers for token amounts (strings with up to 6 decimals). No floats are used for comparisons. */
const SCALE = 6;

export function toMicro(value: string): bigint {
  const [i = "0", f = ""] = value.trim().split(".");
  const frac = (f + "0".repeat(SCALE)).slice(0, SCALE);
  return BigInt(i || "0") * 10n ** BigInt(SCALE) + BigInt(frac || "0");
}

export function lte(a: string, b: string): boolean {
  return toMicro(a) <= toMicro(b);
}

export function cmp(a: string, b: string): number {
  const x = toMicro(a), y = toMicro(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Display-only conversion (scores and charts). */
export function toNumber(value: string): number {
  return Number(value);
}
