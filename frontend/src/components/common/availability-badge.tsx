import { Badge } from "@/components/ui/badge";
import type { Availability } from "@/types/agent";

const MAP: Record<Availability, { label: string; variant: "success" | "warning" | "neutral"; dot: string }> = {
  available: { label: "Available", variant: "success", dot: "bg-teal" },
  busy: { label: "Busy", variant: "warning", dot: "bg-amber-500" },
  offline: { label: "Offline", variant: "neutral", dot: "bg-slate-400" },
};

export function AvailabilityBadge({ value }: { value: Availability }) {
  const m = MAP[value];
  return (
    <Badge variant={m.variant}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </Badge>
  );
}
