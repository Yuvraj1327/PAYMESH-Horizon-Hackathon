import { cn } from "@/lib/utils";

/** Connected-node mark: four agents linked into a mesh, one highlighted as the settlement node. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="PayMesh" className={cn("size-8", className)} fill="none">
      <rect width="32" height="32" rx="8" fill="#142B4A" />
      <g stroke="#7FA6F5" strokeWidth="1.6" strokeLinecap="round">
        <path d="M9 10.5 16 7l7 3.5M9 10.5v11M23 10.5v11M9 21.5 16 25l7-3.5M9 10.5l14 11M23 10.5 9 21.5" opacity=".75" />
      </g>
      <circle cx="9" cy="10.5" r="2.6" fill="#fff" />
      <circle cx="23" cy="10.5" r="2.6" fill="#fff" />
      <circle cx="9" cy="21.5" r="2.6" fill="#fff" />
      <circle cx="23" cy="21.5" r="2.6" fill="#14B8A6" />
      <circle cx="16" cy="16" r="2.2" fill="#2563EB" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}

export function Logo({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight text-navy">
          Pay<span className="text-brand">Mesh</span>
        </span>
        {showTagline && <span className="mt-1 text-[10px] font-medium text-muted-foreground">Autonomous agent payments</span>}
      </span>
    </span>
  );
}
