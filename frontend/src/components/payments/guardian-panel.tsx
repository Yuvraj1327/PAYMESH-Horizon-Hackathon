import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isBlocked } from "@/lib/guardian";
import type { GuardianCheck, GuardianState } from "@/types/payment";

const STATE: Record<GuardianState, { label: string; variant: "success" | "warning" | "danger" | "neutral"; Icon: typeof CheckCircle2; tone: string }> = {
  passed: { label: "Passed", variant: "success", Icon: CheckCircle2, tone: "text-success" },
  warning: { label: "Warning", variant: "warning", Icon: AlertTriangle, tone: "text-warning" },
  blocked: { label: "Blocked", variant: "danger", Icon: ShieldAlert, tone: "text-danger" },
  not_evaluated: { label: "Not checked", variant: "neutral", Icon: CircleDashed, tone: "text-muted-foreground" },
};

/**
 * Shows Payment Guardian results exactly as the backend reported them. This panel never decides anything:
 * it has no policy logic, and the backend re-checks every rule when a payment is authorized.
 */
export function GuardianPanel({ checks, loading, error, demo }: { checks: GuardianCheck[]; loading?: boolean; error?: string | null; demo?: boolean }) {
  const blocked = isBlocked(checks);
  const warned = checks.some((c) => c.state === "warning");
  const evaluated = checks.some((c) => c.state !== "not_evaluated");
  return (
    <Card data-testid="guardian-panel" className={cn(blocked && "border-danger/40")}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {blocked ? <ShieldAlert className="size-5 text-danger" aria-hidden="true" /> : <ShieldCheck className="size-5 text-teal" aria-hidden="true" />}
          <CardTitle>Payment Guardian</CardTitle>
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Checking" />}
          {!loading && evaluated && (
            <Badge variant={blocked ? "danger" : warned ? "warning" : "success"} data-testid="guardian-verdict">
              {blocked ? "Blocked" : warned ? "Passed with warnings" : "All checks passed"}
            </Badge>
          )}
          {demo && <Badge variant="demo">Demo evaluation</Badge>}
        </div>
        <CardDescription>
          Policy checks run by the PayMesh backend before any payment can be authorized. {demo ? "In demo mode a local stand-in produces these results." : "This screen only displays the backend's answer."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="mb-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
        <ul className="divide-y rounded-lg border" aria-label="Guardian checks">
          {checks.map((c) => {
            const s = STATE[c.state];
            return (
              <li key={c.id} className="flex items-start gap-3 px-3 py-3" data-check={c.id} data-state={c.state}>
                <s.Icon className={cn("mt-0.5 size-5 shrink-0", s.tone)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                </div>
                <Badge variant={s.variant}>{s.label}</Badge>
              </li>
            );
          })}
        </ul>
        {blocked && <p role="alert" className="mt-3 text-sm font-medium text-danger">This payment is blocked and cannot be authorized. Adjust your spending policy in Settings or choose a different provider.</p>}
      </CardContent>
    </Card>
  );
}
