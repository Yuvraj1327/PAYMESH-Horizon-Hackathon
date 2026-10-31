import { Bot, ClipboardList, CreditCard, Hourglass, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Kpi } from "@/types/dashboard";

const ICONS: Record<Kpi["key"], LucideIcon> = {
  totalRequests: ClipboardList,
  activeProcurement: Hourglass,
  totalPayments: CreditCard,
  connectedAgents: Bot,
};

export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <section aria-label="Key figures" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => {
        const Icon = ICONS[k.key];
        return (
          <Card key={k.key} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">{k.label}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-navy">{k.value}</p>
              </div>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand"><Icon className="size-5" aria-hidden="true" /></span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{k.hint}</p>
          </Card>
        );
      })}
    </section>
  );
}
