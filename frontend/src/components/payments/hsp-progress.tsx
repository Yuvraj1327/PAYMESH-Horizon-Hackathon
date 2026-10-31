import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentStatusView } from "@/types/payment";

/** Official HSP payment statuses in order (merchant docs). Shown as progress only, never as proof of payment. */
const ORDER = ["payment-required", "payment-submitted", "payment-verified", "payment-processing", "payment-included", "payment-safe", "payment-finalized"] as const;
const LABEL: Record<(typeof ORDER)[number], string> = {
  "payment-required": "Order registered, waiting for your signature",
  "payment-submitted": "Signed payment submitted to HSP",
  "payment-verified": "Verified by HSP",
  "payment-processing": "Processing",
  "payment-included": "Included in a block",
  "payment-safe": "Block considered safe",
  "payment-finalized": "Finalized on-chain",
};

export function HspProgress({ view }: { view: PaymentStatusView | null }) {
  const gw = view?.hsp?.gatewayStatus ?? null;
  const failed = gw === "payment-failed" || view?.status === "FAILED";
  const idx = gw ? ORDER.indexOf(gw as (typeof ORDER)[number]) : view?.hsp?.orderState === "created" ? 0 : -1;
  const verified = !!view?.settledAndVerified;
  return (
    <div data-testid="hsp-progress">
      <ol className="flex flex-col gap-2" aria-label="HSP settlement progress">
        {ORDER.map((s, i) => {
          const done = i < idx || (i === idx && (i === ORDER.length - 1 || verified));
          const current = i === idx && !done && !failed;
          return (
            <li key={s} className={cn("flex items-center gap-2 text-sm", done ? "text-foreground" : current ? "font-medium text-foreground" : "text-muted-foreground")} aria-current={current ? "step" : undefined}>
              {done ? <CheckCircle2 className="size-4 text-teal" aria-hidden="true" /> : current ? <Loader2 className="size-4 animate-spin text-brand motion-reduce:animate-none" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
              {LABEL[s]}
            </li>
          );
        })}
        <li className={cn("flex items-center gap-2 text-sm", failed ? "text-danger" : verified ? "font-semibold text-success" : "text-muted-foreground")}>
          {failed ? <XCircle className="size-4" aria-hidden="true" /> : verified ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
          {failed ? "HSP reported the payment as failed" : verified ? "Settlement independently verified by PayMesh" : "Waiting for PayMesh to verify settlement (gateway + chain)"}
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">HSP statuses are progress indicators. Only the last step, verification by the PayMesh backend, means the payment is complete.</p>
    </div>
  );
}
