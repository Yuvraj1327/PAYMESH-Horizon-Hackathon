import { env } from "@/lib/env";
import { cmp } from "@/lib/money";
import { trimDecimal } from "@/lib/decimal";
import { delay, NotFoundError } from "@/services/errors";
import { getDb } from "@/services/demo/store";
import { uid } from "@/services/demo/engine";
import { DEMO_AGENTS } from "@/services/demo/agents";
import { HspUnavailableError, PaymentBlockedError, type PaymentsBackend } from "@/services/payments/types";
import type {
  GuardianResult, PaymentEvent, PaymentRecord, PaymentReview, PaymentStatus, PolicyInput, Receipt, RuleFailure, SpendingPolicy,
} from "@/types/payment";
import { isTerminal } from "@/types/payment";

/**
 * Demo payment engine — a stand-in for the backend used ONLY while NEXT_PUBLIC_API_BASE_URL is empty.
 * Everything it produces is labelled demo (`source: "demo"`). It can walk a payment to the review step, but it can
 * never create an HSP order, sign, submit or settle anything, and it never generates transaction hashes.
 * The Guardian logic here mirrors the backend's rule *names* so the UI behaves the same, but the real enforcement is
 * the backend's; this file is not shipped logic for live mode.
 */
interface DemoPaymentsDb {
  version: 1;
  payments: PaymentRecord[];
  events: PaymentEvent[];
  reviews: Record<string, PaymentReview>;
  receipts: Record<string, Receipt>;
  policy: SpendingPolicy;
}

const KEY = "paymesh.demo.payments.v1";
let cache: DemoPaymentsDb | null = null;
const TTL_MS = 30 * 60_000;

const isoAgo = (h: number, now: Date) => new Date(now.getTime() - h * 3_600_000).toISOString();

export function defaultDemoPolicy(now: Date): SpendingPolicy {
  return {
    id: "demo-policy", maxTransactionAmount: "1", dailySpendingLimit: "2", allowAllAgents: true, permittedAgentIds: [],
    allowedAssets: ["USDT"], allowedChainIds: [env.chainId], enabled: true, updatedAt: now.toISOString(), source: "demo",
  };
}

export function createSeed(now: Date, requestIdByTitle: (t: string) => string | undefined = () => undefined): DemoPaymentsDb {
  const mk = (n: number, status: PaymentStatus, provider: [string, string], amount: string, ageH: number, extra: Partial<PaymentRecord> = {}): PaymentRecord => ({
    id: `demo-pay-${n}`, requestId: extra.requestId ?? `demo-sample-${n}`, quotationId: `demo-quote-${n}`, providerAgentId: provider[0], providerName: provider[1],
    amount, asset: "USDT", chainId: env.chainId, recipient: null, status, failureReason: null,
    expiresAt: new Date(now.getTime() - (ageH - 0.5) * 3_600_000).toISOString(), snapshotHash: null,
    createdAt: isoAgo(ageH, now), updatedAt: isoAgo(ageH - 0.2, now), txHash: null, source: "demo", ...extra,
  });
  const payments: PaymentRecord[] = [
    mk(1, "SETTLED", ["crypto-research-agent", "Crypto Research Agent"], "0.25", 51, { requestId: requestIdByTitle("Weekly sector overview (sample)") ?? "demo-sample-1" }),
    mk(2, "PENDING", ["market-data-agent", "Market Data Agent"], "0.4", 0.6, { expiresAt: new Date(now.getTime() + 20 * 60_000).toISOString() }),
    mk(3, "AWAITING_SIGNATURE", ["ai-analytics-agent", "AI Analytics Agent"], "0.6", 0.3, { expiresAt: new Date(now.getTime() + 25 * 60_000).toISOString() }),
    mk(4, "VALIDATED", ["crypto-research-agent", "Crypto Research Agent"], "0.25", 0.1, { expiresAt: new Date(now.getTime() + 28 * 60_000).toISOString() }),
    mk(5, "FAILED", ["market-data-agent", "Market Data Agent"], "0.4", 26, { failureReason: "revalidation_failed (sample)" }),
    mk(6, "EXPIRED", ["ai-analytics-agent", "AI Analytics Agent"], "0.6", 74),
  ];
  const events: PaymentEvent[] = payments.flatMap((p) => {
    const base: PaymentEvent[] = [{ id: `${p.id}-e1`, paymentId: p.id, type: "payment_intent_created", data: { sample: true }, at: p.createdAt }];
    if (p.status !== "VALIDATED") base.push({ id: `${p.id}-e2`, paymentId: p.id, type: p.status === "SETTLED" ? "payment_settled" : p.status === "FAILED" ? "payment_failed" : p.status === "EXPIRED" ? "payment_expired" : "payment_authorization_requested", data: { sample: true }, at: p.updatedAt });
    return base;
  });
  const receipts: Record<string, Receipt> = {
    "demo-pay-1": {
      id: "demo-receipt-1", paymentId: "demo-pay-1", reference: "DEMO-SAMPLE-0001", txHash: null, settlementStatus: "demo_sample", chainId: env.chainId,
      tokenAddress: null, payerAddress: null, recipient: null, verifiedAmount: null, blockNumber: null, verifiedAt: null, createdAt: isoAgo(50.8, now), checks: [], source: "demo",
    },
  };
  return { version: 1, payments, events, reviews: {}, receipts, policy: defaultDemoPolicy(now) };
}

