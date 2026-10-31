"use client";

import { useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sparkles } from "lucide-react";
import { Field } from "@/components/procurement/field";
import { CapabilityInput } from "@/components/procurement/capability-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DELIVERY_OPTIONS, PAYMENT_ASSETS, SELECTABLE_CATEGORIES } from "@/constants/categories";
import { requestFormSchema, type RequestFormValues } from "@/lib/validation";
import { DEMO_AGENTS } from "@/services/demo/agents";
import type { CategoryId } from "@/types/agent";

export const EMPTY_FORM: RequestFormValues = {
  title: "", category: "research", description: "", capabilities: [], maxBudget: "", asset: "USDT", preferredDelivery: "none", additionalInstructions: "",
};

export function RequestForm({ defaultValues, onSubmit, submitting, errorMessage }: {
  defaultValues: RequestFormValues; onSubmit: (v: RequestFormValues) => void; submitting: boolean; errorMessage?: string | null;
}) {
  const { register, control, handleSubmit, formState: { errors } } = useForm<RequestFormValues>({
    resolver: zodResolver(requestFormSchema), defaultValues, mode: "onTouched",
  });
  const category = useWatch({ control, name: "category" }) as CategoryId;
  const suggestions = useMemo(() => [...new Set(DEMO_AGENTS.filter((a) => a.category === category).flatMap((a) => a.capabilities))], [category]);
  const desc = useWatch({ control, name: "description" }) ?? "";
  const err = (k: keyof RequestFormValues) => errors[k]?.message as string | undefined;
  const aria = (k: keyof RequestFormValues) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `${k}-error` : `${k}-hint` });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6" aria-label="New procurement request">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="title" label="Request title" required error={err("title")} hint="A short name you’ll recognise later.">
            <Input id="title" maxLength={120} placeholder="e.g. Q4 crypto market research brief" {...aria("title")} {...register("title")} />
          </Field>
        </div>
        <Field id="category" label="Service category" required error={err("category")}>
          <Select id="category" {...aria("category")} {...register("category")}>
            {SELECTABLE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <Field id="preferredDelivery" label="Preferred delivery time" error={err("preferredDelivery")}>
          <Select id="preferredDelivery" {...register("preferredDelivery")}>
            {DELIVERY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="description" label="Task description" required error={err("description")} hint={`Describe what you need in plain language. ${desc.trim().length}/2000`}>
            <Textarea id="description" rows={5} maxLength={2000} placeholder="I need a cryptocurrency market research report covering…" {...aria("description")} {...register("description")} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id="capabilities" label="Required capabilities" error={err("capabilities")} hint="Optional. Helps match agents that can do exactly this.">
            <Controller control={control} name="capabilities" render={({ field }) => (
              <CapabilityInput id="capabilities" value={field.value} onChange={field.onChange} suggestions={suggestions} invalid={!!errors.capabilities} describedBy={errors.capabilities ? "capabilities-error" : "capabilities-hint"} />
            )} />
          </Field>
        </div>
        <Field id="maxBudget" label="Maximum budget" required error={err("maxBudget")} hint="The most you’re willing to pay. Up to 6 decimals.">
          <Input id="maxBudget" inputMode="decimal" autoComplete="off" placeholder="1.00" {...aria("maxBudget")} {...register("maxBudget")} />
        </Field>
        <Field id="asset" label="Payment asset" required error={err("asset")} hint="Stablecoin used for settlement.">
          <Select id="asset" {...aria("asset")} {...register("asset")}>{PAYMENT_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="additionalInstructions" label="Additional instructions" error={err("additionalInstructions")} hint="Optional: format, sources to avoid, anything else the provider should know.">
            <Textarea id="additionalInstructions" rows={3} maxLength={1000} {...aria("additionalInstructions")} {...register("additionalInstructions")} />
          </Field>
        </div>
      </div>

      {errorMessage && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{errorMessage}</p>}

      <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">Demo mode: agents are matched locally and quotations are illustrative. No payment is requested at this step.</p>
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? <><Loader2 className="animate-spin motion-reduce:animate-none" /> Finding agents…</> : <><Sparkles /> Find AI Agents</>}
        </Button>
      </div>
    </form>
  );
}
