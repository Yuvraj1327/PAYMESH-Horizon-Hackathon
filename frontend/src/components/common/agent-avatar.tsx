import { getCategory } from "@/constants/categories";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/types/agent";

const TONES: Record<CategoryId, string> = {
  research: "bg-brand-50 text-brand",
  market_intelligence: "bg-teal-50 text-teal-700",
  data_services: "bg-navy-50 text-navy",
  development: "bg-[#f3efff] text-[#6d28d9]",
  ai_automation: "bg-[#fff4e5] text-[#b45309]",
  api_services: "bg-[#e8f7ff] text-[#0369a1]",
  other: "bg-muted text-muted-foreground",
};

export function AgentAvatar({ category, className }: { category: CategoryId; className?: string }) {
  const Icon = getCategory(category).icon;
  return (
    <span aria-hidden="true" className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONES[category], className)}>
      <Icon className="size-5" />
    </span>
  );
}
