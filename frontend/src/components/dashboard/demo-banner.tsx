import { Info } from "lucide-react";

export function DemoBanner() {
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-lg border border-dashed border-warning/40 bg-warning-bg/50 px-4 py-3 text-sm text-warning">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        <strong className="font-semibold">Demo data.</strong> These figures, agents and events are illustrative. They are not live backend records
        or blockchain activity; verified settlements will only appear here once the backend and HSP are connected.
      </p>
    </div>
  );
}
