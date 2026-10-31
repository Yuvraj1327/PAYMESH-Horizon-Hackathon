import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MobileNav } from "@/components/layout/mobile-nav";
import { GlobalSearch } from "@/components/layout/global-search";
import { NetworkBadge } from "@/components/layout/network-badge";
import { WalletButton } from "@/components/layout/wallet-button";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { UserMenu } from "@/components/layout/user-menu";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { LogoMark } from "@/components/common/logo";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="flex h-16 items-center gap-1.5 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <MobileNav />
        <Link href="/dashboard" className="lg:hidden" aria-label="PayMesh home"><LogoMark className="size-7" /></Link>
        <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-sm lg:flex">
          <span className="text-muted-foreground">PayMesh</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          <Breadcrumb />
        </div>
        <div className="mx-auto hidden w-full min-w-0 max-w-md md:block"><GlobalSearch /></div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <NetworkBadge />
          <WalletButton />
          <NotificationsMenu />
          <UserMenu />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden"><GlobalSearch /></div>
    </header>
  );
}
