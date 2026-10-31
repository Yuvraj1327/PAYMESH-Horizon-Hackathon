import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api/client";
import { trimDecimal } from "@/lib/decimal";
import type { PaymentsBackend } from "@/services/payments/types";
import { PaymentBlockedError } from "@/services/payments/types";
import type {
  GuardianResult, HspProgress, PaymentEvent, PaymentRecord, PaymentReview, PaymentStatus, PaymentStatusView, Receipt, RuleFailure, SpendingPolicy,
} from "@/types/payment";

/**
 * Live FastAPI integration. Every path below exists in the backend (payments.py / transactions.py / policies.py)
 * and every response is validated with Zod; nothing here is invented. Auth: Bearer token from the registered provider.
 */
const STATUSES = ["DRAFT", "VALIDATED", "AWAITING_SIGNATURE", "SIGNED", "SUBMITTED", "PENDING", "SETTLED", "FAILED", "EXPIRED", "CANCELLED"] as const;
const dec = z.union([z.string(), z.number()]).transform((v) => trimDecimal(v));
const nullableStr = z.string().nullish().transform((v) => v ?? null);

const intentSchema = z.object({
  id: z.string(), request_id: z.string(), quotation_id: z.string(), provider_agent_id: z.string(),
  amount: dec, asset: z.string(), chain_id: z.number().int(), recipient: z.string(),
  status: z.enum(STATUSES), conditions_snapshot: z.record(z.string(), z.unknown()).default({}),
  snapshot_hash: nullableStr, expires_at: z.string(), failure_reason: nullableStr,
  created_at: z.string(), updated_at: z.string(),
});
type IntentDto = z.infer<typeof intentSchema>;

function toRecord(i: IntentDto, txHash: string | null = null): PaymentRecord {
  const name = i.conditions_snapshot["provider_name"];
  return {
    id: i.id, requestId: i.request_id, quotationId: i.quotation_id, providerAgentId: i.provider_agent_id,
    providerName: typeof name === "string" && name ? name : "Provider agent",
    amount: i.amount, asset: i.asset, chainId: i.chain_id, recipient: i.recipient, status: i.status,
    failureReason: i.failure_reason, expiresAt: i.expires_at, snapshotHash: i.snapshot_hash,
    createdAt: i.created_at, updatedAt: i.updated_at, txHash, source: "live",
  };
}

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number(), limit: z.number(), offset: z.number() });

const receiptSchema = z.object({
  id: z.string(), payment_intent_id: z.string(), receipt_reference: z.string(), transaction_hash: nullableStr,
  settlement_status: z.string(), chain_id: z.number().nullish().transform((v) => v ?? null), token_address: nullableStr,
  payer_address: nullableStr, recipient: nullableStr, verified_amount: dec.nullish().transform((v) => v ?? null),
  block_number: z.number().nullish().transform((v) => v ?? null), verification_details: z.record(z.string(), z.unknown()).default({}),
  verified_at: nullableStr, created_at: z.string(),
});

function readChecks(details: Record<string, unknown>): Receipt["checks"] {
  const raw = details["checks"];
  if (!Array.isArray(raw)) return [];
  const out: Receipt["checks"] = [];
  for (const c of raw) {
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      const name = typeof o["name"] === "string" ? o["name"] : typeof o["check"] === "string" ? o["check"] : null;
      if (name) out.push({ name, ok: o["ok"] === true || o["passed"] === true, detail: typeof o["detail"] === "string" ? o["detail"] : undefined });
    }
  }
  return out;
}

function toReceipt(r: z.infer<typeof receiptSchema>): Receipt {
  return {
    id: r.id, paymentId: r.payment_intent_id, reference: r.receipt_reference, txHash: r.transaction_hash,
    settlementStatus: r.settlement_status, chainId: r.chain_id, tokenAddress: r.token_address, payerAddress: r.payer_address,
    recipient: r.recipient, verifiedAmount: r.verified_amount, blockNumber: r.block_number, verifiedAt: r.verified_at,
    createdAt: r.created_at, checks: readChecks(r.verification_details), source: "live",
  };
}