function isDb(x: unknown): x is DemoPaymentsDb {
  const d = x as Partial<DemoPaymentsDb> | null;
  return !!d && d.version === 1 && Array.isArray(d.payments) && Array.isArray(d.events) && !!d.policy;
}

function persist() {
  if (typeof window === "undefined" || !cache) return;
  try { window.sessionStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* keep in memory */ }
}

export function getPaymentsDb(): DemoPaymentsDb {
  if (cache) return cache;
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) { const p: unknown = JSON.parse(raw); if (isDb(p)) { cache = p; return cache; } }
    } catch { /* fall through to a fresh seed */ }
  }
  const reqs = getDb().requests;
  cache = createSeed(new Date(), (t) => reqs.find((r) => r.title === t)?.id);
  persist();
  return cache;
}

export function resetPaymentsDb(): void { cache = null; if (typeof window !== "undefined") try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ } }

function mutate<T>(fn: (db: DemoPaymentsDb) => T): T { const r = fn(getPaymentsDb()); persist(); return r; }

function find(db: DemoPaymentsDb, id: string): PaymentRecord {
  const p = db.payments.find((x) => x.id === id);
  if (!p) throw new NotFoundError("Payment");
  return p;
}

function addEvent(db: DemoPaymentsDb, paymentId: string, type: string, data: Record<string, unknown> = {}) {
  db.events.push({ id: uid("evt"), paymentId, type, data, at: new Date().toISOString() });
}

/** Demo stand-in for the backend Guardian: returns rule failures using the backend's rule names. */
export function evaluateDemo(policy: SpendingPolicy, c: { amount: string; asset: string; chainId: number; providerAgentId: string; budget?: string; todayCommitted: string; now?: Date }): RuleFailure[] {
  const f: RuleFailure[] = [];
  if (!policy.enabled) { f.push({ rule: "policy_disabled", message: "Spending policy is disabled" }); return f; }
  if (cmp(c.amount, policy.maxTransactionAmount) > 0) f.push({ rule: "max_transaction_amount", message: "Amount exceeds the per-transaction limit" });
  if (c.budget && cmp(c.amount, c.budget) > 0) f.push({ rule: "budget_exceeded", message: "Quotation price exceeds the request budget" });
  if (!policy.allowedAssets.includes(c.asset)) f.push({ rule: "policy_asset", message: "Asset is not permitted by the spending policy" });
  if (!policy.allowedChainIds.includes(c.chainId)) f.push({ rule: "policy_network", message: "Network is not permitted by the spending policy" });
  if (!policy.allowAllAgents && !policy.permittedAgentIds.includes(c.providerAgentId)) f.push({ rule: "policy_agent", message: "Provider agent is not on the permitted-agents list" });
  const total = trimDecimal((Number(c.todayCommitted) + Number(c.amount)).toFixed(6));
  if (cmp(total, policy.dailySpendingLimit) > 0) f.push({ rule: "daily_limit", message: `Daily spending limit exceeded (already committed ${c.todayCommitted} ${c.asset})` });
  return f;
}

function committedToday(db: DemoPaymentsDb, asset: string, excludeId?: string): string {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  let sum = 0;
  for (const p of db.payments) {
    if (p.id === excludeId || p.asset !== asset || new Date(p.createdAt) < start) continue;
    if (p.status === "FAILED" || p.status === "EXPIRED" || p.status === "CANCELLED") continue;
    sum += Number(p.amount);
  }
  return trimDecimal(sum.toFixed(6));
}

function guardian(db: DemoPaymentsDb, p: PaymentRecord): GuardianResult {
  const failures = evaluateDemo(db.policy, { amount: p.amount, asset: p.asset, chainId: p.chainId, providerAgentId: p.providerAgentId, todayCommitted: committedToday(db, p.asset, p.id) });
  return { evaluated: true, valid: failures.length === 0, failures, hspConfigured: null, source: "demo" };
}

const sim = () => delay(250);

