import type { Agent, AgentService, CategoryId, PaymentAsset } from "@/types/agent";
import type { ActivityEvent, ActorRole, AIRecommendation, EventType, NewRequestInput, ProcurementRequest, Quotation, RequestStatus } from "@/types/procurement";
import { recommendationDto, type AgentDto, type MessageDto, type QuotationDto, type RequestDto, type ServiceDto } from "@/services/live/schemas";

/** Pure mapping from backend DTOs to the UI models. Nothing is invented: unknown values stay null/empty. */

const CAT_FROM_API: Record<string, CategoryId> = { crypto_research: "research", market_data: "data_services", ai_analytics: "market_intelligence", other: "other" };
const CAT_TO_API: Partial<Record<CategoryId, string>> = { research: "crypto_research", data_services: "market_data", market_intelligence: "ai_analytics", other: "other" };

export const categoryFromApi = (c: string): CategoryId => CAT_FROM_API[c] ?? "other";
/** Demo-only categories (development, ai_automation, api_services) have no backend equivalent → "other". */
export const categoryToApi = (c: CategoryId): string => CAT_TO_API[c] ?? "other";

const asAsset = (a: string): PaymentAsset => a as PaymentAsset;

export function mapService(s: ServiceDto): AgentService {
  return { id: s.id, name: s.name, description: s.description, price: s.price, asset: asAsset(s.payment_asset), deliveryMinutes: s.delivery_estimate_minutes };
}

export function mapAgent(a: AgentDto, services: ServiceDto[]): Agent {
  return {
    id: a.id, name: a.name, description: a.description, category: categoryFromApi(a.category), capabilities: a.capabilities,
    services: services.filter((s) => s.provider_agent_id === a.id && s.is_available).map(mapService),
    availability: a.status === "active" ? "available" : "offline",
    // "Verified" in live mode = the backend verified this agent's on-chain registration itself.
    verified: !!a.onchain_registration_reference,
    rating: a.reputation, reviewCount: 0,
    walletAddress: a.wallet_address,
    registration: { onChain: !!a.onchain_registration_reference },
    provider: { name: a.is_demo ? "PayMesh platform demo provider" : "Independent provider", since: new Date(a.created_at).getFullYear().toString(), responseTime: "—" },
    reviews: [],
    isPlatformDemo: a.is_demo,
    source: "live",
  };
}

export function deriveTitle(description: string): { title: string; body: string } {
  const [first = "", ...rest] = description.split("\n");
  const multi = rest.join("\n").trim();
  if (multi) return { title: first.trim().slice(0, 120), body: multi };
  const t = first.trim();
  return { title: t.length > 70 ? `${t.slice(0, 67).trimEnd()}…` : t, body: t };
}

const CAPS_PREFIX = "Required capabilities:";

/** The backend takes one free-text description; title, capabilities, delivery and notes are folded into it so Claude can extract them. */
export function composeDescription(i: NewRequestInput): string {
  const lines = [i.title.trim(), i.description.trim()];
  if (i.requiredCapabilities.length) lines.push(`${CAPS_PREFIX} ${i.requiredCapabilities.join(", ")}`);
  if (i.preferredDeliveryMinutes !== null) lines.push(`Preferred delivery: within ${i.preferredDeliveryMinutes} minutes.`);
  if (i.additionalInstructions.trim()) lines.push(`Additional instructions: ${i.additionalInstructions.trim()}`);
  return lines.join("\n");
}

export function statusFromApi(s: string): RequestStatus {
  switch (s) {
    case "created": case "quoting": return "awaiting_quotes";
    case "quoted": return "quotes_ready";
    case "selected": case "payment_pending": return "provider_selected";
    case "completed": return "completed";
    case "expired": return "expired";
    default: return "cancelled";
  }
}

