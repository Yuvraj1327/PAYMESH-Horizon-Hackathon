import { Bot, Bell, Check, ClipboardList, FileText, Search, Sparkles, UserCheck, Wallet, XCircle, type LucideIcon } from "lucide-react";
import { formatDateTime } from "@/components/common/format";
import type { ActivityEvent, ActorRole, EventType } from "@/types/procurement";

const ICONS: Record<EventType, LucideIcon> = {
  request_created: ClipboardList,
  requirements_extracted: Sparkles,
  agents_discovered: Search,
  quotations_received: FileText,
  recommendation_generated: Bot,
  provider_selected: UserCheck,
  payment_authorization_pending: Wallet,
  request_completed_sample: Check,
  request_cancelled: XCircle,
  task_parsed: Sparkles,
  service_request: Search,
  quotation: FileText,
  recommendation: Bot,
  selection: UserCheck,
  payment_conditions: Wallet,
  delivery: Check,
  note: Bell,
};

const ACTOR: Record<ActorRole, string> = { user: "You", buyer_agent: "Buyer Agent", provider_agent: "Provider Agent", payment_agent: "Payment Agent", system: "System" };

/** Renders only events that exist in application state — nothing is inferred or pre-filled. */
export function Timeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  return (
    <ol className="relative flex flex-col" aria-label="Activity timeline">
      {events.map((e, i) => {
        const Icon = ICONS[e.type] ?? Bell;
        return (
          <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
            {i < events.length - 1 && <span aria-hidden="true" className="absolute left-[17px] top-9 h-[calc(100%-2.25rem)] w-px bg-border" />}
            <span className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy"><Icon className="size-4" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-foreground">{e.title}</p>
                <time dateTime={e.at} className="text-xs text-muted-foreground">{formatDateTime(e.at)}</time>
              </div>
              <p className="text-xs font-medium text-brand">{ACTOR[e.actor]}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{e.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
