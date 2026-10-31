import { describe, expect, it } from "vitest";
import { buildGuardianChecks, isBlocked } from "@/lib/guardian";
import { computeKpis, matchesFilter } from "@/lib/payment-status";
import { queryTransactions } from "@/lib/transactions";
import { buildReceiptDocument } from "@/lib/receipt";
import { describeWalletError } from "@/lib/web3/errors";
import { explorerTxUrl, chainLabel, isSupportedChainId } from "@/lib/web3/chains";
import { shortAddress, sameAddress } from "@/lib/web3/address";
import { singleFlight } from "@/lib/single-flight";
import { formatTokenAmount, trimDecimal } from "@/lib/decimal";
import { parseIds, policyFormSchema } from "@/lib/policy-validation";
import { createSeed, evaluateDemo, defaultDemoPolicy } from "@/services/demo/payments";
import type { GuardianResult, PaymentRecord } from "@/types/payment";

const rec = (o: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "p1", requestId: "r1", quotationId: "q1", providerAgentId: "a1", providerName: "Agent", amount: "0.25", asset: "USDT", chainId: 133,
  recipient: null, status: "VALIDATED", failureReason: null, expiresAt: "2030-01-01T00:00:00Z", snapshotHash: null,
  createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", txHash: null, source: "live", ...o,
});
const result = (failures: { rule: string; message: string }[], extra: Partial<GuardianResult> = {}): GuardianResult => ({ evaluated: true, valid: failures.length === 0, failures, hspConfigured: true, source: "live", ...extra });
const state = (checks: ReturnType<typeof buildGuardianChecks>, id: string) => checks.find((c) => c.id === id)?.state;

describe("Payment Guardian presentation", () => {
  it("shows 'not checked' before the backend has been asked, and never 'passed'", () => {
    const c = buildGuardianChecks(null);
    expect(c.map((x) => x.id)).toEqual(["max_amount", "daily_limit", "providers", "assets", "networks", "expiry"]);
    expect(c.every((x) => x.state === "not_evaluated")).toBe(true);
    expect(isBlocked(c)).toBe(false);
  });
  it("passes every group when the backend reports no failures", () => {
    const c = buildGuardianChecks(result([]), { now: Date.parse("2026-10-01") });
    expect(c.every((x) => x.state === "passed")).toBe(true);
  });
  it("blocks only the group of the failed rule", () => {
    const c = buildGuardianChecks(result([{ rule: "daily_limit", message: "Daily spending limit exceeded" }]));
    expect(state(c, "daily_limit")).toBe("blocked");
    expect(state(c, "max_amount")).toBe("passed");
    expect(isBlocked(c)).toBe(true);
  });
  it("blocks all policy checks when the policy is missing", () => {
    const c = buildGuardianChecks(result([{ rule: "policy_missing", message: "No spending policy configured" }]));
    for (const id of ["max_amount", "daily_limit", "providers", "assets", "networks"]) expect(state(c, id)).toBe("blocked");
    expect(state(c, "policy")).toBe("blocked");
  });
  it("keeps unknown backend rules visible and blocking", () => {
    const c = buildGuardianChecks(result([{ rule: "something_new", message: "New rule" }]));
    expect(state(c, "other")).toBe("blocked");
  });
  it("warns when the authorization window is nearly over and blocks when over (display of backend expires_at)", () => {
    const now = Date.parse("2026-10-01T10:00:00Z");
    expect(state(buildGuardianChecks(result([]), { expiresAt: "2026-10-01T10:03:00Z", now }), "expiry")).toBe("warning");
    expect(state(buildGuardianChecks(result([]), { expiresAt: "2026-10-01T09:59:00Z", now }), "expiry")).toBe("blocked");
    expect(state(buildGuardianChecks(result([]), { expiresAt: "2026-10-01T11:00:00Z", now }), "expiry")).toBe("passed");
  });
  it("warns when HSP is not configured on the backend", () => {
    expect(state(buildGuardianChecks(result([], { hspConfigured: false })), "hsp")).toBe("warning");
  });
});