const hspSchema = z.object({
  order_state: z.string(), gateway_status: nullableStr, payment_request_id: nullableStr, flow_id: nullableStr,
  tx_hash: nullableStr, payer_address: nullableStr, cart_expiry: nullableStr, last_polled_at: nullableStr,
});
const statusSchema = z.object({
  payment_intent_id: z.string(), status: z.enum(STATUSES), settled_and_verified: z.boolean(),
  hsp: hspSchema.nullish().transform((v) => v ?? null), throttled: z.boolean().default(false), note: nullableStr,
});

function toStatus(s: z.infer<typeof statusSchema>): PaymentStatusView {
  const h = s.hsp;
  const hsp: HspProgress | null = h && {
    orderState: h.order_state, gatewayStatus: h.gateway_status, paymentRequestId: h.payment_request_id, flowId: h.flow_id,
    txHash: h.tx_hash, payerAddress: h.payer_address, cartExpiry: h.cart_expiry, lastPolledAt: h.last_polled_at,
  };
  return { paymentId: s.payment_intent_id, status: s.status, settledAndVerified: s.settled_and_verified, hsp, throttled: s.throttled, note: s.note };
}

const failuresSchema = z.array(z.object({ rule: z.string(), message: z.string() }));

/** A 422 `payment_validation_failed` carries the Guardian's failures in `details`. */
export function asBlocked(e: unknown): PaymentBlockedError | null {
  if (e instanceof ApiError && e.code === "payment_validation_failed") {
    const f = failuresSchema.safeParse(e.details);
    return new PaymentBlockedError(e.message, f.success ? f.data : []);
  }
  return null;
}

const reviewSchema = z.object({
  payer_wallet: nullableStr, provider_name: nullableStr, provider_agent_id: nullableStr, recipient: z.string(),
  amount: dec, asset: z.string(), chain_id: z.number(), expires_at: z.string(), snapshot_hash: nullableStr,
});

