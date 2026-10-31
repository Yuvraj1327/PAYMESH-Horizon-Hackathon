import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function Rating({ value, count, className }: { value: number | null; count?: number; className?: string }) {
  if (value === null) return <span className={cn("text-xs text-muted-foreground", className)}>No rating yet</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)} aria-label={`Rated ${value.toFixed(1)} out of 5${count ? `, ${count} sample reviews` : ""}`}>
      <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden="true" />
      <strong className="font-semibold text-foreground">{value.toFixed(1)}</strong>
      {count !== undefined && <span className="text-muted-foreground">({count})</span>}
    </span>
  );
}
