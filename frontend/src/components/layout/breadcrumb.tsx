"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { findNavItem } from "@/constants/navigation";

/** Sub-page labels by route shape (UUIDs/ids are never shown). */
function subLabel(path: string): string | null {
  const seg = path.split("/").filter(Boolean);
  const [root, second, third] = seg;
  if (root === "marketplace" && second) return "Agent";
  if (root === "procurement" && second === "new") return "New request";
  if (root === "procurement" && second && third === "quotations") return "Quotations";
  if (root === "procurement" && second && third === "pay") return "Payment review";
  if (root === "procurement" && second) return "Request";
  if (root === "payments" && second && third === "receipt") return "Receipt";
  if (root === "payments" && second) return "Payment";
  return null;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const item = findNavItem(pathname);
  const sub = subLabel(pathname);
  const label = item?.label ?? "PayMesh";
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
      {sub ? (
        <>
          <Link href={item?.href ?? "/dashboard"} className="truncate text-muted-foreground hover:text-foreground">{label}</Link>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-semibold text-foreground" aria-current="page">{sub}</span>
        </>
      ) : <span className="truncate font-semibold text-foreground" aria-current="page">{label}</span>}
    </nav>
  );
}
