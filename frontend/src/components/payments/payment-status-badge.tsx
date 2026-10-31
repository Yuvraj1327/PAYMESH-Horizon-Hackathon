import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL } from "@/lib/payment-status";
import type { PaymentStatus } from "@/types/payment";

const VARIANT: Record<PaymentStatus, "neutral" | "brand" | "warning" | "success" | "danger" | "outline"> = {
  DRAFT: "neutral", VALIDATED: "neutral", AWAITING_SIGNATURE: "warning", SIGNED: "brand", SUBMITTED: "brand", PENDING: "brand",
  SETTLED: "success", FAILED: "danger", EXPIRED: "outline", CANCELLED: "outline",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={VARIANT[status]} data-status={status}>{STATUS_LABEL[status]}</Badge>;
}

export function DemoBadge() {
  return <Badge variant="demo">Demo</Badge>;
}
