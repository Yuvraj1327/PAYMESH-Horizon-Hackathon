"use client";

import { isDemoMode } from "@/lib/env";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Handshake, MessagesSquare, X } from "lucide-react";
import { BuyerAssistant } from "@/components/procurement/buyer-assistant";
import { EMPTY_FORM, RequestForm } from "@/components/procurement/request-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { useAgent } from "@/hooks/use-marketplace";
import { useCreateRequest } from "@/hooks/use-procurement";
import { formValuesToInput, type RequestFormValues } from "@/lib/validation";
import { dedupeCaps } from "@/lib/validation";
import { getCategory } from "@/constants/categories";
import { ZodError } from "zod";
import type { ExtractedRequirements, NewRequestInput } from "@/types/procurement";

type Tab = "assistant" | "form";

function messageOf(e: unknown): string {
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Please check the request details.";
  return e instanceof Error ? e.message : "Something went wrong. Please try again.";
}

function extractedToForm(x: ExtractedRequirements): RequestFormValues {
  return {
    ...EMPTY_FORM, title: x.title, category: x.category ?? "research", description: x.description,
    capabilities: x.requiredCapabilities, maxBudget: x.maxBudget ?? "", asset: x.asset,
    preferredDelivery: x.preferredDeliveryMinutes === null ? "none" : ([5, 15, 60, 1440].includes(x.preferredDeliveryMinutes) ? String(x.preferredDeliveryMinutes) : "none"),
  };
}

/** The walkthrough's example: a crypto research brief. Fully editable before sending. */
const RESEARCH_PRESET: RequestFormValues = {
  ...EMPTY_FORM, title: "Crypto market research brief", category: "research", maxBudget: "1", asset: "USDT", capabilities: ["Market research"],
  description: "Need a concise research brief on the current crypto market with the key risks and a sector overview.",
};

export function NewRequestView() {
  const router = useRouter();
  const params = useSearchParams();
  const hireId = params.get("agent");
  const preset = params.get("preset") === "research";
  const hired = useAgent(hireId);
  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(hireId);
  const [tab, setTab] = useState<Tab>(hireId || preset ? "form" : "assistant");
  const [prefill, setPrefill] = useState<RequestFormValues | null>(preset ? RESEARCH_PRESET : null);
  const create = useCreateRequest();

  const initial = useMemo<RequestFormValues>(() => {
    if (prefill) return prefill;
    const a = hired.data;
    return a ? { ...EMPTY_FORM, category: a.category, capabilities: [], title: `Request for ${a.name}` } : EMPTY_FORM;
  }, [prefill, hired.data]);

  const submit = (input: NewRequestInput) => create.mutate(input, { onSuccess: ({ id }) => router.push(`/procurement/${id}/quotations`) });
  const fromForm = (v: RequestFormValues) => submit(formValuesToInput(v, preferredAgentId, "form"));
  const fromAssistant = (x: ExtractedRequirements) => {
    if (!x.category || !x.maxBudget) return;
    submit({
      title: x.title, description: x.description, category: x.category, requiredCapabilities: dedupeCaps(x.requiredCapabilities),
      maxBudget: x.maxBudget, asset: x.asset, preferredDeliveryMinutes: x.preferredDeliveryMinutes, additionalInstructions: "", preferredAgentId, origin: "assistant",
    });
  };
  const waitingForHired = !!hireId && hired.isPending;

  return (
    <div className="flex flex-col gap-6">
      {hireId && hired.data && preferredAgentId && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand/30 bg-brand-50/40 p-4">
          <p className="flex items-center gap-2 text-sm"><Handshake className="size-4 text-brand" aria-hidden="true" /> {isDemoMode ? "Requesting a quotation from" : "You started from"} <Link href={`/marketplace/${hired.data.id}`} className="font-semibold text-brand hover:underline">{hired.data.name}</Link>{!isDemoMode && " — the backend sends the request to all matching providers; it cannot target one agent."} <Badge variant="outline">{getCategory(hired.data.category).label}</Badge></p>
          <button type="button" onClick={() => setPreferredAgentId(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="size-3.5" aria-hidden="true" /> Don’t prefer this agent</button>
        </Card>
      )}
      {hireId && hired.isError && <p role="alert" className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">The agent you selected couldn’t be found. You can still create a general request.</p>}

      <Segmented idPrefix="new-request" label="How would you like to create your request?" value={tab} onChange={setTab}
        options={[{ value: "assistant", label: "AI assistant", icon: <MessagesSquare className="size-4" /> }, { value: "form", label: "Manual form", icon: <ClipboardList className="size-4" /> }]} />

      <Card className="p-5 sm:p-6">
        <div role="tabpanel" id="new-request-panel-assistant" aria-labelledby="new-request-tab-assistant" hidden={tab !== "assistant"}>
          <BuyerAssistant onCreate={fromAssistant} creating={create.isPending} createError={create.isError ? messageOf(create.error) : null}
            onEditInForm={(x) => { setPrefill(extractedToForm(x)); setTab("form"); }} />
        </div>
        <div role="tabpanel" id="new-request-panel-form" aria-labelledby="new-request-tab-form" hidden={tab !== "form"}>
          {!waitingForHired && <RequestForm key={prefill ? "prefill" : (hired.data?.id ?? "blank")} defaultValues={initial} onSubmit={fromForm} submitting={create.isPending} errorMessage={create.isError ? messageOf(create.error) : null} />}
        </div>
      </Card>
    </div>
  );
}