export const demoBackend: PaymentsBackend = {
  async list() { await sim(); const db = getPaymentsDb(); const items = [...db.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return { items, total: items.length, truncated: false }; },

  async detail(id) {
    await sim();
    const db = getPaymentsDb(); const payment = find(db, id);
    const status = { paymentId: id, status: payment.status, settledAndVerified: payment.status === "SETTLED", hsp: null, throttled: false, note: "Demo record: no HSP order exists and nothing was settled on-chain." };
    return { payment, status, receipt: db.receipts[id] ?? null, events: db.events.filter((e) => e.paymentId === id).sort((a, b) => a.at.localeCompare(b.at)), review: db.reviews[id] ?? null };
  },

  async activeForRequest(requestId) { await sim(); const db = getPaymentsDb(); return db.payments.filter((p) => p.requestId === requestId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null; },

  async create(requestId) {
    await sim();
    const procurement = getDb();
    const req = procurement.requests.find((r) => r.id === requestId);
    if (!req) throw new NotFoundError("Procurement request");
    const q = procurement.quotations.find((x) => x.id === req.selectedQuotationId);
    if (req.status !== "provider_selected" || !q) throw new PaymentBlockedError("Select a provider before creating a payment.", [{ rule: "provider_selection", message: "No provider is selected for this request" }]);
    return mutate((db) => {
      const existing = db.payments.find((p) => p.requestId === requestId && !["FAILED", "EXPIRED", "CANCELLED"].includes(p.status));
      if (existing) return { payment: existing, created: false };
      const now = new Date();
      const draft: PaymentRecord = {
        id: uid("pay"), requestId, quotationId: q.id, providerAgentId: q.agentId, providerName: DEMO_AGENTS.find((a) => a.id === q.agentId)?.name ?? "Provider agent",
        amount: q.price, asset: q.asset, chainId: env.chainId, recipient: null, status: "VALIDATED", failureReason: null,
        expiresAt: new Date(now.getTime() + TTL_MS).toISOString(), snapshotHash: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), txHash: null, source: "demo",
      };
      const failures = evaluateDemo(db.policy, { amount: draft.amount, asset: draft.asset, chainId: draft.chainId, providerAgentId: draft.providerAgentId, budget: req.maxBudget, todayCommitted: committedToday(db, draft.asset) });
      if (failures.length) throw new PaymentBlockedError("Payment validation failed: " + failures.map((x) => x.rule).join("; "), failures);
      db.payments.push(draft);
      addEvent(db, draft.id, "payment_intent_created", { demo: true });
      return { payment: draft, created: true };
    });
  },

  async validate(id) { await sim(); const db = getPaymentsDb(); return guardian(db, find(db, id)); },

  async authorize(id) {
    await sim();
    return mutate((db) => {
      const p = find(db, id);
      if (p.status !== "VALIDATED") throw new PaymentBlockedError(`Cannot request authorization from status ${p.status}`, []);
      const g = guardian(db, p);
      if (!g.valid) { p.status = "FAILED"; p.failureReason = "revalidation_failed"; throw new PaymentBlockedError("Payment validation failed: " + g.failures.map((x) => x.rule).join("; "), g.failures); }
      p.status = "AWAITING_SIGNATURE"; p.updatedAt = new Date().toISOString();
      const review: PaymentReview = { payerWallet: null, providerName: p.providerName, providerAgentId: p.providerAgentId, recipient: null, amount: p.amount, asset: p.asset, chainId: p.chainId, expiresAt: p.expiresAt, snapshotHash: null };
      db.reviews[id] = review;
      addEvent(db, id, "payment_authorization_requested", { demo: true });
      return { payment: p, review };
    });
  },

  async createMandate() { await sim(); throw new HspUnavailableError(); },
  async signingData() { await sim(); throw new HspUnavailableError(); },
  async verify() { await sim(); throw new HspUnavailableError(); },

  async status(id) {
    const db = getPaymentsDb(); const p = find(db, id);
    return { paymentId: id, status: p.status, settledAndVerified: p.status === "SETTLED", hsp: null, throttled: false, note: "Demo record: no HSP order exists and nothing was settled on-chain." };
  },

  async cancel(id) {
    await sim();
    return mutate((db) => {
      const p = find(db, id);
      if (isTerminal(p.status) || !["VALIDATED", "AWAITING_SIGNATURE", "DRAFT"].includes(p.status)) throw new PaymentBlockedError(`Payment in status ${p.status} can no longer be cancelled`, []);
      p.status = "CANCELLED"; p.updatedAt = new Date().toISOString(); addEvent(db, id, "payment_cancelled", { demo: true });
      return p;
    });
  },

  async receipt(id) { await sim(); return getPaymentsDb().receipts[id] ?? null; },

  async getPolicy() { await sim(); return getPaymentsDb().policy; },

  async savePolicy(i: PolicyInput) {
    await sim();
    return mutate((db) => { db.policy = { id: db.policy.id, ...i, updatedAt: new Date().toISOString(), source: "demo" }; return db.policy; });
  },
};