const idemKey = (requestId: string) => `paymesh.idem.${requestId}`;
function idempotencyKey(requestId: string): string {
  try {
    const existing = window.sessionStorage.getItem(idemKey(requestId));
    if (existing) return existing;
    const k = `pm-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(idemKey(requestId), k);
    return k;
  } catch { return `pm-${crypto.randomUUID()}`; }
}
/** Called when the previous intent for this request ended unsuccessfully, so a new one can be created. */
export function rotateIdempotencyKey(requestId: string): void {
  try { window.sessionStorage.removeItem(idemKey(requestId)); } catch { /* storage unavailable */ }
}

const policySchema = z.object({
  id: z.string(), max_transaction_amount: dec, daily_spending_limit: dec, permitted_agent_ids: z.array(z.string()),
  allow_all_agents: z.boolean(), allowed_assets: z.array(z.string()), allowed_chain_ids: z.array(z.number()), enabled: z.boolean(), updated_at: z.string(),
});
const toPolicy = (p: z.infer<typeof policySchema>): SpendingPolicy => ({
  id: p.id, maxTransactionAmount: p.max_transaction_amount, dailySpendingLimit: p.daily_spending_limit, allowAllAgents: p.allow_all_agents,
  permittedAgentIds: p.permitted_agent_ids, allowedAssets: p.allowed_assets, allowedChainIds: p.allowed_chain_ids, enabled: p.enabled,
  updatedAt: p.updated_at, source: "live",
});

const eventSchema = z.object({ id: z.string(), payment_intent_id: nullableStr, event_type: z.string(), event_data: z.record(z.string(), z.unknown()).default({}), created_at: z.string() });

const post = <T>(path: string, schema: z.ZodType<T>, body?: unknown, headers?: Record<string, string>) =>
  apiRequest(path, { method: "POST", schema, body: body ?? undefined, headers });

async function receiptOrNull(id: string): Promise<Receipt | null> {
  try {
    return toReceipt(await apiRequest(`/api/v1/payments/intents/${id}/receipt`, { schema: receiptSchema }));
  } catch (e) {
    if (e instanceof ApiError && (e.code === "receipt_not_found" || e.status === 404)) return null;
    throw e;
  }
}

const LIST_LIMIT = 100; // backend maximum page size

export const liveBackend: PaymentsBackend = {
  async list() {
    const [intents, receipts] = await Promise.all([
      apiRequest(`/api/v1/payments/intents?limit=${LIST_LIMIT}&offset=0`, { schema: page(intentSchema) }),
      apiRequest(`/api/v1/transactions/receipts?limit=${LIST_LIMIT}&offset=0`, { schema: page(receiptSchema) }).catch(() => null),
    ]);
    const hashes = new Map<string, string>();
    for (const r of receipts?.items ?? []) if (r.transaction_hash) hashes.set(r.payment_intent_id, r.transaction_hash);
    return { items: intents.items.map((i) => toRecord(i, hashes.get(i.id) ?? null)), total: intents.total, truncated: intents.total > intents.items.length };
  },

  async detail(id) {
    const intent = await apiRequest(`/api/v1/payments/intents/${id}`, { schema: intentSchema });
    const [status, receipt, events] = await Promise.all([
      // refresh=false: a cheap local read; "Refresh from HSP" asks the gateway explicitly.
      apiRequest(`/api/v1/payments/intents/${id}/status?refresh=false`, { schema: statusSchema }).catch(() => null),
      // A receipt can exist only for a settled payment; asking earlier would just be a guaranteed 404.
      intent.status === "SETTLED" ? receiptOrNull(id).catch(() => null) : Promise.resolve(null),
      apiRequest(`/api/v1/transactions/events?payment_intent_id=${id}&limit=100`, { schema: page(eventSchema) }).catch(() => null),
    ]);
    const st = status ? toStatus(status) : null;
    const evs: PaymentEvent[] = (events?.items ?? []).map((e) => ({ id: e.id, paymentId: e.payment_intent_id, type: e.event_type, data: e.event_data, at: e.created_at }));
    const payment = toRecord(intent, receipt?.txHash ?? st?.hsp?.txHash ?? null);
    return { payment, status: st, receipt, events: evs.sort((a, b) => a.at.localeCompare(b.at)), review: null };
  },

  async activeForRequest(requestId) {
    const res = await apiRequest(`/api/v1/payments/intents?request_id=${encodeURIComponent(requestId)}&limit=20`, { schema: page(intentSchema) });
    const latest = res.items[0]; // newest first
    return latest ? toRecord(latest) : null;
  },

  async create(requestId, quotationId) {
    try {
      const body = { request_id: requestId, ...(quotationId ? { quotation_id: quotationId } : {}) };
      const res = await fetchWithStatus(requestId, body);
      return { payment: toRecord(res.intent), created: res.created };
    } catch (e) {
      throw asBlocked(e) ?? e;
    }
  },

  async validate(id) {
    const r = await post(`/api/v1/payments/intents/${id}/validate`, z.object({ valid: z.boolean(), failures: failuresSchema, hsp_configured: z.boolean().nullish() }));
    const failures: RuleFailure[] = r.failures;
    return { evaluated: true, valid: r.valid, failures, hspConfigured: r.hsp_configured ?? null, source: "live" } satisfies GuardianResult;
  },

  async authorize(id) {
    try {
      const r = await post(`/api/v1/payments/intents/${id}/authorize`, z.object({ payment_intent: intentSchema, review: reviewSchema }));
      const v = r.review;
      const review: PaymentReview = {
        payerWallet: v.payer_wallet, providerName: v.provider_name, providerAgentId: v.provider_agent_id, recipient: v.recipient,
        amount: v.amount, asset: v.asset, chainId: v.chain_id, expiresAt: v.expires_at, snapshotHash: v.snapshot_hash,
      };
      return { payment: toRecord(r.payment_intent), review };
    } catch (e) { throw asBlocked(e) ?? e; }
  },

  async createMandate(id) {
    const r = await post(`/api/v1/payments/intents/${id}/mandate`, z.object({
      payment_intent_id: z.string(), cart_mandate_id: nullableStr, payment_request_id: nullableStr, payment_url: nullableStr, cart_expiry: nullableStr, order_state: z.string(),
    }));
    return { paymentId: r.payment_intent_id, cartMandateId: r.cart_mandate_id, paymentRequestId: r.payment_request_id, paymentUrl: r.payment_url, cartExpiry: r.cart_expiry, orderState: r.order_state };
  },

  async signingData(id) {
    const r = await apiRequest(`/api/v1/payments/intents/${id}/signing-data`, {
      schema: z.object({
        mode: z.string(), payment_url: z.string(), cart_mandate_id: nullableStr, payment_request_id: nullableStr, expires_at: nullableStr,
        review: z.object({ recipient: z.string(), amount: dec, asset: z.string(), chain_id: z.number(), token_address: nullableStr, authorization_scheme: nullableStr }),
        instructions: z.array(z.string()).default([]),
      }),
    });
    return {
      mode: r.mode, paymentUrl: assertHttps(r.payment_url), cartMandateId: r.cart_mandate_id, paymentRequestId: r.payment_request_id,
      expiresAt: r.expires_at, tokenAddress: r.review.token_address, authorizationScheme: r.review.authorization_scheme,
      recipient: r.review.recipient, amount: r.review.amount, asset: r.review.asset, chainId: r.review.chain_id, instructions: r.instructions,
    };
  },

  async status(id, refresh) {
    return toStatus(await apiRequest(`/api/v1/payments/intents/${id}/status?refresh=${refresh ? "true" : "false"}`, { schema: statusSchema }));
  },

  async verify(id) {
    const r = await post(`/api/v1/payments/intents/${id}/verify`, z.object({
      status: z.enum(STATUSES), settlement_verified: z.boolean(), receipt_reference: nullableStr, transaction_hash: nullableStr,
    }));
    return { status: r.status as PaymentStatus, verified: r.settlement_verified, receiptReference: r.receipt_reference, txHash: r.transaction_hash };
  },

  async cancel(id) {
    return toRecord(await post(`/api/v1/payments/intents/${id}/cancel`, intentSchema));
  },

  receipt: receiptOrNull,

  async getPolicy() {
    try {
      return toPolicy(await apiRequest("/api/v1/policies/me", { schema: policySchema }));
    } catch (e) {
      if (e instanceof ApiError && (e.code === "policy_not_found" || e.status === 404)) return null;
      throw e;
    }
  },

  async savePolicy(i) {
    return toPolicy(await apiRequest("/api/v1/policies/me", {
      method: "PUT", schema: policySchema,
      body: {
        max_transaction_amount: i.maxTransactionAmount, daily_spending_limit: i.dailySpendingLimit, allow_all_agents: i.allowAllAgents,
        permitted_agent_ids: i.permittedAgentIds, allowed_assets: i.allowedAssets, allowed_chain_ids: i.allowedChainIds, enabled: i.enabled,
      },
    }));
  },
};

/** Only an https URL may ever be opened for the HSP checkout. */
export function assertHttps(url: string): string {
  try {
    if (new URL(url).protocol === "https:") return url;
  } catch { /* fall through */ }
  throw new ApiError("The backend returned a payment link that is not a secure https URL. It was not opened.", 0, "unsafe_payment_url");
}

/** POST /payments/intents with an Idempotency-Key; 201 = created, 200 = existing intent returned. */
async function fetchWithStatus(requestId: string, body: unknown): Promise<{ intent: IntentDto; created: boolean }> {
  const before = await apiRequest(`/api/v1/payments/intents?request_id=${encodeURIComponent(requestId)}&limit=20`, { schema: page(intentSchema) });
  const known = new Set(before.items.map((i) => i.id));
  const intent = await post("/api/v1/payments/intents", intentSchema, body, { "Idempotency-Key": idempotencyKey(requestId) });
  return { intent, created: !known.has(intent.id) };
}
