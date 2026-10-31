import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock3, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/utils";
import type { PaymentSummary } from "@/types/dashboard";

export function PaymentOverview({ payments }: { payments: PaymentSummary }) {
  const pending = Number(payments.pending.amount);
  const completed = Number(payments.completed.amount);
  const total = pending + completed;
  const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment overview</CardTitle>
        <CardDescription>Amounts in {payments.asset}. A payment counts as completed only after verification.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          role="img"
          aria-label={`${completedPct}% of payment value completed, ${100 - completedPct}% pending`}
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-warning-bg"
        >
          <div className="h-full bg-teal" style={{ width: `${completedPct}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-teal-50 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-teal-700"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Completed</dt>
            <dd className="mt-1 text-lg font-bold text-navy">{formatAmount(payments.completed.amount)}</dd>
            <dd className="text-xs text-muted-foreground">{payments.completed.count} payments</dd>
          </div>
          <div className="rounded-lg bg-warning-bg/60 p-3">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-warning"><Clock3 className="size-3.5" aria-hidden="true" /> Pending</dt>
            <dd className="mt-1 text-lg font-bold text-navy">{formatAmount(payments.pending.amount)}</dd>
            <dd className="text-xs text-muted-foreground">{payments.pending.count} payments</dd>
          </div>
        </dl>
        <p className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
          <BadgeCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Verified on-chain settlements: <strong className="text-foreground">{payments.verifiedOnChain}</strong>
        </p>
        <Button asChild variant="outline" size="sm" className="self-start"><Link href="/payments">Open payments <ArrowRight /></Link></Button>
      </CardContent>
    </Card>
  );
}
