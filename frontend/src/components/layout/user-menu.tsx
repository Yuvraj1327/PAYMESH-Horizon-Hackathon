"use client";

import Link from "next/link";
import { ChevronDown, Code2, Download, LogOut, Settings, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAuth } from "@/components/auth/auth-provider";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

export function UserMenu() {
  const user = useCurrentUser();
  const { signOut } = useAuth();
  const { canInstall, install } = useInstallPrompt();
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
          <span className="block font-normal">{user.isPreview ? "Demo mode — no account" : user.email}{user.isAdmin && <span className="ml-1 rounded bg-navy-50 px-1.5 py-0.5 text-[10px] font-semibold text-navy">Admin</span>}</span>
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
        {canInstall && <DropdownMenuItem onSelect={() => void install()} data-testid="install-app"><Download /> Install PayMesh app</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {user.isPreview ? (
          <DropdownMenuItem disabled><LogOut /> Sign out (demo mode)</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void signOut()} data-testid="sign-out"><LogOut /> Sign out</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
