import Link from "next/link";
import { Info } from "lucide-react";
import { Logo } from "@/components/common/logo";
import { NavLinks } from "@/components/layout/nav-links";
import { isDemoMode } from "@/lib/env";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/dashboard" onClick={onNavigate} className="px-2 pt-1" aria-label="PayMesh home">
        <Logo showTagline />
      </Link>
      <div className="flex-1 overflow-y-auto">
        <NavLinks onNavigate={onNavigate} />
      </div>
      {isDemoMode && (
        <div className="rounded-lg border border-dashed border-warning/40 bg-warning-bg/50 p-3 text-xs text-warning">
          <p className="flex items-center gap-1.5 font-semibold">
            <Info className="size-3.5" /> Demo mode
          </p>
          <p className="mt-1 leading-relaxed text-warning/90">No backend connected. Figures are illustrative and not blockchain activity.</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-surface lg:block">
      <SidebarContent />
    </aside>
  );
}
