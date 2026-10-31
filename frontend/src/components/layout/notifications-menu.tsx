"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function NotificationsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <Bell className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">You’re all caught up</p>
          <p className="text-xs text-muted-foreground">Quotation, authorization and settlement alerts will appear here.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
