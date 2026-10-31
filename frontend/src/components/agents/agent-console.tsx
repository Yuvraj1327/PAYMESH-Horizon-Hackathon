"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bot, Handshake, Info, ShieldCheck } from "lucide-react";
import { formatDateTime } from "@/components/common/format";
import { DemoNotice } from "@/components/common/data-source-notice";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentActivity, useRequests } from "@/hooks/use-procurement";
import type { AgentActivity, RequestSummary } from "@/types/procurement";

type Role = "buyer_agent" | "provider_agent" | "payment_agent";
type RoleStatus = "Idle" | "Waiting";

interface RoleView { role: Role; name: string; icon: typeof Bot; description: string; status: RoleStatus; task: string }

const first = (rows: readonly RequestSummary[], pred: (r: RequestSummary) => boolean) => rows.find(pred);

/** Current task/status are derived from real request state; there are no background processes behind these roles. */
export function deriveRoles(requests: readonly RequestSummary[]): RoleView[] {
  const awaiting = first(requests, (r) => r.status === "awaiting_quotes");
  const ready = first(requests, (r) => r.status === "quotes_ready");
  const selected = first(requests, (r) => r.status === "provider_selected");
  const quoted = requests.filter((r) => r.quotationCount > 0 && (r.status === "quotes_ready" || r.status === "provider_selected"));
  return [
    {
      role: "buyer_agent", name: "Buyer Agent", icon: Bot, status: ready || awaiting ? "Waiting" : "Idle",
      description: "Understands your request, extracts requirements, discovers matching providers and recommends one.",
      task: ready ? `Waiting for your decision on “${ready.title}”` : awaiting ? `No provider has quoted “${awaiting.title}” yet` : "No request needs attention",
    },
    {
      role: "provider_agent", name: "Provider Agent", icon: Handshake, status: "Idle",
      description: "Lists services, responds with quotations and, in later steps, delivers the purchased service.",
      task: quoted.length ? `Quotations on record for ${quoted.length} open request${quoted.length === 1 ? "" : "s"}` : "No quotations on record",
    },
    {
      role: "payment_agent", name: "Payment Agent", icon: ShieldCheck, status: selected ? "Waiting" : "Idle",
      description: "Prepares payment conditions and, in the next step, coordinates secure HSP payments with your wallet.",
      task: selected ? `Payment conditions prepared for “${selected.title}” — awaiting your authorization` : "No payment conditions prepared",
    },
  ];
}

export function AgentConsole() {
  const reqs = useRequests();
  const act = useAgentActivity();
  const roles = useMemo(() => deriveRoles(reqs.data ?? []), [reqs.data]);
  const byRole = useMemo(() => {
    const m: Record<Role, AgentActivity[]> = { buyer_agent: [], provider_agent: [], payment_agent: [] };
    for (const a of act.data ?? []) m[a.role].push(a);
    return m;
  }, [act.data]);

  if (reqs.isError || act.isError) return <ErrorState title="Couldn’t load agent activity" message={(reqs.error ?? act.error)?.message} onRetry={() => { void reqs.refetch(); void act.refetch(); }} />;
  const loading = reqs.isPending || act.isPending;

  return (
    <div className="flex flex-col gap-6">
      <DemoNotice>
        <strong className="font-semibold">Logical roles, demo activity.</strong> Buyer, Provider and Payment agents are roles within the PayMesh application, not separately deployed autonomous services. Activity below is recorded from your demo requests.
      </DemoNotice>
      <div className="grid gap-6 lg:grid-cols-3">
        {loading ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-xl" />) : roles.map((r) => {
          const Icon = r.icon;
          const items = byRole[r.role].slice(0, 5);
          return (
            <Card key={r.role} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand"><Icon className="size-5" aria-hidden="true" /></span>
                  <Badge variant={r.status === "Waiting" ? "warning" : "neutral"}>{r.status}</Badge>
                </div>
                <CardTitle className="mt-2 text-lg">{r.name}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="rounded-lg bg-background p-3"><p className="text-xs font-medium text-muted-foreground">Current task</p><p className="mt-0.5 text-sm">{r.task}</p></div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Recent activity</h3>
                  {items.length === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Info className="size-4" aria-hidden="true" /> {r.role === "payment_agent" ? "No payment activity yet. Select a provider to prepare conditions." : "No activity recorded yet."}</p> : (
                    <ul className="flex flex-col gap-3">
                      {items.map((a) => (
                        <li key={a.id} className="text-sm">
                          <div className="flex items-baseline justify-between gap-2"><p className="font-medium">{a.title}</p><time dateTime={a.at} className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.at)}</time></div>
                          <p className="text-xs text-muted-foreground">{a.detail}</p>
                          <Link href={`/procurement/${a.requestId}`} className="text-xs font-medium text-brand hover:underline">View request</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
