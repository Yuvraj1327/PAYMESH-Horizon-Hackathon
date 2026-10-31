import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function DemoNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-lg border border-dashed border-warning/40 bg-warning-bg/50 px-4 py-3 text-sm text-warning", className)}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
