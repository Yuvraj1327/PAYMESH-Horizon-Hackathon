/** Normalizes backend decimal strings ("0.25000000" → "0.25") without floating point. */
export function trimDecimal(v: string | number): string {
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Display form for token amounts: group thousands, keep at least 2 and at most 6 decimals (no rounding of small amounts to 0.00). */
export function formatTokenAmount(v: string | number): string {
  const t = trimDecimal(v);
  if (!/^-?\d+(\.\d+)?$/.test(t)) return "—";
  const [i = "0", f = ""] = t.split(".");
  const frac = f.padEnd(2, "0").slice(0, 6);
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}
