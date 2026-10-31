import { Bot, ClipboardList, CreditCard, FileText, UserCheck, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import type { ActivityItem } from "@/types/dashboard";

const ICONS: Record<ActivityItem["kind"], LucideIcon> = {
  request: ClipboardList,
  quotation: FileText,
  selection: UserCheck,
  payment: CreditCard,
  agent: Bot,
};

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Latest events across your requests, agents and payments.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title="No activity yet" description="Events appear here as soon as you create your first request." />
        ) : (
          <ol className="relative flex flex-col">
            {items.map((a, i) => {
              const Icon = ICONS[a.kind];
              return (
                <li key={a.id} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < items.length - 1 && <span aria-hidden="true" className="absolute left-[17px] top-9 h-[calc(100%-2.25rem)] w-px bg-border" />}
                  <span className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy"><Icon className="size-4" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-sm font-medium text-foreground">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.when}</p>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{a.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