export function mapRecommendation(requestId: string, raw: Record<string, unknown> | null): AIRecommendation | null {
  if (!raw) return null;
  const p = recommendationDto.safeParse(raw);
  if (!p.success || !p.data.recommended_quotation_id) return null;
  const d = p.data;
  const recommendedId: string = p.data.recommended_quotation_id;
  const by = d.generated_by === "claude" ? "claude" : "deterministic_fallback";
  return {
    requestId, recommendedQuotationId: recommendedId, factors: [],
    scores: d.ranking.map((r) => ({ quotationId: r.quotation_id, notes: r.notes, total: Math.round(r.score * 10) / 10, price: 0, delivery: 0, capability: 0, reputation: 0 })),
    rationale: d.rationale, highlights: [], tradeoffs: [], generatedBy: by, generatedAt: d.generated_at ?? new Date(0).toISOString(),
  };
}

export function mapRequest(r: RequestDto, quotations: QuotationDto[] = []): ProcurementRequest {
  const { title, body } = deriveTitle(r.description);
  const caps = r.description.split("\n").find((l) => l.startsWith(CAPS_PREFIX));
  const deadline = r.requirements["delivery_deadline_minutes"];
  const status = statusFromApi(r.status);
  const chosen = quotations.find((q) => q.id === r.selected_quotation_id);
  return {
    id: r.id, title, description: body, category: categoryFromApi(r.category),
    requiredCapabilities: caps ? caps.slice(CAPS_PREFIX.length).split(",").map((c) => c.trim()).filter(Boolean) : [],
    maxBudget: r.max_budget, asset: asAsset(r.budget_asset), preferredDeliveryMinutes: typeof deadline === "number" ? deadline : null,
    additionalInstructions: "", status, selectedQuotationId: r.selected_quotation_id, selectedAgentId: r.selected_provider_id,
    recommendation: mapRecommendation(r.id, r.recommendation),
    payment: status === "provider_selected" && chosen ? { quotationId: chosen.id, agentId: chosen.provider_agent_id, amount: chosen.price, asset: asAsset(chosen.payment_asset), state: "awaiting_authorization", preparedAt: r.created_at } : null,
    origin: "form", createdAt: r.created_at, updatedAt: r.created_at, source: "live",
  } as ProcurementRequest;
}

export function mapQuotation(q: QuotationDto, agent: AgentDto | undefined, service: ServiceDto | undefined): Quotation {
  const summary = q.response_details["summary"];
  const status: Quotation["status"] = q.status === "accepted" ? "selected" : q.status === "submitted" ? "submitted" : "not_selected";
  return {
    id: q.id, requestId: q.request_id, agentId: q.provider_agent_id, serviceId: q.service_id ?? "",
    serviceName: service?.name ?? "Custom quotation", price: q.price, asset: asAsset(q.payment_asset), deliveryMinutes: q.delivery_estimate_minutes,
    matchedCapabilities: [], capabilities: agent?.capabilities ?? [], capabilityMatch: null, reputation: agent?.reputation ?? null,
    summary: typeof summary === "string" ? summary : "", status, receivedAt: q.created_at, source: "live",
  };
}

const ACTOR: Record<string, ActorRole> = { user: "user", buyer_agent: "buyer_agent", provider_agent: "provider_agent", payment_agent: "payment_agent", system: "system" };
const TITLES: Record<string, string> = {
  task_parsed: "Requirements extracted", service_request: "Request sent to providers", quotation: "Quotation received", recommendation: "Recommendation generated",
  selection: "Provider selected", payment_conditions: "Payment conditions prepared", delivery: "Delivery recorded", note: "Note",
};
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");

export function mapMessage(m: MessageDto): ActivityEvent {
  const p = m.payload;
  let detail = "";
  if (m.message_type === "task_parsed") detail = str(p["summary"]);
  else if (m.message_type === "recommendation") detail = str(p["rationale"]);
  else if (m.message_type === "quotation") detail = [str(p["price"], 30), str(p["asset"], 16)].filter(Boolean).join(" ");
  else detail = str(p["summary"] ?? p["note"] ?? "");
  const known = ["task_parsed", "service_request", "quotation", "recommendation", "selection", "payment_conditions", "delivery", "note"];
  return {
    id: m.id, requestId: m.request_id ?? "", type: (known.includes(m.message_type) ? m.message_type : "note") as EventType,
    actor: ACTOR[m.sender_role] ?? "system", title: TITLES[m.message_type] ?? "Activity", detail, at: m.created_at,
  };
}
