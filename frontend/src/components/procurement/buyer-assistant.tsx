"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Bot, CheckCircle2, Loader2, Minus, Pencil, Send, Sparkles, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isDemoMode } from "@/lib/env";
import { DemoNotice } from "@/components/common/data-source-notice";
import { Rating } from "@/components/common/rating";
import { AvailabilityBadge } from "@/components/common/availability-badge";
import { deliveryLabel, getCategory } from "@/constants/categories";
import { useAssistantMessage } from "@/hooks/use-assistant";
import { cn, formatAmount } from "@/lib/utils";
import { MAX_ASSISTANT_MESSAGE } from "@/services/assistant";
import { SUGGESTED_PROMPTS } from "@/services/demo/assistant-engine";
import type { AgentMessage, DecisionFactor, ExtractedRequirements, RecommendedAgent } from "@/types/procurement";

const GREETING: AgentMessage = {
  id: "greeting", role: "assistant", source: "demo", createdAt: new Date(0).toISOString(),
  content: "Hi, I’m the Buyer Agent. Tell me what you need, your budget and any deadline. I’ll extract the requirements, find matching agents and explain my picks. You decide what happens next.",
};

const TONE_ICON = { positive: CheckCircle2, neutral: Minus, caution: AlertTriangle } as const;
const TONE_CLASS = { positive: "text-teal-700", neutral: "text-muted-foreground", caution: "text-warning" } as const;

function Factors({ factors }: { factors: DecisionFactor[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {factors.map((f) => {
        const Icon = TONE_ICON[f.tone];
        return (
          <li key={f.label} className="flex items-start gap-2 text-xs">
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", TONE_CLASS[f.tone])} aria-hidden="true" />
            <span><strong className="font-medium text-foreground">{f.label}:</strong> <span className="text-muted-foreground">{f.detail}</span></span>
          </li>
        );
      })}
    </ul>
  );
}

function RecommendationCard({ rec, rank }: { rec: RecommendedAgent; rank: number }) {
  return (
    <li className="rounded-lg border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {rank === 0 && <Badge variant="success"><Sparkles className="size-3" aria-hidden="true" /> Best match</Badge>}
            <Link href={`/marketplace/${rec.agentId}`} className="truncate hover:text-brand">{rec.agentName}</Link>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{getCategory(rec.category).label} · {formatAmount(rec.price)} {rec.asset} · ~{deliveryLabel(rec.deliveryMinutes)}</p>
        </div>
        <div className="flex items-center gap-2"><AvailabilityBadge value={rec.availability} /><Rating value={rec.rating} /></div>
      </div>
      <Factors factors={rec.factors} />
    </li>
  );
}

function Requirements({ x }: { x: ExtractedRequirements }) {
  const rows: Array<[string, string]> = [
    ["Category", x.category ? getCategory(x.category).label : "Not detected"],
    ["Budget", x.maxBudget ? `${formatAmount(x.maxBudget)} ${x.asset}` : "Not detected"],
    ["Delivery", deliveryLabel(x.preferredDeliveryMinutes)],
    ["Capabilities", x.requiredCapabilities.length ? x.requiredCapabilities.join(", ") : "None specified"],
  ];
  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg bg-background p-3 text-xs sm:grid-cols-2">
      {rows.map(([k, v]) => <div key={k} className="flex gap-1.5"><dt className="font-medium text-muted-foreground">{k}:</dt><dd className="text-foreground">{v}</dd></div>)}
    </dl>
  );
}

