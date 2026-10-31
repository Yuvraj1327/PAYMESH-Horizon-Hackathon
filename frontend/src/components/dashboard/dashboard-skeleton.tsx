import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading dashboard">
      <Skeleton className="mb-6 h-40 w-full rounded-xl" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Card key={i} className="p-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-8 w-16" /><Skeleton className="mt-4 h-3 w-32" /></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2"><Skeleton className="h-64 w-full rounded-xl" /><Skeleton className="h-80 w-full rounded-xl" /></div>
        <div className="flex flex-col gap-6"><Skeleton className="h-64 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
