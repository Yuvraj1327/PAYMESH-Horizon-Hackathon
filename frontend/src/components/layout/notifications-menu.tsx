"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDashboard } from "@/hooks/use-dashboard";

/**
 * Recent activity derived from your real procurement requests and payments. The backend has no notifications API
 * (no unread state, no push), so there is no unread badge and nothing here is invented.
 */
export function NotificationsMenu() {
  const { data, isPending, isError } = useDashboard();
  const items = data?.activity.slice(0, 5) ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Recent activity" data-testid="notifications"><Bell className="size-5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recent activity{data?.source === "demo" && " (demo data)"}</DropdownMenuLabel>
        {isPending ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          : isError ? <p role="alert" className="px-4 py-6 text-center text-sm text-danger">Couldn’t load activity.</p>
          : items.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8 text-center"><Bell className="size-6 text-muted-foreground" aria-hidden="true" /><p className="text-sm font-medium">You’re all caught up</p><p className="text-xs text-muted-foreground">Quotation, authorization and settlement updates will appear here.</p></div>
          ) : (
            <ul aria-label="Recent activity">
              {items.map((a) => <li key={a.id} className="px-3 py-2 text-sm"><p className="font-medium">{a.title}</p><p className="line-clamp-2 text-xs text-muted-foreground">{a.detail}</p><p className="text-[11px] text-muted-foreground">{a.when}</p></li>)}
            </ul>
          )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/transactions">View all transactions</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
