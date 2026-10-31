"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, FileSearch, Loader2, Sparkles, Trophy } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { DemoNotice } from "@/components/common/data-source-notice";
import { Rating } from "@/components/common/rating";
import { ProcurementStatusBadge } from "@/components/procurement/status-badge";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { deliveryLabel } from "@/constants/categories";
import { useRequestDetail, useRequestQuotations, useSelectProvider } from "@/hooks/use-procurement";
import { cmp } from "@/lib/money";
import { cn, formatAmount } from "@/lib/utils";
import { NotFoundError } from "@/services/errors";
import type { AgentRef, AIRecommendation, Quotation, QuotationScore } from "@/types/procurement";

const AgentsContext = createContext<AgentRef[]>([]);
function useAgentOf() {
  const agents = useContext(AgentsContext);
  return (id: string) => agents.find((a) => a.id === id);
}

function Bar({ label, value, weight }: { label: string; value: number; weight?: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}{weight !== undefined && <span className="text-muted-foreground/70"> · {Math.round(weight * 100)}%</span>}</span><span className="font-medium tabular-nums">{Math.round(value)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${Math.round(value)} out of 100`}><div className="h-full rounded-full bg-brand" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function RecommendationPanel({ rec, quotes, onJump }: { rec: AIRecommendation; quotes: Quotation[]; onJump: () => void }) {
  const agentOf = useAgentOf();
  const top = quotes.find((q) => q.id === rec.recommendedQuotationId);
  const score = rec.scores.find((s) => s.quotationId === rec.recommendedQuotationId);
  const agent = top ? agentOf(top.agentId) : undefined;
  return (
    <Card className="border-teal/40 bg-teal-50/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="success"><Sparkles className="size-3" aria-hidden="true" /> AI recommendation</Badge>{rec.generatedBy === "demo-heuristic" ? <Badge variant="demo">Demo heuristic</Badge> : <Badge variant="outline">{rec.generatedBy === "claude" ? "Claude, via PayMesh backend" : "Rule-based fallback (backend)"}</Badge>}</div>
        <CardTitle className="mt-1 text-lg">{agent?.name ?? "Recommended provider"}{score && <span className="ml-2 text-base font-medium text-muted-foreground">{score.total}/100</span>}</CardTitle>
        <CardDescription className="text-sm text-foreground/80">{rec.rationale}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Why this provider</h3>
          <ul className="flex flex-col gap-1.5 text-sm">{rec.highlights.map((h) => <li key={h} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-700" aria-hidden="true" />{h}</li>)}</ul>
          {rec.tradeoffs.length > 0 && (<><h3 className="mb-2 mt-4 text-sm font-semibold">Trade-offs</h3><ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">{rec.tradeoffs.map((t) => <li key={t} className="flex items-start gap-2"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />{t}</li>)}</ul></>)}
        </div>
        <div>
          {rec.factors.length > 0 ? (<>
            <h3 className="mb-2 text-sm font-semibold">Decision factors (weight)</h3>
            {score && <div className="flex flex-col gap-2.5">{rec.factors.map((f) => <Bar key={f.key} label={f.label} value={score[f.key]} weight={f.weight} />)}</div>}
          </>) : (<>
            <h3 className="mb-2 text-sm font-semibold">Backend note</h3>
            <p className="text-sm text-muted-foreground">{score?.notes || "The backend returned a score without a note."}</p>
          </>)}
          <Button variant="outline" size="sm" className="mt-4" onClick={onJump}>See this quotation <ArrowRight /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuoteCard({ q, score, recommended, compare, onToggle, onSelect, canSelect }: {
  q: Quotation; score: QuotationScore | undefined; recommended: boolean; compare: boolean; onToggle: () => void; onSelect: () => void; canSelect: boolean;
}) {
  const agentOf = useAgentOf();
  const agent = agentOf(q.agentId);
  const selected = q.status === "selected";
  return (
    <Card id={`quote-${q.id}`} className={cn("flex h-full flex-col gap-4 p-5", selected && "border-brand ring-2 ring-brand/20", recommended && !selected && "border-teal/50")}>
      <div className="flex items-start gap-3">
        {agent && <AgentAvatar category={agent.category} />}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold"><Link href={`/marketplace/${q.agentId}`} className="hover:text-brand">{agent?.name ?? q.agentId}</Link></h3>
          <p className="truncate text-xs text-muted-foreground">{q.serviceName}</p>
        </div>
        <div className="flex flex-col items-end gap-1">{recommended && <Badge variant="success"><Trophy className="size-3" aria-hidden="true" /> AI pick</Badge>}{selected && <Badge variant="brand">Selected</Badge>}</div>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-3xl font-bold tracking-tight text-navy">{formatAmount(q.price)} <span className="text-base font-medium text-muted-foreground">{q.asset}</span></p>
        <p className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Clock className="size-4" aria-hidden="true" /> ~{deliveryLabel(q.deliveryMinutes)}</p>
      </div>
      <Rating value={q.reputation} />
      <ul className="flex flex-wrap gap-1.5" aria-label="Capabilities">
        {q.capabilities.map((c) => <li key={c}><Badge variant={q.matchedCapabilities.includes(c) ? "success" : "outline"}>{q.matchedCapabilities.includes(c) && <CheckCircle2 className="size-3" aria-hidden="true" />}{c}</Badge></li>)}
      </ul>
      {score && <div className="flex flex-col gap-2 rounded-lg bg-background p-3"><Bar label="Overall score" value={score.total} /><Bar label="Price" value={score.price} /><Bar label="Delivery" value={score.delivery} /><Bar label="Capability" value={score.capability} /></div>}
      <p className="text-xs text-muted-foreground">{q.summary}</p>
      <div className="mt-auto flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={compare} onChange={onToggle} /> Include in comparison</label>
        <Button onClick={onSelect} disabled={!canSelect || selected} variant={selected ? "secondary" : "default"}>{selected ? <><CheckCircle2 /> Selected provider</> : "Select provider"}</Button>
      </div>
    </Card>
  );
}

function ComparisonTable({ quotes, scores, recommendedId }: { quotes: Quotation[]; scores: QuotationScore[]; recommendedId: string | null }) {
  const agentOf = useAgentOf();
  const best = useMemo(() => ({
    price: quotes.reduce((m, q) => (cmp(q.price, m) < 0 ? q.price : m), quotes[0]?.price ?? "0"),
    delivery: Math.min(...quotes.map((q) => q.deliveryMinutes)),
    score: Math.max(...scores.filter((s) => quotes.some((q) => q.id === s.quotationId)).map((s) => s.total)),
  }), [quotes, scores]);
  const win = "bg-teal-50 font-semibold text-teal-700";
  const sc = (q: Quotation) => scores.find((s) => s.quotationId === q.id);
  return (
    <div className="overflow-x-auto rounded-xl border bg-surface shadow-card">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">Comparison of selected quotations</caption>
        <thead><tr className="border-b bg-muted/50 text-left"><th scope="col" className="p-3 font-medium text-muted-foreground">Criteria</th>{quotes.map((q) => <th key={q.id} scope="col" className="p-3 font-semibold">{agentOf(q.agentId)?.name}{q.id === recommendedId && <Badge variant="success" className="ml-2">AI pick</Badge>}</th>)}</tr></thead>
        <tbody className="[&_td]:p-3 [&_th]:p-3 [&_tr]:border-b last:[&_tr]:border-0">
          <tr><th scope="row" className="text-left font-medium text-muted-foreground">Price</th>{quotes.map((q) => <td key={q.id} className={cn(q.price === best.price && quotes.length > 1 && win)}>{formatAmount(q.price)} {q.asset}</td>)}</tr>
          <tr><th scope="row" className="text-left font-medium text-muted-foreground">Delivery</th>{quotes.map((q) => <td key={q.id} className={cn(q.deliveryMinutes === best.delivery && quotes.length > 1 && win)}>~{deliveryLabel(q.deliveryMinutes)}</td>)}</tr>
          <tr><th scope="row" className="text-left font-medium text-muted-foreground">Capability match</th>{quotes.map((q) => <td key={q.id} className={cn((q.capabilityMatch ?? 0) >= 1 && win)}>{q.capabilityMatch === null ? "—" : `${Math.round(q.capabilityMatch * 100)}%`}</td>)}</tr>
          <tr><th scope="row" className="text-left font-medium text-muted-foreground">Reputation</th>{quotes.map((q) => <td key={q.id}>{q.reputation !== null ? `${q.reputation.toFixed(1)}/5${q.source === "demo" ? " (sample)" : ""}` : "No rating"}</td>)}</tr>
          <tr><th scope="row" className="text-left font-medium text-muted-foreground">Overall score</th>{quotes.map((q) => <td key={q.id} className={cn(sc(q)?.total === best.score && quotes.length > 1 && win)}>{sc(q)?.total ?? "—"}/100</td>)}</tr>
          <tr><th scope="row" className="text-left font-medium text-muted-foreground">Capabilities</th>{quotes.map((q) => <td key={q.id} className="text-muted-foreground">{q.capabilities.join(", ")}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

export function QuotationsView({ requestId }: { requestId: string }) {
  const { data, isPending, isError, error, refetch } = useRequestDetail(requestId);
  const select = useSelectProvider();
  const ask = useRequestQuotations();
  const [pending, setPending] = useState<Quotation | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  if (isPending) return <div role="status" aria-label="Loading quotations"><Skeleton className="mb-4 h-24 w-full rounded-xl" /><div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-xl" />)}</div></div>;
  if (isError) {
    return error instanceof NotFoundError
      ? <EmptyState title="Request not found" description="This procurement request doesn’t exist in this workspace." action={<Button asChild variant="outline"><Link href="/procurement">Back to procurement</Link></Button>} className="rounded-xl border bg-surface" />
      : <ErrorState title="Couldn’t load quotations" message={error.message} onRetry={() => void refetch()} />;
  }

  const { request, quotations } = data;
  const rec = request.recommendation;
  const canSelect = request.status === "quotes_ready" || request.status === "provider_selected";
  const compared = quotations.filter((q) => !excluded.has(q.id));
  const scores = rec?.scores ?? [];
  const toggle = (id: string) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const confirm = () => {
    if (!pending) return;
    select.mutate({ requestId, quotationId: pending.id }, { onSuccess: () => setPending(null) });
  };
  const jump = () => { const el = document.getElementById(`quote-${rec?.recommendedQuotationId}`); el?.scrollIntoView({ block: "center" }); el?.focus?.(); };
  const pendingAgent = pending ? data.agents.find((a) => a.id === pending.agentId) : undefined;

  return (
    <AgentsContext.Provider value={data.agents}>
    <div className="flex flex-col gap-6">
      <Link href={`/procurement/${requestId}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" /> Back to request</Link>

      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-navy">{request.title}</p>
          <p className="text-sm text-muted-foreground">Budget {formatAmount(request.maxBudget)} {request.asset}{request.preferredDeliveryMinutes !== null && ` · deliver within ${deliveryLabel(request.preferredDeliveryMinutes)}`}{request.requiredCapabilities.length > 0 && ` · ${request.requiredCapabilities.join(", ")}`}</p>
        </div>
        <ProcurementStatusBadge status={request.status} />
      </Card>

      {request.source === "demo" && <DemoNotice><strong className="font-semibold">Demo quotations.</strong> Providers and prices are illustrative, generated locally from the demo listings. The recommendation is a transparent scoring rule, not a live AI model.</DemoNotice>}

      {request.status === "provider_selected" && request.payment && (
        <div role="status" className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm"><strong>Provider selected.</strong> Next, review the payment conditions and authorize with your wallet. Nothing has been paid. You can still change your selection below until a payment is created.</p>
          <Button asChild variant="navy" size="sm"><Link href={`/procurement/${requestId}`}>View request <ArrowRight /></Link></Button>
        </div>
      )}
      {!canSelect && <p role="note" className="rounded-lg border bg-muted px-4 py-3 text-sm text-muted-foreground">This request is {request.status === "cancelled" ? "cancelled" : request.status === "completed" ? "completed" : "not accepting selections"}, so providers can’t be selected.</p>}
      {ask.isError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{ask.error.message}</p>}
      {select.isError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{select.error.message}</p>}

      {quotations.length === 0 ? (
        <EmptyState icon={FileSearch} title="No quotations yet" className="rounded-xl border bg-surface"
          description={request.status === "awaiting_quotes" ? `No available provider could quote within ${formatAmount(request.maxBudget)} ${request.asset} for this category. Try a new request with a higher budget or a broader category.` : "Quotations will appear here when providers respond."}
          action={<div className="flex flex-wrap justify-center gap-2">
            {request.source === "live" && (request.status === "awaiting_quotes") && <Button onClick={() => ask.mutate(requestId)} disabled={ask.isPending} data-testid="request-quotations">{ask.isPending ? <Loader2 className="animate-spin" /> : null} Request quotations</Button>}
            <Button asChild variant="outline"><Link href="/procurement/new">New request</Link></Button>
          </div>} />
      ) : (
        <>
          {rec && <RecommendationPanel rec={rec} quotes={quotations} onJump={jump} />}
          <section aria-labelledby="quotes-title">
            <h2 id="quotes-title" className="mb-3 text-lg font-semibold text-navy">Quotations ({quotations.length})</h2>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {quotations.map((q) => (
                <li key={q.id}><QuoteCard q={q} score={scores.find((s) => s.quotationId === q.id)} recommended={q.id === rec?.recommendedQuotationId} compare={!excluded.has(q.id)} onToggle={() => toggle(q.id)} onSelect={() => setPending(q)} canSelect={canSelect} /></li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="compare-title">
            <h2 id="compare-title" className="mb-3 text-lg font-semibold text-navy">Compare</h2>
            {compared.length < 2 ? <p className="rounded-lg border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">Include at least two quotations to compare them side by side.</p> : <ComparisonTable quotes={compared} scores={scores} recommendedId={rec?.recommendedQuotationId ?? null} />}
          </section>
        </>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => { if (!o && !select.isPending) { setPending(null); select.reset(); } }}>
        <DialogContent>
          <DialogTitle>Select {pendingAgent?.name ?? "provider"}?</DialogTitle>
          <DialogDescription>You’re choosing this provider for “{request.title}”. This prepares the payment conditions only — you won’t be charged and no wallet is needed yet.</DialogDescription>
          {pending && (
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-background p-4 text-sm">
              <div><dt className="text-xs text-muted-foreground">Provider</dt><dd className="font-medium">{pendingAgent?.name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Service</dt><dd className="font-medium">{pending.serviceName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Price</dt><dd className="font-semibold text-navy">{formatAmount(pending.price)} {pending.asset}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Delivery</dt><dd className="font-medium">~{deliveryLabel(pending.deliveryMinutes)}</dd></div>
            </dl>
          )}
          {ask.isError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{ask.error.message}</p>}
      {select.isError && <p role="alert" className="text-sm font-medium text-danger">{select.error.message}</p>}
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="outline" disabled={select.isPending}>Cancel</Button></DialogClose>
            <Button onClick={confirm} disabled={select.isPending}>{select.isPending ? <><Loader2 className="animate-spin motion-reduce:animate-none" /> Selecting…</> : "Confirm selection"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </AgentsContext.Provider>
  );
}
