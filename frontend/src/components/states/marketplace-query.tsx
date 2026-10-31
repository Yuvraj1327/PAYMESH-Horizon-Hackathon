"use client";

import { useSearchParams } from "next/navigation";

/** Reads ?q= on the client so the marketplace route stays statically rendered. */
export function MarketplaceQueryNote() {
  const q = useSearchParams().get("q")?.slice(0, 100);
  return q
    ? <>Search for “{q}” will work here once agent discovery is connected.</>
    : <>Search and filter registered provider agents by category, price and reputation.</>;
}