describe("payment status helpers", () => {
  it("maps statuses to the requested filters", () => {
    expect(matchesFilter("AWAITING_SIGNATURE", "awaiting_authorization")).toBe(true);
    for (const s of ["SIGNED", "SUBMITTED", "PENDING"] as const) expect(matchesFilter(s, "processing")).toBe(true);
    expect(matchesFilter("SETTLED", "completed")).toBe(true);
    expect(matchesFilter("SETTLED", "pending")).toBe(false);
    expect(matchesFilter("PENDING", "pending")).toBe(true);
    expect(matchesFilter("EXPIRED", "expired")).toBe(true);
    expect(matchesFilter("EXPIRED", "failed")).toBe(false);
  });
  it("computes KPIs; volume counts only settled payments, per asset, exactly", () => {
    const k = computeKpis([
      rec({ id: "a", status: "SETTLED", amount: "0.1" }), rec({ id: "b", status: "SETTLED", amount: "0.2" }), rec({ id: "c", status: "SETTLED", amount: "1.5", asset: "USDC" }),
      rec({ id: "d", status: "PENDING" }), rec({ id: "e", status: "FAILED" }), rec({ id: "f", status: "EXPIRED" }), rec({ id: "g", status: "CANCELLED" }),
    ]);
    expect(k).toMatchObject({ total: 7, successful: 3, pending: 1, failed: 2 });
    expect(k.volume).toEqual([{ asset: "USDT", amount: "0.3" }, { asset: "USDC", amount: "1.5" }]);
  });
});

