import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/types/dashboard";

const MAP: Record<RequestStatus, { label: string; variant: "neutral" | "brand" | "success" | "warning" }> = {
  awaiting_quotes: { label: "Awaiting quotes", variant: "neutral" },
  quotes_ready: { label: "Quotes ready", variant: "brand" },
  provider_selected: { label: "Provider selected", variant: "success" },
  payment_pending: { label: "Payment pending", variant: "warning" },
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { label, variant } = MAP[status];
  return <Badge variant={variant}>{label}</Badge>;
}
