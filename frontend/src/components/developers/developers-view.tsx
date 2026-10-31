"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { isAddress } from "viem";
import { Code2, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/states";
import { Field } from "@/components/procurement/field";
import { PageHeader } from "@/components/layout/page-header";
import { DemoNotice } from "@/components/common/data-source-notice";
import { AddressText } from "@/components/common/address-text";
import { useToast } from "@/components/ui/toaster";
import { SELECTABLE_CATEGORIES } from "@/constants/categories";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCreateService, useMyAgents, useRegisterAgent, useSeedDemoAgents } from "@/hooks/use-developer";
import { isDemoMode, env } from "@/lib/env";
import { describePaymentError } from "@/lib/payment-errors";
import { formatTokenAmount } from "@/lib/decimal";
import type { Agent, CategoryId } from "@/types/agent";

const agentSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  description: z.string().trim().max(4000, "Too long"),
  walletAddress: z.string().trim().refine((v) => isAddress(v, { strict: false }) && !/^0x0{40}$/i.test(v), "Enter a valid 0x… wallet address"),
  category: z.string().min(1),
  capabilities: z.string().trim().max(2000),
});
type AgentValues = z.infer<typeof agentSchema>;

const serviceSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(160),
  price: z.string().trim().regex(/^\d+(\.\d{1,6})?$/, "Positive number, up to 6 decimals").refine((v) => Number(v) > 0, "Must be greater than 0"),
  deliveryMinutes: z.string().regex(/^\d+$/, "Whole minutes").refine((v) => Number(v) >= 1 && Number(v) <= 43200, "Between 1 and 43,200"),
});
type ServiceValues = z.infer<typeof serviceSchema>;

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/api/v1/agents", "Register a provider agent (name, wallet, category, capabilities)."],
  ["POST", "/api/v1/services", "List a priced service for your agent."],
  ["POST", "/api/v1/quotations", "Respond to a service request with a quotation (payout address is always your agent's registered wallet)."],
  ["GET", "/api/v1/payments/provider/intents", "Incoming payments addressed to your agents."],
  ["GET", "/api/v1/payments/provider/intents/{id}/verification", "Confirm you were genuinely paid (settlement verified by gateway and chain) before delivering."],
  ["POST", "/api/v1/procurement/requests/{id}/deliver", "Delivery for platform demo providers; refused unless the payment is verified."],
];

function RegisterAgentForm({ onDone }: { onDone: () => void }) {
  const reg = useRegisterAgent();
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<AgentValues>({ resolver: zodResolver(agentSchema), defaultValues: { name: "", description: "", walletAddress: "", category: "research", capabilities: "" }, mode: "onTouched" });
  const submit = (v: AgentValues) => reg.mutate(
    { name: v.name, description: v.description, walletAddress: v.walletAddress, category: v.category as CategoryId, capabilities: v.capabilities.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 25) },
    { onSuccess: () => { toast.push({ title: "Agent registered", variant: "success" }); reset(); onDone(); } },
  );
  const a = (k: keyof AgentValues) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `ag-${k}-error` : undefined });
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="Register agent">
      <Field id="ag-name" label="Agent name" required error={errors.name?.message}><Input id="ag-name" maxLength={120} {...a("name")} {...register("name")} /></Field>
      <Field id="ag-category" label="Category" required><Select id="ag-category" {...register("category")}>{SELECTABLE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
      <div className="sm:col-span-2"><Field id="ag-wallet" label="Payout wallet address" required error={errors.walletAddress?.message} hint="Verified payments settle to this address. It cannot be changed in a quotation."><Input id="ag-wallet" autoComplete="off" spellCheck={false} placeholder="0x…" {...a("walletAddress")} {...register("walletAddress")} /></Field></div>
      <div className="sm:col-span-2"><Field id="ag-description" label="Description" error={errors.description?.message}><Textarea id="ag-description" rows={3} maxLength={4000} {...a("description")} {...register("description")} /></Field></div>
      <div className="sm:col-span-2"><Field id="ag-capabilities" label="Capabilities" hint="Comma-separated, e.g. Market research, Risk summary."><Input id="ag-capabilities" {...register("capabilities")} /></Field></div>
      {reg.error && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger sm:col-span-2">{describePaymentError(reg.error).message}</p>}
      <div className="sm:col-span-2"><Button type="submit" disabled={reg.isPending} data-testid="register-agent">{reg.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Register agent</Button></div>
    </form>
  );
}

function AddServiceForm({ agent }: { agent: Agent }) {
  const create = useCreateService();
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ServiceValues>({ resolver: zodResolver(serviceSchema), defaultValues: { name: "", price: "", deliveryMinutes: "60" }, mode: "onTouched" });
  const submit = (v: ServiceValues) => create.mutate(
    { agentId: agent.id, name: v.name, description: "", price: v.price, asset: "USDT", deliveryMinutes: Number(v.deliveryMinutes) },
    { onSuccess: () => { toast.push({ title: "Service added", variant: "success" }); reset(); } },
  );
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-start" aria-label={`Add service to ${agent.name}`}>
      <Field id={`svc-name-${agent.id}`} label="Service name" error={errors.name?.message}><Input id={`svc-name-${agent.id}`} {...register("name")} /></Field>
      <Field id={`svc-price-${agent.id}`} label="Price (USDT)" error={errors.price?.message}><Input id={`svc-price-${agent.id}`} inputMode="decimal" {...register("price")} /></Field>
      <Field id={`svc-eta-${agent.id}`} label="Delivery (min)" error={errors.deliveryMinutes?.message}><Input id={`svc-eta-${agent.id}`} inputMode="numeric" {...register("deliveryMinutes")} /></Field>
      <Button type="submit" variant="outline" className="sm:mt-[1.375rem]" disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
      {create.error && <p role="alert" className="text-sm text-danger sm:col-span-4">{describePaymentError(create.error).message}</p>}
    </form>
  );
}

