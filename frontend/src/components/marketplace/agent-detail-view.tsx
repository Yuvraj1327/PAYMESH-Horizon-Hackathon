"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, CircleSlash, Clock, Handshake, Star, Wallet } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { AvailabilityBadge } from "@/components/common/availability-badge";
import { DemoNotice } from "@/components/common/data-source-notice";
import { Rating } from "@/components/common/rating";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deliveryLabel, getCategory } from "@/constants/categories";
import { useAgent } from "@/hooks/use-marketplace";
import { formatAmount } from "@/lib/utils";
import { minPrice } from "@/services/marketplace";
import { NotFoundError } from "@/services/errors";
import { formatDateTime } from "@/components/common/format";

export function AgentDetailView({ agentId }: { agentId: string }) {
  const { data: agent, isPending, isError, error, refetch } = useAgent(agentId);

  if (isPending) return <div role="status" aria-label="Loading agent"><Skeleton className="mb-6 h-40 w-full rounded-xl" /><Skeleton className="h-72 w-full rounded-xl" /></div>;
  if (isError) {
    return error instanceof NotFoundError
      ? <EmptyState title="Agent not found" description="This agent doesn’t exist or is no longer listed." action={<Button asChild variant="outline"><Link href="/marketplace">Back to marketplace</Link></Button>} className="rounded-xl border bg-surface" />
      : <ErrorState title="Couldn’t load this agent" message={error.message} onRetry={() => void refetch()} />;
  }

  const cat = getCategory(agent.category);
  const offline = agent.availability === "offline";
  const from = minPrice(agent);
  const hireHref = `/procurement/new?agent=${encodeURIComponent(agent.id)}`;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/marketplace" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" /> Back to marketplace</Link>
      {agent.source === "demo" && <DemoNotice><strong className="font-semibold">Demo listing.</strong> This agent is illustrative: it is not registered on-chain, has no payout wallet, and its ratings and reviews are samples.</DemoNotice>}

      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <AgentAvatar category={agent.category} className="size-14" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-navy sm:text-2xl">{agent.name}</h2>
              <p className="text-sm font-medium text-brand">{cat.label}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Rating value={agent.rating} count={agent.rating !== null ? agent.reviewCount : undefined} />
                <AvailabilityBadge value={agent.availability} />
                {agent.verified && <Badge variant="brand"><BadgeCheck className="size-3" aria-hidden="true" /> Verified listing</Badge>}
                {agent.source === "demo" && <Badge variant="demo">Demo agent</Badge>}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {agent.services.length ? <p className="text-sm text-muted-foreground">From <strong className="text-xl text-navy">{formatAmount(from)} {agent.services[0]?.asset}</strong></p> : <p className="text-sm text-muted-foreground">No services listed yet</p>}
            {offline
              ? <Button disabled><Handshake /> Currently offline</Button>
              : <Button asChild size="lg"><Link href={hireHref}><Handshake /> Hire Agent</Link></Button>}
            <p className="max-w-56 text-xs text-muted-foreground sm:text-right">Starts a procurement request that asks this agent for a quotation. Nothing is paid yet.</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>About</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-foreground/90">{agent.description}</p>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Capabilities</h3>
                <ul className="flex flex-wrap gap-2" aria-label="Capabilities">{agent.capabilities.map((c) => <li key={c}><Badge variant="neutral">{c}</Badge></li>)}</ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Services &amp; pricing</CardTitle><CardDescription>Prices are fixed per service; the final amount is confirmed in a quotation.</CardDescription></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {agent.services.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-sm">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="size-4" aria-hidden="true" /> ~{deliveryLabel(s.deliveryMinutes)}</span>
                      <strong className="text-base text-navy">{formatAmount(s.price)} {s.asset}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reviews</CardTitle>
              <CardDescription>{agent.reviews.length ? "Sample reviews for demonstration — not real customer feedback." : "No reviews yet."}</CardDescription>
            </CardHeader>
            <CardContent>
              {agent.reviews.length === 0 ? <EmptyState icon={Star} title="No reviews yet" description="Reviews appear after completed, verified jobs." className="py-8" /> : (
                <ul className="divide-y">
                  {agent.reviews.map((r) => (
                    <li key={r.id} className="py-4 first:pt-1 last:pb-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">{r.author} {r.isSample && <Badge variant="demo" className="ml-1">Sample</Badge>}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(r.date)}</p>
                      </div>
                      <Rating value={r.rating} className="mt-1" />
                      <p className="mt-1.5 text-sm text-muted-foreground">{r.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Provider information</CardTitle></CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-3 text-sm">
                <Row label="Provider" value={agent.provider.name} />
                <Row label="Listed since" value={agent.provider.since} />
                <Row label="Typical response" value={agent.provider.responseTime} />
                <Row label="On-chain registration" icon={<CircleSlash className="size-4" aria-hidden="true" />} value={agent.registration.onChain ? "Registered on-chain" : "Not registered on-chain (demo)"} />
                <Row label="Wallet address" icon={<Wallet className="size-4" aria-hidden="true" />} value={agent.walletAddress ?? "Not available (demo listing)"} breakAll />
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, icon, breakAll }: { label: string; value: string; icon?: React.ReactNode; breakAll?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 flex items-center gap-1.5 text-foreground ${breakAll ? "break-all" : ""}`}>{icon}{value}</dd>
    </div>
  );
}
