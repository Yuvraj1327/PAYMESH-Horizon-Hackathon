import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states";

/** Polished placeholder for routes that ship in later steps. Pure presentation: no data, no fake activity. */
export function ComingSoonPage({
  title, description, icon, emptyTitle, emptyDescription, planned, note,
}: {
  title: string; description: string; icon: LucideIcon; emptyTitle: string; emptyDescription: ReactNode;
  planned: readonly string[]; note?: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} actions={<Badge variant="neutral"><Clock className="size-3" /> Coming in a later step</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} className="py-16" />
          {note && <p className="border-t px-5 py-3 text-xs text-muted-foreground">{note}</p>}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Planned for this page</CardTitle>
            <CardDescription>What will be built here next.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {planned.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
