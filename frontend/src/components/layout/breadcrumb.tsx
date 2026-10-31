"use client";

import { usePathname } from "next/navigation";
import { findNavItem } from "@/constants/navigation";

export function Breadcrumb() {
  const item = findNavItem(usePathname());
  return <span className="truncate font-semibold text-foreground" aria-current="page">{item?.label ?? "PayMesh"}</span>;
}
