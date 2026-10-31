import { deliveryLabel, getCategory } from "@/constants/categories";
import { assertValidInput } from "@/lib/validation";
import { formatAmount } from "@/lib/utils";
import type { Agent } from "@/types/agent";
import type { ActivityEvent, EventType, ActorRole, NewRequestInput, ProcurementRequest, Quotation } from "@/types/procurement";
import { findCandidates } from "@/services/demo/matching";
import { buildRecommendation } from "@/services/demo/recommend";

export interface DemoDb {
  version: 1;
  requests: ProcurementRequest[];
  quotations: Quotation[];
  events: ActivityEvent[];
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}${counter.toString(36)}`;
}

function ev(requestId: string, type: EventType, actor: ActorRole, title: string, detail: string, at: Date): ActivityEvent {
  return { id: uid("evt"), requestId, type, actor, title, detail, at: at.toISOString() };
}

export interface CreatedRecords {
  request: ProcurementRequest;
  quotations: Quotation[];
  events: ActivityEvent[];
}

/**
 * DEMO "backend": validates, extracts, discovers providers and generates quotations + a recommendation.
 * Every timestamp is <= `now`, and every event describes something that really happened in this state.
 * In live mode these steps are performed by the FastAPI backend; the UI only consumes the resulting records.
 */
export function createRequestRecords(input: NewRequestInput, agents: readonly Agent[], now: Date): CreatedRecords {
  assertValidInput(input);
  const t = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000);
  const id = uid("req");
  const nameOf = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  const candidates = findCandidates(agents, {
    category: input.category, requiredCapabilities: input.requiredCapabilities, maxBudget: input.maxBudget,
    asset: input.asset, preferredAgentId: input.preferredAgentId ?? null,
  });

  const quotations: Quotation[] = candidates.map((c, i) => ({
    id: uid("quo"), requestId: id, agentId: c.agent.id, serviceId: c.service.id, serviceName: c.service.name,
    price: c.service.price, asset: c.service.asset, deliveryMinutes: c.service.deliveryMinutes,
    matchedCapabilities: c.matchedCapabilities, capabilities: c.agent.capabilities, capabilityMatch: c.capabilityMatch,
    reputation: c.agent.rating,
    summary: `${c.agent.name} offers “${c.service.name}” for ${formatAmount(c.service.price)} ${c.service.asset}, delivered in about ${deliveryLabel(c.service.deliveryMinutes)}. (Demo quotation — generated locally.)`,
    status: "submitted", receivedAt: t(8 - i * 2).toISOString(), source: "demo",
  }));

  const request: ProcurementRequest = {
    id, title: input.title, description: input.description, category: input.category,
    requiredCapabilities: input.requiredCapabilities, maxBudget: input.maxBudget, asset: input.asset,
    preferredDeliveryMinutes: input.preferredDeliveryMinutes, additionalInstructions: input.additionalInstructions,
    preferredAgentId: input.preferredAgentId ?? null, status: quotations.length > 0 ? "quotes_ready" : "awaiting_quotes",
    selectedQuotationId: null, selectedAgentId: null, recommendation: null, payment: null, origin: input.origin,
    createdAt: t(12).toISOString(), updatedAt: now.toISOString(), source: "demo",
  };
  request.recommendation = buildRecommendation(request, quotations, nameOf, t(2));

  const cat = getCategory(input.category).label;
  const events: ActivityEvent[] = [
    ev(id, "request_created", "user", "Request created", `“${input.title}” · budget ${formatAmount(input.maxBudget)} ${input.asset}`, t(12)),
    ev(id, "requirements_extracted", "buyer_agent", "Requirements extracted",
      `${cat}${input.requiredCapabilities.length ? ` · ${input.requiredCapabilities.length} capabilities` : ""} · delivery: ${deliveryLabel(input.preferredDeliveryMinutes)}${input.origin === "assistant" ? " (from your chat)" : " (from your form)"}`, t(11)),
    ev(id, "agents_discovered", "buyer_agent", "Agents discovered",
      candidates.length ? `${candidates.length} available provider${candidates.length === 1 ? "" : "s"} matched within budget: ${candidates.map((c) => c.agent.name).join(", ")}` : "No available provider matched within your budget and asset.", t(10)),
  ];
  if (quotations.length > 0) {
    events.push(ev(id, "quotations_received", "provider_agent", "Quotations received", `${quotations.length} demo quotation${quotations.length === 1 ? "" : "s"} received`, t(6)));
    if (request.recommendation) {
      events.push(ev(id, "recommendation_generated", "buyer_agent", "Recommendation generated",
        `Recommended: ${nameOf[quotations.find((q) => q.id === request.recommendation?.recommendedQuotationId)?.agentId ?? ""] ?? "a provider"}`, t(2)));
    }
  }
  return { request, quotations, events };
}

export class SelectionError extends Error {}

/** Selects a provider and prepares (never executes) the payment record. Mutates the passed db. */
export function applySelection(db: DemoDb, requestId: string, quotationId: string, agents: readonly Agent[], now: Date): void {
  const req = db.requests.find((r) => r.id === requestId);
  if (!req) throw new SelectionError("Request not found.");
  if (req.status !== "quotes_ready" && req.status !== "provider_selected") throw new SelectionError("A provider can only be selected while quotations are available.");
  const quotes = db.quotations.filter((q) => q.requestId === requestId);
  const chosen = quotes.find((q) => q.id === quotationId);
  if (!chosen) throw new SelectionError("That quotation does not belong to this request.");
  const agent = agents.find((a) => a.id === chosen.agentId);

  for (const q of quotes) q.status = q.id === chosen.id ? "selected" : "not_selected";
  req.selectedQuotationId = chosen.id;
  req.selectedAgentId = chosen.agentId;
  req.status = "provider_selected";
  req.updatedAt = now.toISOString();
  req.payment = { quotationId: chosen.id, agentId: chosen.agentId, amount: chosen.price, asset: chosen.asset, state: "awaiting_authorization", preparedAt: now.toISOString() };
  const nm = agent?.name ?? "provider";
  db.events.push(
    ev(requestId, "provider_selected", "user", "Provider selected", `${nm} — ${formatAmount(chosen.price)} ${chosen.asset}, ${deliveryLabel(chosen.deliveryMinutes)}`, now),
    ev(requestId, "payment_authorization_pending", "payment_agent", "Awaiting payment authorization",
      `Payment conditions prepared for ${formatAmount(chosen.price)} ${chosen.asset} to ${nm}. Nothing has been authorized or paid.`, new Date(now.getTime() + 1)),
  );
}
