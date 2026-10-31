import type { Availability, CategoryId, DataOrigin, PaymentAsset } from "@/types/agent";

export type RequestStatus = "awaiting_quotes" | "quotes_ready" | "provider_selected" | "completed" | "cancelled" | "expired";
export type ActorRole = "user" | "buyer_agent" | "provider_agent" | "payment_agent" | "system";

export type EventType =
  | "request_created"
  | "requirements_extracted"
  | "agents_discovered"
  | "quotations_received"
  | "recommendation_generated"
  | "provider_selected"
  | "payment_authorization_pending"
  | "request_completed_sample"
  | "request_cancelled"
  // Backend agent-message types (live mode), recorded by the PayMesh backend:
  | "task_parsed" | "service_request" | "quotation" | "recommendation" | "selection" | "payment_conditions" | "delivery" | "note";

/** An event exists only if the application actually recorded it. */
export interface ActivityEvent {
  id: string;
  requestId: string;
  type: EventType;
  actor: ActorRole;
  title: string;
  detail: string;
  at: string;
}

export interface Quotation {
  id: string;
  requestId: string;
  agentId: string;
  serviceId: string;
  serviceName: string;
  price: string;
  asset: PaymentAsset;
  deliveryMinutes: number;
  /** Agent capabilities that match the request's requirements. */
  matchedCapabilities: string[];
  capabilities: string[];
  /** 0..1 share of requested capabilities (or category relevance when none were requested). */
  /** Null in live mode: the backend does not compute a capability match, and none is invented here. */
  capabilityMatch: number | null;
  reputation: number | null;
  summary: string;
  status: "submitted" | "selected" | "not_selected";
  receivedAt: string;
  source: DataOrigin;
}

export interface RecommendationFactor {
  key: "price" | "delivery" | "capability" | "reputation";
  label: string;
  /** Weight 0..1; weights sum to 1. */
  weight: number;
}

export interface QuotationScore {
  quotationId: string;
  /** Live mode: the backend's one-line note for this quotation. */
  notes?: string;
  total: number;
  price: number;
  delivery: number;
  capability: number;
  reputation: number;
}

/** Decision factors and a short, user-facing rationale. No hidden reasoning is stored or shown. */
export interface AIRecommendation {
  requestId: string;
  recommendedQuotationId: string;
  factors: RecommendationFactor[];
  scores: QuotationScore[];
  rationale: string;
  highlights: string[];
  tradeoffs: string[];
  generatedBy: "demo-heuristic" | "claude" | "deterministic_fallback";
  generatedAt: string;
}

export interface PaymentPreparation {
  quotationId: string;
  agentId: string;
  amount: string;
  asset: PaymentAsset;
  /** Step 2 stops here: nothing is authorized, signed or paid. */
  state: "awaiting_authorization";
  preparedAt: string;
}

export interface ProcurementRequest {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  requiredCapabilities: string[];
  maxBudget: string;
  asset: PaymentAsset;
  preferredDeliveryMinutes: number | null;
  additionalInstructions: string;
  preferredAgentId: string | null;
  status: RequestStatus;
  selectedQuotationId: string | null;
  selectedAgentId: string | null;
  recommendation: AIRecommendation | null;
  payment: PaymentPreparation | null;
  origin: "form" | "assistant";
  /** Demo seed history. Never counted as the user's own progress. */
  isSample?: boolean;
  createdAt: string;
  updatedAt: string;
  source: DataOrigin;
}

export interface RequestSummary extends ProcurementRequest {
  quotationCount: number;
  selectedAgentName: string | null;
}

export interface AgentRef { id: string; name: string; category: CategoryId }

export interface RequestDetail {
  request: ProcurementRequest;
  /** Names/categories of the agents referenced by the quotations (so views never look them up in demo data). */
  agents: AgentRef[];
  quotations: Quotation[];
  events: ActivityEvent[];
  selectedAgentName: string | null;
}

export interface NewRequestInput {
  title: string;
  description: string;
  category: CategoryId;
  requiredCapabilities: string[];
  maxBudget: string;
  asset: PaymentAsset;
  preferredDeliveryMinutes: number | null;
  additionalInstructions: string;
  preferredAgentId?: string | null;
  origin: "form" | "assistant";
}

/* ───────── AI Buyer assistant ───────── */
export interface ExtractedRequirements {
  title: string;
  category: CategoryId | null;
  requiredCapabilities: string[];
  maxBudget: string | null;
  asset: PaymentAsset;
  preferredDeliveryMinutes: number | null;
  description: string;
}

export interface DecisionFactor {
  label: string;
  detail: string;
  tone: "positive" | "neutral" | "caution";
}

export interface RecommendedAgent {
  agentId: string;
  agentName: string;
  category: CategoryId;
  price: string;
  asset: PaymentAsset;
  deliveryMinutes: number;
  availability: Availability;
  rating: number | null;
  matchScore: number;
  factors: DecisionFactor[];
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source: DataOrigin;
  extracted?: ExtractedRequirements;
  recommendations?: RecommendedAgent[];
  missing?: string[];
}

/** Derived activity row for the agent console. */
export interface AgentActivity {
  id: string;
  role: Exclude<ActorRole, "user" | "system">;
  title: string;
  detail: string;
  at: string;
  requestId: string;
}
