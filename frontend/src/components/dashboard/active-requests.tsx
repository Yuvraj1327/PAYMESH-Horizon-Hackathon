import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { RequestStatusBadge } from "@/components/dashboard/status-badge";
import type { ActiveRequest } from "@/types/dashboard";

export function ActiveRequests({ requests }: { requests: ActiveRequest[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Active procurement requests</CardTitle>
          <CardDescription>Requests that still need quotations, a decision or a payment.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm"><Link href="/procurement">View all <ArrowRight /></Link></Button>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No active requests" description="Create a request and provider agents will send quotations." />
        ) : (
          <ul className="divide-y">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3.5 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{r.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.category} · Budget {r.budget} {r.asset} · {r.quotations} {r.quotations === 1 ? "quotation" : "quotations"}
                  </p>
                </div>
                <RequestStatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
