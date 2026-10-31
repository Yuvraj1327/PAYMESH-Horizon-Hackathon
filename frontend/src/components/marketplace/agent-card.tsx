import Link from "next/link";
import { BadgeCheck, CircleSlash, Wallet } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { AvailabilityBadge } from "@/components/common/availability-badge";
import { Rating } from "@/components/common/rating";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCategory } from "@/constants/categories";
import { formatAmount } from "@/lib/utils";
import { minPrice } from "@/services/marketplace";
import type { Agent } from "@/types/agent";

export function AgentCard({ agent }: { agent: Agent }) {
  const cat = getCategory(agent.category);
  const first = agent.services[0];
  const asset = first?.asset ?? "USDT";
  return (
    <Card className="flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-pop">
      <div className="flex items-start gap-3">
        <AgentAvatar category={agent.category} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-foreground">
            <Link href={`/marketplace/${agent.id}`} className="after:absolute after:inset-0 hover:text-brand focus-visible:outline-none">{agent.name}</Link>
          </h3>
          <p className="text-xs font-medium text-brand">{cat.label}</p>
        </div>
        {agent.source === "demo" && <Badge variant="demo">Demo</Badge>}
      </div>

      <p className="line-clamp-2 text-sm text-muted-foreground">{agent.description}</p>

      <ul className="flex flex-wrap gap-1.5" aria-label="Services">
        {agent.services.slice(0, 2).map((s) => <li key={s.id}><Badge variant="outline">{s.name}</Badge></li>)}
        {agent.services.length > 2 && <li><Badge variant="outline">+{agent.services.length - 2} more</Badge></li>}
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Rating value={agent.rating} count={agent.rating !== null ? agent.reviewCount : undefined} />
        <AvailabilityBadge value={agent.availability} />
        {agent.verified && <Badge variant="brand"><BadgeCheck className="size-3" aria-hidden="true" /> Verified listing</Badge>}
      </div>

      <dl className="space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Wallet className="size-3.5 shrink-0" aria-hidden="true" />
          <dt className="sr-only">Wallet address</dt>
          <dd className="truncate">{agent.walletAddress ?? "Wallet address not available (demo)"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <CircleSlash className="size-3.5 shrink-0" aria-hidden="true" />
          <dt className="sr-only">On-chain registration</dt>
          <dd>{agent.registration.onChain ? "Registered on-chain" : "Not registered on-chain (demo listing)"}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-3">
        {agent.services.length ? <p className="text-sm text-muted-foreground">From <strong className="text-base text-navy">{formatAmount(minPrice(agent))} {asset}</strong></p> : <p className="text-sm text-muted-foreground">No services listed</p>}
        <Button asChild size="sm" variant="outline" className="relative z-10">
          <Link href={`/marketplace/${agent.id}`} aria-label={`View ${agent.name}`}>View</Link>
        </Button>
      </div>
    </Card>
  );
}
