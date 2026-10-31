export function shortAddress(address: string | null | undefined, head = 6, tail = 4): string {
  if (!address) return "—";
  return address.length <= head + tail + 2 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export const shortHash = (hash: string | null | undefined) => shortAddress(hash, 10, 8);

export const isEvmAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
