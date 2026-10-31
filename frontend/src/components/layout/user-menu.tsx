"use client";

import Link from "next/link";
import { ChevronDown, Code2, LogOut, Settings, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/use-current-user";

export function UserMenu() {
  const user = useCurrentUser();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full border bg-surface py-1 pl-1 pr-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        aria-label="Open profile menu"
      >
        <Avatar name={user.name} className="size-7" />
        <span className="hidden max-w-32 truncate font-medium md:inline">{user.name}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-foreground">{user.name}</span>
          <span className="block font-normal">{user.isPreview ? "Preview session — sign-in comes later" : user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings /> Profile &amp; settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings"><ShieldCheck /> Spending policy</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/developers"><Code2 /> Developers</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
