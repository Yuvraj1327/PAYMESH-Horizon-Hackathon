import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/types/procurement";

const MAP: Record<RequestStatus, { label: string; variant: "neutral" | "brand" | "warning" | "success" | "outline" }> = {
  awaiting_quotes: { label: "Awaiting quotes", variant: "neutral" },
  quotes_ready: { label: "Quotes ready", variant: "brand" },
  provider_selected: { label: "Provider selected", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "outline" },
  expired: { label: "Expired", variant: "outline" },
};

export const STATUS_OPTIONS = (Object.keys(MAP) as RequestStatus[]).map((v) => ({ value: v, label: MAP[v].label }));

export function ProcurementStatusBadge({ status }: { status: RequestStatus }) {
  const m = MAP[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