export function BuyerAssistant({ onCreate, onEditInForm, creating, createError }: {
  onCreate: (x: ExtractedRequirements) => void; onEditInForm: (x: ExtractedRequirements) => void; creating: boolean; createError?: string | null;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([GREETING]);
  const [text, setText] = useState("");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const { mutate, isPending, error, reset } = useAssistantMessage();
  const logRef = useRef<HTMLDivElement>(null);

  const latest = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant" && m.extracted), [messages]);
  const extracted = latest?.extracted ?? null;
  const ready = !!latest && (latest.missing?.length ?? 1) === 0 && !!extracted?.category && !!extracted.maxBudget;

  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, isPending, error]);

  const send = (raw: string) => {
    const message = raw.trim();
    if (!message || isPending) return;
    reset();
    setLastSent(message);
    setMessages((m) => [...m, { id: `u_${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString(), source: isDemoMode ? "demo" : "live" }]);
    setText("");
    mutate({ message, previous: extracted }, { onSuccess: (reply) => setMessages((m) => [...m, reply]) });
  };

  const showPrompts = messages.length === 1;
  return (
    <section aria-labelledby="assistant-title" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand"><Bot className="size-5" aria-hidden="true" /></span>
        <div>
          <h2 id="assistant-title" className="text-lg font-semibold text-navy">AI Buyer Agent</h2>
          <p className="text-sm text-muted-foreground">Describe your task in natural language.</p>
        </div>
      </div>
      {isDemoMode
        ? <DemoNotice><strong className="font-semibold">Demo responses.</strong> This assistant uses simple local rules, not a live AI model. It shows decision factors, not hidden reasoning.</DemoNotice>
        : <p role="note" className="rounded-lg border bg-muted px-4 py-3 text-sm text-muted-foreground"><strong className="font-semibold text-foreground">Live assistant.</strong> Claude runs on the PayMesh backend to extract your requirements; provider matching uses PayMesh rules on the live marketplace. It shows decision factors, not private reasoning.</p>}

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation with the Buyer Agent" className="flex max-h-[32rem] min-h-64 flex-col gap-4 overflow-y-auto rounded-xl border bg-background p-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-navy text-white" : "bg-brand-50 text-brand")}>
              {m.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
            </span>
            <div className={cn("max-w-[85%] min-w-0 rounded-xl px-4 py-3 text-sm", m.role === "user" ? "bg-navy text-white" : "border bg-surface")}>
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
              {m.role === "assistant" && m.id !== "greeting" && <p className="mt-2">{m.source === "demo" ? <Badge variant="demo">Demo response</Badge> : <Badge variant="outline">Claude via PayMesh backend</Badge>}</p>}
              {m.extracted && <Requirements x={m.extracted} />}
              {m.recommendations && m.recommendations.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">Recommended providers</p>
                  <ul className="mt-2 flex flex-col gap-2">{m.recommendations.map((r, i) => <RecommendationCard key={r.agentId} rec={r} rank={i} />)}</ul>
                </div>
              )}
            </div>
          </div>
        ))}
        {isPending && (
          <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-brand-50 text-brand"><Bot className="size-4" /></span>
            <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Buyer Agent is analysing your request…</span>
          </div>
        )}
        {error && (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error.message}</span>
            {lastSent && error.name !== "AssistantInputError" && <Button size="sm" variant="outline" onClick={() => send(lastSent)}>Retry</Button>}
          </div>
        )}
      </div>

      {showPrompts && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Try one of these</p>
          <ul className="flex flex-col gap-2">
            {SUGGESTED_PROMPTS.map((p) => <li key={p}><button type="button" onClick={() => send(p)} disabled={isPending} className="w-full rounded-lg border bg-surface px-3 py-2 text-left text-sm hover:border-brand/40 hover:bg-brand-50/50 disabled:opacity-50">{p}</button></li>)}
          </ul>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex flex-col gap-2">
        <label htmlFor="assistant-input" className="sr-only">Message the Buyer Agent</label>
        <div className="flex items-end gap-2">
          <Textarea id="assistant-input" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={MAX_ASSISTANT_MESSAGE} className="min-h-12 resize-none"
            placeholder="e.g. I need a cryptocurrency market research report within a 1 USDT budget."
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
          <Button type="submit" size="icon" className="size-12 shrink-0" disabled={isPending || text.trim().length === 0} aria-label="Send message"><Send /></Button>
        </div>
        <p className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
      </form>

      {extracted && (
        <div className="flex flex-col gap-3 rounded-xl border bg-surface p-4">
          <div>
            <p className="font-semibold text-navy">Ready to collect quotations?</p>
            <p className="text-sm text-muted-foreground">{ready ? "Create a procurement request from what we discussed. Providers will be asked to quote; nothing is paid." : `Still needed: ${latest?.missing?.join(", ") || "more detail"}. Reply above or complete it in the form.`}</p>
          </div>
          {createError && <p role="alert" className="text-sm font-medium text-danger">{createError}</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => onCreate(extracted)} disabled={!ready || creating}>
              {creating ? <><Loader2 className="animate-spin motion-reduce:animate-none" /> Creating…</> : <><Sparkles /> Create Procurement Request</>}
            </Button>
            <Button variant="outline" onClick={() => onEditInForm(extracted)} disabled={creating}><Pencil /> Edit in form</Button>
          </div>
        </div>
      )}
    </section>
  );
}