export function DevelopersView() {
  const user = useCurrentUser();
  const mine = useMyAgents();
  const seed = useSeedDemoAgents();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <PageHeader title="Developers" description="Register a provider agent, list services and receive verified HSP payments." />
      {isDemoMode && <DemoNotice className="mb-4">Demo mode: no backend is connected, so registration is disabled. The integration guide below describes the real endpoints.</DemoNotice>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle>Your provider agents</CardTitle><CardDescription>Agents you own. The backend sets ownership from your sign-in, never from the form.</CardDescription></div>
                {!isDemoMode && <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}><Plus /> {showForm ? "Hide form" : "Register agent"}</Button>}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {showForm && <RegisterAgentForm onDone={() => setShowForm(false)} />}
              {isDemoMode ? <EmptyState icon={Code2} title="Registration needs the backend" description="Connect the backend (NEXT_PUBLIC_API_BASE_URL) to register and manage agents." />
                : mine.isLoading ? <Skeleton className="h-24" aria-busy="true" />
                : mine.isError ? <ErrorState title="Could not load your agents" message={describePaymentError(mine.error).message} onRetry={() => void mine.refetch()} />
                : mine.data?.length === 0 ? <EmptyState icon={Code2} title="No agents yet" description="Register your first provider agent to start receiving procurement requests." />
                : <ul className="flex flex-col gap-4" aria-label="Your agents" data-testid="my-agents">
                  {mine.data?.map((a) => (
                    <li key={a.id} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{a.name}</h3><Badge variant={a.availability === "available" ? "success" : "outline"}>{a.availability === "available" ? "Active" : "Inactive"}</Badge>{a.registration.onChain ? <Badge variant="brand">On-chain verified</Badge> : <Badge variant="outline">Not verified on-chain</Badge>}</div>
                      <p className="mt-1 text-sm text-muted-foreground">Payout wallet: <AddressText value={a.walletAddress} chainId={env.chainId} /></p>
                      {a.services.length > 0 && <ul className="mt-2 text-sm">{a.services.map((s) => <li key={s.id} className="flex justify-between border-b py-1 last:border-0"><span>{s.name}</span><span className="font-medium">{formatTokenAmount(s.price)} {s.asset}</span></li>)}</ul>}
                      <AddServiceForm agent={a} />
                    </li>
                  ))}
                </ul>}
            </CardContent>
          </Card>

          {user.isAdmin && (
            <Card>
              <CardHeader><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-teal" aria-hidden="true" /><CardTitle>Administrator</CardTitle></div><CardDescription>Visible only to administrators; the backend enforces the role.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button variant="outline" className="w-fit" disabled={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: () => toast.push({ title: "Platform demo agents are in place", variant: "success" }) })} data-testid="seed-demo">{seed.isPending ? <Loader2 className="animate-spin" /> : null} Seed platform demo providers</Button>
                {seed.error && <p role="alert" className="text-sm text-danger">{describePaymentError(seed.error).message}</p>}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle>Integration guide</CardTitle><CardDescription>Real endpoints of the PayMesh API (Bearer token from your sign-in).</CardDescription></CardHeader>
          <CardContent>
            <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground"><li>Register an agent with a payout wallet.</li><li>List services with prices.</li><li>Quote buyer requests.</li><li>Get paid through HSP; confirm settlement before delivering.</li></ol>
            <ul className="flex flex-col gap-3" aria-label="API endpoints">
              {ENDPOINTS.map(([m, path, d]) => <li key={path} className="text-sm"><p className="flex flex-wrap items-center gap-2"><Badge variant="outline">{m}</Badge><code className="break-all font-mono text-xs">{path}</code></p><p className="mt-0.5 text-xs text-muted-foreground">{d}</p></li>)}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">Payments settle to your agent&apos;s registered wallet via HSP. A wallet signature alone is never treated as payment.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
