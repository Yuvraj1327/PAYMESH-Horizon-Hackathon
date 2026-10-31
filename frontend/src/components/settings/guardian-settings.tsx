"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { Field } from "@/components/procurement/field";
import { DemoNotice } from "@/components/common/data-source-notice";
import { DemoBadge } from "@/components/payments/payment-status-badge";
import { usePolicy, useSavePolicy } from "@/hooks/use-payments";
import { isDemoMode, env } from "@/lib/env";
import { ApiError } from "@/lib/api/client";
import { describePaymentError } from "@/lib/payment-errors";
import { ASSET_CHOICES, NETWORK_CHOICES, formToPolicy, policyFormSchema, policyToForm, type PolicyFormValues } from "@/lib/policy-validation";
import { formatDateTime } from "@/components/common/format";
import type { SpendingPolicy } from "@/types/payment";

export function GuardianSettings() {
  const q = usePolicy();
  const save = useSavePolicy();
  if (q.isLoading) return <Skeleton className="h-96" aria-busy="true" />;
  if (q.isError) return <Card><ErrorState title="Could not load your spending policy" message={describePaymentError(q.error).message} onRetry={() => void q.refetch()} /></Card>;
  return <PolicyForm key={q.data?.updatedAt ?? "none"} policy={q.data ?? null} save={save} />;
}

function PolicyForm({ policy, save }: { policy: SpendingPolicy | null; save: ReturnType<typeof useSavePolicy> }) {
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema({ demo: isDemoMode })), defaultValues: policyToForm(policy, env.chainId), mode: "onTouched",
  });
  const aria = (k: keyof PolicyFormValues) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `${k}-error` : undefined });
  const err = (k: keyof PolicyFormValues) => errors[k]?.message as string | undefined;

  function submit(v: PolicyFormValues) {
    save.mutate(formToPolicy(v));
  }
  const saved = save.isSuccess ? save.data.updatedAt : null;
  const apiMessage = save.error instanceof ApiError && save.error.code ? save.error.message : save.error ? describePaymentError(save.error).message : null;

  return (
    <Card id="payment-guardian">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2"><ShieldCheck className="size-5 text-teal" aria-hidden="true" /><CardTitle>Payment Guardian</CardTitle>{policy?.source === "demo" && <DemoBadge />}</div>
        <CardDescription>Your spending policy. The PayMesh backend enforces it on every payment; changing it here never bypasses a check.</CardDescription>
      </CardHeader>
      <CardContent>
        {isDemoMode && <DemoNotice className="mb-4">Demo mode: this policy is stored in your browser session only and affects the demo payment checks.</DemoNotice>}
        {!policy && <p role="note" className="mb-4 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning" data-testid="no-policy">You have no spending policy yet. The backend blocks all payments until you save one.</p>}
        <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-5" aria-label="Payment Guardian policy">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="maxTransactionAmount" label="Maximum per transaction" required error={err("maxTransactionAmount")} hint="Largest single payment allowed.">
              <Input id="maxTransactionAmount" inputMode="decimal" placeholder="e.g. 5" {...aria("maxTransactionAmount")} {...register("maxTransactionAmount")} />
            </Field>
            <Field id="dailySpendingLimit" label="Daily spending limit" required error={err("dailySpendingLimit")} hint="Total allowed per day (UTC), per asset.">
              <Input id="dailySpendingLimit" inputMode="decimal" placeholder="e.g. 20" {...aria("dailySpendingLimit")} {...register("dailySpendingLimit")} />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Allowed providers</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-brand)]" {...register("allowAllAgents")} /> Allow all providers</label>
            <Field id="permittedAgentIds" label="Permitted provider IDs" error={err("permittedAgentIds")} hint={`One per line or comma-separated. Used when “Allow all providers” is off.${isDemoMode ? "" : " Provider IDs are UUIDs."}`}>
              <Textarea id="permittedAgentIds" rows={3} placeholder={isDemoMode ? "crypto-research-agent" : "00000000-0000-0000-0000-000000000000"} {...aria("permittedAgentIds")} {...register("permittedAgentIds")} />
            </Field>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <fieldset aria-describedby={errors.allowedAssets ? "allowedAssets-error" : undefined}>
              <legend className="mb-2 text-sm font-medium">Allowed payment assets</legend>
              <div className="flex flex-wrap gap-4">{ASSET_CHOICES.map((a) => <label key={a} className="flex items-center gap-2 text-sm"><input type="checkbox" value={a} className="size-4 accent-[var(--color-brand)]" {...register("allowedAssets")} /> {a}</label>)}</div>
              {errors.allowedAssets && <p id="allowedAssets-error" role="alert" className="mt-1 text-xs font-medium text-danger">{errors.allowedAssets.message}</p>}
              <p className="mt-1 text-xs text-muted-foreground">The backend rejects assets the platform does not support.</p>
            </fieldset>
            <fieldset aria-describedby={errors.allowedChainIds ? "allowedChainIds-error" : undefined}>
              <legend className="mb-2 text-sm font-medium">Allowed networks</legend>
              <div className="flex flex-col gap-2">{NETWORK_CHOICES.map((n) => <label key={n.id} className="flex items-center gap-2 text-sm"><input type="checkbox" value={n.id} className="size-4 accent-[var(--color-brand)]" {...register("allowedChainIds")} /> {n.label}</label>)}</div>
              {errors.allowedChainIds && <p id="allowedChainIds-error" role="alert" className="mt-1 text-xs font-medium text-danger">{errors.allowedChainIds.message}</p>}
            </fieldset>
          </div>

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-brand)]" {...register("enabled")} /> Policy enabled <span className="text-xs text-muted-foreground">(a disabled policy blocks all payments)</span></label>

          {apiMessage && <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger" data-testid="policy-error">{apiMessage}</p>}
          {saved && !save.isPending && <p role="status" className="flex items-center gap-2 rounded-md bg-success-bg px-3 py-2 text-sm text-success" data-testid="policy-saved"><CheckCircle2 className="size-4" aria-hidden="true" /> Policy saved {formatDateTime(saved)}. The backend now enforces it.</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending || (!!policy && !isDirty)} data-testid="save-policy">{save.isPending ? <Loader2 className="animate-spin" /> : null} {save.isPending ? "Saving…" : policy ? "Save changes" : "Create policy"}</Button>
            {policy && <span className="text-xs text-muted-foreground">Last updated {formatDateTime(policy.updatedAt)}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