describe("transactions query", () => {
  const items = Array.from({ length: 25 }, (_, i) => rec({ id: `pay-${String(i).padStart(2, "0")}`, createdAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`, chainId: i % 2 ? 177 : 133, status: i % 5 === 0 ? "SETTLED" : "PENDING", txHash: i === 3 ? `0x${"ab".repeat(32)}` : null }));
  const base = { text: "", status: "all" as const, network: "all" as const, sort: "newest" as const, page: 1, pageSize: 10 };
  it("sorts by date and paginates, clamping the page", () => {
    const r = queryTransactions(items, base);
    expect(r).toMatchObject({ total: 25, pages: 3, page: 1 });
    expect(r.rows[0]?.id).toBe("pay-24");
    expect(queryTransactions(items, { ...base, sort: "oldest" }).rows[0]?.id).toBe("pay-00");
    expect(queryTransactions(items, { ...base, page: 99 }).page).toBe(3);
    expect(queryTransactions(items, { ...base, page: 3 }).rows).toHaveLength(5);
  });
  it("searches by payment id or transaction hash and filters by status and network", () => {
    expect(queryTransactions(items, { ...base, text: "PAY-07" }).rows.map((r) => r.id)).toEqual(["pay-07"]);
    expect(queryTransactions(items, { ...base, text: "ABABAB" }).rows.map((r) => r.id)).toEqual(["pay-03"]);
    expect(queryTransactions(items, { ...base, status: "completed" }).total).toBe(5);
    expect(queryTransactions(items, { ...base, network: "177" }).total).toBe(12);
  });
});

describe("receipts", () => {
  it("refuses to build a receipt for a payment that is not settled", () => {
    const receipt = { id: "r", paymentId: "p1", reference: "R1", txHash: null, settlementStatus: "x", chainId: 133, tokenAddress: null, payerAddress: null, recipient: null, verifiedAmount: null, blockNumber: null, verifiedAt: null, createdAt: "", checks: [], source: "live" as const };
    expect(() => buildReceiptDocument(rec({ status: "PENDING" }), receipt)).toThrow();
    expect(buildReceiptDocument(rec({ status: "SETTLED" }), receipt).reference).toBe("R1");
    expect(buildReceiptDocument(rec({ status: "SETTLED", source: "demo" }), { ...receipt, source: "demo" }).kind).toBe("paymesh.demo-receipt");
  });
});

describe("demo payments engine", () => {
  const now = new Date("2026-10-31T10:00:00Z");
  it("seeds labelled demo records without transaction hashes or addresses", () => {
    const db = createSeed(now);
    expect(db.payments.length).toBeGreaterThanOrEqual(6);
    for (const p of db.payments) { expect(p.source).toBe("demo"); expect(p.txHash).toBeNull(); expect(p.recipient).toBeNull(); }
    for (const r of Object.values(db.receipts)) { expect(r.source).toBe("demo"); expect(r.txHash).toBeNull(); }
    expect(new Set(db.payments.map((p) => p.status))).toEqual(new Set(["SETTLED", "PENDING", "AWAITING_SIGNATURE", "VALIDATED", "FAILED", "EXPIRED"]));
  });
  it("evaluates the stand-in Guardian with the backend's rule names", () => {
    const policy = defaultDemoPolicy(now);
    const ok = { amount: "0.25", asset: "USDT", chainId: 133, providerAgentId: "x", todayCommitted: "0" };
    expect(evaluateDemo(policy, ok)).toEqual([]);
    expect(evaluateDemo(policy, { ...ok, amount: "1.5" }).map((f) => f.rule)).toContain("max_transaction_amount");
    expect(evaluateDemo(policy, { ...ok, todayCommitted: "1.9" }).map((f) => f.rule)).toContain("daily_limit");
    expect(evaluateDemo(policy, { ...ok, asset: "USDC" }).map((f) => f.rule)).toContain("policy_asset");
    expect(evaluateDemo(policy, { ...ok, chainId: 177 }).map((f) => f.rule)).toContain("policy_network");
    expect(evaluateDemo({ ...policy, allowAllAgents: false }, ok).map((f) => f.rule)).toContain("policy_agent");
    expect(evaluateDemo({ ...policy, enabled: false }, ok).map((f) => f.rule)).toEqual(["policy_disabled"]);
  });
});

describe("wallet helpers", () => {
  it("maps wallet errors to actionable messages", () => {
    expect(describeWalletError({ code: 4001 }).kind).toBe("rejected");
    expect(describeWalletError({ name: "UserRejectedRequestError", message: "x" }).kind).toBe("rejected");
    expect(describeWalletError({ name: "ConnectorNotFoundError" }).kind).toBe("unavailable");
    expect(describeWalletError({ code: 4902 }).kind).toBe("wrong_network");
    expect(describeWalletError({ code: -32002 }).kind).toBe("pending");
    expect(describeWalletError({ message: "insufficient funds for gas" }).message).toMatch(/HSK/);
    expect(describeWalletError({ name: "HttpRequestError", message: "fail" }).kind).toBe("rpc");
    expect(describeWalletError(new Error("boom")).kind).toBe("unknown");
    expect(describeWalletError({ cause: { code: 4001 } }).kind).toBe("rejected");
  });
  it("uses the verified chain ids; explorer links need a configured URL", () => {
    expect(isSupportedChainId(133) && isSupportedChainId(177)).toBe(true);
    expect(isSupportedChainId(1)).toBe(false);
    expect(chainLabel(133)).toBe("HashKey Chain Testnet");
    expect(chainLabel(1)).toBe("Unsupported network (1)");
    expect(explorerTxUrl(133, `0x${"a".repeat(64)}`)).toBeNull(); // no NEXT_PUBLIC_EXPLORER_URL_133 in tests
  });
  it("formats addresses", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress(null)).toBe("—");
    expect(sameAddress("0xAbC", "0xabc")).toBe(true);
    expect(sameAddress(null, "0xabc")).toBe(false);
  });
});

describe("misc", () => {
  it("single-flight shares one in-flight call per key", async () => {
    let calls = 0;
    const fn = () => new Promise<number>((r) => { calls += 1; setTimeout(() => r(calls), 10); });
    const [a, b] = await Promise.all([singleFlight("k", fn), singleFlight("k", fn)]);
    expect(a).toBe(b); expect(calls).toBe(1);
    await singleFlight("k", fn); expect(calls).toBe(2);
  });
  it("formats decimals without float rounding", () => {
    expect(trimDecimal("0.25000000")).toBe("0.25");
    expect(trimDecimal("5.000000")).toBe("5");
    expect(formatTokenAmount("0.000123")).toBe("0.000123");
    expect(formatTokenAmount("1234.5")).toBe("1,234.50");
    expect(formatTokenAmount("abc")).toBe("—");
  });
  it("validates the policy form inputs (backend still decides acceptance)", () => {
    const base = { maxTransactionAmount: "5", dailySpendingLimit: "20", enabled: true, allowAllAgents: true, permittedAgentIds: "", allowedAssets: ["USDT"], allowedChainIds: ["133"] };
    const live = policyFormSchema({ demo: false });
    expect(live.safeParse(base).success).toBe(true);
    expect(live.safeParse({ ...base, maxTransactionAmount: "0" }).success).toBe(false);
    expect(live.safeParse({ ...base, dailySpendingLimit: "1.1234567" }).success).toBe(false);
    expect(live.safeParse({ ...base, allowedAssets: [] }).success).toBe(false);
    expect(live.safeParse({ ...base, allowAllAgents: false }).success).toBe(false);
    expect(live.safeParse({ ...base, allowAllAgents: false, permittedAgentIds: "not-a-uuid" }).success).toBe(false);
    expect(live.safeParse({ ...base, allowAllAgents: false, permittedAgentIds: "123e4567-e89b-12d3-a456-426614174000" }).success).toBe(true);
    expect(policyFormSchema({ demo: true }).safeParse({ ...base, allowAllAgents: false, permittedAgentIds: "crypto-research-agent" }).success).toBe(true);
    expect(parseIds("a, b\nb;c")).toEqual(["a", "b", "c"]);
  });
});
