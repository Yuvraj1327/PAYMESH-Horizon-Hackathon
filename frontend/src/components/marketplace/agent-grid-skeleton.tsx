import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function AgentGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading agents" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>
          <Skeleton className="h-10 w-full" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-8 w-full" />
        </Card>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
